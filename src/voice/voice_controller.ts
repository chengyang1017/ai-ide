export interface VoiceControllerOptions {
  character: HTMLElement;
  onStateChange?: (state: VoiceState, message: string) => void;
  onVoicesChanged?: (languages: VoiceLanguageOption[]) => void;
}

export type VoiceState =
  | 'idle'
  | 'speaking'
  | 'paused'
  | 'disabled'
  | 'error';

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

const LANGUAGE_PRESETS: Array<{
  code: string;
  label: string;
}> = [
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
 * Alpha 0.18 compatibility wrapper using the original Alpha 0.8 voice engine.
 *
 * Voice playback intentionally returns to the earliest implementation:
 * - Renderer / Chromium speechSynthesis only
 * - one SpeechSynthesisUtterance per tutor speech
 * - no WindowsTtsBridge
 * - no audio-base64 synthesis
 * - no sentence chunk queue
 * - no pre-generation
 *
 * The newer language / voice-selection API is kept so the current UI
 * can continue to compile and work.
 */
export class VoiceController {
  private enabled = true;
  private rate = 1;
  private selectedVoiceId = '';
  private selectedLanguage = 'zh-CN';
  private sequence = 0;

  private currentUtterance:
    | SpeechSynthesisUtterance
    | null = null;

  private resolveCurrent:
    | (() => void)
    | null = null;

  private readonly character: HTMLElement;

  private readonly onStateChange?:
    VoiceControllerOptions['onStateChange'];

  private readonly onVoicesChanged?:
    VoiceControllerOptions['onVoicesChanged'];

  constructor(
    options: VoiceControllerOptions,
  ) {
    this.character = options.character;
    this.onStateChange =
      options.onStateChange;
    this.onVoicesChanged =
      options.onVoicesChanged;
  }

  async initialize(): Promise<void> {
    if (!this.isSupported()) {
      this.setState(
        'error',
        '当前 Electron 环境不支持系统语音',
      );
      this.emitVoicesChanged();
      return;
    }

    window.speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        this.emitVoicesChanged();
      },
    );

    // Chromium 的 voice 列表有时不会在构造后立即准备好。
    window.setTimeout(() => {
      this.emitVoicesChanged();
    }, 0);

    this.emitVoicesChanged();

    if (this.enabled) {
      this.setState(
        'idle',
        this.languageStatusMessage(),
      );
    }
  }

  get isEnabled(): boolean {
    return (
      this.enabled &&
      this.isSupported()
    );
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
    return (
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    );
  }

  setEnabled(
    enabled: boolean,
  ): void {
    this.enabled = enabled;

    if (!enabled) {
      this.stop();

      this.setState(
        'disabled',
        '语音已关闭',
      );

      return;
    }

    if (!this.isSupported()) {
      this.setState(
        'error',
        '当前 Electron 环境不支持系统语音',
      );

      return;
    }

    this.setState(
      'idle',
      this.languageStatusMessage(),
    );
  }

  setRate(
    rate: number,
  ): void {
    if (!Number.isFinite(rate)) {
      return;
    }

    this.rate = Math.min(
      2,
      Math.max(0.5, rate),
    );
  }

  setVoice(
    id: string,
  ): void {
    this.selectedVoiceId = id;

    if (this.enabled) {
      this.setState(
        'idle',
        this.languageStatusMessage(),
      );
    }
  }

  setLanguage(
    language: string,
  ): void {
    const normalized =
      normalizeLanguageTag(language);

    if (!normalized) {
      return;
    }

    this.selectedLanguage = normalized;

    const selected =
      this.resolveVoice();

    if (
      this.selectedVoiceId &&
      (
        !selected ||
        !languageMatches(
          selected.lang,
          normalized,
        )
      )
    ) {
      this.selectedVoiceId = '';
    }

    if (this.enabled) {
      this.setState(
        'idle',
        this.languageStatusMessage(),
      );
    }
  }

  getVoiceOptions(
    language = this.selectedLanguage,
  ): TutorVoiceOption[] {
    return this.getVoices()
      .filter((voice) => {
        return languageMatches(
          voice.lang,
          language,
        );
      })
      .map((voice) => {
        return {
          id: voiceIdOf(voice),
          name: voice.name,
          language:
            normalizeLanguageTag(
              voice.lang,
            ),
          gender: '',
        };
      });
  }

  getLanguageOptions():
    VoiceLanguageOption[] {
    const voices =
      this.getVoices();

    const options =
      new Map<
        string,
        VoiceLanguageOption
      >();

    for (
      const preset
      of LANGUAGE_PRESETS
    ) {
      const matchingVoices =
        voices.filter((voice) => {
          return languageMatches(
            voice.lang,
            preset.code,
          );
        });

      options.set(
        preset.code,
        {
          code: preset.code,
          label: preset.label,
          available:
            matchingVoices.length > 0,
          voiceCount:
            matchingVoices.length,
        },
      );
    }

    for (const voice of voices) {
      const code =
        normalizeLanguageTag(
          voice.lang,
        );

      if (
        !code ||
        options.has(code)
      ) {
        continue;
      }

      const voiceCount =
        voices.filter((candidate) => {
          return languageMatches(
            candidate.lang,
            code,
          );
        }).length;

      options.set(
        code,
        {
          code,
          label: code,
          available: true,
          voiceCount,
        },
      );
    }

    return [
      ...options.values(),
    ];
  }

  /**
   * Original Alpha 0.8 playback behavior:
   * one full tutor speech -> one Web Speech utterance.
   */
  async speak(
    text: string,
  ): Promise<void> {
    const content =
      text.trim();

    if (
      !content ||
      !this.enabled
    ) {
      return;
    }

    if (!this.isSupported()) {
      this.setState(
        'error',
        '当前 Electron 环境不支持系统语音',
      );

      return;
    }

    // A new tutor speech must immediately take ownership of playback.
    // Resolve the previous speak() first so an interrupted explanation
    // cannot leave its caller waiting forever.
    const speechId =
      this.interruptCurrentSpeech();

    const utterance =
      new SpeechSynthesisUtterance(
        content,
      );

    this.currentUtterance =
      utterance;

    utterance.rate =
      this.rate;

    // These were the original Alpha 0.8 values.
    utterance.pitch = 1;
    utterance.volume = 1;

    const voice =
      this.resolveVoice();

    if (voice) {
      utterance.voice = voice;
      utterance.lang =
        voice.lang;
    } else {
      utterance.lang =
        this.selectedLanguage ||
        'zh-CN';
    }

    await new Promise<void>(
      (resolve) => {
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }

          settled = true;

          if (
            this.resolveCurrent ===
            finish
          ) {
            this.resolveCurrent =
              null;
          }

          resolve();
        };

        this.resolveCurrent =
          finish;

        utterance.onstart = () => {
          if (
            speechId !==
            this.sequence
          ) {
            finish();
            return;
          }

          this.setState(
            'speaking',
            '正在朗读',
          );
        };

        utterance.onpause = () => {
          if (
            speechId ===
            this.sequence
          ) {
            this.setState(
              'paused',
              '语音已暂停',
            );
          }
        };

        utterance.onresume = () => {
          if (
            speechId ===
            this.sequence
          ) {
            this.setState(
              'speaking',
              '继续朗读',
            );
          }
        };

        utterance.onend = () => {
          if (
            speechId ===
            this.sequence
          ) {
            this.currentUtterance =
              null;

            this.setState(
              'idle',
              '等待下一段',
            );
          }

          finish();
        };

        utterance.onerror = (
          event,
        ) => {
          if (
            speechId ===
            this.sequence
          ) {
            this.currentUtterance =
              null;

            if (
              ![
                'canceled',
                'interrupted',
              ].includes(
                event.error,
              )
            ) {
              this.setState(
                'error',
                '系统语音播放失败',
              );
            }
          }

          finish();
        };

        this.setState(
          'speaking',
          '正在朗读',
        );

        window.speechSynthesis.speak(
          utterance,
        );
      },
    );
  }

  pause(): void {
    if (
      !this.isSupported() ||
      !this.currentUtterance
    ) {
      return;
    }

    window.speechSynthesis.pause();
  }

  resume(): void {
    if (
      !this.isSupported() ||
      !this.currentUtterance
    ) {
      return;
    }

    window.speechSynthesis.resume();
  }

  /**
   * Public interruption entry point for the tutor UI.
   * It intentionally keeps the original full-utterance voice engine;
   * it only makes interruption deterministic.
   */
  interrupt(): void {
    this.stop();
  }

  stop(): void {
    this.interruptCurrentSpeech();

    this.setState(
      this.enabled
        ? 'idle'
        : 'disabled',
      this.enabled
        ? '等待讲解'
        : '语音已关闭',
    );
  }

  /**
   * Cancel the current browser utterance and, just as importantly,
   * settle the Promise owned by the previous speak() call.
   *
   * Returning the new sequence id lets the next utterance start under
   * the same generation without a race with stale onend/onerror events.
   */
  private interruptCurrentSpeech():
    number {
    const speechId =
      this.invalidate();

    const resolveCurrent =
      this.resolveCurrent;

    this.resolveCurrent =
      null;

    this.currentUtterance =
      null;

    if (this.isSupported()) {
      // Chromium can occasionally keep a paused synthesizer sticky.
      // Resume first so cancel() always clears the active utterance.
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      window.speechSynthesis.cancel();
    }

    // Promise resolution is idempotent. Calling it here means callers of
    // an interrupted speak() can continue immediately instead of waiting
    // for Chromium to emit onerror/onend for the cancelled utterance.
    resolveCurrent?.();

    return speechId;
  }

  private resolveVoice():
    | SpeechSynthesisVoice
    | undefined {
    const voices =
      this.getVoices();

    if (
      this.selectedVoiceId
    ) {
      const selected =
        voices.find((voice) => {
          return (
            voiceIdOf(voice) ===
            this.selectedVoiceId
          );
        });

      if (
        selected &&
        languageMatches(
          selected.lang,
          this.selectedLanguage,
        )
      ) {
        return selected;
      }
    }

    const exact =
      voices.find((voice) => {
        return (
          normalizeLanguageTag(
            voice.lang,
          ).toLowerCase() ===
          this.selectedLanguage
            .toLowerCase()
        );
      });

    if (exact) {
      return exact;
    }

    const matching =
      voices.find((voice) => {
        return languageMatches(
          voice.lang,
          this.selectedLanguage,
        );
      });

    if (matching) {
      return matching;
    }

    // This is the same fallback philosophy as Alpha 0.8:
    // prefer Chinese for the default tutor, then the OS default.
    if (
      this.selectedLanguage
        .toLowerCase()
        .startsWith('zh')
    ) {
      const chinese =
        voices.find((voice) => {
          return /^zh[-_]/i.test(
            voice.lang,
          );
        });

      if (chinese) {
        return chinese;
      }
    }

    return voices.find(
      (voice) => voice.default,
    );
  }

  private getVoices():
    SpeechSynthesisVoice[] {
    if (!this.isSupported()) {
      return [];
    }

    return window
      .speechSynthesis
      .getVoices();
  }

  private emitVoicesChanged():
    void {
    this.onVoicesChanged?.(
      this.getLanguageOptions(),
    );

    if (
      this.enabled &&
      !this.currentUtterance
    ) {
      this.setState(
        'idle',
        this.languageStatusMessage(),
      );
    }
  }

  private languageStatusMessage():
    string {
    const voice =
      this.resolveVoice();

    const label =
      this.languageLabel(
        this.selectedLanguage,
      );

    if (!voice) {
      return `${label} · 未找到系统语音`;
    }

    return `${label} · ${voice.name} · Web Speech`;
  }

  private languageLabel(
    code: string,
  ): string {
    return (
      LANGUAGE_PRESETS.find(
        (preset) =>
          preset.code === code,
      )?.label ?? code
    );
  }

  private invalidate():
    number {
    this.sequence += 1;
    return this.sequence;
  }

  private setState(
    state: VoiceState,
    message: string,
  ): void {
    this.character.classList.toggle(
      'voice-speaking',
      state === 'speaking',
    );

    this.character.classList.toggle(
      'voice-paused',
      state === 'paused',
    );

    this.character.dataset.voiceState =
      state;

    this.onStateChange?.(
      state,
      message,
    );
  }
}

function voiceIdOf(
  voice: SpeechSynthesisVoice,
): string {
  return (
    `web:${voice.name}:` +
    `${voice.lang}`
  );
}

function normalizeLanguageTag(
  value: string,
): string {
  return value
    .trim()
    .replace('_', '-');
}

function languageMatches(
  voiceLanguage: string,
  requestedLanguage: string,
): boolean {
  const voice =
    normalizeLanguageTag(
      voiceLanguage,
    ).toLowerCase();

  const requested =
    normalizeLanguageTag(
      requestedLanguage,
    ).toLowerCase();

  if (voice === requested) {
    return true;
  }

  return (
    voice.split('-')[0] ===
    requested.split('-')[0]
  );
}