const { ipcMain } = require('electron');
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');

const originalHandle = ipcMain.handle.bind(ipcMain);

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

const KNOWN_TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.env', '.go', '.gradle',
  '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.json', '.kt', '.kts',
  '.less', '.mjs', '.cjs', '.md', '.php', '.prisma', '.py', '.rb', '.rs',
  '.scss', '.sql', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.txt',
  '.vue', '.xml', '.yaml', '.yml',
]);

const KNOWN_TEXT_FILE_NAMES = new Set([
  '.editorconfig',
  '.env',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  'dockerfile',
  'license',
  'makefile',
  'readme',
]);

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_VISIBLE_FILES = 5000;
const MAX_VISIBLE_DIRECTORIES = 5000;
const TEXT_PROBE_BYTES = 8192;

let activeProjectRoot = '';
const fallbackWatchers = new Map();
const fallbackWriteSuppressUntil = new Map();

function isLocalProjectRoot(value) {
  return typeof value === 'string'
    && path.isAbsolute(value)
    && !/^github:\/\//i.test(value);
}

function normalizeProjectRelativePath(rawPath, { allowRoot = false } = {}) {
  if (typeof rawPath !== 'string') {
    throw new Error('项目路径必须是字符串');
  }

  const normalized = path.posix.normalize(
    rawPath.replace(/\\/g, '/'),
  );

  if (normalized === '.' || normalized === '') {
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

function resolveInsideProject(rootPath, rawPath, options) {
  const relativePath = normalizeProjectRelativePath(
    rawPath,
    options,
  );
  const targetPath = relativePath
    ? path.resolve(rootPath, ...relativePath.split('/'))
    : rootPath;
  const relative = path.relative(rootPath, targetPath);

  if (
    relative === '..'
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
  ) {
    throw new Error('路径必须位于当前项目内部');
  }

  return {
    relativePath,
    targetPath,
  };
}

function normalizedRelativeFromRoot(rootPath, absolutePath) {
  return path
    .relative(rootPath, absolutePath)
    .split(path.sep)
    .join('/');
}

function isKnownTextName(fileName) {
  const lowerName = fileName.toLowerCase();
  if (KNOWN_TEXT_FILE_NAMES.has(lowerName)) {
    return true;
  }
  if (lowerName.startsWith('.env')) {
    return true;
  }
  return KNOWN_TEXT_EXTENSIONS.has(
    path.extname(lowerName),
  );
}

async function looksLikeTextFile(
  absolutePath,
  fileName,
  size,
) {
  if (size > MAX_TEXT_FILE_BYTES) {
    return false;
  }

  if (isKnownTextName(fileName) || size === 0) {
    return true;
  }

  const handle = await fs.open(absolutePath, 'r');
  try {
    const probeLength = Math.min(
      size,
      TEXT_PROBE_BYTES,
    );
    const buffer = Buffer.alloc(probeLength);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      probeLength,
      0,
    );
    const sample = buffer.subarray(0, bytesRead);

    if (sample.includes(0)) {
      return false;
    }

    let suspiciousControls = 0;
    for (const byte of sample) {
      const allowedWhitespace =
        byte === 9 || byte === 10 || byte === 13;
      if (
        byte < 32
          && !allowedWhitespace
      ) {
        suspiciousControls += 1;
      }
    }

    if (
      sample.length > 0
        && suspiciousControls / sample.length > 0.02
    ) {
      return false;
    }

    try {
      new TextDecoder('utf-8', {
        fatal: true,
      }).decode(sample);
      return true;
    } catch {
      return false;
    }
  } finally {
    await handle.close();
  }
}

async function scanVisibleProject(rootPath) {
  const files = [];
  const directories = [];

  async function walk(directoryPath) {
    if (
      files.length >= MAX_VISIBLE_FILES
        && directories.length >= MAX_VISIBLE_DIRECTORIES
    ) {
      return;
    }

    const entries = await fs.readdir(
      directoryPath,
      { withFileTypes: true },
    );

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      const absolutePath = path.join(
        directoryPath,
        entry.name,
      );

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        if (
          directories.length < MAX_VISIBLE_DIRECTORIES
        ) {
          directories.push(
            normalizedRelativeFromRoot(
              rootPath,
              absolutePath,
            ),
          );
        }

        await walk(absolutePath);
        continue;
      }

      if (
        !entry.isFile()
          || files.length >= MAX_VISIBLE_FILES
      ) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      if (
        await looksLikeTextFile(
          absolutePath,
          entry.name,
          stat.size,
        )
      ) {
        files.push(
          normalizedRelativeFromRoot(
            rootPath,
            absolutePath,
          ),
        );
      }
    }
  }

  await walk(rootPath);

  return {
    files,
    directories,
  };
}

async function augmentProjectSnapshot(snapshot) {
  if (
    !snapshot
      || !isLocalProjectRoot(snapshot.rootPath)
  ) {
    if (snapshot?.rootPath) {
      activeProjectRoot = '';
    }
    return snapshot;
  }

  const rootPath = path.resolve(snapshot.rootPath);
  activeProjectRoot = rootPath;
  const visible = await scanVisibleProject(rootPath);
  const files = Array.from(
    new Set([
      ...(Array.isArray(snapshot.files)
        ? snapshot.files
        : []),
      ...visible.files,
    ]),
  ).sort((a, b) => a.localeCompare(b));

  return {
    ...snapshot,
    rootPath,
    files,
    directories: visible.directories,
  };
}

function closeFallbackWatcher(senderId) {
  const entry = fallbackWatchers.get(senderId);
  if (!entry) {
    return;
  }

  fallbackWatchers.delete(senderId);
  try {
    entry.dispose();
  } catch {
    // Ignore races while switching files or closing windows.
  }
}

async function fallbackWriteProjectFile(
  relativePath,
  rawContent,
) {
  if (!activeProjectRoot) {
    throw new Error('请先打开一个本地真实项目');
  }
  if (typeof rawContent !== 'string') {
    throw new Error('要保存的文件内容无效。');
  }

  const bytes = Buffer.byteLength(
    rawContent,
    'utf8',
  );
  if (bytes > MAX_TEXT_FILE_BYTES) {
    throw new Error('这个文件超过 2 MB，暂不直接保存。');
  }

  const entry = resolveInsideProject(
    activeProjectRoot,
    relativePath,
  );
  const stat = await fs.stat(entry.targetPath);
  if (!stat.isFile()) {
    throw new Error('目标不是文件。');
  }

  fallbackWriteSuppressUntil.set(
    entry.targetPath,
    Date.now() + 650,
  );
  await fs.writeFile(
    entry.targetPath,
    rawContent,
    'utf8',
  );

  setTimeout(() => {
    const until =
      fallbackWriteSuppressUntil.get(
        entry.targetPath,
      ) ?? 0;
    if (Date.now() >= until) {
      fallbackWriteSuppressUntil.delete(
        entry.targetPath,
      );
    }
  }, 700).unref?.();

  return {
    path: entry.relativePath,
    bytes,
  };
}

async function fallbackWatchProjectFile(
  event,
  relativePath,
) {
  if (!activeProjectRoot) {
    throw new Error('请先打开一个本地真实项目');
  }

  const entry = resolveInsideProject(
    activeProjectRoot,
    relativePath,
  );
  const stat = await fs.stat(entry.targetPath);
  if (!stat.isFile()) {
    throw new Error('目标不是文件。');
  }

  const senderId = event.sender.id;
  closeFallbackWatcher(senderId);
  let debounceTimer = null;

  const watcher = watch(
    entry.targetPath,
    { persistent: false },
    () => {
      const suppressedUntil =
        fallbackWriteSuppressUntil.get(
          entry.targetPath,
        ) ?? 0;
      if (Date.now() <= suppressedUntil) {
        return;
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!event.sender.isDestroyed()) {
          event.sender.send(
            'project:file-changed',
            { path: entry.relativePath },
          );
        }
      }, 120);
    },
  );

  watcher.on('error', () => {
    closeFallbackWatcher(senderId);
  });

  fallbackWatchers.set(senderId, {
    dispose() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher.close();
    },
  });

  return { path: entry.relativePath };
}

function isProjectMembershipError(error) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  return (
    message.includes(
      '当前已打开项目中的代码文件',
    )
      || message.includes(
        '代码便签只能绑定当前项目中的代码文件',
      )
  );
}

ipcMain.handle = function patchedHandle(
  channel,
  listener,
) {
  if (
    channel === 'project:open'
      || channel === 'project:restore'
  ) {
    return originalHandle(
      channel,
      async (...args) => {
        const snapshot = await listener(...args);
        return augmentProjectSnapshot(snapshot);
      },
    );
  }

  if (channel === 'github:open-repository') {
    return originalHandle(
      channel,
      async (...args) => {
        const result = await listener(...args);
        if (result) {
          activeProjectRoot = '';
        }
        return result;
      },
    );
  }

  if (channel === 'project:write-file') {
    return originalHandle(
      channel,
      async (...args) => {
        try {
          return await listener(...args);
        } catch (error) {
          if (
            !activeProjectRoot
              || !isProjectMembershipError(error)
          ) {
            throw error;
          }

          return fallbackWriteProjectFile(
            args[1],
            args[2],
          );
        }
      },
    );
  }

  if (channel === 'project:watch-file') {
    return originalHandle(
      channel,
      async (...args) => {
        const event = args[0];
        closeFallbackWatcher(event.sender.id);

        try {
          return await listener(...args);
        } catch (error) {
          if (
            !activeProjectRoot
              || !isProjectMembershipError(error)
          ) {
            throw error;
          }

          return fallbackWatchProjectFile(
            event,
            args[1],
          );
        }
      },
    );
  }

  if (channel === 'project:unwatch-file') {
    return originalHandle(
      channel,
      async (...args) => {
        const event = args[0];
        closeFallbackWatcher(event.sender.id);
        return listener(...args);
      },
    );
  }

  if (channel === 'notes:list') {
    return originalHandle(
      channel,
      async (...args) => {
        try {
          return await listener(...args);
        } catch (error) {
          if (
            !activeProjectRoot
              || !isProjectMembershipError(error)
          ) {
            throw error;
          }

          const entry = resolveInsideProject(
            activeProjectRoot,
            args[1],
          );
          const stat = await fs.stat(entry.targetPath);
          if (!stat.isFile()) {
            throw error;
          }
          return [];
        }
      },
    );
  }

  return originalHandle(channel, listener);
};
