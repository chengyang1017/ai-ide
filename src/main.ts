import './styles.css';
import { CharacterController } from './character/character_controller';
import { demoFiles, demoMoves } from './demo/demo_project';
import { EditorController } from './editor/editor_controller';

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
          <small>Alpha 0.1 · 独立项目</small>
        </div>
      </div>
      <div class="titlebar-actions">
        <span id="tutor-status" class="tutor-status">等待开始</span>
        <button id="run-demo" class="primary-button">▶ 让老师开始跳</button>
        <button id="next-step">下一跳</button>
      </div>
    </header>

    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-title">EXPLORER</div>
        <div class="project-name">▾ ai-code-tutor-demo</div>
        <div id="file-tree" class="file-tree"></div>

        <div class="sidebar-note">
          <strong>当前 Alpha 目标</strong>
          <p>先验证角色真的可以生活在代码区域里，而不是待在右侧聊天面板。</p>
        </div>
      </aside>

      <main class="editor-pane">
        <div class="editor-tabbar">
          <span class="editor-tab-dot"></span>
          <span id="active-file">src/app.ts</span>
          <span class="tab-badge">Monaco</span>
        </div>

        <div id="editor-stage" class="editor-stage">
          <div id="editor" class="editor"></div>

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
        </div>
      </main>
    </div>

    <footer class="statusbar">
      <span>独立 Electron + Monaco</span>
      <span>角色坐标 ← Monaco.getScrolledVisiblePosition()</span>
      <span id="position-status">Ln 1, Col 1</span>
    </footer>
  </div>
`;

const editorElement = requireElement('editor');
const characterElement = requireElement('tutor-character');
const bubbleElement = requireElement('speech-bubble');
const tutorStatus = requireElement('tutor-status');
const fileTree = requireElement('file-tree');
const activeFile = requireElement('active-file');
const runDemoButton = requireButton('run-demo');
const nextStepButton = requireButton('next-step');
const positionStatus = requireElement('position-status');

const editorController = new EditorController(editorElement, demoFiles);
const characterController = new CharacterController(
  editorController,
  characterElement,
  bubbleElement,
  tutorStatus,
);

let currentStep = -1;
let demoRunning = false;
let demoRunId = 0;

renderFileTree();
updateActiveFile();

editorController.editor.onDidChangeCursorPosition((event) => {
  positionStatus.textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
});

runDemoButton.addEventListener('click', async () => {
  if (demoRunning) {
    demoRunId += 1;
    demoRunning = false;
    runDemoButton.textContent = '▶ 让老师开始跳';
    tutorStatus.textContent = '演示已停止';
    return;
  }

  demoRunning = true;
  const runId = ++demoRunId;
  runDemoButton.textContent = '■ 停止演示';

  for (let index = 0; index < demoMoves.length; index += 1) {
    if (!demoRunning || runId !== demoRunId) {
      break;
    }

    currentStep = index;
    await moveToCurrentStep();
    await delay(demoMoves[index]?.waitMs ?? 2400);
  }

  if (runId === demoRunId) {
    demoRunning = false;
    runDemoButton.textContent = '↻ 再演示一次';
    tutorStatus.textContent = '✓ 演示完成：已经可以跨文件跳';
  }
});

nextStepButton.addEventListener('click', async () => {
  demoRunning = false;
  demoRunId += 1;
  runDemoButton.textContent = '▶ 让老师开始跳';
  currentStep = (currentStep + 1) % demoMoves.length;
  await moveToCurrentStep();
});

async function moveToCurrentStep(): Promise<void> {
  const move = demoMoves[currentStep];
  if (!move) {
    return;
  }

  await characterController.moveTo(move);
  updateActiveFile();
  updateFileTreeSelection();
}

function renderFileTree(): void {
  for (const file of demoFiles) {
    const button = document.createElement('button');
    button.className = 'file-item';
    button.dataset.path = file.path;
    button.innerHTML = `<span class="file-icon">TS</span><span>${file.path.replace('src/', '')}</span>`;
    button.addEventListener('click', () => {
      demoRunning = false;
      demoRunId += 1;
      runDemoButton.textContent = '▶ 让老师开始跳';
      characterController.hideBubble();
      editorController.openFile(file.path);
      updateActiveFile();
      updateFileTreeSelection();
    });
    fileTree.appendChild(button);
  }

  updateFileTreeSelection();
}

function updateActiveFile(): void {
  activeFile.textContent = editorController.path;
}

function updateFileTreeSelection(): void {
  for (const item of fileTree.querySelectorAll<HTMLButtonElement>('.file-item')) {
    item.dataset.active = String(item.dataset.path === editorController.path);
  }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

window.addEventListener('beforeunload', () => {
  editorController.dispose();
});
