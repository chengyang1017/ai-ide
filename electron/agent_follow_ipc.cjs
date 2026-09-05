const { ipcMain } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_CACHE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_FILES = 4000;
const CHANGE_DEBOUNCE_MS = 90;

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

const sessions = new Map();

function normalizeRoot(rawRoot) {
  if (
    typeof rawRoot !== 'string'
      || !rawRoot.trim()
      || !path.isAbsolute(rawRoot)
  ) {
    throw new Error('Agent 跟随只能用于本地真实项目。');
  }

  return path.resolve(rawRoot);
}

function toRelative(root, filename) {
  const absolute = path.resolve(root, filename);
  const relative = path.relative(root, absolute);

  if (
    !relative
      || relative === '..'
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
  ) {
    return '';
  }

  return relative.split(path.sep).join('/');
}

function ignoredRelativePath(relativePath) {
  return relativePath
    .split('/')
    .some((segment) => IGNORED_DIRECTORIES.has(segment));
}

async function readTextSnapshot(targetPath) {
  let stat;
  try {
    stat = await fsp.stat(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  if (!stat.isFile() || stat.size > MAX_CACHE_FILE_BYTES) {
    return null;
  }

  const bytes = await fsp.readFile(targetPath);
  const probe = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (probe.includes(0)) {
    return null;
  }

  return bytes.toString('utf8');
}

function firstChangedLine(before, after) {
  if (before === after) {
    return null;
  }

  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const shared = Math.min(beforeLines.length, afterLines.length);

  let first = 0;
  while (
    first < shared
      && beforeLines[first] === afterLines[first]
  ) {
    first += 1;
  }

  if (first === shared && beforeLines.length === afterLines.length) {
    return null;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= first
      && afterEnd >= first
      && beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const line = first + 1;
  const endLine = Math.max(line, afterEnd + 1);

  return {
    line,
    endLine,
    oldPreview: beforeLines
      .slice(first, Math.min(beforeEnd + 1, first + 4))
      .join('\n')
      .slice(0, 800),
    newPreview: afterLines
      .slice(first, Math.min(afterEnd + 1, first + 4))
      .join('\n')
      .slice(0, 800),
  };
}

async function buildSnapshot(root) {
  const cache = new Map();
  let count = 0;

  async function walk(directoryPath, relativeDirectory) {
    if (count >= MAX_CACHE_FILES) {
      return;
    }

    const entries = await fsp.readdir(directoryPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (count >= MAX_CACHE_FILES) {
        break;
      }

      if (
        entry.isDirectory()
          && IGNORED_DIRECTORIES.has(entry.name)
      ) {
        continue;
      }

      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const targetPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        await walk(targetPath, relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      count += 1;
      const content = await readTextSnapshot(targetPath);
      if (content !== null) {
        cache.set(relativePath, content);
      }
    }
  }

  await walk(root, '');
  return cache;
}

function send(sender, payload) {
  if (!sender.isDestroyed()) {
    sender.send('agent-follow:file-change', payload);
  }
}

function closeSession(senderId) {
  const session = sessions.get(senderId);
  if (!session) {
    return false;
  }

  sessions.delete(senderId);
  session.watcher.close();
  for (const timer of session.pending.values()) {
    clearTimeout(timer);
  }
  session.pending.clear();
  return true;
}

async function processChange(session, sender, relativePath) {
  if (!relativePath || ignoredRelativePath(relativePath)) {
    return;
  }

  const targetPath = path.resolve(
    session.root,
    ...relativePath.split('/'),
  );
  const before = session.cache.get(relativePath);
  const after = await readTextSnapshot(targetPath);

  if (after === null) {
    if (before !== undefined) {
      session.cache.delete(relativePath);
      send(sender, {
        type: 'deleted',
        path: relativePath,
        line: 1,
        endLine: 1,
        oldPreview: before.slice(0, 800),
        newPreview: '',
      });
    }
    return;
  }

  session.cache.set(relativePath, after);

  if (before === undefined) {
    send(sender, {
      type: 'created',
      path: relativePath,
      line: 1,
      endLine: Math.min(4, Math.max(1, after.split(/\r?\n/).length)),
      oldPreview: '',
      newPreview: after.split(/\r?\n/).slice(0, 4).join('\n').slice(0, 800),
    });
    return;
  }

  const diff = firstChangedLine(before, after);
  if (!diff) {
    return;
  }

  send(sender, {
    type: 'modified',
    path: relativePath,
    ...diff,
  });
}

ipcMain.handle('agent-follow:start', async (event, rawRoot) => {
  const root = normalizeRoot(rawRoot);
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) {
    throw new Error('Agent 跟随项目根目录无效。');
  }

  const senderId = event.sender.id;
  closeSession(senderId);

  const cache = await buildSnapshot(root);
  const pending = new Map();

  const watcher = fs.watch(
    root,
    { recursive: true, persistent: false },
    (_eventType, filename) => {
      if (!filename) {
        return;
      }

      const relativePath = toRelative(root, String(filename));
      if (!relativePath || ignoredRelativePath(relativePath)) {
        return;
      }

      const existing = pending.get(relativePath);
      if (existing) {
        clearTimeout(existing);
      }

      pending.set(
        relativePath,
        setTimeout(() => {
          pending.delete(relativePath);
          void processChange(
            sessions.get(senderId) ?? { root, cache },
            event.sender,
            relativePath,
          ).catch(() => {
            // A transient editor/build write should not break Agent following.
          });
        }, CHANGE_DEBOUNCE_MS),
      );
    },
  );

  sessions.set(senderId, {
    root,
    cache,
    pending,
    watcher,
  });

  event.sender.once('destroyed', () => {
    closeSession(senderId);
  });

  return {
    root,
    cachedFiles: cache.size,
  };
});

ipcMain.handle('agent-follow:stop', (event) => {
  return closeSession(event.sender.id);
});
