const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DartLspClient } = require('./dart_lsp.cjs');
const { WindowsTtsBridge } = require('./windows_tts.cjs');

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.ai-code-tutor',
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
const MAX_IMAGE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_NOTE_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
]);

let currentProjectRoot = null;
let currentProjectFiles = [];
let runtimeOpenAiKey = process.env.OPENAI_API_KEY?.trim() || '';
let dartLspClient = null;
const windowsTts = new WindowsTtsBridge();
const projectFileWatchers = new Map();
const internalWriteSuppressUntil = new Map();

const DEFAULT_APP_STATE = {
  version: 2,
  lastProjectRoot: '',
  lastOpenFile: '',
  voice: {
    enabled: true,
    language: 'zh-CN',
    voiceId: '',
    rate: 1,
  },
  appearance: {
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
  },
  encryptedOpenAiKey: '',
};

let persistentState = structuredClone(DEFAULT_APP_STATE);

const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-5.2';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const MAX_AI_CANDIDATES = 14;
const AI_CONTEXT_RADIUS = 5;
const MAX_SEMANTIC_AI_NODES = 24;
const SEMANTIC_AI_CONTEXT_RADIUS = 4;

function createWindow() {
  const chrome = appearanceChromeColors(persistentState.appearance);
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 640,
    backgroundColor: chrome.backgroundColor,
    title: 'AI Code Tutor IDE',
    autoHideMenuBar: true,
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: chrome.titleBarColor,
            symbolColor: chrome.symbolColor,
            height: 36,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Windows 原生菜单栏会保持系统浅色，和自定义外观割裂。默认隐藏；Alt 仍可临时调出菜单。
  window.setMenuBarVisibility(false);

  window.webContents.on('destroyed', () => {
    closeProjectFileWatcher(window.webContents.id);
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
  const project = await loadProjectRoot(rootPath);
  persistentState.lastProjectRoot = rootPath;
  persistentState.lastOpenFile = '';
  await savePersistentState();
  return { ...project, lastOpenFile: '' };
});

ipcMain.handle('project:restore', async () => {
  const rootPath = persistentState.lastProjectRoot;
  if (!rootPath) {
    return null;
  }

  try {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) {
      return null;
    }

    const project = await loadProjectRoot(rootPath);
    const lastOpenFile = currentProjectFiles.includes(persistentState.lastOpenFile)
      ? persistentState.lastOpenFile
      : '';
    return { ...project, lastOpenFile };
  } catch {
    return null;
  }
});


ipcMain.handle('project:watch-file', async (event, relativePath) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const normalizedPath = validateProjectFilePath(relativePath);
  const targetPath = resolveInsideProject(currentProjectRoot, normalizedPath);
  const stat = await fs.stat(targetPath);
  if (!stat.isFile()) {
    throw new Error('目标不是文件。');
  }

  const senderId = event.sender.id;
  closeProjectFileWatcher(senderId);

  let debounceTimer = null;
  const watcher = watch(targetPath, { persistent: false }, () => {
    const suppressedUntil = internalWriteSuppressUntil.get(targetPath) ?? 0;
    if (Date.now() <= suppressedUntil) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!event.sender.isDestroyed()) {
        event.sender.send('project:file-changed', { path: normalizedPath });
      }
    }, 120);
  });

  watcher.on('error', () => {
    closeProjectFileWatcher(senderId);
  });

  projectFileWatchers.set(senderId, {
    watcher,
    dispose() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher.close();
    },
  });

  return { path: normalizedPath };
});

ipcMain.handle('project:unwatch-file', (event) => {
  closeProjectFileWatcher(event.sender.id);
  return true;
});

ipcMain.handle('project:read-asset', async (_event, relativePath) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const normalizedPath = normalizeRelativePath(typeof relativePath === 'string' ? relativePath : '');
  const targetPath = resolveInsideProject(currentProjectRoot, normalizedPath);
  const mimeType = normalizeImageMimeType('', targetPath);
  const stat = await fs.stat(targetPath);
  if (!stat.isFile()) {
    throw new Error('图片资源不存在。');
  }
  if (stat.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('图片资源超过 12 MB。');
  }
  const bytes = await fs.readFile(targetPath);
  return {
    path: normalizedPath,
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
  };
});

ipcMain.handle('project:open-external', async (_event, rawUrl) => {
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('只允许打开 http/https 外部链接。');
  }
  await shell.openExternal(url);
  return true;
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
  const normalizedPath = normalizeRelativePath(relativePath);
  persistentState.lastOpenFile = normalizedPath;
  await savePersistentState();
  return {
    path: normalizedPath,
    content,
  };
});


ipcMain.handle('project:write-file', async (_event, relativePath, rawContent) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('文件路径无效。');
  }

  if (typeof rawContent !== 'string') {
    throw new Error('要保存的文件内容无效。');
  }

  const normalizedPath = normalizeRelativePath(relativePath);
  if (!currentProjectFiles.includes(normalizedPath)) {
    throw new Error('只能保存当前已打开项目中的代码文件。');
  }

  const byteLength = Buffer.byteLength(rawContent, 'utf8');
  if (byteLength > MAX_TEXT_FILE_BYTES) {
    throw new Error('这个文件超过 2 MB，Alpha 0.11 暂不直接保存。');
  }

  const targetPath = resolveInsideProject(currentProjectRoot, normalizedPath);
  const stat = await fs.stat(targetPath);
  if (!stat.isFile()) {
    throw new Error('目标不是文件。');
  }

  internalWriteSuppressUntil.set(targetPath, Date.now() + 650);
  await fs.writeFile(targetPath, rawContent, 'utf8');
  setTimeout(() => {
    const suppressedUntil = internalWriteSuppressUntil.get(targetPath) ?? 0;
    if (Date.now() >= suppressedUntil) {
      internalWriteSuppressUntil.delete(targetPath);
    }
  }, 700).unref?.();
  persistentState.lastOpenFile = normalizedPath;
  await savePersistentState();

  return {
    path: normalizedPath,
    bytes: byteLength,
  };
});



ipcMain.handle('notes:list', async (_event, relativePath) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const filePath = validateProjectFilePath(relativePath);
  const notes = await loadProjectCodeNotes();
  return notes
    .filter((note) => note.filePath === filePath)
    .sort((a, b) => a.line - b.line || a.column - b.column || a.createdAt.localeCompare(b.createdAt));
});

ipcMain.handle('notes:upsert', async (_event, rawNote) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const input = rawNote && typeof rawNote === 'object' ? rawNote : {};
  const filePath = validateProjectFilePath(input.filePath);
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length > 20000) {
    throw new Error('单个代码便签最多 20000 个字符。');
  }

  const images = sanitizeNoteImages(input.images);
  if (!text && images.length === 0) {
    throw new Error('便签至少需要文字或图片。');
  }

  const placement = input.placement === 'inline' ? 'inline' : 'gutter';
  const line = Number(input.line);
  if (!Number.isInteger(line) || line < 1) {
    throw new Error('便签行号无效。');
  }
  const rawColumn = Number(input.column);
  const column = placement === 'inline' && Number.isInteger(rawColumn) && rawColumn > 0
    ? rawColumn
    : 1;

  const anchorText = typeof input.anchorText === 'string'
    ? input.anchorText.trim().slice(0, 500)
    : '';
  const requestedId = typeof input.id === 'string' ? input.id.trim() : '';
  const notes = await loadProjectCodeNotes();

  const now = new Date().toISOString();
  const existingIndex = requestedId
    ? notes.findIndex((note) => note.id === requestedId)
    : -1;

  const note = existingIndex >= 0
    ? {
        ...notes[existingIndex],
        filePath,
        placement,
        line,
        column,
        anchorText,
        text,
        images,
        updatedAt: now,
      }
    : {
        id: randomUUID(),
        filePath,
        placement,
        line,
        column,
        anchorText,
        text,
        images,
        createdAt: now,
        updatedAt: now,
      };

  if (existingIndex >= 0) {
    notes[existingIndex] = note;
  } else {
    notes.push(note);
  }
  await saveProjectCodeNotes(notes);
  return note;
});

ipcMain.handle('notes:delete', async (_event, rawId) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) {
    throw new Error('便签 ID 无效。');
  }

  const notes = await loadProjectCodeNotes();
  const nextNotes = notes.filter((note) => note.id !== id);
  if (nextNotes.length !== notes.length) {
    await saveProjectCodeNotes(nextNotes);
  }
  return true;
});

ipcMain.handle('notes:import-image', async (_event, rawImage) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const input = rawImage && typeof rawImage === 'object' ? rawImage : {};
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 160) : 'note-image';
  const mimeType = normalizeImageMimeType(input.mimeType, name);
  const base64 = typeof input.dataBase64 === 'string' ? input.dataBase64 : '';
  if (!base64) {
    throw new Error('图片内容为空。');
  }

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_NOTE_IMAGE_BYTES) {
    throw new Error('便签图片需要小于 8 MB。');
  }

  const extension = imageExtensionForMime(mimeType, name);
  const assetRelativePath = `assets/${randomUUID()}${extension}`;
  const targetPath = resolveInsideNotesDirectory(assetRelativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, bytes);

  const createdAt = new Date().toISOString();
  return {
    id: randomUUID(),
    path: assetRelativePath,
    name: name || `image${extension}`,
    mimeType,
    createdAt,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
  };
});

ipcMain.handle('notes:read-image', async (_event, rawAssetPath) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const assetPath = validateNoteAssetPath(rawAssetPath);
  const targetPath = resolveInsideNotesDirectory(assetPath);
  const stat = await fs.stat(targetPath);
  if (!stat.isFile() || stat.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('便签图片不存在或过大。');
  }
  const bytes = await fs.readFile(targetPath);
  const mimeType = normalizeImageMimeType('', targetPath);
  return {
    path: assetPath,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
  };
});

ipcMain.handle('project:search', async (_event, rawQuery) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (query.length < 2 || query.length > 80) {
    throw new Error('搜索词长度需要在 2 到 80 个字符之间。');
  }

  return searchProjectInternal(query, 40);
});

ipcMain.handle('semantic:dart-targets', async (_event, rawFocus) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const focus = validateSemanticFocus(rawFocus);
  if (!focus.filePath.toLowerCase().endsWith('.dart')) {
    throw new Error('Alpha 0.5 的第一种语义引擎先接 Dart。请在 .dart 文件中使用这个功能。');
  }

  if (!dartLspClient) {
    dartLspClient = new DartLspClient(currentProjectRoot);
  }

  const absolutePath = resolveInsideProject(currentProjectRoot, focus.filePath);
  const semantic = await dartLspClient.findSemanticTargets({
    absolutePath,
    content: focus.documentText,
    line: focus.line,
    column: focus.column,
  });

  const locations = [];
  for (const target of semantic.targets.slice(0, 24)) {
    const relativePath = toProjectRelativePath(target.absolutePath);
    if (!relativePath || !currentProjectFiles.includes(relativePath)) {
      continue;
    }

    const snippet = await readSnippet(relativePath, target.line, 2);
    locations.push({
      path: relativePath,
      line: target.line,
      column: target.column,
      kind: target.kind,
      label: target.label || '',
      preview: snippet.focusLine,
    });
  }

  return {
    provider: 'Dart Analysis Server · LSP',
    mode: semantic.mode,
    symbolName: semantic.symbolName || focus.query,
    locations: dedupeSemanticLocations(locations),
  };
});

ipcMain.handle('app:get-state', () => ({
  lastProjectRoot: persistentState.lastProjectRoot,
  lastOpenFile: persistentState.lastOpenFile,
  voice: { ...persistentState.voice },
  appearance: { ...persistentState.appearance },
  hasOpenAiKey: runtimeOpenAiKey.length > 0,
  nativeTts: windowsTts.isSupported(),
}));

ipcMain.handle('app:update-voice-state', async (_event, rawVoiceState) => {
  persistentState.voice = validateVoiceState(rawVoiceState);
  await savePersistentState();
  return { ...persistentState.voice };
});

ipcMain.handle('app:update-appearance-state', async (event, rawAppearance) => {
  persistentState.appearance = validateAppearanceState({
    ...persistentState.appearance,
    ...(rawAppearance && typeof rawAppearance === 'object' ? rawAppearance : {}),
  });
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    applyWindowChrome(window, persistentState.appearance);
  }
  await savePersistentState();
  return { ...persistentState.appearance };
});

ipcMain.handle('appearance:choose-background', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择 IDE 背景图片',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const sourcePath = result.filePaths[0];
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile() || stat.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('背景图片需要小于 12 MB。');
  }

  const mimeType = normalizeImageMimeType('', sourcePath);
  const extension = imageExtensionForMime(mimeType, sourcePath);
  const appearanceDirectory = path.join(app.getPath('userData'), 'ai-code-tutor', 'appearance');
  const targetName = `background${extension}`;
  const targetPath = path.join(appearanceDirectory, targetName);
  await fs.mkdir(appearanceDirectory, { recursive: true });

  for (const fileName of ['background.png', 'background.jpg', 'background.webp', 'background.gif', 'background.bmp', 'background.avif']) {
    if (fileName !== targetName) {
      await fs.rm(path.join(appearanceDirectory, fileName), { force: true }).catch(() => {});
    }
  }

  await fs.copyFile(sourcePath, targetPath);
  persistentState.appearance = validateAppearanceState({
    ...persistentState.appearance,
    imageFile: targetName,
  });
  await savePersistentState();

  const bytes = await fs.readFile(targetPath);
  return {
    name: path.basename(sourcePath),
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    appearance: { ...persistentState.appearance },
  };
});

ipcMain.handle('appearance:get-background', async () => {
  const imageFile = persistentState.appearance?.imageFile || '';
  if (!imageFile) {
    return null;
  }
  const targetPath = path.join(app.getPath('userData'), 'ai-code-tutor', 'appearance', path.basename(imageFile));
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isFile() || stat.size > MAX_IMAGE_FILE_BYTES) {
      return null;
    }
    const mimeType = normalizeImageMimeType('', targetPath);
    const bytes = await fs.readFile(targetPath);
    return {
      name: path.basename(targetPath),
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    };
  } catch {
    return null;
  }
});

ipcMain.handle('appearance:clear-background', async () => {
  const imageFile = persistentState.appearance?.imageFile || '';
  if (imageFile) {
    const targetPath = path.join(app.getPath('userData'), 'ai-code-tutor', 'appearance', path.basename(imageFile));
    await fs.rm(targetPath, { force: true }).catch(() => {});
  }
  persistentState.appearance = validateAppearanceState({
    ...persistentState.appearance,
    imageFile: '',
  });
  await savePersistentState();
  return { ...persistentState.appearance };
});

ipcMain.handle('voice:list', async () => windowsTts.listVoices());

ipcMain.handle('voice:synthesize', async (_event, rawRequest) => {
  const request = rawRequest && typeof rawRequest === 'object' ? rawRequest : {};
  return windowsTts.synthesize({
    text: request.text,
    voiceId: request.voiceId,
    rate: request.rate,
  });
});

ipcMain.handle('ai:has-key', () => runtimeOpenAiKey.length > 0);

ipcMain.handle('ai:set-key', async (_event, rawApiKey) => {
  const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
  if (apiKey.length < 8) {
    throw new Error('OpenAI API Key 无效。');
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows 安全存储暂不可用，API Key 没有写入磁盘。');
  }

  runtimeOpenAiKey = apiKey;
  persistentState.encryptedOpenAiKey = safeStorage.encryptString(apiKey).toString('base64');
  await savePersistentState();
  return true;
});

ipcMain.handle('ai:clear-key', async () => {
  runtimeOpenAiKey = process.env.OPENAI_API_KEY?.trim() || '';
  persistentState.encryptedOpenAiKey = '';
  await savePersistentState();
  return true;
});

ipcMain.handle('ai:explain-current-code', async (_event, rawContext) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  if (!runtimeOpenAiKey) {
    throw new Error('请先设置 OpenAI API Key。');
  }

  const context = validateCurrentCodeContext(rawContext);
  const explanation = await requestCurrentCodeExplanation(context);

  return {
    explanation,
    model: OPENAI_MODEL,
    filePath: context.filePath,
    line: context.line,
    column: context.column,
    query: context.query,
    usedSelection: Boolean(
      context.selectionStartLine
      && context.selectionEndLine
      && (
        context.selectionStartLine !== context.selectionEndLine
        || context.selectionStartColumn !== context.selectionEndColumn
      )
    ),
    usedUnsavedContent: context.isDirty,
  };
});

ipcMain.handle('ai:plan-tour', async (_event, rawFocus) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  if (!runtimeOpenAiKey) {
    throw new Error('请先设置 OpenAI API Key。');
  }

  const focus = validateTutorFocus(rawFocus);
  const candidates = await buildTutorCandidates(focus);
  const aiPlan = await requestTutorPlan(focus, candidates);

  return {
    summary: aiPlan.summary,
    model: OPENAI_MODEL,
    candidateCount: candidates.length,
    moves: aiPlan.steps.map((step) => {
      const candidate = candidates.find((item) => item.id === step.candidateId);
      if (!candidate) {
        throw new Error(`AI 返回了不存在的候选位置：${step.candidateId}`);
      }

      return {
        filePath: candidate.path,
        line: candidate.line,
        column: candidate.column,
        action: step.action,
        speech: step.speech,
        waitMs: 1900,
      };
    }),
  };
});


ipcMain.handle('ai:plan-dart-semantic-tour', async (_event, rawFocus, rawMode) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  if (!runtimeOpenAiKey) {
    throw new Error('请先设置 OpenAI API Key。');
  }

  const focus = validateSemanticFocus(rawFocus);
  if (!focus.filePath.toLowerCase().endsWith('.dart')) {
    throw new Error('Alpha 0.6 先支持 Dart 函数 / 方法的语义教学链。');
  }

  const mode = validateSemanticTutorMode(rawMode);
  if (!dartLspClient) {
    dartLspClient = new DartLspClient(currentProjectRoot);
  }

  const absolutePath = resolveInsideProject(currentProjectRoot, focus.filePath);
  const graph = await dartLspClient.findCallGraph({
    absolutePath,
    content: focus.documentText,
    line: focus.line,
    column: focus.column,
    direction: mode === 'incoming' ? 'incoming' : mode === 'outgoing' ? 'outgoing' : 'both',
    maxDepth: mode === 'full' ? 2 : 3,
    maxNodes: MAX_SEMANTIC_AI_NODES,
    selectionStartLine: focus.selectionStartLine,
    selectionStartColumn: focus.selectionStartColumn,
    selectionEndLine: focus.selectionEndLine,
    selectionEndColumn: focus.selectionEndColumn,
  });

  if (!graph.nodes.length) {
    throw new Error(`Dart Analyzer 没有定位到 “${focus.query}” 对应的函数 / 方法。你可以选中整个函数、选中函数名，或把光标放在函数体内部。`);
  }

  const candidates = await buildSemanticAiCandidates(graph.nodes);
  if (!candidates.length) {
    throw new Error('调用关系存在，但都位于当前项目之外；Alpha 0.6 默认不展开 Flutter SDK / 第三方包。');
  }

  const resolvedFocus = {
    ...focus,
    query: graph.symbolName || focus.query,
  };

  const aiPlan = await requestSemanticTutorPlan({
    focus: resolvedFocus,
    mode,
    symbolName: graph.symbolName || focus.query,
    candidates,
  });

  return {
    summary: aiPlan.summary,
    model: OPENAI_MODEL,
    mode,
    symbolName: graph.symbolName || focus.query,
    nodeCount: candidates.length,
    moves: aiPlan.steps.map((step) => {
      const candidate = candidates.find((item) => item.id === step.candidateId);
      if (!candidate) {
        throw new Error(`AI 返回了不存在的语义节点：${step.candidateId}`);
      }

      return {
        filePath: candidate.path,
        line: candidate.line,
        column: candidate.column,
        action: step.action,
        speech: step.speech,
        waitMs: 2100,
      };
    }),
  };
});

function validateSemanticTutorMode(value) {
  if (value === 'incoming' || value === 'outgoing' || value === 'full') {
    return value;
  }
  return 'full';
}

function validateSemanticFocus(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('当前语义导航上下文无效。');
  }

  const filePath = typeof value.filePath === 'string'
    ? normalizeRelativePath(value.filePath)
    : '';
  const query = typeof value.query === 'string' ? value.query.trim().slice(0, 120) : '';
  const documentText = typeof value.documentText === 'string'
    ? value.documentText.slice(0, MAX_TEXT_FILE_BYTES)
    : '';
  const line = Number.isInteger(value.line) ? Math.max(1, value.line) : 1;
  const column = Number.isInteger(value.column) ? Math.max(1, value.column) : 1;
  const selectionStartLine = Number.isInteger(value.selectionStartLine)
    ? Math.max(1, value.selectionStartLine)
    : null;
  const selectionStartColumn = Number.isInteger(value.selectionStartColumn)
    ? Math.max(1, value.selectionStartColumn)
    : null;
  const selectionEndLine = Number.isInteger(value.selectionEndLine)
    ? Math.max(1, value.selectionEndLine)
    : null;
  const selectionEndColumn = Number.isInteger(value.selectionEndColumn)
    ? Math.max(1, value.selectionEndColumn)
    : null;

  if (!currentProjectFiles.includes(filePath)) {
    throw new Error('当前文件不属于已打开项目。');
  }
  if (!query) {
    throw new Error('请把光标放在一个 Dart 类、方法、函数或变量名称上。');
  }
  if (!documentText) {
    throw new Error('当前文件内容为空。');
  }

  return {
    filePath,
    query,
    documentText,
    line,
    column,
    selectionStartLine,
    selectionStartColumn,
    selectionEndLine,
    selectionEndColumn,
  };
}

function toProjectRelativePath(absolutePath) {
  if (!currentProjectRoot || typeof absolutePath !== 'string') {
    return null;
  }

  const relative = path.relative(currentProjectRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return normalizeRelativePath(relative);
}

function dedupeSemanticLocations(locations) {
  const seen = new Set();
  return locations.filter((location) => {
    const key = `${location.path}:${location.line}:${location.column}:${location.kind}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function validateCurrentCodeContext(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('当前编辑器上下文无效。');
  }

  const filePath = typeof value.filePath === 'string'
    ? normalizeRelativePath(value.filePath)
    : '';
  const language = typeof value.language === 'string'
    ? value.language.trim().slice(0, 40)
    : 'plaintext';
  const selectedText = typeof value.selectedText === 'string'
    ? value.selectedText.trim().slice(0, 12_000)
    : '';
  const query = typeof value.query === 'string'
    ? value.query.trim().slice(0, 120)
    : null;
  const nearbyCode = typeof value.nearbyCode === 'string'
    ? value.nearbyCode.slice(0, 20_000)
    : '';
  const line = Number.isInteger(value.line) ? Math.max(1, value.line) : 1;
  const column = Number.isInteger(value.column) ? Math.max(1, value.column) : 1;
  const selectionStartLine = Number.isInteger(value.selectionStartLine)
    ? Math.max(1, value.selectionStartLine)
    : null;
  const selectionStartColumn = Number.isInteger(value.selectionStartColumn)
    ? Math.max(1, value.selectionStartColumn)
    : null;
  const selectionEndLine = Number.isInteger(value.selectionEndLine)
    ? Math.max(1, value.selectionEndLine)
    : null;
  const selectionEndColumn = Number.isInteger(value.selectionEndColumn)
    ? Math.max(1, value.selectionEndColumn)
    : null;

  if (!currentProjectFiles.includes(filePath)) {
    throw new Error('当前文件不属于已打开项目。');
  }
  if (!selectedText && !query && !nearbyCode.trim()) {
    throw new Error('当前光标附近没有可解释的代码。');
  }

  return {
    filePath,
    language,
    line,
    column,
    selectedText,
    query: query || null,
    nearbyCode,
    isDirty: value.isDirty === true,
    selectionStartLine,
    selectionStartColumn,
    selectionEndLine,
    selectionEndColumn,
  };
}

function validateTutorFocus(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('当前代码上下文无效。');
  }

  const filePath = typeof value.filePath === 'string'
    ? normalizeRelativePath(value.filePath)
    : '';
  const selectedText = typeof value.selectedText === 'string'
    ? value.selectedText.trim().slice(0, 6000)
    : '';
  const query = typeof value.query === 'string'
    ? value.query.trim().slice(0, 80)
    : null;
  const line = Number.isInteger(value.line) ? value.line : 1;
  const column = Number.isInteger(value.column) ? value.column : 1;

  if (!currentProjectFiles.includes(filePath)) {
    throw new Error('当前文件不属于已打开项目。');
  }

  if (selectedText.length === 0 && (!query || query.length < 2)) {
    throw new Error('请先选中一段代码，或把光标放在一个标识符上。');
  }

  return {
    filePath,
    selectedText,
    query: query && query.length >= 2 ? query : null,
    line: Math.max(1, line),
    column: Math.max(1, column),
  };
}

async function buildSemanticAiCandidates(nodes) {
  const candidates = [];
  const seen = new Set();

  for (const node of nodes) {
    if (candidates.length >= MAX_SEMANTIC_AI_NODES) {
      break;
    }

    const relativePath = toProjectRelativePath(node.absolutePath);
    if (!relativePath || !currentProjectFiles.includes(relativePath)) {
      continue;
    }

    const key = `${relativePath}:${node.line}:${node.column}:${node.relation}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const snippet = await readSnippet(
      relativePath,
      node.line,
      SEMANTIC_AI_CONTEXT_RADIUS,
    );

    candidates.push({
      id: `semantic-${candidates.length}`,
      path: relativePath,
      line: node.line,
      column: node.column,
      relation: node.relation,
      depth: node.depth,
      name: node.name || '',
      parentName: node.parentName || '',
      preview: snippet.focusLine,
      snippet: snippet.text,
    });
  }

  return candidates;
}

async function buildTutorCandidates(focus) {
  const candidates = [];
  const seen = new Set();

  const currentSnippet = await readSnippet(
    focus.filePath,
    focus.line,
    AI_CONTEXT_RADIUS + 3,
  );

  candidates.push({
    id: 'current',
    path: focus.filePath,
    line: focus.line,
    column: focus.column,
    preview: focus.selectedText || currentSnippet.focusLine,
    snippet: currentSnippet.text,
    reason: '用户当前正在看的代码',
  });
  seen.add(`${focus.filePath}:${focus.line}:${focus.column}`);

  if (!focus.query) {
    return candidates;
  }

  const matches = await searchProjectInternal(focus.query, MAX_AI_CANDIDATES * 2);
  for (const match of matches) {
    if (candidates.length >= MAX_AI_CANDIDATES) {
      break;
    }

    const key = `${match.path}:${match.line}:${match.column}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const snippet = await readSnippet(match.path, match.line, AI_CONTEXT_RADIUS);
    candidates.push({
      id: `candidate-${candidates.length}`,
      path: match.path,
      line: match.line,
      column: match.column,
      preview: match.preview,
      snippet: snippet.text,
      reason: `项目中 “${focus.query}” 的一个匹配位置`,
    });
  }

  return candidates;
}

async function readSnippet(relativePath, focusLine, radius) {
  const absolutePath = resolveInsideProject(currentProjectRoot, relativePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const safeFocus = Math.min(Math.max(1, focusLine), Math.max(1, lines.length));
  const start = Math.max(1, safeFocus - radius);
  const end = Math.min(lines.length, safeFocus + radius);
  const text = lines
    .slice(start - 1, end)
    .map((line, index) => {
      const absoluteLine = start + index;
      const marker = absoluteLine === safeFocus ? '>' : ' ';
      return `${marker} ${String(absoluteLine).padStart(4, ' ')} | ${line}`;
    })
    .join('\n');

  return {
    text,
    focusLine: lines[safeFocus - 1]?.trim() || '',
  };
}

async function requestSemanticTutorPlan({ focus, mode, symbolName, candidates }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeOpenAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning: { effort: 'low' },
        input: [
          {
            role: 'system',
            content: SEMANTIC_AI_TUTOR_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildSemanticTutorPrompt(focus, mode, symbolName, candidates),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'ai_code_tutor_semantic_tour',
            strict: true,
            schema: buildAiTutorSchema(candidates),
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI API 请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }

    if (payload.status === 'incomplete') {
      throw new Error(`AI 返回内容不完整：${payload.incomplete_details?.reason || 'unknown'}`);
    }

    const outputText = extractOpenAiOutputText(payload);
    const decoded = JSON.parse(outputText);
    validateAiPlan(decoded, candidates);
    return decoded;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('AI 语义调用链分析超时，请稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSemanticTutorPrompt(focus, mode, symbolName, candidates) {
  const modeLabel = mode === 'incoming'
    ? '重点解释谁调用它（incoming calls）'
    : mode === 'outgoing'
      ? '重点解释它调用谁（outgoing calls）'
      : '从入口、当前函数到后续调用中选择最适合教学的一条功能链';

  const candidateText = candidates.map((candidate) => {
    const relation = semanticRelationLabel(candidate.relation);
    return `语义节点 ID：${candidate.id}
关系：${relation}
层级：${candidate.depth}
符号：${candidate.name || '(未知)'}
父节点：${candidate.parentName || '(根节点)'}
文件：${candidate.path}
目标：第 ${candidate.line} 行，第 ${candidate.column} 列
代码：
${candidate.snippet}`;
  }).join('\n\n---\n\n');

  return `用户正在学习一个真实 Dart / Flutter 项目。

当前符号：${symbolName}
当前文件：${focus.filePath}
当前位置：第 ${focus.line} 行，第 ${focus.column} 列
教学模式：${modeLabel}

下面的节点全部来自 Dart Analysis Server 的 Call Hierarchy，不是文本同名搜索。IDE 已经过滤掉项目外的 Flutter SDK / 第三方包。你只能从这些真实语义节点 ID 中选择角色路线，不能编造文件、行号或关系。

${candidateText}

请规划 1 到 6 步。优先形成能让学习者理解“入口 → 当前函数 → 关键下游调用”或所选方向的清晰路线。不要机械遍历全部节点；相同意义的节点可以跳过。`;
}

function semanticRelationLabel(relation) {
  if (relation === 'root') return '当前函数 / 方法';
  if (relation === 'incomingCall') return '调用当前节点的上游函数';
  if (relation === 'outgoingCall') return '当前节点调用的下游函数';
  return String(relation || 'unknown');
}

async function requestCurrentCodeExplanation(context) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeOpenAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning: { effort: 'low' },
        max_output_tokens: 900,
        input: [
          {
            role: 'system',
            content: CURRENT_CODE_EXPLAIN_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildCurrentCodeExplainPrompt(context),
          },
        ],
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI API 请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }
    if (payload.status === 'incomplete') {
      throw new Error(`AI 返回内容不完整：${payload.incomplete_details?.reason || 'unknown'}`);
    }

    return extractOpenAiOutputText(payload).trim();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('AI 当前代码解释超时，请稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCurrentCodeExplainPrompt(context) {
  const selectionLabel = context.selectionStartLine
    ? `第 ${context.selectionStartLine} 行到第 ${context.selectionEndLine ?? context.selectionStartLine} 行`
    : '没有主动选区，解释光标所在代码';

  return `用户正在 IDE 中阅读真实项目代码。

当前文件：${context.filePath}
语言：${context.language}
光标/焦点：第 ${context.line} 行，第 ${context.column} 列
当前标识符：${context.query || '(无)'}
选区：${selectionLabel}
编辑器状态：${context.isDirty ? '有未保存修改；以下内容来自 Monaco 当前内存，优先相信它' : '已保存'}

当前选中或所在代码：
${context.selectedText || '(无)'}

光标附近代码：
${context.nearbyCode || '(无)'}

请直接解释用户现在正在看的这里。先说“这段代码在做什么”，再解释关键语法/数据流/调用关系；如果上下文不足以证明某个结论，要明确说不知道，不要脑补项目其他文件。`;
}

async function requestTutorPlan(focus, candidates) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeOpenAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning: { effort: 'low' },
        input: [
          {
            role: 'system',
            content: AI_TUTOR_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildAiTutorPrompt(focus, candidates),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'ai_code_tutor_project_tour',
            strict: true,
            schema: buildAiTutorSchema(candidates),
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI API 请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }

    if (payload.status === 'incomplete') {
      throw new Error(`AI 返回内容不完整：${payload.incomplete_details?.reason || 'unknown'}`);
    }

    const outputText = extractOpenAiOutputText(payload);
    const decoded = JSON.parse(outputText);
    validateAiPlan(decoded, candidates);
    return decoded;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('AI 项目分析超时，请稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAiTutorPrompt(focus, candidates) {
  const candidateText = candidates.map((candidate) => {
    return `候选 ID：${candidate.id}\n文件：${candidate.path}\n目标：第 ${candidate.line} 行，第 ${candidate.column} 列\n说明：${candidate.reason}\n代码：\n${candidate.snippet}`;
  }).join('\n\n---\n\n');

  return `用户正在学习一个真实代码项目。\n\n当前文件：${focus.filePath}\n当前行：${focus.line}\n当前选中/所在代码：\n${focus.selectedText || '(未选中文本)'}\n搜索标识符：${focus.query || '(没有可用于跨文件检索的标识符)'}\n\n下面是 IDE 已经从项目中检索并读取的真实候选位置。你只能从这些候选 ID 中选择角色要去的位置，不允许编造文件或行号。\n\n${candidateText}\n\n请规划一条 1 到 6 步的教学路线。不要为了数量把所有同名文本都走一遍；优先挑真正有助于理解定义、调用、数据流或功能链的位置。第一步可以保留在 current，也可以直接跳到更关键的候选。`;
}

function extractOpenAiOutputText(payload) {
  for (const output of payload.output || []) {
    if (output.type !== 'message') {
      continue;
    }
    for (const content of output.content || []) {
      if (content.type === 'refusal') {
        throw new Error(content.refusal || 'AI 拒绝了这次项目讲解请求。');
      }
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  throw new Error('AI 没有返回可用的项目讲解路线。');
}

function validateAiPlan(plan, candidates) {
  if (!plan || typeof plan !== 'object' || typeof plan.summary !== 'string' || !Array.isArray(plan.steps)) {
    throw new Error('AI 返回的项目讲解格式无效。');
  }

  if (plan.steps.length < 1 || plan.steps.length > 6) {
    throw new Error('AI 返回的讲解步骤数量无效。');
  }

  const validIds = new Set(candidates.map((candidate) => candidate.id));
  for (const step of plan.steps) {
    if (
      !step
      || typeof step !== 'object'
      || !validIds.has(step.candidateId)
      || !['jump', 'point', 'think'].includes(step.action)
      || typeof step.speech !== 'string'
      || step.speech.trim().length === 0
    ) {
      throw new Error('AI 返回了无法执行的角色步骤。');
    }
  }
}

const CURRENT_CODE_EXPLAIN_SYSTEM_PROMPT = `你是住在代码编辑器里的 AI 编程导师。
你会收到 IDE 在这一刻真实捕获的编辑器上下文，包括当前文件、光标、选区、标识符、附近代码，以及是否存在未保存修改。

要求：
1. 使用简体中文，直接回答“用户现在正在看的代码在做什么”。
2. 如果有选区，优先解释选区；没有选区时围绕光标所在行和当前标识符解释。
3. 先讲功能，再讲关键语法、数据流或调用关系，不要只做逐字翻译。
4. 未保存内容来自 Monaco 当前内存，应优先于你对磁盘文件的任何假设。
5. 只能根据提供的当前上下文下结论；需要其他文件才能确认的事情要明确说明。
6. 面向正在学习真实项目的程序员，尽量把这一段放回功能链中理解。
7. 控制在约 2 到 4 个短段落，适合显示在角色气泡并朗读。`;

const SEMANTIC_AI_TUTOR_SYSTEM_PROMPT = `你是住在代码编辑器里的 AI 编程导师。
IDE 已经通过 Dart Analysis Server / LSP 得到了真实 Call Hierarchy。你的任务是把这些真实语义节点组织成适合学习的调用链，并让角色按顺序跨文件跳着讲。

要求：
1. 使用简体中文，像老师带学生读真实项目一样自然。
2. 只能选择提示中存在的 candidateId，绝对不能编造文件、行号、函数或调用关系。
3. root 是用户当前函数；incomingCall 是上游调用者；outgoingCall 是下游被调用函数。
4. 优先讲清“为什么从这里开始”“控制流/功能链怎么继续”“这个调用为什么重要”。
5. 不要机械遍历所有 Call Hierarchy 节点，选择 1 到 6 个最有教学价值的位置。
6. 默认只讨论用户项目内部代码；IDE 已经把 Flutter SDK 和第三方包节点过滤掉。
7. 如果调用图不足以证明完整业务流程，要明确说当前语义链能证明到哪里，不要脑补。
8. speech 一般 1 到 3 句话，必须围绕当前节点与上一/下一节点的真实关系。
9. action 只能是 jump、point、think：跨文件/跨位置用 jump，具体代码解释用 point，关系总结用 think。
10. summary 用 1 到 2 句话概括这条语义教学路线。`;

const AI_TUTOR_SYSTEM_PROMPT = `你是住在代码编辑器里的 AI 编程导师。
你的工作不是把所有搜索结果逐个念出来，而是从 IDE 已提供的真实候选代码位置中，规划一条适合学习者理解代码功能链的路线。

要求：
1. 使用简体中文，像老师带着学生读代码一样自然。
2. 只能选择提示里存在的 candidateId，绝对不能编造文件、行号或候选 ID。
3. 优先区分“定义在哪里”“在哪里被调用/使用”“数据流下一步去哪”“为什么这个位置重要”。
4. 文本同名不代表语义相关；如果候选明显只是巧合同名，可以跳过。
5. 路线控制在 1 到 6 步，不要为了凑数量重复讲同一件事。
6. speech 要直接解释当前候选为什么值得看，通常 1 到 3 句话。
7. action 只能是 jump、point、think：
   - jump：跨位置/跨文件带学生去下一站
   - point：指着当前具体代码解释
   - think：说明概念、关系或需要谨慎判断的地方
8. summary 用 1 到 2 句话概括这条教学路线会帮助用户理解什么。
9. 如果现有候选不足以确认完整调用链，要明确说“这些候选只能说明……”，不要假装已经理解整个项目。`;

function buildAiTutorSchema(candidates) {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            candidateId: {
              type: 'string',
              enum: candidates.map((candidate) => candidate.id),
            },
            action: {
              type: 'string',
              enum: ['jump', 'point', 'think'],
            },
            speech: { type: 'string' },
          },
          required: ['candidateId', 'action', 'speech'],
          additionalProperties: false,
        },
      },
    },
    required: ['summary', 'steps'],
    additionalProperties: false,
  };
}

async function searchProjectInternal(query, maximumMatches = 40) {
  const matches = [];
  const lowerQuery = query.toLowerCase();
  const BATCH_SIZE = 20;

  for (let offset = 0; offset < currentProjectFiles.length; offset += BATCH_SIZE) {
    if (matches.length >= maximumMatches) {
      break;
    }

    const batch = currentProjectFiles.slice(offset, offset + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (relativePath) => {
      try {
        const absolutePath = resolveInsideProject(currentProjectRoot, relativePath);
        const content = await fs.readFile(absolutePath, 'utf8');
        return findMatchesInFile(relativePath, content, lowerQuery, maximumMatches);
      } catch {
        return [];
      }
    }));

    for (const result of batchResults) {
      for (const match of result) {
        matches.push(match);
        if (matches.length >= maximumMatches) {
          break;
        }
      }
      if (matches.length >= maximumMatches) {
        break;
      }
    }
  }

  return matches;
}

function findMatchesInFile(relativePath, content, lowerQuery, maximumMatches) {
  const results = [];
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lowerLine = line.toLowerCase();
    let fromIndex = 0;

    while (results.length < maximumMatches) {
      const matchIndex = lowerLine.indexOf(lowerQuery, fromIndex);
      if (matchIndex < 0) {
        break;
      }

      results.push({
        path: normalizeRelativePath(relativePath),
        line: lineIndex + 1,
        column: matchIndex + 1,
        preview: line.trim(),
      });

      fromIndex = matchIndex + Math.max(1, lowerQuery.length);
    }

    if (results.length >= maximumMatches) {
      break;
    }
  }

  return results;
}


function closeProjectFileWatcher(senderId) {
  const entry = projectFileWatchers.get(senderId);
  if (!entry) {
    return;
  }
  projectFileWatchers.delete(senderId);
  try {
    entry.dispose();
  } catch {
    // Ignore watcher cleanup races while windows/projects are closing.
  }
}

async function loadProjectRoot(rootPath) {
  const files = await collectProjectFiles(rootPath);
  dartLspClient?.dispose();
  dartLspClient = null;
  currentProjectRoot = rootPath;
  currentProjectFiles = files;

  return {
    rootPath,
    projectName: path.basename(rootPath),
    files,
  };
}


function validateProjectFilePath(relativePath) {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('文件路径无效。');
  }
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!currentProjectFiles.includes(normalizedPath)) {
    throw new Error('代码便签只能绑定当前项目中的代码文件。');
  }
  return normalizedPath;
}

function legacyCodeNotesFilePath() {
  return path.join(app.getPath('userData'), 'ai-code-tutor', 'code-notes.json');
}

function projectNotesDirectory() {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }
  return path.join(currentProjectRoot, '.ai-code-tutor');
}

function projectCodeNotesFilePath() {
  return path.join(projectNotesDirectory(), 'notes.json');
}

function resolveInsideNotesDirectory(relativePath) {
  const root = projectNotesDirectory();
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('便签资源路径无效。');
  }
  return target;
}

function validateNoteAssetPath(value) {
  const normalized = normalizeRelativePath(typeof value === 'string' ? value.trim() : '');
  if (!normalized || !normalized.startsWith('assets/')) {
    throw new Error('便签图片路径无效。');
  }
  return normalized;
}

function sanitizeNoteImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 12).flatMap((image) => {
    if (!image || typeof image !== 'object') {
      return [];
    }
    try {
      const assetPath = validateNoteAssetPath(image.path);
      return [{
        id: typeof image.id === 'string' && image.id.trim() ? image.id.trim() : randomUUID(),
        path: assetPath,
        name: typeof image.name === 'string' ? image.name.trim().slice(0, 160) : path.basename(assetPath),
        mimeType: normalizeImageMimeType(image.mimeType, assetPath),
        createdAt: typeof image.createdAt === 'string' ? image.createdAt : new Date().toISOString(),
      }];
    } catch {
      return [];
    }
  });
}

function sanitizeProjectCodeNotes(decoded) {
  const items = Array.isArray(decoded?.notes) ? decoded.notes : [];
  return items.filter((note) => (
    note
    && typeof note.id === 'string'
    && typeof note.filePath === 'string'
    && Number.isInteger(note.line)
    && note.line > 0
    && typeof note.text === 'string'
  )).map((note) => ({
    id: note.id,
    filePath: normalizeRelativePath(note.filePath),
    placement: note.placement === 'inline' ? 'inline' : 'gutter',
    line: note.line,
    column: note.placement === 'inline' && Number.isInteger(note.column) && note.column > 0 ? note.column : 1,
    anchorText: typeof note.anchorText === 'string' ? note.anchorText.slice(0, 500) : '',
    text: note.text.slice(0, 20000),
    images: sanitizeNoteImages(note.images),
    createdAt: typeof note.createdAt === 'string' ? note.createdAt : new Date(0).toISOString(),
    updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : new Date(0).toISOString(),
  }));
}

async function loadProjectCodeNotes() {
  if (!currentProjectRoot) {
    return [];
  }

  let notes = [];
  try {
    const raw = await fs.readFile(projectCodeNotesFilePath(), 'utf8');
    notes = sanitizeProjectCodeNotes(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to load project AI Code Tutor notes:', error);
    }
  }

  const migrated = await migrateLegacyCodeNotes(notes);
  if (migrated.changed) {
    await saveProjectCodeNotes(migrated.notes);
    await removeMigratedLegacyCodeNotes(migrated.migratedIds);
  }
  return migrated.notes;
}

async function migrateLegacyCodeNotes(projectNotes) {
  if (!currentProjectRoot) {
    return { notes: projectNotes, changed: false, migratedIds: [] };
  }

  try {
    const raw = await fs.readFile(legacyCodeNotesFilePath(), 'utf8');
    const decoded = JSON.parse(raw);
    const legacyItems = Array.isArray(decoded?.notes) ? decoded.notes : [];
    const existingIds = new Set(projectNotes.map((note) => note.id));
    let changed = false;
    const migratedIds = [];
    const next = [...projectNotes];

    for (const note of legacyItems) {
      if (
        !note
        || typeof note.id !== 'string'
        || typeof note.projectRoot !== 'string'
        || path.resolve(note.projectRoot) !== currentProjectRoot
        || existingIds.has(note.id)
      ) {
        continue;
      }

      const migrated = sanitizeProjectCodeNotes({ notes: [{ ...note, images: [] }] })[0];
      if (!migrated) {
        continue;
      }
      next.push(migrated);
      existingIds.add(migrated.id);
      migratedIds.push(migrated.id);
      changed = true;
    }

    return { notes: next, changed, migratedIds };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to migrate legacy AI Code Tutor notes:', error);
    }
    return { notes: projectNotes, changed: false, migratedIds: [] };
  }
}

async function removeMigratedLegacyCodeNotes(migratedIds) {
  if (!currentProjectRoot || !Array.isArray(migratedIds) || migratedIds.length === 0) {
    return;
  }
  try {
    const filePath = legacyCodeNotesFilePath();
    const raw = await fs.readFile(filePath, 'utf8');
    const decoded = JSON.parse(raw);
    const items = Array.isArray(decoded?.notes) ? decoded.notes : [];
    const migrated = new Set(migratedIds);
    const next = items.filter((note) => !(
      note
      && typeof note.id === 'string'
      && migrated.has(note.id)
      && typeof note.projectRoot === 'string'
      && path.resolve(note.projectRoot) === currentProjectRoot
    ));
    if (next.length !== items.length) {
      await fs.writeFile(filePath, JSON.stringify({ ...decoded, notes: next }, null, 2), 'utf8');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to clean migrated legacy AI Code Tutor notes:', error);
    }
  }
}

async function saveProjectCodeNotes(notes) {
  const filePath = projectCodeNotesFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ version: 3, notes }, null, 2), 'utf8');
  await cleanupOrphanNoteAssets(notes);
}

async function cleanupOrphanNoteAssets(notes) {
  const assetsDirectory = path.join(projectNotesDirectory(), 'assets');
  let entries;
  try {
    entries = await fs.readdir(assetsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to inspect code note assets:', error);
    }
    return;
  }

  const used = new Set(notes.flatMap((note) => (note.images ?? []).map((image) => normalizeRelativePath(image.path))));
  await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const relative = `assets/${entry.name}`;
    if (!used.has(relative)) {
      await fs.rm(path.join(assetsDirectory, entry.name), { force: true }).catch(() => {});
    }
  }));
}

function normalizeImageMimeType(rawMimeType, fileName) {
  const mimeType = typeof rawMimeType === 'string' ? rawMimeType.trim().toLowerCase() : '';
  if (mimeType && Array.from(IMAGE_MIME_BY_EXTENSION.values()).includes(mimeType)) {
    return mimeType;
  }
  const extension = path.extname(String(fileName || '')).toLowerCase();
  const inferred = IMAGE_MIME_BY_EXTENSION.get(extension);
  if (!inferred) {
    throw new Error('只支持 PNG、JPG、WEBP、GIF、BMP、AVIF 图片。');
  }
  return inferred;
}

function imageExtensionForMime(mimeType, fileName) {
  const original = path.extname(String(fileName || '')).toLowerCase();
  if (IMAGE_MIME_BY_EXTENSION.get(original) === mimeType) {
    return original === '.jpeg' ? '.jpg' : original;
  }
  for (const [extension, value] of IMAGE_MIME_BY_EXTENSION) {
    if (value === mimeType) {
      return extension === '.jpeg' ? '.jpg' : extension;
    }
  }
  return '.png';
}

function validateAppearanceState(value) {
  const input = value && typeof value === 'object' ? value : {};
  const normalizeUnit = (raw, fallback) => {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : fallback;
  };
  const blur = Number(input.blur);
  const normalizeHexColor = (raw, fallback) => (
    typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw.trim())
      ? raw.trim()
      : fallback
  );
  const color = normalizeHexColor(input.color, '#111318');
  const backgroundMode = input.backgroundMode === 'gradient' ? 'gradient' : 'solid';
  const gradientStart = normalizeHexColor(input.gradientStart, '#171a2d');
  const gradientEnd = normalizeHexColor(input.gradientEnd, '#412f66');
  const gradientAngleRaw = Number(input.gradientAngle);
  const gradientAngle = Number.isFinite(gradientAngleRaw)
    ? ((gradientAngleRaw % 360) + 360) % 360
    : 135;
  const scope = input.scope === 'all' ? 'all' : 'editor';
  const fit = ['cover', 'contain', 'fill', 'none'].includes(input.fit) ? input.fit : 'cover';
  const position = ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'].includes(input.position)
    ? input.position
    : 'center';

  return {
    color,
    backgroundMode,
    gradientStart,
    gradientEnd,
    gradientAngle,
    scope,
    imageFile: typeof input.imageFile === 'string' ? path.basename(input.imageFile) : '',
    imageOpacity: normalizeUnit(input.imageOpacity, 0.42),
    overlayOpacity: normalizeUnit(input.overlayOpacity, 0.56),
    blur: Number.isFinite(blur) ? Math.min(24, Math.max(0, blur)) : 0,
    fit,
    position,
  };
}

function validateVoiceState(value) {
  const input = value && typeof value === 'object' ? value : {};
  const rate = Number(input.rate);
  return {
    enabled: input.enabled !== false,
    language: typeof input.language === 'string' && input.language.trim()
      ? input.language.trim()
      : 'zh-CN',
    voiceId: typeof input.voiceId === 'string' ? input.voiceId : '',
    rate: Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1,
  };
}

function stateFilePath() {
  return path.join(app.getPath('userData'), 'ai-code-tutor', 'state.json');
}

async function loadPersistentState() {
  persistentState = structuredClone(DEFAULT_APP_STATE);
  try {
    const raw = await fs.readFile(stateFilePath(), 'utf8');
    const decoded = JSON.parse(raw);
    if (decoded && typeof decoded === 'object') {
      persistentState = {
        ...persistentState,
        ...decoded,
        version: 2,
        voice: validateVoiceState(decoded.voice),
        appearance: validateAppearanceState(decoded.appearance),
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to load AI Code Tutor state:', error);
    }
  }

  if (!runtimeOpenAiKey && persistentState.encryptedOpenAiKey) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        runtimeOpenAiKey = safeStorage.decryptString(
          Buffer.from(persistentState.encryptedOpenAiKey, 'base64'),
        );
      }
    } catch (error) {
      console.warn('Failed to decrypt stored OpenAI API Key:', error);
      persistentState.encryptedOpenAiKey = '';
      await savePersistentState();
    }
  }
}

async function savePersistentState() {
  const filePath = stateFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(persistentState, null, 2), 'utf8');
}

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


function applyWindowChrome(window, appearance) {
  const chrome = appearanceChromeColors(appearance);
  window.setBackgroundColor(chrome.backgroundColor);
  if (process.platform === 'win32' && typeof window.setTitleBarOverlay === 'function') {
    window.setTitleBarOverlay({
      color: chrome.titleBarColor,
      symbolColor: chrome.symbolColor,
      height: 36,
    });
  }
}

function appearanceChromeColors(appearance) {
  const normalized = validateAppearanceState(appearance);
  let base = '#171a20';
  if (normalized.scope === 'all') {
    base = normalized.backgroundMode === 'gradient'
      ? blendHex(normalized.gradientStart, normalized.gradientEnd, 0.5)
      : normalized.color;
  }

  // Windows titleBarOverlay 只支持单块系统颜色，无法真正跟随 CSS 渐变或用户壁纸。
  // 使用透明覆盖层，让右上角最小化 / 最大化 / 关闭按钮直接透出网页自己的玻璃标题栏，
  // 这样纯色、渐变和上传图片都会和窗口按钮区域保持同一套背景。
  const titleBarColor = '#00000000';
  const chromeReference = blendHex(base, '#0b0d12', 0.38);
  const luminance = hexLuminanceValue(chromeReference);
  return {
    backgroundColor: base,
    titleBarColor,
    symbolColor: luminance > 0.58 ? '#18202d' : '#f2f4f8',
  };
}

function blendHex(from, to, amount) {
  const a = parseHexColor(from) ?? [23, 26, 32];
  const b = parseHexColor(to) ?? [11, 13, 18];
  const t = Math.max(0, Math.min(1, Number(amount) || 0));
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * t)
    .toString(16)
    .padStart(2, '0')).join('')}`;
}

function parseHexColor(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(typeof value === 'string' ? value : '');
  if (!match) {
    return null;
  }
  const number = Number.parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function hexLuminanceValue(value) {
  const color = parseHexColor(value);
  if (!color) {
    return 0;
  }
  return (color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114) / 255;
}

app.whenReady().then(async () => {
  await loadPersistentState();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  dartLspClient?.dispose();
  dartLspClient = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
