import './styles.css';
import { CharacterController } from './character/character_controller';
import { demoFiles } from './demo/demo_project';
import { EditorController } from './editor/editor_controller';
import { buildRelatedCodeMoves } from './project/project_navigator';
import { buildSemanticTutorRoute } from './project/semantic_navigator';

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
          <small>Alpha 0.5 · Dart LSP 语义调用导航</small>
        </div>
      </div>
      <div class="titlebar-actions">
        <span id="tutor-status" class="tutor-status">等待打开项目</span>
        <button id="open-project" class="primary-button">📂 打开项目</button>
        <button id="jump-to-cursor">🤖 老师跳到光标</button>
        <button id="find-related" disabled>🧭 老师找相关代码</button>
        <button id="semantic-related" disabled>🧠 Dart 语义调用</button>
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
          <strong>Alpha 0.5</strong>
          <p>Dart 文件现在可直接启动 Dart Analysis Server。把光标放在方法 / 函数 / 类名上，老师会按真实定义、调用者、被调用目标或语义引用跨文件跳转。</p>
        </div>
      </aside>

      <main class="editor-pane">
        <div class="editor-tabbar">
          <span class="editor-tab-dot"></span>
          <span id="active-file">src/app.ts</span>
          <span id="workspace-badge" class="tab-badge">Demo</span>
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
      <span>Electron + Monaco</span>
      <span id="project-root">尚未打开真实项目</span>
      <span id="position-status">Ln 1, Col 1</span>
    </footer>
  </div>

  <div id="api-key-modal" class="modal-backdrop" hidden>
    <section class="api-key-dialog" role="dialog" aria-modal="true" aria-labelledby="api-key-title">
      <div class="api-key-dialog-header">
        <div>
          <strong id="api-key-title">OpenAI API Key</strong>
          <p>只保存在当前 Electron 进程内存中，关闭 IDE 后自动清除。</p>
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
        <button id="api-key-cancel" type="button">取消</button>
        <button id="api-key-save" class="primary-button" type="button">保存到当前会话</button>
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
const projectName = requireElement('project-name');
const projectRoot = requireElement('project-root');
const workspaceBadge = requireElement('workspace-badge');
const openProjectButton = requireButton('open-project');
const jumpToCursorButton = requireButton('jump-to-cursor');
const findRelatedButton = requireButton('find-related');
const semanticRelatedButton = requireButton('semantic-related');
const setApiKeyButton = requireButton('set-api-key');
const aiTourButton = requireButton('ai-tour');
const positionStatus = requireElement('position-status');
const apiKeyModal = requireElement('api-key-modal');
const apiKeyInput = requireInput('api-key-input');
const apiKeyError = requireElement('api-key-error');
const apiKeyCloseButton = requireButton('api-key-close');
const apiKeyCancelButton = requireButton('api-key-cancel');
const apiKeySaveButton = requireButton('api-key-save');

const editorController = new EditorController(editorElement, demoFiles);
const characterController = new CharacterController(
  editorController,
  characterElement,
  bubbleElement,
  tutorStatus,
  async (path) => {
    if (!isRealProject) {
      throw new Error('请先打开真实项目。');
    }
    await openRealProjectFile(path, false);
  },
);

let projectFiles: string[] = demoFiles.map((file) => file.path);
let isRealProject = false;
let projectLoadSequence = 0;
let relatedTourSequence = 0;
let relatedTourRunning = false;
let semanticTourSequence = 0;
let semanticTourRunning = false;
let aiTourSequence = 0;
let aiTourRunning = false;

renderFileTree(projectFiles);
updateActiveFile();

editorController.editor.onDidChangeCursorPosition((event) => {
  positionStatus.textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
});

openProjectButton.addEventListener('click', async () => {
  stopRelatedTour('准备打开项目');
  stopSemanticTour('准备打开项目');
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

    projectFiles = result.files;
    isRealProject = true;
    projectName.textContent = `▾ ${result.projectName}`;
    projectRoot.textContent = result.rootPath;
    workspaceBadge.textContent = '真实项目';
    findRelatedButton.disabled = false;
    semanticRelatedButton.disabled = false;
    aiTourButton.disabled = false;
    renderFileTree(projectFiles);
    characterController.clear('项目已打开');

    const firstFile = chooseInitialFile(projectFiles);
    if (!firstFile) {
      activeFile.textContent = '没有可读取的代码文件';
      tutorStatus.textContent = '项目中没有找到支持的文本代码文件';
      return;
    }

    await openRealProjectFile(firstFile, true);
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
      updateFileTreeSelection();
      await delay(move.waitMs ?? 1500);
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
      updateFileTreeSelection();
      await delay(move.waitMs ?? 1700);
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

setApiKeyButton.addEventListener('click', () => {
  openApiKeyDialog();
});

apiKeyCloseButton.addEventListener('click', closeApiKeyDialog);
apiKeyCancelButton.addEventListener('click', closeApiKeyDialog);
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
      updateFileTreeSelection();
      await delay(move.waitMs ?? 1900);
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

function stopRelatedTour(message: string): void {
  relatedTourSequence += 1;
  relatedTourRunning = false;
  findRelatedButton.textContent = '🧭 老师找相关代码';
  tutorStatus.textContent = message;
}

function stopSemanticTour(message: string): void {
  semanticTourSequence += 1;
  semanticTourRunning = false;
  semanticRelatedButton.textContent = '🧠 Dart 语义调用';
  tutorStatus.textContent = message;
}

function stopAiTour(message: string): void {
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
  apiKeySaveButton.textContent = '保存到当前会话';
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
  apiKeySaveButton.textContent = '保存中…';

  try {
    await window.tutorIde.setOpenAiKey(apiKey);
    closeApiKeyDialog();
    tutorStatus.textContent = '✓ OpenAI API Key 已放入当前进程内存';
  } catch (error) {
    apiKeyError.textContent = errorMessage(error);
    apiKeySaveButton.disabled = false;
    apiKeySaveButton.textContent = '保存到当前会话';
    apiKeyInput.focus();
  }
}

function renderFileTree(paths: string[]): void {
  fileTree.replaceChildren();

  if (paths.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'file-tree-empty';
    empty.textContent = '没有找到支持的代码文件';
    fileTree.appendChild(empty);
    return;
  }

  const tree = buildTree(paths);
  renderTreeNodes(tree, fileTree, 0);
  updateFileTreeSelection();
}

function renderTreeNodes(nodes: TreeNode[], container: HTMLElement, depth: number): void {
  for (const node of nodes) {
    if (node.type === 'directory') {
      const row = document.createElement('div');
      row.className = 'directory-item';
      row.style.paddingLeft = `${12 + depth * 14}px`;
      row.innerHTML = `<span class="directory-arrow">⌄</span><span>📁 ${escapeText(node.name)}</span>`;
      container.appendChild(row);
      renderTreeNodes(node.children, container, depth + 1);
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
      stopAiTour('已手动切换文件');
      characterController.clear('已切换文件');

      try {
        if (isRealProject) {
          await openRealProjectFile(node.path, false);
        } else {
          editorController.openFile(node.path);
          updateActiveFile();
          updateFileTreeSelection();
        }
      } catch (error) {
        tutorStatus.textContent = errorMessage(error);
      }
    });
    container.appendChild(button);
  }
}

async function openRealProjectFile(path: string, replaceWorkspace: boolean): Promise<void> {
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
  updateFileTreeSelection();
  tutorStatus.textContent = `已打开 ${path}`;
}

function updateActiveFile(): void {
  activeFile.textContent = editorController.path;
}

function updateFileTreeSelection(): void {
  for (const item of fileTree.querySelectorAll<HTMLButtonElement>('.file-item')) {
    item.dataset.active = String(item.dataset.path === editorController.path);
  }
}

interface TreeDirectoryNode {
  type: 'directory';
  name: string;
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
        child = {
          type: 'directory',
          name: part,
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

window.addEventListener('beforeunload', () => {
  editorController.dispose();
});
