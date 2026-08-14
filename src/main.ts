import './styles.css';
import { CharacterController } from './character/character_controller';
import { demoFiles } from './demo/demo_project';
import { EditorController } from './editor/editor_controller';
import { buildRelatedCodeMoves } from './project/project_navigator';
import { buildSemanticTutorRoute } from './project/semantic_navigator';
import type { SemanticTutorMode } from './core/semantic_ai_plan';
import { VoiceController } from './voice/voice_controller';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app element.');
}

app.innerHTML = `
  <div class="ide-shell">
    <header class="titlebar">
      <div class="brand">
        <span class="brand-mark">AI</span>
        <div>
          <strong>Code Tutor IDE</strong>
          <small>Alpha 0.11 · 真实保存 + Ctrl+Click + Tutor Rail</small>
        </div>
      </div>
      <div class="titlebar-actions">
        <span id="tutor-status" class="tutor-status">等待打开项目</span>
        <button id="open-project" class="primary-button">📂 打开项目</button>
        <button id="jump-to-cursor">🤖 老师跳到光标</button>
        <button id="find-related" disabled>🧭 老师找相关代码</button>
        <button id="semantic-related" disabled>🧠 Dart 语义调用</button>
        <select id="semantic-ai-mode" class="semantic-mode" title="AI 语义教学方向">
          <option value="full">完整功能链</option>
          <option value="incoming">谁调用它</option>
          <option value="outgoing">它调用谁</option>
        </select>
        <button id="semantic-ai-tour" class="semantic-ai-button" disabled>🧠✨ AI 理解函数</button>
        <button id="voice-toggle" class="voice-button">🔊 语音开启</button>
        <select id="voice-language" class="voice-language" title="语音语言">
          <option value="zh-CN">中文（简体）</option>
        </select>
        <select id="voice-select" class="voice-select" title="具体系统声音">
          <option value="">自动选择声音</option>
        </select>
        <select id="voice-rate" class="voice-rate" title="语音速度">
          <option value="0.8">0.8×</option>
          <option value="1" selected>1.0×</option>
          <option value="1.2">1.2×</option>
          <option value="1.4">1.4×</option>
        </select>
        <button id="set-api-key">🔑 API Key</button>
        <button id="ai-tour" class="ai-button" disabled>✨ AI 老师理解项目</button>
      </div>
    </header>

    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-title">EXPLORER</div>
        <div id="project-name" class="project-name">▾ ai-code-tutor-demo</div>
        <div id="file-tree" class="file-tree"></div>

        <div class="sidebar-note">
          <strong>Alpha 0.11</strong>
          <p>Monaco 修改现在可以用 Ctrl+S 真正写回原文件；Dart 支持 Ctrl+Click 语义跳转；角色移动到独立 Tutor Rail，不再盖住代码字符。</p>
        </div>
      </aside>

      <main class="editor-pane">
        <div class="editor-tabbar">
          <span id="editor-tab-dot" class="editor-tab-dot" data-dirty="false"></span>
          <span id="active-file">src/app.ts</span>
          <span id="editor-save-state" class="editor-save-state">✓ 已保存</span>
          <span id="workspace-badge" class="tab-badge">Demo</span>
        </div>

        <div id="editor-stage" class="editor-stage">
          <div id="editor" class="editor"></div>

          <aside id="tutor-rail" class="tutor-rail" aria-label="AI Tutor activity rail">
            <div class="tutor-rail-label">AI TUTOR</div>
            <div id="tutor-character" class="tutor-character offscreen" data-action="jump">
              <div class="speech-bubble" id="speech-bubble"></div>
              <div class="robot-shadow"></div>
              <div class="robot">
                <div class="antenna"><span></span></div>
                <div class="head">
                  <span class="eye left"></span>
                  <span class="eye right"></span>
                  <span class="mouth"></span>
                </div>
                <div class="body"><span>AI</span></div>
                <div class="arm"></div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>

    <footer class="statusbar">
      <span>Electron + Monaco</span>
      <span id="project-root">尚未打开真实项目</span>
      <span id="voice-status">语音：等待讲解</span>
      <span id="position-status">Ln 1, Col 1</span>
    </footer>
  </div>

  <div id="api-key-modal" class="modal-backdrop" hidden>
    <section class="api-key-dialog" role="dialog" aria-modal="true" aria-labelledby="api-key-title">
      <div class="api-key-dialog-header">
        <div>
          <strong id="api-key-title">OpenAI API Key</strong>
          <p>使用 Electron safeStorage 加密后保存到本机；Windows 使用当前用户的 DPAPI 保护。</p>
        </div>
        <button id="api-key-close" class="icon-button" type="button" aria-label="关闭">×</button>
      </div>

      <label class="api-key-field">
        <span>API Key</span>
        <input
          id="api-key-input"
          type="password"
          placeholder="sk-..."
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <div id="api-key-error" class="api-key-error" aria-live="polite"></div>

      <div class="api-key-dialog-actions">
        <button id="api-key-clear" class="danger-button" type="button">清除已保存 Key</button>
        <span class="dialog-spacer"></span>
        <button id="api-key-cancel" type="button">取消</button>
        <button id="api-key-save" class="primary-button" type="button">加密保存到本机</button>
      </div>
    </section>
  </div>
`;

const editorElement = requireElement('editor');
const characterElement = requireElement('tutor-character');
const bubbleElement = requireElement('speech-bubble');
const tutorStatus = requireElement('tutor-status');
const fileTree = requireElement('file-tree');
const activeFile = requireElement('active-file');
const editorTabDot = requireElement('editor-tab-dot');
const editorSaveState = requireElement('editor-save-state');
const projectName = requireElement('project-name');
const projectRoot = requireElement('project-root');
const workspaceBadge = requireElement('workspace-badge');
const openProjectButton = requireButton('open-project');
const jumpToCursorButton = requireButton('jump-to-cursor');
const findRelatedButton = requireButton('find-related');
const semanticRelatedButton = requireButton('semantic-related');
const semanticAiModeSelect = requireSelect('semantic-ai-mode');
const semanticAiTourButton = requireButton('semantic-ai-tour');
const voiceToggleButton = requireButton('voice-toggle');
const voiceLanguageSelect = requireSelect('voice-language');
const voiceSelect = requireSelect('voice-select');
const voiceRateSelect = requireSelect('voice-rate');
const setApiKeyButton = requireButton('set-api-key');
const aiTourButton = requireButton('ai-tour');
const voiceStatus = requireElement('voice-status');
const positionStatus = requireElement('position-status');
const apiKeyModal = requireElement('api-key-modal');
const apiKeyInput = requireInput('api-key-input');
const apiKeyError = requireElement('api-key-error');
const apiKeyCloseButton = requireButton('api-key-close');
const apiKeyCancelButton = requireButton('api-key-cancel');
const apiKeyClearButton = requireButton('api-key-clear');
const apiKeySaveButton = requireButton('api-key-save');

interface RuntimeMonacoMouseEvent {
  event: {
    ctrlKey: boolean;
    preventDefault(): void;
  };
  target: {
    position?: {
      lineNumber: number;
      column: number;
    } | null;
  };
}

interface RuntimeMonacoEditor {
  onMouseDown(listener: (event: RuntimeMonacoMouseEvent) => void): { dispose(): void };
  setPosition(position: { lineNumber: number; column: number }): void;
  focus(): void;
}

const editorController = new EditorController(editorElement, demoFiles);
const runtimeEditor = editorController.editor as unknown as RuntimeMonacoEditor;
let preferredVoiceLanguage = 'zh-CN';
let preferredVoiceId = '';
let preferredVoiceRate = 1;
let voiceEnabledPreference = true;

const voiceController = new VoiceController({
  character: characterElement,
  onStateChange: (_state, message) => {
    voiceStatus.textContent = `语音：${message}`;
  },
  onVoicesChanged: (languages) => {
    renderVoiceLanguageOptions(languages);
    renderVoiceOptions();
  },
});

const characterController = new CharacterController(
  editorController,
  characterElement,
  bubbleElement,
  tutorStatus,
  async (path) => {
    if (!isRealProject) {
      throw new Error('请先打开真实项目。');
    }
    await openRealProjectFile(path, false, true);
  },
  voiceController,
);

let projectFiles: string[] = demoFiles.map((file) => file.path);
let isRealProject = false;
let projectLoadSequence = 0;
let relatedTourSequence = 0;
let relatedTourRunning = false;
let semanticTourSequence = 0;
let semanticTourRunning = false;
let semanticAiTourSequence = 0;
let semanticAiTourRunning = false;
let aiTourSequence = 0;
let aiTourRunning = false;
let definitionNavigationSequence = 0;
let fileSaveSequence = 0;
const expandedDirectories = new Set<string>();

renderFileTree(projectFiles);
updateActiveFile();

editorController.editor.onDidChangeCursorPosition((event) => {
  positionStatus.textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
});

editorController.onDirtyStateChanged(() => {
  updateEditorSaveState();
  updateFileTreeSelection(false);
});

runtimeEditor.onMouseDown((event) => {
  if (!event.event.ctrlKey || !event.target.position) {
    return;
  }

  event.event.preventDefault();
  void navigateToDartDefinition(
    event.target.position.lineNumber,
    event.target.position.column,
  );
});

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void saveCurrentFile();
  }
});

openProjectButton.addEventListener('click', async () => {
  stopRelatedTour('准备打开项目');
  stopSemanticTour('准备打开项目');
  stopSemanticAiTour('准备打开项目');
  stopAiTour('准备打开项目');
  const sequence = ++projectLoadSequence;
  openProjectButton.disabled = true;
  tutorStatus.textContent = '正在读取项目目录…';

  try {
    const result = await window.tutorIde.openProject();
    if (!result || sequence !== projectLoadSequence) {
      tutorStatus.textContent = '已取消打开项目';
      return;
    }

    await activateRealProject(result, result.lastOpenFile ?? '');
    tutorStatus.textContent = `✓ 已读取 ${projectFiles.length} 个代码文件`;
  } catch (error) {
    tutorStatus.textContent = errorMessage(error);
  } finally {
    openProjectButton.disabled = false;
  }
});

jumpToCursorButton.addEventListener('click', async () => {
  stopRelatedTour('已切换到手动定位');
  stopSemanticTour('已切换到手动定位');
  stopSemanticAiTour('已切换到手动定位');
  stopAiTour('已切换到手动定位');
  const position = editorController.editor.getPosition();
  if (!position) {
    return;
  }

  await characterController.moveTo({
    filePath: editorController.path,
    line: position.lineNumber,
    column: position.column,
    action: 'point',
    speech: isRealProject
      ? `我现在真的站在 ${editorController.path} 第 ${position.lineNumber} 行。下一阶段让 AI 自己决定该跳到哪里。`
      : '这是演示文件。先点“打开项目”，我就能进入你的真实代码。',
  });
});



findRelatedButton.addEventListener('click', async () => {
  if (relatedTourRunning) {
    stopRelatedTour('已停止项目导航');
    return;
  }

  stopSemanticTour('已切换到项目文本导航');
  stopSemanticAiTour('已切换到项目文本导航');
  stopAiTour('已切换到项目文本导航');

  if (!isRealProject) {
    tutorStatus.textContent = '请先打开真实项目';
    return;
  }

  const seed = editorController.getNavigationSeed();
  if (!seed) {
    tutorStatus.textContent = '请把光标放在类名、方法名或变量名上，或先选中一个标识符';
    return;
  }

  const sequence = ++relatedTourSequence;
  relatedTourRunning = true;
  findRelatedButton.textContent = '■ 停止寻找';
  tutorStatus.textContent = `正在整个项目搜索 “${seed.query}”…`;

  try {
    const matches = await window.tutorIde.searchProject(seed.query);
    if (sequence !== relatedTourSequence) {
      return;
    }

    const moves = buildRelatedCodeMoves({
      query: seed.query,
      currentPath: editorController.path,
      currentLine: seed.line,
    }, matches);

    if (moves.length === 0) {
      await characterController.moveTo({
        filePath: editorController.path,
        line: seed.line,
        column: seed.column,
        action: 'think',
        speech: `我搜索了整个项目，目前没有找到 “${seed.query}” 的其他位置。`,
      });
      return;
    }

    for (let index = 0; index < moves.length; index += 1) {
      if (sequence !== relatedTourSequence) {
        return;
      }

      const move = moves[index];
      if (!move) {
        continue;
      }

      tutorStatus.textContent = `项目导航 ${index + 1} / ${moves.length} · ${move.filePath}:${move.line}`;
      await characterController.moveTo(move);
      updateActiveFile();
      updateFileTreeSelection(true);
      await delay(characterController.voiceEnabled ? 320 : (move.waitMs ?? 1500));
    }

    if (sequence === relatedTourSequence) {
      tutorStatus.textContent = `✓ 已走过 “${seed.query}” 的 ${moves.length} 个相关位置`;
    }
  } catch (error) {
    if (sequence === relatedTourSequence) {
      tutorStatus.textContent = errorMessage(error);
    }
  } finally {
    if (sequence === relatedTourSequence) {
      relatedTourRunning = false;
      findRelatedButton.textContent = '🧭 老师找相关代码';
    }
  }
});

semanticRelatedButton.addEventListener('click', async () => {
  if (semanticTourRunning) {
    stopSemanticTour('已停止 Dart 语义导航');
    return;
  }

  if (!isRealProject) {
    tutorStatus.textContent = '请先打开真实项目';
    return;
  }

  const focus = editorController.getSemanticFocus();
  if (!focus) {
    tutorStatus.textContent = 'Alpha 0.5 先支持 Dart：请打开 .dart 文件，并把光标放在一个真实符号名称上';
    return;
  }

  stopRelatedTour('已切换到 Dart 语义导航');
  stopSemanticAiTour('已切换到 Dart 语义导航');
  stopAiTour('已切换到 Dart 语义导航');

  const sequence = ++semanticTourSequence;
  semanticTourRunning = true;
  semanticRelatedButton.textContent = '■ 停止语义导航';
  tutorStatus.textContent = `正在启动 Dart Analysis Server，分析 “${focus.query}”…`;

  try {
    const result = await window.tutorIde.findDartSemanticTargets(focus);
    if (sequence !== semanticTourSequence) {
      return;
    }

    const route = buildSemanticTutorRoute(result);
    if (route.moves.length === 0) {
      tutorStatus.textContent = `Dart Analyzer 没有找到 “${focus.query}” 的定义、调用或引用`;
      return;
    }

    for (let index = 0; index < route.moves.length; index += 1) {
      if (sequence !== semanticTourSequence) {
        return;
      }

      const move = route.moves[index];
      if (!move) {
        continue;
      }

      tutorStatus.textContent = `Dart 语义导航 ${index + 1} / ${route.moves.length} · ${move.filePath}:${move.line}`;
      await characterController.moveTo(move);
      updateActiveFile();
      updateFileTreeSelection(true);
      await delay(characterController.voiceEnabled ? 320 : (move.waitMs ?? 1700));
    }

    if (sequence === semanticTourSequence) {
      tutorStatus.textContent = `✓ ${route.summary} · ${result.provider}`;
    }
  } catch (error) {
    if (sequence === semanticTourSequence) {
      tutorStatus.textContent = errorMessage(error);
    }
  } finally {
    if (sequence === semanticTourSequence) {
      semanticTourRunning = false;
      semanticRelatedButton.textContent = '🧠 Dart 语义调用';
    }
  }
});

semanticAiTourButton.addEventListener('click', async () => {
  if (semanticAiTourRunning) {
    stopSemanticAiTour('已停止 AI 语义教学链');
    return;
  }

  if (!isRealProject) {
    tutorStatus.textContent = '请先打开真实项目';
    return;
  }

  const focus = editorController.getSemanticFocus();
  if (!focus) {
    tutorStatus.textContent = '请打开 Dart 文件；可以选中整个函数、选中函数名，或把光标放在函数体内部';
    return;
  }

  if (!(await ensureOpenAiKey())) {
    tutorStatus.textContent = '请先设置 OpenAI API Key，再重新点击 AI 理解函数';
    return;
  }

  stopRelatedTour('已切换到 AI 语义教学链');
  stopSemanticTour('已切换到 AI 语义教学链');
  stopAiTour('已切换到 AI 语义教学链');

  const mode = semanticAiModeSelect.value as SemanticTutorMode;
  const sequence = ++semanticAiTourSequence;
  semanticAiTourRunning = true;
  semanticAiTourButton.textContent = '■ 停止 AI 调用链';
  semanticAiModeSelect.disabled = true;
  tutorStatus.textContent = `Dart Analyzer 正在识别当前函数并建立 “${focus.query}” 的真实调用图…`;

  try {
    const plan = await window.tutorIde.planDartSemanticTour(focus, mode);
    if (sequence !== semanticAiTourSequence) {
      return;
    }

    if (plan.moves.length === 0) {
      tutorStatus.textContent = 'AI 没有从这张调用图中选出可执行的教学路线';
      return;
    }

    for (let index = 0; index < plan.moves.length; index += 1) {
      if (sequence !== semanticAiTourSequence) {
        return;
      }

      const move = plan.moves[index];
      if (!move) {
        continue;
      }

      tutorStatus.textContent = `AI 真实调用链 ${index + 1} / ${plan.moves.length} · ${move.filePath}:${move.line}`;
      await characterController.moveTo(move);
      updateActiveFile();
      updateFileTreeSelection(true);
      await delay(characterController.voiceEnabled ? 360 : (move.waitMs ?? 2100));
    }

    if (sequence === semanticAiTourSequence) {
      tutorStatus.textContent = `✓ ${plan.summary} · ${plan.model} · 真实语义节点 ${plan.nodeCount} 个`;
    }
  } catch (error) {
    if (sequence === semanticAiTourSequence) {
      tutorStatus.textContent = errorMessage(error);
    }
  } finally {
    if (sequence === semanticAiTourSequence) {
      semanticAiTourRunning = false;
      semanticAiTourButton.textContent = '🧠✨ AI 理解函数';
      semanticAiModeSelect.disabled = false;
    }
  }
});

voiceToggleButton.addEventListener('click', () => {
  voiceEnabledPreference = !voiceEnabledPreference;
  voiceController.setEnabled(voiceEnabledPreference);
  updateVoiceToggleLabel();
  void persistVoicePreferences();
});

voiceLanguageSelect.addEventListener('change', () => {
  preferredVoiceLanguage = voiceLanguageSelect.value;
  preferredVoiceId = '';
  voiceController.stop();
  voiceController.setLanguage(preferredVoiceLanguage);
  renderVoiceOptions();

  const firstVoice = voiceController.getVoiceOptions(preferredVoiceLanguage)[0];
  if (firstVoice) {
    preferredVoiceId = firstVoice.id;
    voiceController.setVoice(firstVoice.id);
    voiceSelect.value = firstVoice.id;
  }
  void persistVoicePreferences();
});

voiceSelect.addEventListener('change', () => {
  preferredVoiceId = voiceSelect.value;
  voiceController.stop();
  voiceController.setVoice(preferredVoiceId);
  void persistVoicePreferences();
});

voiceRateSelect.addEventListener('change', () => {
  preferredVoiceRate = Number(voiceRateSelect.value);
  voiceController.setRate(preferredVoiceRate);
  void persistVoicePreferences();
});

setApiKeyButton.addEventListener('click', () => {
  openApiKeyDialog();
});

apiKeyCloseButton.addEventListener('click', closeApiKeyDialog);
apiKeyCancelButton.addEventListener('click', closeApiKeyDialog);
apiKeyClearButton.addEventListener('click', () => {
  void clearStoredApiKey();
});
apiKeySaveButton.addEventListener('click', () => {
  void saveApiKeyFromDialog();
});

apiKeyModal.addEventListener('click', (event) => {
  if (event.target === apiKeyModal) {
    closeApiKeyDialog();
  }
});

apiKeyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void saveApiKeyFromDialog();
    return;
  }

  if (event.key === 'Escape') {
    closeApiKeyDialog();
  }
});

aiTourButton.addEventListener('click', async () => {
  if (aiTourRunning) {
    stopAiTour('已停止 AI 教学路线');
    return;
  }

  if (!isRealProject) {
    tutorStatus.textContent = '请先打开真实项目';
    return;
  }

  const focus = editorController.getTutorFocus();
  if (!focus) {
    tutorStatus.textContent = '请先选中代码，或把光标放在一个类名、方法名或变量名上';
    return;
  }

  if (!(await ensureOpenAiKey())) {
    tutorStatus.textContent = '未设置 OpenAI API Key';
    return;
  }

  stopRelatedTour('已切换到 AI 教学路线');
  stopSemanticTour('已切换到 AI 教学路线');
  stopSemanticAiTour('已切换到 AI 教学路线');
  const sequence = ++aiTourSequence;
  aiTourRunning = true;
  aiTourButton.textContent = '■ 停止 AI 老师';
  tutorStatus.textContent = focus.query
    ? `AI 正在理解 “${focus.query}” 在项目里的关系…`
    : 'AI 正在理解当前选中的代码…';

  try {
    const plan = await window.tutorIde.planTutorTour(focus);
    if (sequence !== aiTourSequence) {
      return;
    }

    if (plan.moves.length === 0) {
      tutorStatus.textContent = 'AI 没有生成可执行的教学路线';
      return;
    }

    for (let index = 0; index < plan.moves.length; index += 1) {
      if (sequence !== aiTourSequence) {
        return;
      }

      const move = plan.moves[index];
      if (!move) {
        continue;
      }

      tutorStatus.textContent = `AI 教学 ${index + 1} / ${plan.moves.length} · ${move.filePath}:${move.line}`;
      await characterController.moveTo(move);
      updateActiveFile();
      updateFileTreeSelection(true);
      await delay(characterController.voiceEnabled ? 360 : (move.waitMs ?? 1900));
    }

    if (sequence === aiTourSequence) {
      tutorStatus.textContent = `✓ ${plan.summary} · ${plan.model} · 候选 ${plan.candidateCount} 个`;
    }
  } catch (error) {
    if (sequence === aiTourSequence) {
      tutorStatus.textContent = errorMessage(error);
    }
  } finally {
    if (sequence === aiTourSequence) {
      aiTourRunning = false;
      aiTourButton.textContent = '✨ AI 老师理解项目';
    }
  }
});

async function saveCurrentFile(): Promise<void> {
  if (!isRealProject) {
    tutorStatus.textContent = '演示文件不会写入磁盘；请先打开真实项目。';
    return;
  }

  if (!editorController.isDirty()) {
    tutorStatus.textContent = `✓ ${editorController.path} 已经是最新保存状态`;
    return;
  }

  const sequence = ++fileSaveSequence;
  const path = editorController.path;
  const content = editorController.getCurrentContent();
  tutorStatus.textContent = `正在保存 ${path}…`;
  editorSaveState.textContent = '保存中…';

  try {
    const result = await window.tutorIde.writeProjectFile(path, content);
    if (sequence !== fileSaveSequence) {
      return;
    }
    editorController.markSaved(result.path, content);
    tutorStatus.textContent = `✓ 已真正写回 ${result.path} · ${result.bytes} bytes`;
  } catch (error) {
    if (sequence === fileSaveSequence) {
      tutorStatus.textContent = errorMessage(error);
      updateEditorSaveState();
    }
  }
}

async function navigateToDartDefinition(line: number, column: number): Promise<void> {
  if (!isRealProject) {
    tutorStatus.textContent = 'Ctrl+Click 语义跳转只对真实项目启用。';
    return;
  }

  const focus = editorController.getSemanticFocusAtPosition(line, column);
  if (!focus) {
    if (editorController.path.toLowerCase().endsWith('.dart')) {
      tutorStatus.textContent = 'Ctrl+Click：这里没有可跳转的 Dart 符号。';
    }
    return;
  }

  const sequence = ++definitionNavigationSequence;
  stopRelatedTour('已切换到 Ctrl+Click 语义跳转');
  stopSemanticTour('已切换到 Ctrl+Click 语义跳转');
  stopSemanticAiTour('已切换到 Ctrl+Click 语义跳转');
  stopAiTour('已切换到 Ctrl+Click 语义跳转');
  characterController.clear('Ctrl+Click 语义跳转');
  tutorStatus.textContent = `Dart Analyzer 正在查找 “${focus.query}” 的定义…`;

  try {
    const result = await window.tutorIde.findDartSemanticTargets(focus);
    if (sequence !== definitionNavigationSequence) {
      return;
    }

    const target = result.locations.find((location) => location.kind === 'definition');
    if (!target) {
      tutorStatus.textContent = `Dart Analyzer 没有找到 “${focus.query}” 的定义。`;
      return;
    }

    if (target.path !== editorController.path) {
      await openRealProjectFile(target.path, false, true);
    }

    editorController.reveal(target.line, target.column);
    runtimeEditor.setPosition({
      lineNumber: target.line,
      column: target.column,
    });
    runtimeEditor.focus();
    tutorStatus.textContent = `↪ Ctrl+Click：${focus.query} → ${target.path}:${target.line}`;
  } catch (error) {
    if (sequence === definitionNavigationSequence) {
      tutorStatus.textContent = errorMessage(error);
    }
  }
}

function stopRelatedTour(message: string): void {
  characterController.stopSpeech();
  relatedTourSequence += 1;
  relatedTourRunning = false;
  findRelatedButton.textContent = '🧭 老师找相关代码';
  tutorStatus.textContent = message;
}

function stopSemanticTour(message: string): void {
  characterController.stopSpeech();
  semanticTourSequence += 1;
  semanticTourRunning = false;
  semanticRelatedButton.textContent = '🧠 Dart 语义调用';
  tutorStatus.textContent = message;
}

function stopSemanticAiTour(message: string): void {
  characterController.stopSpeech();
  semanticAiTourSequence += 1;
  semanticAiTourRunning = false;
  semanticAiTourButton.textContent = '🧠✨ AI 理解函数';
  semanticAiModeSelect.disabled = false;
  tutorStatus.textContent = message;
}

function stopAiTour(message: string): void {
  characterController.stopSpeech();
  aiTourSequence += 1;
  aiTourRunning = false;
  aiTourButton.textContent = '✨ AI 老师理解项目';
  tutorStatus.textContent = message;
}

async function ensureOpenAiKey(): Promise<boolean> {
  if (await window.tutorIde.hasOpenAiKey()) {
    return true;
  }

  openApiKeyDialog();
  return false;
}

function openApiKeyDialog(): void {
  apiKeyError.textContent = '';
  apiKeyInput.value = '';
  apiKeyModal.hidden = false;
  window.setTimeout(() => apiKeyInput.focus(), 0);
}

function closeApiKeyDialog(): void {
  apiKeyModal.hidden = true;
  apiKeyInput.value = '';
  apiKeyError.textContent = '';
  apiKeySaveButton.disabled = false;
  apiKeySaveButton.textContent = '加密保存到本机';
}

async function saveApiKeyFromDialog(): Promise<void> {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    apiKeyError.textContent = '请输入 OpenAI API Key。';
    apiKeyInput.focus();
    return;
  }

  apiKeyError.textContent = '';
  apiKeySaveButton.disabled = true;
  apiKeySaveButton.textContent = '加密保存中…';

  try {
    await window.tutorIde.setOpenAiKey(apiKey);
    closeApiKeyDialog();
    tutorStatus.textContent = '✓ OpenAI API Key 已使用系统安全存储加密保存';
    setApiKeyButton.textContent = '🔑 API Key ✓';
  } catch (error) {
    apiKeyError.textContent = errorMessage(error);
    apiKeySaveButton.disabled = false;
    apiKeySaveButton.textContent = '加密保存到本机';
    apiKeyInput.focus();
  }
}

async function clearStoredApiKey(): Promise<void> {
  apiKeyError.textContent = '';
  apiKeyClearButton.disabled = true;
  try {
    await window.tutorIde.clearOpenAiKey();
    closeApiKeyDialog();
    setApiKeyButton.textContent = '🔑 API Key';
    tutorStatus.textContent = '✓ 已清除本机保存的 OpenAI API Key';
  } catch (error) {
    apiKeyError.textContent = errorMessage(error);
  } finally {
    apiKeyClearButton.disabled = false;
  }
}

async function persistVoicePreferences(): Promise<void> {
  try {
    await window.tutorIde.updateVoiceState({
      enabled: voiceEnabledPreference,
      language: preferredVoiceLanguage,
      voiceId: preferredVoiceId,
      rate: preferredVoiceRate,
    });
  } catch (error) {
    console.warn('Failed to persist voice preferences:', error);
  }
}

function updateVoiceToggleLabel(): void {
  voiceToggleButton.textContent = voiceEnabledPreference
    ? '🔊 语音开启'
    : '🔇 语音关闭';
}

async function initializeApplication(): Promise<void> {
  tutorStatus.textContent = '正在恢复上次工作区…';
  try {
    const state = await window.tutorIde.getAppState();
    preferredVoiceLanguage = state.voice.language || 'zh-CN';
    preferredVoiceId = state.voice.voiceId || '';
    preferredVoiceRate = Number.isFinite(state.voice.rate) ? state.voice.rate : 1;
    voiceEnabledPreference = state.voice.enabled !== false;

    voiceController.setLanguage(preferredVoiceLanguage);
    voiceController.setRate(preferredVoiceRate);
    await voiceController.initialize();
    voiceController.setVoice(preferredVoiceId);
    voiceController.setEnabled(voiceEnabledPreference);

    voiceRateSelect.value = String(preferredVoiceRate);
    if (!voiceRateSelect.value) {
      voiceRateSelect.value = '1';
      preferredVoiceRate = 1;
      voiceController.setRate(1);
    }
    renderVoiceLanguageOptions(voiceController.getLanguageOptions());
    renderVoiceOptions();
    updateVoiceToggleLabel();
    setApiKeyButton.textContent = state.hasOpenAiKey ? '🔑 API Key ✓' : '🔑 API Key';

    const restored = await window.tutorIde.restoreProject();
    if (restored) {
      await activateRealProject(restored, restored.lastOpenFile);
      tutorStatus.textContent = `✓ 已恢复 ${restored.projectName} · ${editorController.path}`;
      return;
    }

    tutorStatus.textContent = '等待打开项目';
  } catch (error) {
    tutorStatus.textContent = errorMessage(error);
    await voiceController.initialize();
  }
}

async function activateRealProject(
  result: { rootPath: string; projectName: string; files: string[] },
  preferredFile: string,
): Promise<void> {
  projectFiles = result.files;
  isRealProject = true;
  projectName.textContent = `▾ ${result.projectName}`;
  projectRoot.textContent = result.rootPath;
  workspaceBadge.textContent = '真实项目';
  findRelatedButton.disabled = false;
  semanticRelatedButton.disabled = false;
  semanticAiTourButton.disabled = false;
  aiTourButton.disabled = false;
  renderFileTree(projectFiles);
  characterController.clear('项目已打开');

  const targetFile = preferredFile && projectFiles.includes(preferredFile)
    ? preferredFile
    : chooseInitialFile(projectFiles);
  if (!targetFile) {
    activeFile.textContent = '没有可读取的代码文件';
    tutorStatus.textContent = '项目中没有找到支持的文本代码文件';
    return;
  }

  await openRealProjectFile(targetFile, true, true);
}

function renderFileTree(paths: string[]): void {
  fileTree.replaceChildren();
  expandedDirectories.clear();

  if (paths.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'file-tree-empty';
    empty.textContent = '没有找到支持的代码文件';
    fileTree.appendChild(empty);
    return;
  }

  const tree = buildTree(paths);
  renderTreeNodes(tree, fileTree, 0);
  updateFileTreeSelection(false);
}

function renderTreeNodes(nodes: TreeNode[], container: HTMLElement, depth: number): void {
  for (const node of nodes) {
    if (node.type === 'directory') {
      const wrapper = document.createElement('div');
      wrapper.className = 'directory-node';

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'directory-item';
      row.dataset.directoryPath = node.path;
      row.style.paddingLeft = `${12 + depth * 14}px`;

      const arrow = document.createElement('span');
      arrow.className = 'directory-arrow';
      arrow.textContent = '›';

      const label = document.createElement('span');
      label.textContent = `📁 ${node.name}`;
      row.append(arrow, label);

      const children = document.createElement('div');
      children.className = 'directory-children';
      children.dataset.directoryChildren = node.path;
      children.hidden = true;

      row.addEventListener('click', () => {
        setDirectoryExpanded(node.path, !expandedDirectories.has(node.path));
      });

      wrapper.append(row, children);
      container.appendChild(wrapper);
      renderTreeNodes(node.children, children, depth + 1);
      continue;
    }

    const button = document.createElement('button');
    button.className = 'file-item';
    button.dataset.path = node.path;
    button.style.paddingLeft = `${22 + depth * 14}px`;
    button.innerHTML = `<span class="file-icon">${fileLabel(node.path)}</span><span>${escapeText(node.name)}</span>`;
    button.addEventListener('click', async () => {
      stopRelatedTour('已手动切换文件');
      stopSemanticTour('已手动切换文件');
      stopSemanticAiTour('已手动切换文件');
      stopAiTour('已手动切换文件');
      characterController.clear('已切换文件');

      try {
        if (isRealProject) {
          await openRealProjectFile(node.path, false, true);
        } else {
          editorController.openFile(node.path);
          updateActiveFile();
          updateFileTreeSelection(true);
        }
      } catch (error) {
        tutorStatus.textContent = errorMessage(error);
      }
    });
    container.appendChild(button);
  }
}

async function openRealProjectFile(
  path: string,
  replaceWorkspace: boolean,
  revealInTree = true,
): Promise<void> {
  tutorStatus.textContent = `正在打开 ${path}…`;
  const result = await window.tutorIde.readProjectFile(path);
  const file = {
    path: result.path,
    language: languageFromPath(result.path),
    content: result.content,
  };

  if (replaceWorkspace) {
    editorController.replaceWorkspace(file);
  } else {
    editorController.openFileContent(file);
  }

  updateActiveFile();
  updateFileTreeSelection(revealInTree);
  tutorStatus.textContent = editorController.isDirty()
    ? `已打开 ${path} · 保留未保存修改`
    : `已打开 ${path}`;
}

function updateActiveFile(): void {
  activeFile.textContent = editorController.path;
  updateEditorSaveState();
}

function updateEditorSaveState(): void {
  const dirty = isRealProject && editorController.isDirty();
  editorTabDot.dataset.dirty = String(dirty);
  editorSaveState.dataset.dirty = String(dirty);
  editorSaveState.textContent = dirty ? '● 未保存 · Ctrl+S' : '✓ 已保存';
}

function updateFileTreeSelection(revealInTree = false): void {
  if (revealInTree && editorController.path) {
    expandAncestorsForPath(editorController.path);
  }

  let activeItem: HTMLButtonElement | null = null;
  for (const item of fileTree.querySelectorAll<HTMLButtonElement>('.file-item')) {
    const itemPath = item.dataset.path ?? '';
    const active = itemPath === editorController.path;
    item.dataset.active = String(active);
    item.dataset.dirty = String(editorController.isDirty(itemPath));
    if (active) {
      activeItem = item;
    }
  }

  if (revealInTree) {
    activeItem?.scrollIntoView({ block: 'nearest' });
  }
}

function expandAncestorsForPath(filePath: string): void {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return;
  }

  let current = '';
  for (const part of parts.slice(0, -1)) {
    current = current ? `${current}/${part}` : part;
    setDirectoryExpanded(current, true);
  }
}

function setDirectoryExpanded(path: string, expanded: boolean): void {
  if (expanded) {
    expandedDirectories.add(path);
  } else {
    expandedDirectories.delete(path);
  }

  for (const row of fileTree.querySelectorAll<HTMLButtonElement>('.directory-item')) {
    if (row.dataset.directoryPath !== path) {
      continue;
    }
    row.dataset.expanded = String(expanded);
    const arrow = row.querySelector<HTMLElement>('.directory-arrow');
    if (arrow) {
      arrow.textContent = expanded ? '⌄' : '›';
    }
  }

  for (const children of fileTree.querySelectorAll<HTMLElement>('.directory-children')) {
    if (children.dataset.directoryChildren === path) {
      children.hidden = !expanded;
    }
  }
}

interface TreeDirectoryNode {
  type: 'directory';
  name: string;
  path: string;
  children: TreeNode[];
}

interface TreeFileNode {
  type: 'file';
  name: string;
  path: string;
}

type TreeNode = TreeDirectoryNode | TreeFileNode;

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeDirectoryNode = {
    type: 'directory',
    name: '',
    path: '',
    children: [],
  };

  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean);
    let directory = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;

      if (isFile) {
        directory.children.push({
          type: 'file',
          name: part,
          path: filePath,
        });
        return;
      }

      let child = directory.children.find(
        (node): node is TreeDirectoryNode => node.type === 'directory' && node.name === part,
      );

      if (!child) {
        const parentPath = directory.path;
        child = {
          type: 'directory',
          name: part,
          path: parentPath ? `${parentPath}/${part}` : part,
          children: [],
        };
        directory.children.push(child);
      }

      directory = child;
    });
  }

  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  for (const node of nodes) {
    if (node.type === 'directory') {
      sortTree(node.children);
    }
  }
}

function chooseInitialFile(paths: string[]): string | undefined {
  const priorities = [
    'src/main.ts',
    'src/main.tsx',
    'src/main.js',
    'lib/main.dart',
    'main.py',
    'package.json',
    'README.md',
  ];

  for (const priority of priorities) {
    const match = paths.find((path) => path.toLowerCase() === priority.toLowerCase());
    if (match) {
      return match;
    }
  }

  return paths[0];
}

function languageFromPath(path: string): string {
  const lower = path.toLowerCase();
  const fileName = lower.split('/').at(-1) ?? lower;

  if (fileName === 'dockerfile') return 'dockerfile';
  if (lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.scss')) return 'scss';
  if (lower.endsWith('.less')) return 'less';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.dart')) return 'dart';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'kotlin';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.cpp') || lower.endsWith('.cc')) return 'cpp';
  if (lower.endsWith('.c')) return 'c';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'plaintext';
}

function fileLabel(path: string): string {
  const language = languageFromPath(path);
  const labels: Record<string, string> = {
    typescript: 'TS',
    javascript: 'JS',
    json: '{}',
    dart: 'D',
    python: 'PY',
    java: 'JV',
    kotlin: 'KT',
    markdown: 'MD',
    css: '#',
    html: '<>',
  };
  return labels[language] ?? '·';
}

function renderVoiceLanguageOptions(
  languages: Array<{ code: string; label: string; available: boolean; voiceCount: number }>,
): void {
  const selected = preferredVoiceLanguage;
  voiceLanguageSelect.replaceChildren();

  for (const language of languages) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.available
      ? `${language.label} · ${language.voiceCount} 个声音`
      : `${language.label} · 未安装`;
    option.dataset.available = String(language.available);
    voiceLanguageSelect.appendChild(option);
  }

  if (![...voiceLanguageSelect.options].some((option) => option.value === selected)) {
    const option = document.createElement('option');
    option.value = selected;
    option.textContent = `${selected} · 未安装`;
    option.dataset.available = 'false';
    voiceLanguageSelect.appendChild(option);
  }

  voiceLanguageSelect.value = selected;
}

function renderVoiceOptions(): void {
  const voices = voiceController.getVoiceOptions(preferredVoiceLanguage);
  voiceSelect.replaceChildren();

  if (voices.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '当前语言没有可用声音';
    voiceSelect.appendChild(option);
    voiceSelect.disabled = true;
    preferredVoiceId = '';
    voiceController.setVoice('');
    return;
  }

  voiceSelect.disabled = false;
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice.id;
    const gender = voice.gender ? ` · ${voice.gender}` : '';
    option.textContent = `${voice.name}${gender}`;
    voiceSelect.appendChild(option);
  }

  const hasPreferred = voices.some((voice) => voice.id === preferredVoiceId);
  if (!hasPreferred) {
    preferredVoiceId = voices[0]?.id ?? '';
    voiceController.setVoice(preferredVoiceId);
  }
  voiceSelect.value = preferredVoiceId;
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Missing button #${id}`);
  }
  return element;
}

function requireSelect(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Missing select #${id}`);
  }
  return element;
}

function requireInput(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Missing input #${id}`);
  }
  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

void initializeApplication();

window.addEventListener('beforeunload', () => {
  voiceController.stop();
  editorController.dispose();
});
