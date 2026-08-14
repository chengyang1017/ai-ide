import './styles.css';
import { CharacterController } from './character/character_controller';
import { demoFiles } from './demo/demo_project';
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
          <small>Alpha 0.2 · 真实项目读取</small>
        </div>
      </div>
      <div class="titlebar-actions">
        <span id="tutor-status" class="tutor-status">等待打开项目</span>
        <button id="open-project" class="primary-button">📂 打开项目</button>
        <button id="jump-to-cursor">🤖 老师跳到光标</button>
      </div>
    </header>

    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-title">EXPLORER</div>
        <div id="project-name" class="project-name">▾ ai-code-tutor-demo</div>
        <div id="file-tree" class="file-tree"></div>

        <div class="sidebar-note">
          <strong>Alpha 0.2</strong>
          <p>现在可以直接打开电脑里的真实项目。先验证文件树、真实源码和角色坐标能够连起来。</p>
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
const positionStatus = requireElement('position-status');

const editorController = new EditorController(editorElement, demoFiles);
const characterController = new CharacterController(
  editorController,
  characterElement,
  bubbleElement,
  tutorStatus,
);

let projectFiles: string[] = demoFiles.map((file) => file.path);
let isRealProject = false;
let projectLoadSequence = 0;

renderFileTree(projectFiles);
updateActiveFile();

editorController.editor.onDidChangeCursorPosition((event) => {
  positionStatus.textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
});

openProjectButton.addEventListener('click', async () => {
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

window.addEventListener('beforeunload', () => {
  editorController.dispose();
});
