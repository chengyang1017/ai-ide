export interface VoiceControllerOptions {
  character: HTMLElement;
  onStateChange?: (state: VoiceState, message: string) => void;
}

export type VoiceState = 'idle' | 'speaking' | 'paused' | 'disabled' | 'error';

/**
 * Alpha 0.8：Renderer 内的本地 TTS 控制器。
 *
 * 不调用 OpenAI Audio API，也不需要额外 API Key。
 * 直接使用 Electron / Chromium 暴露的 Web Speech speechSynthesis，
 * 因此优先使用 Windows 本机已经安装的中文语音。
 */
export class VoiceController {
  private enabled = true;
  private rate = 1;
  private selectedVoiceName = '';
  private sequence = 0;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private resolveCurrent: (() => void) | null = null;
  private readonly character: HTMLElement;
  private readonly onStateChange?: VoiceControllerOptions['onStateChange'];

  constructor(options: VoiceControllerOptions) {
    this.character = options.character;
    this.onStateChange = options.onStateChange;
  }

  get isEnabled(): boolean {
    return this.enabled && this.isSupported();
  }

  get currentRate(): number {
    return this.rate;
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

    this.setState('idle', '语音已开启');
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

  getVoiceOptions(): Array<{ name: string; lang: string }> {
    if (!this.isSupported()) {
      return [];
    }

    return window.speechSynthesis
      .getVoices()
      .map((voice) => ({ name: voice.name, lang: voice.lang }));
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

    const speechId = this.invalidate();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(content);
    this.currentUtterance = utterance;
    utterance.rate = this.rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    const voice = this.resolveVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'zh-CN';
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
        this.setState('speaking', '正在朗读');
      };

      utterance.onpause = () => {
        if (speechId === this.sequence) {
          this.setState('paused', '语音已暂停');
        }
      };

      utterance.onresume = () => {
        if (speechId === this.sequence) {
          this.setState('speaking', '继续朗读');
        }
      };

      utterance.onend = () => {
        if (speechId === this.sequence) {
          this.currentUtterance = null;
          this.setState('idle', '等待下一段');
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

      this.setState('speaking', '正在朗读');
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
    this.setState(this.enabled ? 'idle' : 'disabled', this.enabled ? '等待讲解' : '语音已关闭');
  }

  private resolveVoice(): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices();

    if (this.selectedVoiceName) {
      const selected = voices.find((voice) => voice.name === this.selectedVoiceName);
      if (selected) {
        return selected;
      }
    }

    // 角色当前主要使用中文教学。优先系统中文声音，找不到再让系统使用默认声音。
    return voices.find((voice) => /^zh[-_]/i.test(voice.lang))
      ?? voices.find((voice) => voice.default);
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
