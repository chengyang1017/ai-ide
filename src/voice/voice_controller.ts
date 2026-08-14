export interface VoiceControllerOptions {
  character: HTMLElement;
  onStateChange?: (state: VoiceState, message: string) => void;
  onVoicesChanged?: (languages: VoiceLanguageOption[]) => void;
}

export type VoiceState = 'idle' | 'speaking' | 'paused' | 'disabled' | 'error';

export interface VoiceLanguageOption {
  code: string;
  label: string;
  available: boolean;
  voiceCount: number;
}

const LANGUAGE_PRESETS: Array<{ code: string; label: string }> = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'zh-TW', label: '中文（繁體）' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'vi-VN', label: 'Tiếng Việt' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'ky-KG', label: 'Кыргызча' },
  { code: 'tr-TR', label: 'Türkçe' },
  { code: 'ms-MY', label: 'Bahasa Melayu' },
  { code: 'id-ID', label: 'Bahasa Indonesia' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
];

/**
 * Alpha 0.9：Renderer 内的本地 TTS 控制器。
 *
 * - 不调用 OpenAI Audio API，也不需要额外 API Key。
 * - 使用 Electron / Chromium 暴露的 Web Speech speechSynthesis。
 * - 支持按语言选择系统语音，并处理 Windows/Chromium 异步加载 voices 的情况。
 */
export class VoiceController {
  private enabled = true;
  private rate = 1;
  private selectedVoiceName = '';
  private selectedLanguage = 'zh-CN';
  private sequence = 0;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private resolveCurrent: (() => void) | null = null;
  private readonly character: HTMLElement;
  private readonly onStateChange?: VoiceControllerOptions['onStateChange'];
  private readonly onVoicesChanged?: VoiceControllerOptions['onVoicesChanged'];

  constructor(options: VoiceControllerOptions) {
    this.character = options.character;
    this.onStateChange = options.onStateChange;
    this.onVoicesChanged = options.onVoicesChanged;

    if (this.isSupported()) {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        this.emitVoicesChanged();
      });

      // Chromium 第一次打开页面时 getVoices() 可能先返回空数组。
      // 下一轮事件循环再读一次，并等待后续 voiceschanged。
      window.setTimeout(() => this.emitVoicesChanged(), 0);
    }
  }

  get isEnabled(): boolean {
    return this.enabled && this.isSupported();
  }

  get currentRate(): number {
    return this.rate;
  }

  get currentLanguage(): string {
    return this.selectedLanguage;
  }

  isSupported(): boolean {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
      this.setState('disabled', '语音已关闭');
      return;
    }

    if (!this.isSupported()) {
      this.setState('error', '当前 Electron 环境不支持系统语音');
      return;
    }

    this.setState('idle', this.languageStatusMessage());
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate)) {
      return;
    }
    this.rate = Math.min(2, Math.max(0.5, rate));
  }

  setVoice(name: string): void {
    this.selectedVoiceName = name;
  }

  setLanguage(language: string): void {
    const normalized = language.trim();
    if (!normalized) {
      return;
    }

    this.selectedLanguage = normalized;
    this.selectedVoiceName = '';

    if (this.enabled) {
      this.setState('idle', this.languageStatusMessage());
    }
  }

  getVoiceOptions(): Array<{ name: string; lang: string }> {
    return this.getVoices()
      .map((voice) => ({ name: voice.name, lang: voice.lang }));
  }

  getLanguageOptions(): VoiceLanguageOption[] {
    const voices = this.getVoices();
    const options = new Map<string, VoiceLanguageOption>();

    for (const preset of LANGUAGE_PRESETS) {
      const matchingVoices = voices.filter((voice) => languageMatches(voice.lang, preset.code));
      options.set(preset.code, {
        code: preset.code,
        label: preset.label,
        available: matchingVoices.length > 0,
        voiceCount: matchingVoices.length,
      });
    }

    // 系统如果安装了预设之外的语言，也自动加入下拉框。
    for (const voice of voices) {
      const code = normalizeLanguageTag(voice.lang);
      if (!code || options.has(code)) {
        continue;
      }

      const voiceCount = voices.filter((candidate) => languageMatches(candidate.lang, code)).length;
      options.set(code, {
        code,
        label: code,
        available: true,
        voiceCount,
      });
    }

    return [...options.values()];
  }

  /**
   * 朗读一段 Tutor 台词。
   * Promise 会在当前语音真正结束后 resolve，
   * 因此调用链可以做到“说完这一段 → 再跳到下一段”。
   */
  async speak(text: string): Promise<void> {
    const content = text.trim();
    if (!content || !this.enabled) {
      return;
    }

    if (!this.isSupported()) {
      this.setState('error', '当前 Electron 环境不支持系统语音');
      return;
    }

    // Windows / Chromium 的 voices 往往异步注入。
    // 最多等一小段时间，避免第一次朗读直接掉到英文默认音。
    await this.waitForVoices();

    const speechId = this.invalidate();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(content);
    this.currentUtterance = utterance;
    utterance.rate = this.rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.lang = this.selectedLanguage;

    const voice = this.resolveVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.resolveCurrent === finish) {
          this.resolveCurrent = null;
        }
        resolve();
      };
      this.resolveCurrent = finish;

      utterance.onstart = () => {
        if (speechId !== this.sequence) {
          finish();
          return;
        }
        this.setState('speaking', `正在朗读 · ${this.languageLabel(this.selectedLanguage)}`);
      };

      utterance.onpause = () => {
        if (speechId === this.sequence) {
          this.setState('paused', '语音已暂停');
        }
      };

      utterance.onresume = () => {
        if (speechId === this.sequence) {
          this.setState('speaking', `继续朗读 · ${this.languageLabel(this.selectedLanguage)}`);
        }
      };

      utterance.onend = () => {
        if (speechId === this.sequence) {
          this.currentUtterance = null;
          this.setState('idle', this.languageStatusMessage());
        }
        finish();
      };

      utterance.onerror = (event) => {
        if (speechId === this.sequence) {
          this.currentUtterance = null;
          if (!['canceled', 'interrupted'].includes(event.error)) {
            this.setState('error', '系统语音播放失败');
          }
        }
        finish();
      };

      const resolvedVoice = this.resolveVoice();
      if (!resolvedVoice) {
        this.setState(
          'speaking',
          `${this.languageLabel(this.selectedLanguage)}未找到系统语音，可能回退到默认声音`,
        );
      } else {
        this.setState(
          'speaking',
          `正在朗读 · ${this.languageLabel(this.selectedLanguage)} · ${resolvedVoice.name}`,
        );
      }

      window.speechSynthesis.speak(utterance);
    });
  }

  pause(): void {
    if (!this.isSupported() || !this.currentUtterance) {
      return;
    }
    window.speechSynthesis.pause();
  }

  resume(): void {
    if (!this.isSupported() || !this.currentUtterance) {
      return;
    }
    window.speechSynthesis.resume();
  }

  stop(): void {
    this.invalidate();
    this.currentUtterance = null;
    const resolveCurrent = this.resolveCurrent;
    this.resolveCurrent = null;
    if (this.isSupported()) {
      window.speechSynthesis.cancel();
    }
    resolveCurrent?.();
    this.setState(
      this.enabled ? 'idle' : 'disabled',
      this.enabled ? this.languageStatusMessage() : '语音已关闭',
    );
  }

  private async waitForVoices(): Promise<void> {
    if (this.getVoices().length > 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        window.clearTimeout(timeout);
        resolve();
      };

      const onVoicesChanged = () => finish();
      const timeout = window.setTimeout(finish, 900);
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged, { once: true });
    });
  }

  private resolveVoice(): SpeechSynthesisVoice | undefined {
    const voices = this.getVoices();

    if (this.selectedVoiceName) {
      const selected = voices.find((voice) => voice.name === this.selectedVoiceName);
      if (selected) {
        return selected;
      }
    }

    const exact = voices.find(
      (voice) => normalizeLanguageTag(voice.lang).toLowerCase() === this.selectedLanguage.toLowerCase(),
    );
    if (exact) {
      return exact;
    }

    const sameLanguage = voices.find((voice) => languageMatches(voice.lang, this.selectedLanguage));
    if (sameLanguage) {
      return sameLanguage;
    }

    return undefined;
  }

  private getVoices(): SpeechSynthesisVoice[] {
    if (!this.isSupported()) {
      return [];
    }
    return window.speechSynthesis.getVoices();
  }

  private emitVoicesChanged(): void {
    this.onVoicesChanged?.(this.getLanguageOptions());
    if (this.enabled && !this.currentUtterance) {
      this.setState('idle', this.languageStatusMessage());
    }
  }

  private languageStatusMessage(): string {
    const voice = this.resolveVoice();
    const label = this.languageLabel(this.selectedLanguage);
    return voice
      ? `${label} · ${voice.name}`
      : `${label} · 系统未找到对应语音`;
  }

  private languageLabel(code: string): string {
    return LANGUAGE_PRESETS.find((preset) => preset.code === code)?.label ?? code;
  }

  private invalidate(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private setState(state: VoiceState, message: string): void {
    this.character.classList.toggle('voice-speaking', state === 'speaking');
    this.character.classList.toggle('voice-paused', state === 'paused');
    this.character.dataset.voiceState = state;
    this.onStateChange?.(state, message);
  }
}

function normalizeLanguageTag(value: string): string {
  return value.trim().replace('_', '-');
}

function languageMatches(voiceLanguage: string, requestedLanguage: string): boolean {
  const voice = normalizeLanguageTag(voiceLanguage).toLowerCase();
  const requested = normalizeLanguageTag(requestedLanguage).toLowerCase();

  if (voice === requested) {
    return true;
  }

  const voiceBase = voice.split('-')[0];
  const requestedBase = requested.split('-')[0];
  return Boolean(voiceBase && requestedBase && voiceBase === requestedBase);
}
