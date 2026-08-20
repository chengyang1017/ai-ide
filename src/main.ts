import './styles.css';
import './tablet.css';
import './tablet_dual.css';
import './tablet/tablet_ui';
import './tablet/tablet_size';
import './tablet/tablet_bootstrap';
import './android/android_tutor_ide';
import { CharacterController } from './character/character_controller';
import { demoFiles } from './demo/demo_project';
import { EditorController } from './editor/editor_controller';
import { monaco } from './editor/monaco_setup';
import { captureCurrentCodeContext } from './editor/current_code_context';
import { buildRelatedCodeMoves } from './project/project_navigator';
import { buildSemanticTutorRoute } from './project/semantic_navigator';
import type { SemanticTutorMode } from './core/semantic_ai_plan';
import { VoiceController } from './voice/voice_controller';
import { CodeNoteController } from './notes/code_note_controller';
import type { AppearanceState } from './electron_api';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app element.');
}

app.innerHTML = `
  <div id="ide-shell" class="ide-shell" data-background-scope="editor">
    <header class="titlebar">
      <div class="brand">
        <span class="brand-mark">AI</span>
        <div>
          <strong>Code Tutor IDE</strong>
          <small>Alpha 0.16 · 项目便签 + 外观 + Markdown 预览</small>
        </div>
      </div>

      <div class="titlebar-right">
        <span id="tutor-status" class="tutor-status">等待打开项目</span>
        <button id="voice-toggle" class="voice-button compact-button">🔊 语音</button>

        <details class="toolbar-menu">
          <summary title="语音设置">⚙ 语音设置</summary>
          <div class="toolbar-menu-panel voice-settings-panel">
            <label>
              <span>语言</span>
              <select id="voice-language" class="voice-language" title="语音语言">
                <option value="zh-CN">中文（简体）</option>
              </select>
            </label>
            <label>
              <span>声音</span>
              <select id="voice-select" class="voice-select" title="具体系统声音">
                <option value="">自动选择声音</option>
              </select>
            </label>
            <label>
              <span>语速</span>
              <select id="voice-rate" class="voice-rate" title="语音速度">
                <option value="0.8">0.8×</option>
                <option value="1" selected>1.0×</option>
                <option value="1.2">1.2×</option>
                <option value="1.4">1.4×</option>
              </select>
            </label>
          </div>
        </details>

        <button id="appearance-settings" class="compact-button">◐ 外观</button>
        <button id="set-api-key" class="compact-button">🔑 Key</button>
      </div>
    </header>

    <nav class="commandbar" aria-label="IDE commands">
      <div class="command-group command-group-project">
        <span class="command-group-label">PROJECT</span>
        <button id="open-project" class="primary-button">📂 打开项目</button>
      </div>

      <div class="command-divider" aria-hidden="true"></div>

      <div class="command-group">
        <span class="command-group-label">NAVIGATE</span>
        <button id="jump-to-cursor">🤖 跳到光标</button>
        <button id="find-related" disabled>🧭 相关代码</button>
        <button id="semantic-related" disabled>🧠 Dart 调用</button>
      </div>

      <div class="command-divider" aria-hidden="true"></div>

      <div class="command-group command-group-ai">
        <span class="command-group-label">AI TUTOR</span>
        <select id="semantic-ai-mode" class="semantic-mode" title="AI 语义教学方向">
          <option value="full">完整功能链</option>
          <option value="incoming">谁调用它</option>
          <option value="outgoing">它调用谁</option>
        </select>
        <button id="explain-current-code" class="ai-button" disabled>✨ 解释这里</button>
        <button id="semantic-ai-tour" class="semantic-ai-button" disabled>🧠✨ 理解函数</button>
        <button id="ai-tour" class="ai-button" disabled>✨ 理解项目</button>
      </div>
    </nav>

    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-title">EXPLORER</div>
        <div id="project-name" class="project-name">▾ ai-code-tutor-demo</div>
        <div id="file-tree" class="file-tree"></div>

        <div class="sidebar-note">
          <strong>Alpha 0.16</strong>
          <p>项目便签会跟随仓库共享；支持图片、外部点击自动收起、外观壁纸和 Markdown 实时预览。</p>
        </div>
      </aside>

      <main class="editor-pane">
        <div class="editor-tabbar">
          <span id="editor-tab-dot" class="editor-tab-dot" data-dirty="false"></span>
          <span id="active-file">src/app.ts</span>
          <span id="editor-save-state" class="editor-save-state">✓ 已保存</span>
          <span class="code-note-hint" title="光标位置出现＋可添加代码内便签；行号旁也会出现＋，两种便签可以同时存在">📝 双位置便签</span>
          <span id="external-change-state" class="external-change-state" hidden>
            <span>⚠ 外部已修改</span>
            <button id="external-reload" type="button">重新加载</button>
            <button id="external-keep" type="button">保留本地</button>
          </span>
          <span id="markdown-mode-controls" class="markdown-mode-controls" hidden>
            <button type="button" data-markdown-mode="edit">编辑</button>
            <button type="button" data-markdown-mode="split">分栏</button>
            <button type="button" data-markdown-mode="preview">预览</button>
          </span>
          <span id="workspace-badge" class="tab-badge">Demo</span>
        </div>

        <div id="editor-stage" class="editor-stage">
          <div id="editor" class="editor"></div>
          <article id="markdown-preview" class="markdown-preview" hidden aria-label="Markdown preview"></article>

          <div id="tutor-surface" class="tutor-surface" aria-label="AI Tutor activity layer">
            <div class="speech-bubble" id="speech-bubble"></div>
            <div id="tutor-character" class="tutor-character offscreen" data-action="jump" data-placement="code-end">
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
          </div>
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
          <p>使用系统安全存储加密后保存到本机；Windows 使用 Electron safeStorage，Android 使用 Android Keystore。</p>
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

  <div id="appearance-modal" class="modal-backdrop" hidden>
    <section class="settings-dialog appearance-dialog" role="dialog" aria-modal="true" aria-labelledby="appearance-title">
      <div class="settings-dialog-header">
        <div>
          <strong id="appearance-title">外观</strong>
          <p>颜色、背景图片和代码可读性都保存在本机，不会污染项目。</p>
        </div>
        <button id="appearance-close" class="icon-button" type="button" aria-label="关闭">×</button>
      </div>

      <div class="appearance-body">
        <section class="appearance-section appearance-background-section">
          <div class="appearance-section-heading">
            <h3>背景颜色</h3>
            <div id="appearance-background-mode" class="appearance-segmented" aria-label="背景类型">
              <button type="button" data-background-mode="solid">纯色</button>
              <button type="button" data-background-mode="gradient">渐变</button>
            </div>
          </div>

          <div id="appearance-solid-controls">
            <div id="appearance-presets" class="appearance-presets">
              <button type="button" data-color="#111318" style="--swatch:#111318" title="深黑"></button>
              <button type="button" data-color="#171a21" style="--swatch:#171a21" title="石墨"></button>
              <button type="button" data-color="#101827" style="--swatch:#101827" title="深蓝"></button>
              <button type="button" data-color="#10201c" style="--swatch:#10201c" title="墨绿"></button>
              <button type="button" data-color="#1e1528" style="--swatch:#1e1528" title="紫黑"></button>
              <button type="button" data-color="#251a17" style="--swatch:#251a17" title="咖啡"></button>
              <button type="button" data-color="#2a2521" style="--swatch:#2a2521" title="暖灰"></button>
              <button type="button" data-color="#f3f1eb" style="--swatch:#f3f1eb" title="暖白"></button>
              <button type="button" data-color="#eef3f8" style="--swatch:#eef3f8" title="冷白"></button>
              <button type="button" data-color="#f6efe8" style="--swatch:#f6efe8" title="奶油"></button>
            </div>
            <label class="appearance-field appearance-color-field">
              <span>自定义</span>
              <input id="appearance-color" type="color" value="#111318" />
              <code id="appearance-color-value">#111318</code>
            </label>
          </div>

          <div id="appearance-gradient-controls" class="appearance-gradient-controls" hidden>
            <div id="appearance-gradient-presets" class="appearance-gradient-presets">
              <button type="button" data-gradient-start="#171a2d" data-gradient-end="#412f66" data-gradient-angle="135" style="--swatch:linear-gradient(135deg,#171a2d,#412f66)" title="暮紫"></button>
              <button type="button" data-gradient-start="#0d2037" data-gradient-end="#283f78" data-gradient-angle="135" style="--swatch:linear-gradient(135deg,#0d2037,#283f78)" title="深海"></button>
              <button type="button" data-gradient-start="#10251f" data-gradient-end="#17445a" data-gradient-angle="135" style="--swatch:linear-gradient(135deg,#10251f,#17445a)" title="森林蓝"></button>
              <button type="button" data-gradient-start="#2b1720" data-gradient-end="#5a2b43" data-gradient-angle="135" style="--swatch:linear-gradient(135deg,#2b1720,#5a2b43)" title="玫瑰夜"></button>
              <button type="button" data-gradient-start="#2a1c17" data-gradient-end="#5a3422" data-gradient-angle="135" style="--swatch:linear-gradient(135deg,#2a1c17,#5a3422)" title="落日咖啡"></button>
              <button type="button" data-gradient-start="#15171c" data-gradient-end="#303642" data-gradient-angle="120" style="--swatch:linear-gradient(120deg,#15171c,#303642)" title="石墨渐变"></button>
              <button type="button" data-gradient-start="#241538" data-gradient-end="#123d52" data-gradient-angle="110" style="--swatch:linear-gradient(110deg,#241538,#123d52)" title="紫青"></button>
              <button type="button" data-gradient-start="#17243c" data-gradient-end="#4a2d59" data-gradient-angle="155" style="--swatch:linear-gradient(155deg,#17243c,#4a2d59)" title="蓝紫"></button>
            </div>
            <div class="appearance-gradient-colors">
              <label class="appearance-field appearance-color-field compact">
                <span>起点</span>
                <input id="appearance-gradient-start" type="color" value="#171a2d" />
                <code id="appearance-gradient-start-value">#171A2D</code>
              </label>
              <label class="appearance-field appearance-color-field compact">
                <span>终点</span>
                <input id="appearance-gradient-end" type="color" value="#412f66" />
                <code id="appearance-gradient-end-value">#412F66</code>
              </label>
            </div>
            <label class="appearance-range-field">
              <span>方向 <output id="appearance-gradient-angle-value">135°</output></span>
              <input id="appearance-gradient-angle" type="range" min="0" max="359" value="135" />
            </label>
          </div>
        </section>

        <section class="appearance-section">
          <h3>背景图片</h3>
          <div class="appearance-image-actions">
            <button id="appearance-upload" type="button" class="primary-button">上传图片</button>
            <button id="appearance-clear-image" type="button">移除图片</button>
            <span id="appearance-image-name">未选择</span>
          </div>
          <div id="appearance-preview" class="appearance-preview"><span>背景预览</span></div>
        </section>

        <section class="appearance-section appearance-controls">
          <label class="appearance-field">
            <span>作用范围</span>
            <select id="appearance-scope">
              <option value="editor">仅编辑器</option>
              <option value="all">整个 IDE</option>
            </select>
          </label>
          <label class="appearance-field">
            <span>图片布局</span>
            <select id="appearance-fit">
              <option value="cover">填充</option>
              <option value="contain">适应</option>
              <option value="fill">拉伸</option>
              <option value="none">原尺寸</option>
            </select>
          </label>
          <label class="appearance-field">
            <span>位置</span>
            <select id="appearance-position">
              <option value="center">居中</option>
              <option value="top">顶部</option>
              <option value="bottom">底部</option>
              <option value="left">左侧</option>
              <option value="right">右侧</option>
              <option value="top left">左上</option>
              <option value="top right">右上</option>
              <option value="bottom left">左下</option>
              <option value="bottom right">右下</option>
            </select>
          </label>
          <label class="appearance-range-field">
            <span>图片强度 <output id="appearance-image-opacity-value">42%</output></span>
            <input id="appearance-image-opacity" type="range" min="0" max="100" value="42" />
          </label>
          <label class="appearance-range-field">
            <span>暗色遮罩 <output id="appearance-overlay-value">56%</output></span>
            <input id="appearance-overlay" type="range" min="0" max="90" value="56" />
          </label>
          <label class="appearance-range-field">
            <span>模糊 <output id="appearance-blur-value">0px</output></span>
            <input id="appearance-blur" type="range" min="0" max="24" value="0" />
          </label>
        </section>
      </div>
    </section>
  </div>
`;

const editorElement = requireElement('editor');
const editorStage = requireElement('editor-stage');
const characterElement = requireElement('tutor-character');
const bubbleElement = requireElement('speech-bubble');
const tutorStatus = requireElement('tutor-status');
const fileTree = requireElement('file-tree');
const activeFile = requireElement('active-file');
const editorTabDot = requireElement('editor-tab-dot');
const editorSaveState = requireElement('editor-save-state');
const externalChangeState = requireElement('external-change-state');
const externalReloadButton = requireButton('external-reload');
const externalKeepButton = requireButton('external-keep');
const projectName = requireElement('project-name');
const projectRoot = requireElement('project-root');
const workspaceBadge = requireElement('workspace-badge');
const openProjectButton = requireButton('open-project');
const jumpToCursorButton = requireButton('jump-to-cursor');
const findRelatedButton = requireButton('find-related');
const semanticRelatedButton = requireButton('semantic-related');
const semanticAiModeSelect = requireSelect('semantic-ai-mode');
const semanticAiTourButton = requireButton('semantic-ai-tour');
const explainCurrentCodeButton = requireButton('explain-current-code');
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
const ideShell = requireElement('ide-shell');
const appearanceSettingsButton = requireButton('appearance-settings');
const appearanceModal = requireElement('appearance-modal');
const appearanceCloseButton = requireButton('appearance-close');
const appearanceBackgroundMode = requireElement('appearance-background-mode');
const appearanceSolidControls = requireElement('appearance-solid-controls');
const appearanceGradientControls = requireElement('appearance-gradient-controls');
const appearancePresets = requireElement('appearance-presets');
const appearanceColorInput = requireInput('appearance-color');
const appearanceColorValue = requireElement('appearance-color-value');
const appearanceGradientPresets = requireElement('appearance-gradient-presets');
const appearanceGradientStartInput = requireInput('appearance-gradient-start');
const appearanceGradientStartValue = requireElement('appearance-gradient-start-value');
const appearanceGradientEndInput = requireInput('appearance-gradient-end');
const appearanceGradientEndValue = requireElement('appearance-gradient-end-value');
const appearanceGradientAngleInput = requireInput('appearance-gradient-angle');
const appearanceGradientAngleValue = requireElement('appearance-gradient-angle-value');
const appearanceUploadButton = requireButton('appearance-upload');
const appearanceClearImageButton = requireButton('appearance-clear-image');
const appearanceImageName = requireElement('appearance-image-name');
const appearancePreview = requireElement('appearance-preview');
const appearanceScopeSelect = requireSelect('appearance-scope');
const appearanceFitSelect = requireSelect('appearance-fit');
const appearancePositionSelect = requireSelect('appearance-position');
const appearanceImageOpacityInput = requireInput('appearance-image-opacity');
const appearanceImageOpacityValue = requireElement('appearance-image-opacity-value');
const appearanceOverlayInput = requireInput('appearance-overlay');
const appearanceOverlayValue = requireElement('appearance-overlay-value');
const appearanceBlurInput = requireInput('appearance-blur');
const appearanceBlurValue = requireElement('appearance-blur-value');
const markdownModeControls = requireElement('markdown-mode-controls');
const markdownPreview = requireElement('markdown-preview');

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
  onMouseMove(listener: (event: RuntimeMonacoMouseEvent) => void): { dispose(): void };
  onMouseLeave(listener: () => void): { dispose(): void };
  onDidChangeModelContent(listener: () => void): { dispose(): void };
  onDidType(listener: (text: string) => void): { dispose(): void };
  setPosition(position: { lineNumber: number; column: number }): void;
  layout(): void;
  focus(): void;
}

const editorController = new EditorController(editorElement, demoFiles);
const codeNoteController = new CodeNoteController(
  editorController.editor,
  editorStage,
  (message) => { tutorStatus.textContent = message; },
);
codeNoteController.disable();
const runtimeEditor = editorController.editor as unknown as RuntimeMonacoEditor;
let preferredVoiceLanguage = 'zh-CN';
let preferredVoiceId = '';
let preferredVoiceRate = 1;
let voiceEnabledPreference = true;
let appearanceState: AppearanceState = {
  color: '#111318',
  backgroundMode: 'solid',
  gradientStart: '#171a2d',
  gradientEnd: '#412f66',
  gradientAngle: 135,
  scope: 'editor',
  imageFile: '',
  imageOpacity: 0.42,
  overlayOpacity: 0.56,
  blur: 0,
  fit: 'cover',
  position: 'center',
};
let appearanceBackgroundDataUrl = '';
type MarkdownViewMode = 'edit' | 'split' | 'preview';
const savedMarkdownMode = localStorage.getItem('ai-code-tutor.markdown-mode');
let markdownViewMode: MarkdownViewMode = savedMarkdownMode === 'edit' || savedMarkdownMode === 'preview'
  ? savedMarkdownMode
  : 'split';
let markdownRenderSequence = 0;

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
let projectDirectories: string[] = [];
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
let currentExplainSequence = 0;
let currentExplainRunning = false;
let tutorQuestionRunning = false;

const tutorQuestionInput = document.createElement('input');
tutorQuestionInput.type = 'text';
tutorQuestionInput.placeholder = '随时问老师…';
tutorQuestionInput.setAttribute('aria-label', '随时问 AI 老师');
Object.assign(tutorQuestionInput.style, {
  width: '210px',
  minWidth: '120px',
  padding: '6px 9px',
  borderRadius: '6px',
  border: '1px solid rgba(255,255,255,.16)',
  background: 'rgba(12,14,20,.72)',
  color: 'inherit',
  outline: 'none',
});
document.querySelector('.titlebar-right')?.prepend(tutorQuestionInput);
let definitionNavigationSequence = 0;
let fileSaveSequence = 0;
let externalRefreshSequence = 0;
let pendingExternalChange: { path: string; content: string } | null = null;
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

runtimeEditor.onDidChangeModelContent(() => {
  if (isMarkdownFile(editorController.path)) {
    void renderMarkdownPreview();
  }
});

tutorQuestionInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  void askTutorQuestion();
});

async function askTutorQuestion(): Promise<void> {
  const question = tutorQuestionInput.value.trim();
  if (!question || tutorQuestionRunning) return;

  const teaching = characterController.getTeachingContext();
  if (!teaching) {
    tutorStatus.textContent = '先让 AI 老师开始讲解，再随时插话提问';
    return;
  }
  if (!(await ensureOpenAiKey())) return;

  const context = captureCurrentCodeContext(editorController);
  if (!context) {
    tutorStatus.textContent = '当前代码上下文不可用';
    return;
  }

  tutorQuestionRunning = true;
  tutorQuestionInput.disabled = true;
  characterController.pauseForQuestion(question);

  try {
    const result = await window.tutorIde.explainCurrentCode({
      ...context,
      filePath: teaching.filePath,
      line: teaching.line,
      column: teaching.column,
      selectedText: `用户在老师讲解过程中插话提问：${question}\n\n老师刚才正在讲：${teaching.speech}\n\n当前代码：${context.selectedText}`,
      nearbyCode: `${context.nearbyCode}\n\n请先直接回答用户的问题，再用一两句话说明它和刚才讲解内容的关系。不要重新从头讲整段代码。`,
    });
    await characterController.presentQuestionAnswer(result.explanation);
    tutorQuestionInput.value = '';
  } catch (error) {
    tutorStatus.textContent = errorMessage(error);
  } finally {
    tutorQuestionRunning = false;
    tutorQuestionInput.disabled = false;
    tutorQuestionInput.focus();
    characterController.resumeAfterQuestion();
  }
}

window.tutorIde.onProjectFileChanged((change) => {
  void handleExternalFileChanged(change.path);
});

externalReloadButton.addEventListener('click', () => {
  if (!pendingExternalChange || pendingExternalChange.path !== editorController.path) {
    clearExternalChangeState();
    return;
  }

  const change = pendingExternalChange;
  editorController.replaceFileContentFromDisk({
    path: change.path,
    language: languageFromPath(change.path),
    content: change.content,
  });
  clearExternalChangeState();
  updateActiveFile();
  tutorStatus.textContent = `↻ 已重新加载外部修改 · ${change.path}`;
});

externalKeepButton.addEventListener('click', () => {
  if (!pendingExternalChange) {
    clearExternalChangeState();
    return;
  }
  const path = pendingExternalChange.path;
  clearExternalChangeState();
  tutorStatus.textContent = `保留 IDE 中的未保存内容 · ${path}`;
});

let ctrlNavigationPressed = false;
let hoveredEditorPosition: { lineNumber: number; column: number } | null = null;

runtimeEditor.onMouseMove((event) => {
  hoveredEditorPosition = event.target.position ?? null;
  if (ctrlNavigationPressed && hoveredEditorPosition) {
    editorController.showDefinitionHint(
      hoveredEditorPosition.lineNumber,
      hoveredEditorPosition.column,
    );
  } else {
    editorController.clearDefinitionHint();
  }
});

runtimeEditor.onMouseLeave(() => {
  hoveredEditorPosition = null;
  editorController.clearDefinitionHint();
});

runtimeEditor.onMouseDown((event) => {
  if (!event.event.ctrlKey || !event.target.position) {
    return;
  }

  event.event.preventDefault();
  editorController.clearDefinitionHint();
  void navigateToDartDefinition(
    event.target.position.lineNumber,
    event.target.position.column,
  );
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && hasActiveTutorActivity()) {
    event.preventDefault();
    interruptTutorActivities('Esc · 已打断 AI 讲解');
    return;
  }

  if (event.key === 'Control') {
    ctrlNavigationPressed = true;
    if (hoveredEditorPosition) {
      editorController.showDefinitionHint(
        hoveredEditorPosition.lineNumber,
        hoveredEditorPosition.column,
      );
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void saveCurrentFile();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.key === 'Control') {
    ctrlNavigationPressed = false;
    editorController.clearDefinitionHint();
  }
});

window.addEventListener('blur', () => {
  ctrlNavigationPressed = false;
  editorController.clearDefinitionHint();
});

window.addEventListener('android-project-snapshot', (event) => {
  void applyAndroidProjectSnapshot(
    event as CustomEvent<{
      rootPath: string;
      projectName: string;
      files: string[];
      directories?: string[];
      preferredFile?: string;
      message?: string;
    }>,
  );
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

appearanceSettingsButton.addEventListener('click', () => {
  syncAppearanceControls();
  appearanceModal.hidden = false;
});
appearanceCloseButton.addEventListener('click', () => {
  appearanceModal.hidden = true;
});
appearanceModal.addEventListener('click', (event) => {
  if (event.target === appearanceModal) {
    appearanceModal.hidden = true;
  }
});
appearanceBackgroundMode.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-background-mode]');
  const mode = button?.dataset.backgroundMode;
  if (mode !== 'solid' && mode !== 'gradient') {
    return;
  }
  appearanceState = { ...appearanceState, backgroundMode: mode };
  void updateAppearanceFromControls();
});
appearancePresets.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-color]');
  if (!button?.dataset.color) {
    return;
  }
  appearanceState = { ...appearanceState, backgroundMode: 'solid' };
  appearanceColorInput.value = button.dataset.color;
  void updateAppearanceFromControls();
});
appearanceGradientPresets.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-gradient-start]');
  if (!button?.dataset.gradientStart || !button.dataset.gradientEnd) {
    return;
  }
  appearanceState = { ...appearanceState, backgroundMode: 'gradient' };
  appearanceGradientStartInput.value = button.dataset.gradientStart;
  appearanceGradientEndInput.value = button.dataset.gradientEnd;
  appearanceGradientAngleInput.value = button.dataset.gradientAngle ?? '135';
  void updateAppearanceFromControls();
});
appearanceColorInput.addEventListener('input', () => {
  appearanceState = { ...appearanceState, backgroundMode: 'solid' };
  void updateAppearanceFromControls(false);
});
appearanceColorInput.addEventListener('change', () => void updateAppearanceFromControls(true));
appearanceGradientStartInput.addEventListener('input', () => {
  appearanceState = { ...appearanceState, backgroundMode: 'gradient' };
  void updateAppearanceFromControls(false);
});
appearanceGradientEndInput.addEventListener('input', () => {
  appearanceState = { ...appearanceState, backgroundMode: 'gradient' };
  void updateAppearanceFromControls(false);
});
appearanceGradientAngleInput.addEventListener('input', () => {
  appearanceState = { ...appearanceState, backgroundMode: 'gradient' };
  void updateAppearanceFromControls(false);
});
appearanceGradientStartInput.addEventListener('change', () => void updateAppearanceFromControls(true));
appearanceGradientEndInput.addEventListener('change', () => void updateAppearanceFromControls(true));
appearanceGradientAngleInput.addEventListener('change', () => void updateAppearanceFromControls(true));
appearanceScopeSelect.addEventListener('change', () => void updateAppearanceFromControls());
appearanceFitSelect.addEventListener('change', () => void updateAppearanceFromControls());
appearancePositionSelect.addEventListener('change', () => void updateAppearanceFromControls());
appearanceImageOpacityInput.addEventListener('input', () => void updateAppearanceFromControls(false));
appearanceOverlayInput.addEventListener('input', () => void updateAppearanceFromControls(false));
appearanceBlurInput.addEventListener('input', () => void updateAppearanceFromControls(false));
appearanceImageOpacityInput.addEventListener('change', () => void updateAppearanceFromControls(true));
appearanceOverlayInput.addEventListener('change', () => void updateAppearanceFromControls(true));
appearanceBlurInput.addEventListener('change', () => void updateAppearanceFromControls(true));
appearanceUploadButton.addEventListener('click', () => void chooseAppearanceBackground());
appearanceClearImageButton.addEventListener('click', () => void clearAppearanceBackground());

markdownModeControls.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-markdown-mode]');
  const mode = button?.dataset.markdownMode;
  if (mode === 'edit' || mode === 'split' || mode === 'preview') {
    markdownViewMode = mode;
    localStorage.setItem('ai-code-tutor.markdown-mode', mode);
    updateMarkdownUi();
  }
});
markdownPreview.addEventListener('click', (event) => {
  const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!anchor) {
    return;
  }
  event.preventDefault();
  void handleMarkdownLink(anchor.getAttribute('href') ?? '');
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

explainCurrentCodeButton.addEventListener('click', async () => {
  if (currentExplainRunning) {
    interruptTutorActivities('已停止当前代码解释');
    return;
  }

  if (!isRealProject) {
    tutorStatus.textContent = '请先打开真实项目';
    return;
  }

  const context = captureCurrentCodeContext(editorController);
  if (!context) {
    tutorStatus.textContent = '请把光标放到代码上，或先选中一段想理解的代码';
    return;
  }

  if (!(await ensureOpenAiKey())) {
    tutorStatus.textContent = '未设置 OpenAI API Key';
    return;
  }

  stopRelatedTour('已切换到当前代码解释');
  stopSemanticTour('已切换到当前代码解释');
  stopSemanticAiTour('已切换到当前代码解释');
  stopAiTour('已切换到当前代码解释');

  const sequence = ++currentExplainSequence;
  currentExplainRunning = true;
  explainCurrentCodeButton.disabled = false;
  explainCurrentCodeButton.textContent = '■ 停止解释';
  tutorStatus.textContent = context.query
    ? `AI 正在理解 ${context.filePath}:${context.line} 的 “${context.query}”…`
    : `AI 正在理解 ${context.filePath}:${context.line}…`;

  try {
    const result = await window.tutorIde.explainCurrentCode(context);
    if (sequence !== currentExplainSequence) {
      return;
    }

    await characterController.moveTo({
      filePath: result.filePath,
      line: result.line,
      column: result.column,
      action: 'point',
      speech: result.explanation,
    });
    if (sequence !== currentExplainSequence) {
      return;
    }

    updateActiveFile();
    updateFileTreeSelection(true);
    tutorStatus.textContent = `✓ 已解释当前代码 · ${result.model}${result.usedUnsavedContent ? ' · 包含未保存修改' : ''}`;
  } catch (error) {
    if (sequence === currentExplainSequence) {
      tutorStatus.textContent = errorMessage(error);
    }
  } finally {
    if (sequence === currentExplainSequence) {
      currentExplainRunning = false;
      explainCurrentCodeButton.disabled = !isRealProject;
      explainCurrentCodeButton.textContent = '✨ 解释这里';
    }
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

  if (pendingExternalChange?.path === editorController.path) {
    tutorStatus.textContent = '⚠ 文件已在其他编辑器中修改，请先选择“重新加载”或“保留本地”再保存。';
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

function hasActiveTutorActivity(): boolean {
  return relatedTourRunning
    || semanticTourRunning
    || semanticAiTourRunning
    || aiTourRunning
    || currentExplainRunning
    || tutorQuestionRunning;
}

function interruptTutorActivities(message: string): void {
  if (!hasActiveTutorActivity()) {
    return;
  }

  relatedTourSequence += 1;
  semanticTourSequence += 1;
  semanticAiTourSequence += 1;
  aiTourSequence += 1;
  currentExplainSequence += 1;

  relatedTourRunning = false;
  semanticTourRunning = false;
  semanticAiTourRunning = false;
  aiTourRunning = false;
  currentExplainRunning = false;
  tutorQuestionRunning = false;
  tutorQuestionInput.disabled = false;

  findRelatedButton.textContent = '🧭 老师找相关代码';
  semanticRelatedButton.textContent = '🧠 Dart 语义调用';
  semanticAiTourButton.textContent = '🧠✨ AI 理解函数';
  semanticAiModeSelect.disabled = false;
  aiTourButton.textContent = '✨ AI 老师理解项目';
  explainCurrentCodeButton.disabled = !isRealProject;
  explainCurrentCodeButton.textContent = '✨ 解释这里';

  characterController.interrupt(message);
  tutorStatus.textContent = message;
}

function cancelCurrentExplanation(): void {
  currentExplainSequence += 1;
  currentExplainRunning = false;
  explainCurrentCodeButton.disabled = !isRealProject;
  explainCurrentCodeButton.textContent = '✨ 解释这里';
}

function stopRelatedTour(message: string): void {
  characterController.stopSpeech();
  cancelCurrentExplanation();
  relatedTourSequence += 1;
  relatedTourRunning = false;
  findRelatedButton.textContent = '🧭 老师找相关代码';
  tutorStatus.textContent = message;
}

function stopSemanticTour(message: string): void {
  characterController.stopSpeech();
  cancelCurrentExplanation();
  semanticTourSequence += 1;
  semanticTourRunning = false;
  semanticRelatedButton.textContent = '🧠 Dart 语义调用';
  tutorStatus.textContent = message;
}

function stopSemanticAiTour(message: string): void {
  characterController.stopSpeech();
  cancelCurrentExplanation();
  semanticAiTourSequence += 1;
  semanticAiTourRunning = false;
  semanticAiTourButton.textContent = '🧠✨ AI 理解函数';
  semanticAiModeSelect.disabled = false;
  tutorStatus.textContent = message;
}

function stopAiTour(message: string): void {
  characterController.stopSpeech();
  cancelCurrentExplanation();
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


function applyAppearance(): void {
  const image = appearanceBackgroundDataUrl ? `url("${appearanceBackgroundDataUrl}")` : 'none';
  const background = appearanceState.backgroundMode === 'gradient'
    ? `linear-gradient(${appearanceState.gradientAngle}deg, ${appearanceState.gradientStart}, ${appearanceState.gradientEnd})`
    : appearanceState.color;
  ideShell.dataset.backgroundScope = appearanceState.scope;
  ideShell.dataset.backgroundMode = appearanceState.backgroundMode;
  ideShell.dataset.hasBackgroundImage = String(Boolean(appearanceBackgroundDataUrl));
  ideShell.style.setProperty('--appearance-color', appearanceState.color);
  ideShell.style.setProperty('--appearance-background', background);
  ideShell.style.setProperty('--appearance-gradient-start', appearanceState.gradientStart);
  ideShell.style.setProperty('--appearance-gradient-end', appearanceState.gradientEnd);
  ideShell.style.setProperty('--appearance-gradient-angle', `${appearanceState.gradientAngle}deg`);
  ideShell.style.setProperty('--appearance-image', image);
  ideShell.style.setProperty('--appearance-image-opacity', String(appearanceState.imageOpacity));
  ideShell.style.setProperty('--appearance-overlay-opacity', String(appearanceState.overlayOpacity));
  ideShell.style.setProperty('--appearance-blur', `${appearanceState.blur}px`);
  ideShell.style.setProperty('--appearance-fit', appearanceState.fit === 'none' ? 'auto' : appearanceState.fit);
  ideShell.style.setProperty('--appearance-position', appearanceState.position);

  const stickySurface = stickyScrollSurface(background);
  ideShell.style.setProperty('--sticky-scroll-background', stickySurface.cssBackground);
  ideShell.style.setProperty('--sticky-scroll-color', stickySurface.color);
  ideShell.style.setProperty('--sticky-scroll-hover', stickySurface.hover);
  ideShell.style.setProperty('--sticky-scroll-border', stickySurface.border);
  ideShell.style.setProperty('--sticky-scroll-shadow', stickySurface.shadow);

  appearancePreview.dataset.hasBackgroundImage = String(Boolean(appearanceBackgroundDataUrl));
  appearancePreview.dataset.backgroundMode = appearanceState.backgroundMode;
  appearancePreview.style.setProperty('--appearance-color', appearanceState.color);
  appearancePreview.style.setProperty('--appearance-background', background);
  appearancePreview.style.setProperty('--appearance-gradient-start', appearanceState.gradientStart);
  appearancePreview.style.setProperty('--appearance-gradient-end', appearanceState.gradientEnd);
  appearancePreview.style.setProperty('--appearance-gradient-angle', `${appearanceState.gradientAngle}deg`);
  appearancePreview.style.setProperty('--appearance-image', image);
  appearancePreview.style.setProperty('--appearance-image-opacity', String(appearanceState.imageOpacity));
  appearancePreview.style.setProperty('--appearance-overlay-opacity', String(appearanceState.overlayOpacity));
  appearancePreview.style.setProperty('--appearance-blur', `${appearanceState.blur}px`);
  appearancePreview.style.setProperty('--appearance-fit', appearanceState.fit === 'none' ? 'auto' : appearanceState.fit);
  appearancePreview.style.setProperty('--appearance-position', appearanceState.position);

  applyAdaptiveSyntaxTheme();
}

function syncAppearanceControls(imageName = appearanceState.imageFile): void {
  appearanceColorInput.value = appearanceState.color;
  appearanceColorValue.textContent = appearanceState.color.toUpperCase();
  appearanceGradientStartInput.value = appearanceState.gradientStart;
  appearanceGradientStartValue.textContent = appearanceState.gradientStart.toUpperCase();
  appearanceGradientEndInput.value = appearanceState.gradientEnd;
  appearanceGradientEndValue.textContent = appearanceState.gradientEnd.toUpperCase();
  appearanceGradientAngleInput.value = String(Math.round(appearanceState.gradientAngle));
  appearanceGradientAngleValue.textContent = `${Math.round(appearanceState.gradientAngle)}°`;
  appearanceSolidControls.hidden = appearanceState.backgroundMode !== 'solid';
  appearanceGradientControls.hidden = appearanceState.backgroundMode !== 'gradient';
  for (const button of appearanceBackgroundMode.querySelectorAll<HTMLButtonElement>('[data-background-mode]')) {
    button.dataset.active = String(button.dataset.backgroundMode === appearanceState.backgroundMode);
  }
  appearanceScopeSelect.value = appearanceState.scope;
  appearanceFitSelect.value = appearanceState.fit;
  appearancePositionSelect.value = appearanceState.position;
  appearanceImageOpacityInput.value = String(Math.round(appearanceState.imageOpacity * 100));
  appearanceOverlayInput.value = String(Math.round(appearanceState.overlayOpacity * 100));
  appearanceBlurInput.value = String(Math.round(appearanceState.blur));
  appearanceImageOpacityValue.textContent = `${appearanceImageOpacityInput.value}%`;
  appearanceOverlayValue.textContent = `${appearanceOverlayInput.value}%`;
  appearanceBlurValue.textContent = `${appearanceBlurInput.value}px`;
  appearanceImageName.textContent = imageName || '未选择';
  appearanceClearImageButton.disabled = !appearanceBackgroundDataUrl;
  for (const button of appearancePresets.querySelectorAll<HTMLButtonElement>('[data-color]')) {
    button.dataset.active = String(
      appearanceState.backgroundMode === 'solid'
      && button.dataset.color?.toLowerCase() === appearanceState.color.toLowerCase()
    );
  }
  for (const button of appearanceGradientPresets.querySelectorAll<HTMLButtonElement>('[data-gradient-start]')) {
    button.dataset.active = String(
      appearanceState.backgroundMode === 'gradient'
      && button.dataset.gradientStart?.toLowerCase() === appearanceState.gradientStart.toLowerCase()
      && button.dataset.gradientEnd?.toLowerCase() === appearanceState.gradientEnd.toLowerCase()
      && Number(button.dataset.gradientAngle ?? 135) === Math.round(appearanceState.gradientAngle)
    );
  }
  applyAppearance();
}

async function updateAppearanceFromControls(persist = true): Promise<void> {
  appearanceState = {
    ...appearanceState,
    color: appearanceColorInput.value,
    backgroundMode: appearanceState.backgroundMode === 'gradient' ? 'gradient' : 'solid',
    gradientStart: appearanceGradientStartInput.value,
    gradientEnd: appearanceGradientEndInput.value,
    gradientAngle: Number(appearanceGradientAngleInput.value),
    scope: appearanceScopeSelect.value === 'all' ? 'all' : 'editor',
    fit: normalizeAppearanceFit(appearanceFitSelect.value),
    position: normalizeAppearancePosition(appearancePositionSelect.value),
    imageOpacity: Number(appearanceImageOpacityInput.value) / 100,
    overlayOpacity: Number(appearanceOverlayInput.value) / 100,
    blur: Number(appearanceBlurInput.value),
  };
  syncAppearanceControls();
  if (!persist) {
    return;
  }
  try {
    appearanceState = await window.tutorIde.updateAppearanceState(appearanceState);
    syncAppearanceControls();
  } catch (error) {
    tutorStatus.textContent = `外观保存失败：${errorMessage(error)}`;
  }
}

async function chooseAppearanceBackground(): Promise<void> {
  appearanceUploadButton.disabled = true;
  appearanceUploadButton.textContent = '选择中…';
  try {
    const result = await window.tutorIde.chooseAppearanceBackground();
    if (!result) {
      return;
    }
    appearanceState = result.appearance;
    appearanceBackgroundDataUrl = result.dataUrl;
    syncAppearanceControls(result.name);
    tutorStatus.textContent = `✓ 已设置背景图片 · ${result.name}`;
  } catch (error) {
    tutorStatus.textContent = `背景图片设置失败：${errorMessage(error)}`;
  } finally {
    appearanceUploadButton.disabled = false;
    appearanceUploadButton.textContent = '上传图片';
  }
}

async function clearAppearanceBackground(): Promise<void> {
  try {
    appearanceState = await window.tutorIde.clearAppearanceBackground();
    appearanceBackgroundDataUrl = '';
    syncAppearanceControls();
    tutorStatus.textContent = '已移除背景图片';
  } catch (error) {
    tutorStatus.textContent = `移除背景失败：${errorMessage(error)}`;
  }
}

function normalizeAppearanceFit(value: string): AppearanceState['fit'] {
  return value === 'contain' || value === 'fill' || value === 'none' ? value : 'cover';
}

function normalizeAppearancePosition(value: string): AppearanceState['position'] {
  const positions: AppearanceState['position'][] = [
    'center', 'top', 'bottom', 'left', 'right',
    'top left', 'top right', 'bottom left', 'bottom right',
  ];
  return positions.includes(value as AppearanceState['position'])
    ? value as AppearanceState['position']
    : 'center';
}

function applyAdaptiveSyntaxTheme(): void {
  const backgroundColors = appearanceState.backgroundMode === 'gradient'
    ? [appearanceState.gradientStart, appearanceState.gradientEnd]
    : [appearanceState.color];
  const averageLuminance = backgroundColors.reduce(
    (total, color) => total + hexLuminance(color),
    0,
  ) / Math.max(1, backgroundColors.length);

  // 黑色遮罩会显著降低实际代码区亮度。背景图片无法可靠采样时，
  // 使用遮罩强度作为保守判断，避免在照片上误用低对比度的浅色语法。
  const effectiveLuminance = averageLuminance * (1 - appearanceState.overlayOpacity);
  const useLightTokens = !appearanceBackgroundDataUrl
    && effectiveLuminance >= 0.62;

  const stickySurface = stickyScrollSurface(
    appearanceState.backgroundMode === 'gradient'
      ? `linear-gradient(${appearanceState.gradientAngle}deg, ${appearanceState.gradientStart}, ${appearanceState.gradientEnd})`
      : appearanceState.color,
  );

  const rules: monaco.editor.ITokenThemeRule[] = useLightTokens
    ? [
        { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7C3AED', fontStyle: 'bold' },
        { token: 'string', foreground: '0F766E' },
        { token: 'number', foreground: 'B45309' },
        { token: 'regexp', foreground: 'BE123C' },
        { token: 'type', foreground: '0369A1' },
        { token: 'type.identifier', foreground: '0369A1' },
        { token: 'class', foreground: '0369A1' },
        { token: 'function', foreground: '1D4ED8' },
        { token: 'variable', foreground: '0F172A' },
        { token: 'constant', foreground: 'B45309' },
        { token: 'operator', foreground: '6D28D9' },
        { token: 'delimiter', foreground: '475569' },
      ]
    : [
        { token: 'comment', foreground: '8995A5', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'D6A6FF', fontStyle: 'bold' },
        { token: 'string', foreground: 'A7E68A' },
        { token: 'number', foreground: 'FFB879' },
        { token: 'regexp', foreground: 'FF91A4' },
        { token: 'type', foreground: '82D8FF' },
        { token: 'type.identifier', foreground: '82D8FF' },
        { token: 'class', foreground: '82D8FF' },
        { token: 'function', foreground: '80BFFF' },
        { token: 'variable', foreground: 'E7EBF3' },
        { token: 'constant', foreground: 'FFD580' },
        { token: 'operator', foreground: 'FF9BD8' },
        { token: 'delimiter', foreground: 'ACB4C1' },
      ];

  monaco.editor.defineTheme('ai-tutor-adaptive', {
    base: useLightTokens ? 'vs' : 'vs-dark',
    inherit: true,
    rules,
    colors: useLightTokens
      ? {
          'editor.background': '#FFFFFF00',
          'editor.foreground': '#172033',
          'editorLineNumber.foreground': '#64748B',
          'editorLineNumber.activeForeground': '#172033',
          'editorCursor.foreground': '#5B21B6',
          'editor.selectionBackground': '#2563EB33',
          'editor.inactiveSelectionBackground': '#2563EB1F',
          'editor.lineHighlightBackground': '#0F172A0A',
          // Sticky Scroll 与当前外观共用同一色系，但仍保持完全不透明，
          // 防止下面正在滚动的正文穿透。
          'editorStickyScroll.background': stickySurface.color,
          'editorStickyScrollHover.background': stickySurface.hover,
          'editorStickyScroll.border': stickySurface.border,
          'editorStickyScroll.shadow': stickySurface.shadow,
          'editorIndentGuide.background1': '#64748B33',
          'editorIndentGuide.activeBackground1': '#47556966',
          'editorGutter.background': '#00000000',
          'minimap.background': '#00000000',
          'editorOverviewRuler.background': '#00000000',
          'editorOverviewRuler.border': '#00000000',
          'scrollbar.shadow': '#00000000',
        }
      : {
          'editor.background': '#00000000',
          'editor.foreground': '#E7EBF3',
          'editorLineNumber.foreground': '#788493',
          'editorLineNumber.activeForeground': '#EEF2F8',
          'editorCursor.foreground': '#E7D8FF',
          'editor.selectionBackground': '#7C5CFF55',
          'editor.inactiveSelectionBackground': '#7C5CFF2E',
          'editor.lineHighlightBackground': '#FFFFFF0A',
          'editorStickyScroll.background': stickySurface.color,
          'editorStickyScrollHover.background': stickySurface.hover,
          'editorStickyScroll.border': stickySurface.border,
          'editorStickyScroll.shadow': stickySurface.shadow,
          'editorIndentGuide.background1': '#FFFFFF16',
          'editorIndentGuide.activeBackground1': '#FFFFFF33',
          'editorGutter.background': '#00000000',
          'minimap.background': '#00000000',
          'editorOverviewRuler.background': '#00000000',
          'editorOverviewRuler.border': '#00000000',
          'scrollbar.shadow': '#00000000',
        },
  });
  monaco.editor.setTheme('ai-tutor-adaptive');
  ideShell.dataset.syntaxTone = useLightTokens ? 'light' : 'dark';
}

function stickyScrollSurface(backgroundCss: string): {
  cssBackground: string;
  color: string;
  hover: string;
  border: string;
  shadow: string;
} {
  const color = appearanceState.backgroundMode === 'gradient'
    ? mixHexColors(appearanceState.gradientStart, appearanceState.gradientEnd, 0.5)
    : normalizeHexColor(appearanceState.color);
  const light = hexLuminance(color) >= 0.58;

  // 对纯色/渐变直接复用用户选择的背景；图片模式不能透明，否则会重新出现
  // 正文穿透，因此使用与当前主题同色系的完全不透明底色。
  const cssBackground = appearanceBackgroundDataUrl ? color : backgroundCss;

  return {
    cssBackground,
    color,
    hover: mixHexColors(color, light ? '#000000' : '#FFFFFF', light ? 0.07 : 0.09),
    border: mixHexColors(color, light ? '#000000' : '#FFFFFF', light ? 0.16 : 0.14),
    shadow: light ? '#0F172A24' : '#00000066',
  };
}

function normalizeHexColor(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  return match ? `#${match[1].toUpperCase()}` : '#171A22';
}

function mixHexColors(from: string, to: string, amount: number): string {
  const a = hexRgb(normalizeHexColor(from));
  const b = hexRgb(normalizeHexColor(to));
  const t = Math.max(0, Math.min(1, amount));
  return `#${[
    Math.round(a.red + (b.red - a.red) * t),
    Math.round(a.green + (b.green - a.green) * t),
    Math.round(a.blue + (b.blue - a.blue) * t),
  ].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function hexRgb(color: string): { red: number; green: number; blue: number } {
  const value = Number.parseInt(color.slice(1), 16);
  return {
    red: (value >> 16) & 255,
    green: (value >> 8) & 255,
    blue: value & 255,
  };
}

function hexLuminance(color: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return 0;
  }
  const value = Number.parseInt(match[1], 16);
  const red = ((value >> 16) & 255) / 255;
  const green = ((value >> 8) & 255) / 255;
  const blue = (value & 255) / 255;
  return red * 0.299 + green * 0.587 + blue * 0.114;
}

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath);
}

function updateMarkdownUi(): void {
  const markdown = isMarkdownFile(editorController.path);
  markdownModeControls.hidden = !markdown;
  editorStage.dataset.markdownMode = markdown ? markdownViewMode : 'none';
  markdownPreview.hidden = !markdown || markdownViewMode === 'edit';
  editorElement.hidden = markdown && markdownViewMode === 'preview';
  tutorStatus.dataset.markdown = String(markdown);

  for (const button of markdownModeControls.querySelectorAll<HTMLButtonElement>('[data-markdown-mode]')) {
    button.dataset.active = String(button.dataset.markdownMode === markdownViewMode);
  }

  if (markdown) {
    void renderMarkdownPreview();
  } else {
    markdownPreview.replaceChildren();
  }
  window.requestAnimationFrame(() => runtimeEditor.layout());
}

async function renderMarkdownPreview(): Promise<void> {
  if (!isMarkdownFile(editorController.path) || markdownViewMode === 'edit') {
    return;
  }
  const sequence = ++markdownRenderSequence;
  const filePath = editorController.path;
  const source = editorController.getCurrentContent();
  markdownPreview.innerHTML = renderMarkdownDocument(source);

  const localImages = Array.from(markdownPreview.querySelectorAll<HTMLImageElement>('img[data-project-src]'));
  await Promise.all(localImages.map(async (image) => {
    const rawSource = image.dataset.projectSrc ?? '';
    const resolved = resolveProjectRelativePath(filePath, rawSource);
    if (!resolved) {
      image.dataset.broken = 'true';
      return;
    }
    try {
      const asset = await window.tutorIde.readProjectAsset(resolved);
      if (sequence !== markdownRenderSequence || filePath !== editorController.path) {
        return;
      }
      image.src = asset.dataUrl;
      image.removeAttribute('data-project-src');
    } catch {
      image.dataset.broken = 'true';
      image.alt = `${image.alt || '图片'}（无法读取 ${resolved}）`;
    }
  }));
}

function renderMarkdownDocument(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = /^```([^`]*)$/.exec(trimmed);
    if (fence) {
      const language = escapeText(fence[1].trim());
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      output.push(`<pre><code${language ? ` data-language="${language}"` : ''}>${escapeText(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1]) && line.includes('|')) {
      const headers = splitMarkdownTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      output.push(`<div class="md-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderMarkdownInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${renderMarkdownInline(row[cellIndex] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = markdownHeadingId(text);
      output.push(`<h${level} id="${escapeAttribute(id)}">${renderMarkdownInline(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
      output.push('<hr />');
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quotes: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quotes.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      output.push(`<blockquote>${quotes.map((value) => `<p>${renderMarkdownInline(value)}</p>`).join('')}</blockquote>`);
      continue;
    }

    if (/^[-+*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-+*]\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^[-+*]\s+/, '');
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
        items.push(task
          ? `<li class="task-list-item"><input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''} /><span>${renderMarkdownInline(task[2])}</span></li>`
          : `<li>${renderMarkdownInline(item)}</li>`);
        index += 1;
      }
      output.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(`<li>${renderMarkdownInline(lines[index].trim().replace(/^\d+[.)]\s+/, ''))}</li>`);
        index += 1;
      }
      output.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paragraph: string[] = [trimmed];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${renderMarkdownInline(paragraph.join(' '))}</p>`);
  }

  return output.join('\n');
}

function renderMarkdownInline(raw: string): string {
  const codeTokens: string[] = [];
  const elementTokens: string[] = [];
  let working = raw.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `\u0000CODE${codeTokens.length}\u0000`;
    codeTokens.push(`<code>${escapeText(code)}</code>`);
    return token;
  });
  working = escapeText(working);

  working = working.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_match, alt: string, url: string) => {
    const decodedUrl = decodeHtmlAttribute(url);
    const html = /^https?:\/\//i.test(decodedUrl) || /^data:image\//i.test(decodedUrl)
      ? `<img src="${escapeAttribute(decodedUrl)}" alt="${escapeAttribute(decodeHtmlAttribute(alt))}" loading="lazy" />`
      : `<img data-project-src="${escapeAttribute(decodedUrl)}" alt="${escapeAttribute(decodeHtmlAttribute(alt))}" loading="lazy" />`;
    const token = `\u0001ELEMENT${elementTokens.length}\u0001`;
    elementTokens.push(html);
    return token;
  });
  working = working.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_match, label: string, url: string) => {
    const decodedUrl = decodeHtmlAttribute(url);
    const token = `\u0001ELEMENT${elementTokens.length}\u0001`;
    elementTokens.push(`<a href="${escapeAttribute(decodedUrl)}">${label}</a>`);
    return token;
  });

  working = working.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  working = working.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  working = working.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  working = working.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  working = working.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');

  for (let index = 0; index < elementTokens.length; index += 1) {
    working = working.replace(`\u0001ELEMENT${index}\u0001`, elementTokens[index]);
  }
  for (let index = 0; index < codeTokens.length; index += 1) {
    working = working.replace(`\u0000CODE${index}\u0000`, codeTokens[index]);
  }
  return working;
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isMarkdownBlockStart(lines: string[], index: number): boolean {
  const value = lines[index].trim();
  return !value
    || /^```/.test(value)
    || /^(#{1,6})\s+/.test(value)
    || /^>\s?/.test(value)
    || /^[-+*]\s+/.test(value)
    || /^\d+[.)]\s+/.test(value)
    || /^([-*_])(?:\s*\1){2,}\s*$/.test(value)
    || (index + 1 < lines.length && value.includes('|') && isMarkdownTableSeparator(lines[index + 1]));
}

function markdownHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function handleMarkdownLink(rawHref: string): Promise<void> {
  const href = decodeHtmlAttribute(rawHref.trim());
  if (!href) {
    return;
  }
  if (href.startsWith('#')) {
    const target = markdownPreview.querySelector<HTMLElement>(`#${cssEscape(href.slice(1))}`);
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  if (/^https?:\/\//i.test(href)) {
    await window.tutorIde.openExternal(href);
    return;
  }

  const [pathPart] = href.split('#', 1);
  const resolved = resolveProjectRelativePath(editorController.path, pathPart);
  if (resolved && projectFiles.includes(resolved)) {
    await openRealProjectFile(resolved, false, true);
    return;
  }
  tutorStatus.textContent = `Markdown 链接无法在当前项目中打开：${href}`;
}

function resolveProjectRelativePath(fromFile: string, rawTarget: string): string {
  const cleanTarget = decodeURIComponentSafe(rawTarget.split(/[?#]/, 1)[0]).replaceAll('\\', '/');
  if (!cleanTarget || /^(?:[a-z]+:)?\/\//i.test(cleanTarget)) {
    return '';
  }
  const baseParts = cleanTarget.startsWith('/')
    ? []
    : fromFile.split('/').slice(0, -1);
  const parts = [...baseParts, ...cleanTarget.replace(/^\/+/, '').split('/')];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (normalized.length === 0) {
        return '';
      }
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join('/');
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('`', '&#096;');
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cssEscape(value: string): string {
  if ('CSS' in window && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

async function initializeApplication(): Promise<void> {
  tutorStatus.textContent = '正在恢复上次工作区…';
  try {
    const state = await window.tutorIde.getAppState();
    preferredVoiceLanguage = state.voice.language || 'zh-CN';
    preferredVoiceId = state.voice.voiceId || '';
    preferredVoiceRate = Number.isFinite(state.voice.rate) ? state.voice.rate : 1;
    voiceEnabledPreference = state.voice.enabled !== false;
    appearanceState = state.appearance ?? appearanceState;
    const background = await window.tutorIde.getAppearanceBackground();
    appearanceBackgroundDataUrl = background?.dataUrl ?? '';
    applyAppearance();
    syncAppearanceControls(background?.name ?? appearanceState.imageFile);

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
  result: {
    rootPath: string;
    projectName: string;
    files: string[];
    directories?: string[];
  },
  preferredFile: string,
): Promise<void> {
  projectFiles = result.files;
  projectDirectories =
    result.directories ?? [];
  isRealProject = true;
  projectName.textContent = `▾ ${result.projectName}`;
  projectRoot.textContent = result.rootPath;
  workspaceBadge.textContent = '真实项目';
  findRelatedButton.disabled = false;
  semanticRelatedButton.disabled = false;
  semanticAiTourButton.disabled = false;
  explainCurrentCodeButton.disabled = false;
  aiTourButton.disabled = false;
  renderFileTree(
    projectFiles,
    projectDirectories,
  );
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

async function applyAndroidProjectSnapshot(
  event: CustomEvent<{
    rootPath: string;
    projectName: string;
    files: string[];
    directories?: string[];
    preferredFile?: string;
    message?: string;
  }>,
): Promise<void> {
  const snapshot = event.detail;

  projectFiles = snapshot.files;
  projectDirectories =
    snapshot.directories ?? [];
  isRealProject = true;

  projectName.textContent =
    `▾ ${snapshot.projectName}`;
  projectRoot.textContent =
    snapshot.rootPath;
  workspaceBadge.textContent =
    '真实项目';

  renderFileTree(
    projectFiles,
    projectDirectories,
  );

  const preferredFile =
    snapshot.preferredFile ?? '';

  if (
    preferredFile
      && projectFiles.includes(
        preferredFile,
      )
  ) {
    await openRealProjectFile(
      preferredFile,
      false,
      true,
    );
  } else {
    updateFileTreeSelection(true);
  }

  tutorStatus.textContent =
    snapshot.message
      ?? `✓ 项目目录已刷新 · ${projectFiles.length} 个代码文件`;
}

function renderFileTree(
  paths: string[],
  directories: string[] = [],
): void {
  fileTree.replaceChildren();
  expandedDirectories.clear();

  if (
    paths.length === 0
      && directories.length === 0
  ) {
    const empty = document.createElement('div');
    empty.className = 'file-tree-empty';
    empty.textContent = '没有找到支持的代码文件';
    fileTree.appendChild(empty);
    return;
  }

  const tree = buildTree(
    paths,
    directories,
  );
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
          codeNoteController.disable();
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
  clearExternalChangeState();
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

  await codeNoteController.openFile(file.path);
  await window.tutorIde.watchProjectFile(file.path);
  updateActiveFile();
  updateFileTreeSelection(revealInTree);
  tutorStatus.textContent = editorController.isDirty()
    ? `已打开 ${path} · 保留未保存修改`
    : `已打开 ${path}`;
}

async function handleExternalFileChanged(path: string): Promise<void> {
  if (!isRealProject || path !== editorController.path) {
    return;
  }

  const sequence = ++externalRefreshSequence;
  try {
    const result = await window.tutorIde.readProjectFile(path);
    if (sequence !== externalRefreshSequence || result.path !== editorController.path) {
      return;
    }

    if (editorController.isDirty(result.path)) {
      pendingExternalChange = { path: result.path, content: result.content };
      externalChangeState.hidden = false;
      tutorStatus.textContent = `⚠ ${result.path} 已在其他编辑器中修改；本地还有未保存内容，未自动覆盖。`;
      return;
    }

    editorController.replaceFileContentFromDisk({
      path: result.path,
      language: languageFromPath(result.path),
      content: result.content,
    });
    clearExternalChangeState();
    updateActiveFile();
    tutorStatus.textContent = `↻ 已实时同步外部修改 · ${result.path}`;
  } catch (error) {
    if (sequence === externalRefreshSequence) {
      tutorStatus.textContent = `外部文件同步失败：${errorMessage(error)}`;
    }
  }
}

function clearExternalChangeState(): void {
  pendingExternalChange = null;
  externalChangeState.hidden = true;
}

function updateActiveFile(): void {
  activeFile.textContent = editorController.path;
  updateEditorSaveState();
  updateMarkdownUi();
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

function buildTree(
  paths: string[],
  directories: string[] = [],
): TreeNode[] {
  const root: TreeDirectoryNode = {
    type: 'directory',
    name: '',
    path: '',
    children: [],
  };

  for (
    const directoryPath of directories
  ) {
    const parts =
      directoryPath
        .split('/')
        .filter(Boolean);
    let directory = root;

    for (const part of parts) {
      let child =
        directory.children.find(
          (
            node,
          ): node is TreeDirectoryNode =>
            node.type === 'directory'
              && node.name === part,
        );

      if (!child) {
        const parentPath =
          directory.path;
        child = {
          type: 'directory',
          name: part,
          path: parentPath
            ? `${parentPath}/${part}`
            : part,
          children: [],
        };
        directory.children.push(child);
      }

      directory = child;
    }
  }

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
  codeNoteController.dispose();
  editorController.dispose();
});
