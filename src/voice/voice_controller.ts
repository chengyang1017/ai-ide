import type { NativeVoiceInfo } from '../electron_api';

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

export interface TutorVoiceOption {
  id: string;
  name: string;
  language: string;
  gender: string;
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
 * Alpha 0.10：Windows 原生 TTS 优先。
 *
 * Windows 上通过 Electron Main 调用 Windows.Media.SpeechSynthesis，避免 Chromium
 * speechSynthesis 看不到 Narrator / 系统已安装声音的问题。非 Windows 环境仍保留
 * Web Speech 作为开发期 fallback。
 */
export class VoiceController {
  private enabled = true;
  private rate = 1;
  private selectedVoiceId = '';
  private selectedLanguage = 'zh-CN';
  private sequence = 0;
  private nativeVoices: NativeVoiceInfo[] = [];
  private nativeReady = false;
  private currentAudio: HTMLAudioElement | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private resolveCurrent: (() => void) | null = null;
  private readonly character: HTMLElement;
  private readonly onStateChange?: VoiceControllerOptions['onStateChange'];
  private readonly onVoicesChanged?: VoiceControllerOptions['onVoicesChanged'];

  constructor(options: VoiceControllerOptions) {
    this.character = options.character;
    this.onStateChange = options.onStateChange;
    this.onVoicesChanged = options.onVoicesChanged;
  }

  async initialize(): Promise<void> {
    try {
      this.nativeVoices = await window.tutorIde.listNativeVoices();
      this.nativeReady = this.nativeVoices.length > 0;
    } catch (error) {
      this.nativeVoices = [];
      this.nativeReady = false;
      console.warn('Windows native TTS unavailable:', error);
    }

    if (!this.nativeReady && this.isWebSpeechSupported()) {
      window.speechSynthesis.addEventListener('voiceschanged', () => this.emitVoicesChanged());
      window.setTimeout(() => this.emitVoicesChanged(), 0);
    }

    this.emitVoicesChanged();
    if (this.enabled) {
      this.setState('idle', this.languageStatusMessage());
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

  get currentVoiceId(): string {
    return this.selectedVoiceId;
  }

  isSupported(): boolean {
    return this.nativeReady || this.isWebSpeechSupported();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
      this.setState('disabled', '语音已关闭');
      return;
    }

    if (!this.isSupported()) {
      this.setState('error', '没有可用的系统语音引擎');
      return;
    }

    this.setState('idle', this.languageStatusMessage());
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    this.rate = Math.min(2, Math.max(0.5, rate));
  }

  setVoice(id: string): void {
    this.selectedVoiceId = id;
    if (this.enabled) {
      this.setState('idle', this.languageStatusMessage());
    }
  }

  setLanguage(language: string): void {
    const normalized = normalizeLanguageTag(language);
    if (!normalized) return;

    this.selectedLanguage = normalized;
    const selected = this.resolveVoice();
    if (this.selectedVoiceId && (!selected || !languageMatches(selected.language, normalized))) {
      this.selectedVoiceId = '';
    }

    if (this.enabled) {
      this.setState('idle', this.languageStatusMessage());
    }
  }

  getVoiceOptions(language = this.selectedLanguage): TutorVoiceOption[] {
    return this.getVoices()
      .filter((voice) => languageMatches(voice.language, language))
      .map((voice) => ({
        id: voice.id,
        name: voice.name,
        language: voice.language,
        gender: voice.gender,
      }));
  }

  getLanguageOptions(): VoiceLanguageOption[] {
    const voices = this.getVoices();
    const options = new Map<string, VoiceLanguageOption>();

    for (const preset of LANGUAGE_PRESETS) {
      const matchingVoices = voices.filter((voice) => languageMatches(voice.language, preset.code));
      options.set(preset.code, {
        code: preset.code,
        label: preset.label,
        available: matchingVoices.length > 0,
        voiceCount: matchingVoices.length,
      });
    }

    for (const voice of voices) {
      const code = normalizeLanguageTag(voice.language);
      if (!code || options.has(code)) continue;

      const voiceCount = voices.filter((candidate) => languageMatches(candidate.language, code)).length;
      options.set(code, {
        code,
        label: code,
        available: true,
        voiceCount,
      });
    }

    return [...options.values()];
  }

  async speak(text: string): Promise<void> {
    const content = text.trim();
    if (!content || !this.enabled) return;

    if (!this.isSupported()) {
      this.setState('error', '没有可用的系统语音引擎');
      return;
    }

    const voice = this.resolveVoice();
    if (!voice) {
      this.setState('error', `${this.languageLabel(this.selectedLanguage)}没有安装可用语音`);
      return;
    }

    if (this.nativeReady) {
      await this.speakNative(content, voice);
      return;
    }

    await this.speakWeb(content, voice);
  }

  pause(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.setState('paused', '语音已暂停');
      return;
    }

    if (this.currentUtterance && this.isWebSpeechSupported()) {
      window.speechSynthesis.pause();
    }
  }

  resume(): void {
    if (this.currentAudio) {
      void this.currentAudio.play();
      this.setState('speaking', `继续朗读 · ${this.currentVoiceLabel()}`);
      return;
    }

    if (this.currentUtterance && this.isWebSpeechSupported()) {
      window.speechSynthesis.resume();
    }
  }

  stop(): void {
    this.invalidate();

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.removeAttribute('src');
      this.currentAudio.load();
      this.currentAudio = null;
    }

    this.currentUtterance = null;
    if (this.isWebSpeechSupported()) {
      window.speechSynthesis.cancel();
    }

    const resolveCurrent = this.resolveCurrent;
    this.resolveCurrent = null;
    resolveCurrent?.();

    this.setState(
      this.enabled ? 'idle' : 'disabled',
      this.enabled ? this.languageStatusMessage() : '语音已关闭',
    );
  }

  private async speakNative(content: string, voice: InternalVoice): Promise<void> {
    const speechId = this.invalidate();
    this.stopActivePlaybackOnly();
    this.setState('speaking', `正在生成语音 · ${voice.name}`);

    try {
      const result = await window.tutorIde.synthesizeSpeech({
        text: content,
        voiceId: voice.id,
        rate: this.rate,
      });

      if (speechId !== this.sequence) return;

      const audio = new Audio(`data:${result.mimeType || 'audio/wav'};base64,${result.audioBase64}`);
      this.currentAudio = audio;
      this.setState('speaking', `正在朗读 · ${result.voiceName || voice.name}`);

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (this.resolveCurrent === finish) this.resolveCurrent = null;
          resolve();
        };
        this.resolveCurrent = finish;

        audio.onended = () => {
          if (speechId === this.sequence) {
            this.currentAudio = null;
            this.setState('idle', this.languageStatusMessage());
          }
          finish();
        };
        audio.onerror = () => {
          if (speechId === this.sequence) {
            this.currentAudio = null;
            this.setState('error', 'Windows 原生语音播放失败');
          }
          finish();
        };

        void audio.play().catch(() => {
          this.setState('error', 'Windows 原生语音无法开始播放');
          finish();
        });
      });
    } catch (error) {
      if (speechId === this.sequence) {
        this.setState('error', error instanceof Error ? error.message : 'Windows 原生语音失败');
      }
    }
  }

  private async speakWeb(content: string, voice: InternalVoice): Promise<void> {
    if (!this.isWebSpeechSupported()) return;

    const speechId = this.invalidate();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    this.currentUtterance = utterance;
    utterance.rate = this.rate;
    utterance.lang = voice.language;
    utterance.voice = voice.webVoice ?? null;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.resolveCurrent === finish) this.resolveCurrent = null;
        resolve();
      };
      this.resolveCurrent = finish;

      utterance.onstart = () => {
        if (speechId === this.sequence) this.setState('speaking', `正在朗读 · ${voice.name}`);
      };
      utterance.onpause = () => {
        if (speechId === this.sequence) this.setState('paused', '语音已暂停');
      };
      utterance.onresume = () => {
        if (speechId === this.sequence) this.setState('speaking', `继续朗读 · ${voice.name}`);
      };
      utterance.onend = () => {
        if (speechId === this.sequence) {
          this.currentUtterance = null;
          this.setState('idle', this.languageStatusMessage());
        }
        finish();
      };
      utterance.onerror = () => {
        if (speechId === this.sequence) this.setState('error', '系统语音播放失败');
        finish();
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  private stopActivePlaybackOnly(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    if (this.isWebSpeechSupported()) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
    const resolveCurrent = this.resolveCurrent;
    this.resolveCurrent = null;
    resolveCurrent?.();
  }

  private resolveVoice(): InternalVoice | undefined {
    const voices = this.getVoices();

    if (this.selectedVoiceId) {
      const selected = voices.find((voice) => voice.id === this.selectedVoiceId);
      if (selected && languageMatches(selected.language, this.selectedLanguage)) return selected;
    }

    const exact = voices.find(
      (voice) => normalizeLanguageTag(voice.language).toLowerCase() === this.selectedLanguage.toLowerCase(),
    );
    return exact ?? voices.find((voice) => languageMatches(voice.language, this.selectedLanguage));
  }

  private getVoices(): InternalVoice[] {
    if (this.nativeReady) {
      return this.nativeVoices.map((voice) => ({
        id: voice.id,
        name: voice.name,
        language: normalizeLanguageTag(voice.language),
        gender: voice.gender,
      }));
    }

    if (!this.isWebSpeechSupported()) return [];
    return window.speechSynthesis.getVoices().map((voice) => ({
      id: `web:${voice.name}:${voice.lang}`,
      name: voice.name,
      language: normalizeLanguageTag(voice.lang),
      gender: '',
      webVoice: voice,
    }));
  }

  private emitVoicesChanged(): void {
    this.onVoicesChanged?.(this.getLanguageOptions());
    if (this.enabled && !this.currentAudio && !this.currentUtterance) {
      this.setState('idle', this.languageStatusMessage());
    }
  }

  private languageStatusMessage(): string {
    const voice = this.resolveVoice();
    const label = this.languageLabel(this.selectedLanguage);
    if (!voice) return `${label} · 未安装可用语音`;
    return `${label} · ${voice.name}${this.nativeReady ? ' · Windows 原生' : ''}`;
  }

  private currentVoiceLabel(): string {
    return this.resolveVoice()?.name ?? this.languageLabel(this.selectedLanguage);
  }

  private languageLabel(code: string): string {
    return LANGUAGE_PRESETS.find((preset) => preset.code === code)?.label ?? code;
  }

  private isWebSpeechSupported(): boolean {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
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

interface InternalVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
  webVoice?: SpeechSynthesisVoice;
}

function normalizeLanguageTag(value: string): string {
  return value.trim().replace('_', '-');
}

function languageMatches(voiceLanguage: string, requestedLanguage: string): boolean {
  const voice = normalizeLanguageTag(voiceLanguage).toLowerCase();
  const requested = normalizeLanguageTag(requestedLanguage).toLowerCase();
  if (voice === requested) return true;
  const voiceBase = voice.split('-')[0];
  const requestedBase = requested.split('-')[0];
  return Boolean(voiceBase && requestedBase && voiceBase === requestedBase);
}
