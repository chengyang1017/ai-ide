const { app, BrowserWindow, dialog, ipcMain } = require('electron/main');
const fs = require('node:fs/promises');
const path = require('node:path');

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.dart_tool',
  '.idea',
  '.gradle',
  '.next',
  '.nuxt',
  'coverage',
]);

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.env', '.go', '.gradle',
  '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.json', '.kt', '.kts',
  '.less', '.mjs', '.cjs', '.md', '.php', '.prisma', '.py', '.rb', '.rs',
  '.scss', '.sql', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.txt',
  '.vue', '.xml', '.yaml', '.yml',
]);

const MAX_PROJECT_FILES = 5000;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

let currentProjectRoot = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#111318',
    title: 'AI Code Tutor IDE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (app.isPackaged) {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    void window.loadURL('http://127.0.0.1:5173');
  }
}

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: '打开代码项目',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const rootPath = path.resolve(result.filePaths[0]);
  const files = await collectProjectFiles(rootPath);
  currentProjectRoot = rootPath;

  return {
    rootPath,
    projectName: path.basename(rootPath),
    files,
  };
});

ipcMain.handle('project:read-file', async (_event, relativePath) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('文件路径无效。');
  }

  const targetPath = resolveInsideProject(currentProjectRoot, relativePath);
  const stat = await fs.stat(targetPath);

  if (!stat.isFile()) {
    throw new Error('目标不是文件。');
  }

  if (stat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error('这个文件超过 2 MB，Alpha 0.2 暂不直接打开。');
  }

  const content = await fs.readFile(targetPath, 'utf8');
  return {
    path: normalizeRelativePath(relativePath),
    content,
  };
});

async function collectProjectFiles(rootPath) {
  const files = [];

  async function walk(directoryPath) {
    if (files.length >= MAX_PROJECT_FILES) {
      return;
    }

    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= MAX_PROJECT_FILES) {
        return;
      }

      const absolutePath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(absolutePath);
        }
        continue;
      }

      if (!entry.isFile() || !isSupportedTextFile(entry.name)) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      if (stat.size > MAX_TEXT_FILE_BYTES) {
        continue;
      }

      files.push(normalizeRelativePath(path.relative(rootPath, absolutePath)));
    }
  }

  await walk(rootPath);
  return files;
}

function isSupportedTextFile(fileName) {
  if (fileName === '.gitignore' || fileName === '.gitattributes') {
    return true;
  }

  const lowerName = fileName.toLowerCase();
  if (lowerName.startsWith('.env')) {
    return true;
  }

  return TEXT_EXTENSIONS.has(path.extname(lowerName));
}

function resolveInsideProject(rootPath, relativePath) {
  const targetPath = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, targetPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('不能读取项目目录之外的文件。');
  }

  return targetPath;
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
