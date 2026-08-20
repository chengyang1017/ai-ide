import {
  Capacitor,
  registerPlugin,
} from '@capacitor/core';

import './android_app_shell';

interface AndroidProjectResult {
  cancelled: boolean;
  rootPath?: string;
  projectName?: string;
  files?: string[];
  directories?: string[];
  lastOpenFile?: string;
  createdPath?: string;
}

interface AndroidProjectPlugin {
  openProject(): Promise<AndroidProjectResult>;
  restoreProject(): Promise<AndroidProjectResult>;
  readProjectFile(options: {
    path: string;
  }): Promise<{
    path: string;
    content: string;
  }>;
  writeProjectFile(options: {
    path: string;
    content: string;
  }): Promise<{
    path: string;
    bytes: number;
  }>;
  readProjectAsset(options: {
    path: string;
  }): Promise<{
    path: string;
    mimeType: string;
    dataUrl: string;
  }>;
  createProjectFile(options: {
    path: string;
  }): Promise<AndroidProjectResult>;
  createProjectDirectory(options: {
    path: string;
  }): Promise<AndroidProjectResult>;
  writeClipboard(options: {
    text: string;
  }): Promise<{
    value: boolean;
  }>;
  readClipboard(): Promise<{
    text: string;
  }>;
  hasOpenAiKey(): Promise<{
    value: boolean;
  }>;
  setOpenAiKey(options: {
    apiKey: string;
  }): Promise<{
    value: boolean;
  }>;
  clearOpenAiKey(): Promise<{
    value: boolean;
  }>;
}

const AndroidProject =
  registerPlugin<AndroidProjectPlugin>(
    'AndroidProject',
  );

const DEFAULT_APPEARANCE = {
  color: '#111318',
  backgroundMode: 'solid' as const,
  gradientStart: '#171a2d',
  gradientEnd: '#412f66',
  gradientAngle: 135,
  scope: 'editor' as const,
  imageFile: '',
  imageOpacity: 0.42,
  overlayOpacity: 0.56,
  blur: 0,
  fit: 'cover' as const,
  position: 'center' as const,
};

const DEFAULT_VOICE = {
  enabled: true,
  language: 'zh-CN',
  voiceId: '',
  rate: 1,
};

function unsupported(
  feature: string,
): never {
  throw new Error(
    `Android 平板版暂未接入${feature}。`,
  );
}

if (
  Capacitor.getPlatform() === 'android'
) {
  window.addEventListener(
    'ai-ide-editor-native-copy',
    (event) => {
      const detail =
        (
          event as CustomEvent<{
            text?: string;
          }>
        ).detail;

      const text =
        detail?.text ?? '';

      void AndroidProject
        .writeClipboard({
          text,
        })
        .then(
          () => {
            window.dispatchEvent(
              new CustomEvent(
                'ai-ide-editor-clipboard-result',
                {
                  detail: {
                    kind: 'copy',
                    ok: true,
                  },
                },
              ),
            );
          },
        )
        .catch(
          (error) => {
            window.dispatchEvent(
              new CustomEvent(
                'ai-ide-editor-clipboard-result',
                {
                  detail: {
                    kind: 'copy',
                    ok: false,
                    message:
                      String(error),
                  },
                },
              ),
            );
          },
        );
    },
  );

  window.addEventListener(
    'ai-ide-editor-native-paste-request',
    () => {
      void AndroidProject
        .readClipboard()
        .then(
          (result) => {
            window.dispatchEvent(
              new CustomEvent(
                'ai-ide-editor-paste-text',
                {
                  detail: {
                    text:
                      result.text ?? '',
                  },
                },
              ),
            );
          },
        )
        .catch(
          (error) => {
            window.dispatchEvent(
              new CustomEvent(
                'ai-ide-editor-clipboard-result',
                {
                  detail: {
                    kind: 'paste',
                    ok: false,
                    message:
                      String(error),
                  },
                },
              ),
            );
          },
        );
    },
  );

  const loadAppearance = () => {
    try {
      const raw =
        localStorage.getItem(
          'code-tutor-android-appearance',
        );

      if (!raw) {
        return {
          ...DEFAULT_APPEARANCE,
        };
      }

      return {
        ...DEFAULT_APPEARANCE,
        ...JSON.parse(raw),
      };
    } catch {
      return {
        ...DEFAULT_APPEARANCE,
      };
    }
  };

  const loadVoice = () => {
    try {
      const raw =
        localStorage.getItem(
          'code-tutor-android-voice',
        );

      if (!raw) {
        return {
          ...DEFAULT_VOICE,
        };
      }

      return {
        ...DEFAULT_VOICE,
        ...JSON.parse(raw),
      };
    } catch {
      return {
        ...DEFAULT_VOICE,
      };
    }
  };

  window.tutorIde = {
    async openProject() {
      const result =
        await AndroidProject.openProject();

      if (
        result.cancelled ||
        !result.rootPath ||
        !result.projectName
      ) {
        return null;
      }

      return {
        rootPath: result.rootPath,
        projectName: result.projectName,
        files: result.files ?? [],
        directories:
          result.directories ?? [],
        lastOpenFile:
          result.lastOpenFile ?? '',
      };
    },

    async restoreProject() {
      const result =
        await AndroidProject.restoreProject();

      if (
        result.cancelled ||
        !result.rootPath ||
        !result.projectName
      ) {
        return null;
      }

      return {
        rootPath: result.rootPath,
        projectName: result.projectName,
        files: result.files ?? [],
        directories:
          result.directories ?? [],
        lastOpenFile:
          result.lastOpenFile ?? '',
      };
    },

    readProjectFile(relativePath) {
      return AndroidProject.readProjectFile({
        path: relativePath,
      });
    },

    readProjectAsset(relativePath) {
      return AndroidProject.readProjectAsset({
        path: relativePath,
      });
    },

    writeProjectFile(
      relativePath,
      content,
    ) {
      return AndroidProject.writeProjectFile({
        path: relativePath,
        content,
      });
    },

    async watchProjectFile(relativePath) {
      return {
        path: relativePath,
      };
    },

    async unwatchProjectFile() {
      return true;
    },

    onProjectFileChanged() {
      return () => {};
    },

    async openExternal(url) {
      window.open(
        url,
        '_blank',
        'noopener,noreferrer',
      );
      return true;
    },

    async listCodeNotes() {
      // 先保证 Android 项目浏览/编辑主链可用。
      // 项目便签持久化后续单独接 SAF。
      return [];
    },

    async upsertCodeNote() {
      return unsupported('项目便签写入');
    },

    async deleteCodeNote() {
      return false;
    },

    async importCodeNoteImage() {
      return unsupported('便签图片');
    },

    async readCodeNoteImage(assetPath) {
      const asset =
        await AndroidProject.readProjectAsset({
          path: assetPath,
        });

      return {
        path: asset.path,
        dataUrl: asset.dataUrl,
      };
    },

    async searchProject() {
      return [];
    },

    async findDartSemanticTargets() {
      return unsupported(
        'Dart 原生语义导航',
      );
    },

    async getAppState() {
      let hasOpenAiKey = false;

      try {
        hasOpenAiKey =
          (
            await AndroidProject.hasOpenAiKey()
          ).value;
      } catch {
        hasOpenAiKey = false;
      }

      return {
        lastProjectRoot: '',
        lastOpenFile: '',
        voice: loadVoice(),
        appearance: loadAppearance(),
        hasOpenAiKey,
        nativeTts: false,
      };
    },

    async updateVoiceState(voiceState) {
      const next = {
        ...DEFAULT_VOICE,
        ...voiceState,
      };

      localStorage.setItem(
        'code-tutor-android-voice',
        JSON.stringify(next),
      );

      return next;
    },

    async updateAppearanceState(
      appearance,
    ) {
      const next = {
        ...loadAppearance(),
        ...appearance,
      };

      localStorage.setItem(
        'code-tutor-android-appearance',
        JSON.stringify(next),
      );

      return next;
    },

    async chooseAppearanceBackground() {
      return null;
    },

    async getAppearanceBackground() {
      return null;
    },

    async clearAppearanceBackground() {
      const next = {
        ...loadAppearance(),
        imageFile: '',
      };

      localStorage.setItem(
        'code-tutor-android-appearance',
        JSON.stringify(next),
      );

      return next;
    },

    async listNativeVoices() {
      return [];
    },

    async synthesizeSpeech() {
      return unsupported(
        'Android 原生 TTS 合成',
      );
    },

    async hasOpenAiKey() {
      return (
        await AndroidProject.hasOpenAiKey()
      ).value;
    },

    async setOpenAiKey(apiKey) {
      return (
        await AndroidProject.setOpenAiKey({
          apiKey,
        })
      ).value;
    },

    async clearOpenAiKey() {
      return (
        await AndroidProject.clearOpenAiKey()
      ).value;
    },

    async explainCurrentCode() {
      return unsupported(
        'Android AI 解释桥',
      );
    },

    async planTutorTour() {
      return unsupported(
        'Android AI 教学规划桥',
      );
    },

    async planDartSemanticTour() {
      return unsupported(
        'Android Dart AI 教学桥',
      );
    },
  };


interface AndroidProjectSnapshotDetail {
  rootPath: string;
  projectName: string;
  files: string[];
  directories: string[];
  preferredFile?: string;
  message?: string;
}

function installAndroidProjectCreationStyles():
  void {
  if (
    document.getElementById(
      'android-project-create-styles',
    )
  ) {
    return;
  }

  const style =
    document.createElement('style');
  style.id =
    'android-project-create-styles';
  style.textContent = `
    .android-project-create-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      padding: 6px 8px 8px;
      border-bottom:
        1px solid rgba(255,255,255,.08);
    }

    .android-project-create-actions button {
      min-height: 32px;
      padding: 5px 7px;
      font-size: 12px;
    }

    .android-project-create-target {
      grid-column: 1 / -1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
      opacity: .8;
    }

    .directory-item[data-create-target="true"] {
      outline:
        1px solid rgba(124,92,255,.7);
      outline-offset: -1px;
    }

    @media (max-width: 820px) {
      .android-project-create-actions {
        padding: 5px 6px 7px;
      }

      .android-project-create-actions button {
        min-height: 36px;
      }
    }
  `;

  document.head.appendChild(style);
}

function installAndroidProjectCreationUi():
  boolean {
  const projectName =
    document.querySelector<HTMLElement>(
      '#project-name',
    );

  if (!projectName) {
    return false;
  }

  if (
    document.querySelector(
      '.android-project-create-actions',
    )
  ) {
    return true;
  }

  const actions =
    document.createElement('div');
  actions.className =
    'android-project-create-actions';

  const target =
    document.createElement('button');
  target.type = 'button';
  target.className =
    'android-project-create-target';
  target.textContent =
    '位置：项目根目录';
  target.title =
    '先点击 Explorer 中的文件夹，可把新内容创建到该文件夹';

  const newFile =
    document.createElement('button');
  newFile.type = 'button';
  newFile.textContent = '＋ 文件';

  const newDirectory =
    document.createElement('button');
  newDirectory.type = 'button';
  newDirectory.textContent =
    '＋ 文件夹';

  actions.append(
    target,
    newFile,
    newDirectory,
  );
  projectName.after(actions);

  let selectedDirectory = '';

  const setTarget = (
    directory: string,
  ) => {
    selectedDirectory = directory;
    target.textContent = directory
      ? `位置：${directory}`
      : '位置：项目根目录';

    for (
      const row of document
        .querySelectorAll<HTMLElement>(
          '.directory-item',
        )
    ) {
      row.dataset.createTarget = String(
        (
          row.dataset.directoryPath ?? ''
        ) === directory
          && Boolean(directory),
      );
    }
  };

  document.addEventListener(
    'click',
    (event) => {
      const element =
        event.target as HTMLElement | null;

      const directory =
        element?.closest<HTMLElement>(
          '.directory-item',
        );

      if (directory) {
        setTarget(
          directory.dataset.directoryPath
            ?? '',
        );
        return;
      }

      if (
        element?.closest('#project-name')
      ) {
        setTarget('');
      }
    },
  );

  target.addEventListener(
    'click',
    () => setTarget(''),
  );

  const ensureProjectOpen = () => {
    const root =
      document.querySelector<HTMLElement>(
        '#project-root',
      )?.textContent ?? '';

    if (!root.startsWith('content://')) {
      window.alert(
        '请先点击“打开项目”，选择一个 Android 项目文件夹。',
      );
      return false;
    }

    return true;
  };

  const askName = (
    kind: '文件' | '文件夹',
  ) => {
    if (!ensureProjectOpen()) {
      return '';
    }

    const location = selectedDirectory
      ? `“${selectedDirectory}”`
      : '项目根目录';

    const value = window.prompt(
      `在 ${location} 新建${kind}：`,
      '',
    )?.trim() ?? '';

    if (!value) {
      return '';
    }

    if (
      value === '.'
        || value === '..'
        || /[\\/]/.test(value)
    ) {
      window.alert(
        `${kind}名称不能包含 / 或 \\。`,
      );
      return '';
    }

    return value;
  };

  const makePath = (name: string) =>
    selectedDirectory
      ? `${selectedDirectory}/${name}`
      : name;

  const emitSnapshot = (
    result: AndroidProjectResult,
    options: {
      preferredFile?: string;
      message: string;
    },
  ) => {
    if (
      result.cancelled
        || !result.rootPath
        || !result.projectName
    ) {
      return;
    }

    const detail:
      AndroidProjectSnapshotDetail = {
        rootPath: result.rootPath,
        projectName:
          result.projectName,
        files: result.files ?? [],
        directories:
          result.directories ?? [],
        preferredFile:
          options.preferredFile,
        message: options.message,
      };

    window.dispatchEvent(
      new CustomEvent(
        'android-project-snapshot',
        { detail },
      ),
    );
  };

  newFile.addEventListener(
    'click',
    async () => {
      const name = askName('文件');
      if (!name) return;

      const path = makePath(name);
      newFile.disabled = true;

      try {
        const result =
          await AndroidProject
            .createProjectFile({
              path,
            });

        const created =
          result.createdPath ?? path;

        emitSnapshot(result, {
          preferredFile: created,
          message:
            `✓ 已创建文件 · ${created}`,
        });
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : '创建文件失败',
        );
      } finally {
        newFile.disabled = false;
      }
    },
  );

  newDirectory.addEventListener(
    'click',
    async () => {
      const name =
        askName('文件夹');
      if (!name) return;

      const path = makePath(name);
      newDirectory.disabled = true;

      try {
        const result =
          await AndroidProject
            .createProjectDirectory({
              path,
            });

        const created =
          result.createdPath ?? path;

        emitSnapshot(result, {
          message:
            `✓ 已创建文件夹 · ${created}`,
        });
        setTarget(created);
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : '创建文件夹失败',
        );
      } finally {
        newDirectory.disabled = false;
      }
    },
  );

  return true;
}

function bootstrapAndroidProjectCreationUi():
  void {
  installAndroidProjectCreationStyles();

  if (installAndroidProjectCreationUi()) {
    return;
  }

  const observer =
    new MutationObserver(() => {
      if (
        installAndroidProjectCreationUi()
      ) {
        observer.disconnect();
      }
    });

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    },
  );
}

if (
  document.readyState === 'loading'
) {
  document.addEventListener(
    'DOMContentLoaded',
    bootstrapAndroidProjectCreationUi,
    { once: true },
  );
} else {
  window.requestAnimationFrame(
    bootstrapAndroidProjectCreationUi,
  );
}
}
