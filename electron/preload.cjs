const { contextBridge, ipcRenderer } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let activeProjectRoot = '';

function rememberProjectSnapshot(snapshot) {
  if (
    snapshot
      && typeof snapshot.rootPath === 'string'
      && path.isAbsolute(snapshot.rootPath)
  ) {
    activeProjectRoot = path.resolve(snapshot.rootPath);
  }

  return snapshot;
}

async function invokeProjectSnapshot(channel, ...args) {
  const snapshot = await ipcRenderer.invoke(channel, ...args);
  return rememberProjectSnapshot(snapshot);
}

function requireProjectRoot() {
  if (!activeProjectRoot) {
    throw new Error('请先打开一个真实项目');
  }

  return activeProjectRoot;
}

function normalizeProjectRelativePath(
  rawPath,
  { allowRoot = false } = {},
) {
  if (typeof rawPath !== 'string') {
    throw new Error('项目路径必须是字符串');
  }

  const forwardPath = rawPath.replace(/\\/g, '/');
  const normalized = path.posix.normalize(forwardPath);

  if (
    normalized === '.'
      || normalized === ''
  ) {
    if (allowRoot) {
      return '';
    }
    throw new Error('不能直接操作项目根目录');
  }

  if (
    path.posix.isAbsolute(normalized)
      || normalized === '..'
      || normalized.startsWith('../')
  ) {
    throw new Error('路径必须位于当前项目内部');
  }

  return normalized;
}

function resolveProjectEntry(
  rawPath,
  options,
) {
  const rootPath = requireProjectRoot();
  const relativePath =
    normalizeProjectRelativePath(
      rawPath,
      options,
    );
  const targetPath = relativePath
    ? path.resolve(
        rootPath,
        ...relativePath.split('/'),
      )
    : rootPath;
  const relativeFromRoot =
    path.relative(rootPath, targetPath);

  if (
    relativeFromRoot === '..'
      || relativeFromRoot.startsWith(
        `..${path.sep}`,
      )
      || path.isAbsolute(relativeFromRoot)
  ) {
    throw new Error('路径必须位于当前项目内部');
  }

  return {
    rootPath,
    relativePath,
    targetPath,
  };
}

async function ensurePathDoesNotExist(targetPath) {
  try {
    await fs.access(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  throw new Error('目标位置已经存在同名文件或文件夹');
}

async function createProjectFile(relativePath) {
  const entry = resolveProjectEntry(relativePath);
  await fs.mkdir(
    path.dirname(entry.targetPath),
    { recursive: true },
  );
  await fs.writeFile(
    entry.targetPath,
    '',
    {
      encoding: 'utf8',
      flag: 'wx',
    },
  );

  return { path: entry.relativePath };
}

async function createProjectDirectory(relativePath) {
  const entry = resolveProjectEntry(relativePath);
  await fs.mkdir(entry.targetPath, {
    recursive: false,
  });

  return { path: entry.relativePath };
}

async function moveProjectEntry(
  sourceRelativePath,
  targetDirectoryRelativePath,
) {
  const source =
    resolveProjectEntry(sourceRelativePath);
  const targetDirectory =
    resolveProjectEntry(
      targetDirectoryRelativePath,
      { allowRoot: true },
    );

  const targetDirectoryStat =
    await fs.stat(targetDirectory.targetPath);
  if (!targetDirectoryStat.isDirectory()) {
    throw new Error('拖放目标不是文件夹');
  }

  const relativeTargetFromSource =
    path.relative(
      source.targetPath,
      targetDirectory.targetPath,
    );
  if (
    relativeTargetFromSource === ''
      || (
        relativeTargetFromSource !== '..'
          && !relativeTargetFromSource.startsWith(
            `..${path.sep}`,
          )
          && !path.isAbsolute(
            relativeTargetFromSource,
          )
      )
  ) {
    throw new Error('不能把文件夹移动到它自己内部');
  }

  const destinationPath =
    path.join(
      targetDirectory.targetPath,
      path.basename(source.targetPath),
    );

  if (destinationPath === source.targetPath) {
    return {
      from: source.relativePath,
      to: source.relativePath,
    };
  }

  await ensurePathDoesNotExist(destinationPath);
  await fs.rename(
    source.targetPath,
    destinationPath,
  );

  const destinationRelativePath =
    path.relative(
      source.rootPath,
      destinationPath,
    )
      .split(path.sep)
      .join('/');

  return {
    from: source.relativePath,
    to: destinationRelativePath,
  };
}

async function deleteProjectEntry(relativePath) {
  const entry = resolveProjectEntry(relativePath);
  const stat = await fs.lstat(entry.targetPath);
  const type = stat.isDirectory()
    ? 'directory'
    : 'file';

  await fs.rm(entry.targetPath, {
    recursive: stat.isDirectory(),
    force: false,
  });

  return {
    path: entry.relativePath,
    type,
  };
}

contextBridge.exposeInMainWorld('tutorIde', {
  openProject: () => invokeProjectSnapshot('project:open'),
  restoreProject: () => invokeProjectSnapshot('project:restore'),
  openGitHubRepository: (url) => invokeProjectSnapshot('github:open-repository', url),
  readProjectFile: (relativePath) => ipcRenderer.invoke('project:read-file', relativePath),
  readProjectAsset: (relativePath) => ipcRenderer.invoke('project:read-asset', relativePath),
  openExternal: (url) => ipcRenderer.invoke('project:open-external', url),
  writeProjectFile: (relativePath, content) => ipcRenderer.invoke('project:write-file', relativePath, content),
  createProjectFile,
  createProjectDirectory,
  moveProjectEntry,
  deleteProjectEntry,
  watchProjectFile: (relativePath) => ipcRenderer.invoke('project:watch-file', relativePath),
  unwatchProjectFile: () => ipcRenderer.invoke('project:unwatch-file'),
  onProjectFileChanged: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('project:file-changed', wrapped);
    return () => ipcRenderer.removeListener('project:file-changed', wrapped);
  },
  searchProject: (query) => ipcRenderer.invoke('project:search', query),
  listCodeNotes: (relativePath) => ipcRenderer.invoke('notes:list', relativePath),
  upsertCodeNote: (note) => ipcRenderer.invoke('notes:upsert', note),
  deleteCodeNote: (id) => ipcRenderer.invoke('notes:delete', id),
  importCodeNoteImage: (image) => ipcRenderer.invoke('notes:import-image', image),
  readCodeNoteImage: (assetPath) => ipcRenderer.invoke('notes:read-image', assetPath),
  findDartSemanticTargets: (focus) => ipcRenderer.invoke('semantic:dart-targets', focus),
  getAppState: () => ipcRenderer.invoke('app:get-state'),
  updateVoiceState: (voiceState) => ipcRenderer.invoke('app:update-voice-state', voiceState),
  updateAppearanceState: (appearance) => ipcRenderer.invoke('app:update-appearance-state', appearance),
  chooseAppearanceBackground: () => ipcRenderer.invoke('appearance:choose-background'),
  getAppearanceBackground: () => ipcRenderer.invoke('appearance:get-background'),
  clearAppearanceBackground: () => ipcRenderer.invoke('appearance:clear-background'),
  listNativeVoices: () => ipcRenderer.invoke('voice:list'),
  synthesizeSpeech: (request) => ipcRenderer.invoke('voice:synthesize', request),
  hasOpenAiKey: () => ipcRenderer.invoke('ai:has-key'),
  setOpenAiKey: (apiKey) => ipcRenderer.invoke('ai:set-key', apiKey),
  clearOpenAiKey: () => ipcRenderer.invoke('ai:clear-key'),
  explainCurrentCode: (context) => ipcRenderer.invoke('ai:explain-current-code', context),
  planTutorTour: (focus) => ipcRenderer.invoke('ai:plan-tour', focus),
  planDartSemanticTour: (focus, mode) => ipcRenderer.invoke('ai:plan-dart-semantic-tour', focus, mode),
});
