const { ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeRoot(rawRoot) {
  if (
    typeof rawRoot !== 'string'
      || !path.isAbsolute(rawRoot)
  ) {
    throw new Error('当前项目不是可写的本地项目');
  }

  return path.resolve(rawRoot);
}

function normalizeRelativePath(
  rawPath,
  { allowRoot = false } = {},
) {
  if (typeof rawPath !== 'string') {
    throw new Error('项目路径必须是字符串');
  }

  const normalized = path.posix.normalize(
    rawPath.replace(/\\/g, '/'),
  );

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
  rawRoot,
  rawPath,
  options,
) {
  const rootPath = normalizeRoot(rawRoot);
  const relativePath = normalizeRelativePath(
    rawPath,
    options,
  );
  const targetPath = relativePath
    ? path.resolve(
        rootPath,
        ...relativePath.split('/'),
      )
    : rootPath;
  const relativeFromRoot = path.relative(
    rootPath,
    targetPath,
  );

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

async function requireDirectory(targetPath) {
  const stat = await fs.stat(targetPath);
  if (!stat.isDirectory()) {
    throw new Error('目标不是文件夹');
  }
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

ipcMain.handle(
  'project-files:create-file',
  async (_event, rawRoot, relativePath) => {
    const entry = resolveProjectEntry(
      rawRoot,
      relativePath,
    );
    await requireDirectory(entry.rootPath);
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
  },
);

ipcMain.handle(
  'project-files:create-directory',
  async (_event, rawRoot, relativePath) => {
    const entry = resolveProjectEntry(
      rawRoot,
      relativePath,
    );
    await requireDirectory(entry.rootPath);
    await fs.mkdir(entry.targetPath, {
      recursive: false,
    });

    return { path: entry.relativePath };
  },
);

ipcMain.handle(
  'project-files:move-entry',
  async (
    _event,
    rawRoot,
    sourceRelativePath,
    targetDirectoryRelativePath,
  ) => {
    const source = resolveProjectEntry(
      rawRoot,
      sourceRelativePath,
    );
    const targetDirectory = resolveProjectEntry(
      rawRoot,
      targetDirectoryRelativePath,
      { allowRoot: true },
    );

    await requireDirectory(source.rootPath);
    await requireDirectory(
      targetDirectory.targetPath,
    );

    const sourceStat = await fs.lstat(
      source.targetPath,
    );

    if (sourceStat.isDirectory()) {
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
        throw new Error(
          '不能把文件夹移动到它自己内部',
        );
      }
    }

    const destinationPath = path.join(
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

    return {
      from: source.relativePath,
      to: path
        .relative(source.rootPath, destinationPath)
        .split(path.sep)
        .join('/'),
    };
  },
);

ipcMain.handle(
  'project-files:delete-entry',
  async (_event, rawRoot, relativePath) => {
    const entry = resolveProjectEntry(
      rawRoot,
      relativePath,
    );
    await requireDirectory(entry.rootPath);

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
  },
);
