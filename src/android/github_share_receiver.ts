import {
  Capacitor,
  registerPlugin,
} from '@capacitor/core';
import './github_share_receiver.css';
import './github_account_workspace';
import {
  githubApiGetJson,
  githubReadRepositoryAsset,
  githubReadRepositoryFile,
} from './github_auth_bridge';

interface GitHubIntentResult {
  url: string;
}

interface AndroidProjectPlugin {
  takePendingGitHubUrl():
    Promise<GitHubIntentResult>;
}

interface GitHubLocation {
  url: string;
  owner: string;
  repo: string;
  repository: string;
  routeParts: string[];
  displayPath: string;
}

interface GitHubRepositoryInfo {
  default_branch: string;
}

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  size?: number;
  sha?: string;
}

interface GitHubTreeResult {
  tree: GitHubTreeItem[];
  truncated?: boolean;
}

interface RemoteGitHubSession {
  owner: string;
  repo: string;
  repository: string;
  ref: string;
  files: Set<string>;
  fileCache: Map<string, string>;
}

const AndroidProject =
  registerPlugin<AndroidProjectPlugin>(
    'AndroidProject',
  );

const MAX_REMOTE_TEXT_BYTES =
  2 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.dart',
  '.env',
  '.go',
  '.gradle',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.json',
  '.kt',
  '.kts',
  '.less',
  '.mjs',
  '.cjs',
  '.md',
  '.php',
  '.prisma',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.properties',
  '.lock',
]);

const TEXT_FILE_NAMES = new Set([
  '.editorconfig',
  '.env',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  'dockerfile',
  'makefile',
  'license',
  'readme',
]);

let remoteSession:
  RemoteGitHubSession | null = null;

function parseGitHubLocation(
  value: string,
): GitHubLocation | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
        || url.hostname.toLowerCase()
          !== 'github.com'
    ) {
      return null;
    }

    const parts =
      url.pathname
        .split('/')
        .filter(Boolean);
    const owner = parts[0];
    const rawRepo = parts[1];

    if (!owner || !rawRepo) {
      return null;
    }

    const repo =
      rawRepo.replace(/\.git$/i, '');
    const routeParts = parts.slice(2);

    return {
      url: url.toString(),
      owner,
      repo,
      repository: `${owner}/${repo}`,
      routeParts,
      displayPath:
        routeParts.length > 0
          ? routeParts.join('/')
          : '仓库首页',
    };
  } catch {
    return null;
  }
}

async function requestJson<T>(
  url: string,
): Promise<T> {
  const parsed = new URL(url);
  if (parsed.hostname !== 'api.github.com') {
    throw new Error('GitHub API 地址无效。');
  }

  return githubApiGetJson<T>(
    `${parsed.pathname}${parsed.search}`,
  );
}

async function loadCompleteGitHubTree(
  repoApi: string,
  ref: string,
): Promise<GitHubTreeItem[]> {
  const recursive =
    await requestJson<GitHubTreeResult>(
      `${repoApi}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );

  if (!recursive.truncated) {
    return recursive.tree;
  }

  const root =
    await requestJson<GitHubTreeResult>(
      `${repoApi}/git/trees/${encodeURIComponent(ref)}`,
    );

  const result: GitHubTreeItem[] = [];
  const queue: Array<{
    sha: string;
    prefix: string;
  }> = [];

  const collect = (
    items: GitHubTreeItem[],
    prefix: string,
  ): void => {
    for (const item of items) {
      const fullPath =
        prefix
          ? `${prefix}/${item.path}`
          : item.path;

      if (item.type === 'tree') {
        if (item.sha) {
          queue.push({
            sha: item.sha,
            prefix: fullPath,
          });
        }
        continue;
      }

      result.push({
        ...item,
        path: fullPath,
      });
    }
  };

  collect(root.tree, '');

  while (queue.length > 0) {
    const directory = queue.shift();
    if (!directory) {
      continue;
    }

    const subtree =
      await requestJson<GitHubTreeResult>(
        `${repoApi}/git/trees/${encodeURIComponent(directory.sha)}`,
      );

    collect(
      subtree.tree,
      directory.prefix,
    );
  }

  return result;
}

function resolveGitHubRef(
  location: GitHubLocation,
  defaultBranch: string,
): {
  ref: string;
  preferredPath: string;
  preferredDirectory: string;
} {
  const [
    routeKind,
    routeRef,
    ...rest
  ] = location.routeParts;

  if (
    (routeKind === 'blob'
      || routeKind === 'tree')
      && routeRef
  ) {
    return {
      ref: routeRef,
      preferredPath:
        routeKind === 'blob'
          ? rest.join('/')
          : '',
      preferredDirectory:
        routeKind === 'tree'
          ? rest.join('/')
          : '',
    };
  }

  return {
    ref: defaultBranch,
    preferredPath: '',
    preferredDirectory: '',
  };
}

function isSupportedTextFile(
  item: GitHubTreeItem,
): boolean {
  if (item.type !== 'blob') {
    return false;
  }

  if (
    typeof item.size === 'number'
      && item.size > MAX_REMOTE_TEXT_BYTES
  ) {
    return false;
  }

  const name =
    item.path
      .split('/')
      .at(-1)
      ?.toLowerCase()
      ?? '';

  if (TEXT_FILE_NAMES.has(name)) {
    return true;
  }

  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }

  return TEXT_EXTENSIONS.has(
    name.slice(dot),
  );
}

function choosePreferredFile(
  files: string[],
  preferredPath: string,
  preferredDirectory: string,
): string | undefined {
  if (
    preferredPath
      && files.includes(preferredPath)
  ) {
    return preferredPath;
  }

  if (preferredDirectory) {
    const prefix =
      `${preferredDirectory.replace(/\/+$/, '')}/`;
    const inside =
      files.find(
        (path) => path.startsWith(prefix),
      );
    if (inside) {
      return inside;
    }
  }

  const priorities = [
    'lib/main.dart',
    'src/main.ts',
    'src/main.tsx',
    'src/main.js',
    'src/index.ts',
    'src/index.tsx',
    'main.py',
    'package.json',
    'pubspec.yaml',
    'README.md',
  ];

  for (const priority of priorities) {
    const match =
      files.find(
        (path) =>
          path.toLowerCase()
            === priority.toLowerCase(),
      );
    if (match) {
      return match;
    }
  }

  return files[0];
}

async function readRemoteText(
  relativePath: string,
): Promise<{
  path: string;
  content: string;
}> {
  const session = remoteSession;
  if (!session) {
    throw new Error(
      'GitHub 远程仓库已经关闭。',
    );
  }

  const cached =
    session.fileCache.get(relativePath);
  if (cached !== undefined) {
    return {
      path: relativePath,
      content: cached,
    };
  }

  if (!session.files.has(relativePath)) {
    throw new Error(
      `GitHub 仓库中没有这个代码文件：${relativePath}`,
    );
  }

  const result =
    await githubReadRepositoryFile({
      owner: session.owner,
      repo: session.repo,
      ref: session.ref,
      path: relativePath,
    });

  session.fileCache.set(
    relativePath,
    result.content,
  );

  return result;
}

async function readRemoteAsset(
  relativePath: string,
): Promise<{
  path: string;
  mimeType: string;
  dataUrl: string;
}> {
  const session = remoteSession;
  if (!session) {
    throw new Error(
      'GitHub 远程仓库已经关闭。',
    );
  }

  return githubReadRepositoryAsset({
    owner: session.owner,
    repo: session.repo,
    ref: session.ref,
    path: relativePath,
  });
}

function installRemoteProjectAdapter():
  void {
  const baseOpenProject =
    window.tutorIde.openProject
      .bind(window.tutorIde);
  const baseRestoreProject =
    window.tutorIde.restoreProject
      .bind(window.tutorIde);
  const baseReadProjectFile =
    window.tutorIde.readProjectFile
      .bind(window.tutorIde);
  const baseReadProjectAsset =
    window.tutorIde.readProjectAsset
      .bind(window.tutorIde);
  const baseWriteProjectFile =
    window.tutorIde.writeProjectFile
      .bind(window.tutorIde);

  window.tutorIde.openProject =
    async () => {
      const result =
        await baseOpenProject();

      if (result) {
        remoteSession = null;
      }

      return result;
    };

  window.tutorIde.restoreProject =
    async () => {
      const result =
        await baseRestoreProject();

      // Cold-starting from a GitHub share can race with the normal
      // "restore last local project" startup. Once the GitHub session
      // has begun, let the shared repository win instead of replacing it.
      if (remoteSession) {
        return null;
      }

      return result;
    };

  window.tutorIde.readProjectFile =
    (relativePath) => {
      if (remoteSession) {
        return readRemoteText(
          relativePath,
        );
      }

      return baseReadProjectFile(
        relativePath,
      );
    };

  window.tutorIde.readProjectAsset =
    (relativePath) => {
      if (remoteSession) {
        return readRemoteAsset(
          relativePath,
        );
      }

      return baseReadProjectAsset(
        relativePath,
      );
    };

  window.tutorIde.writeProjectFile =
    (relativePath, content) => {
      if (remoteSession) {
        void content;
        return Promise.reject(
          new Error(
            `GitHub 在线仓库目前是只读模式，不能直接保存 ${relativePath}。`,
          ),
        );
      }

      return baseWriteProjectFile(
        relativePath,
        content,
      );
    };
}

async function loadGitHubRepository(
  location: GitHubLocation,
): Promise<{
  ref: string;
  files: string[];
  preferredFile?: string;
}> {
  const repoApi =
    `https://api.github.com/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}`;

  const info =
    await requestJson<GitHubRepositoryInfo>(
      repoApi,
    );

  const target =
    resolveGitHubRef(
      location,
      info.default_branch || 'main',
    );

  const treeItems =
    await loadCompleteGitHubTree(
      repoApi,
      target.ref,
    );

  const files =
    treeItems
      .filter(isSupportedTextFile)
      .map((item) => item.path);

  if (files.length === 0) {
    throw new Error(
      '这个 GitHub 仓库没有找到可阅读的文本代码文件。',
    );
  }

  remoteSession = {
    owner: location.owner,
    repo: location.repo,
    repository: location.repository,
    ref: target.ref,
    files: new Set(files),
    fileCache: new Map(),
  };

  return {
    ref: target.ref,
    files,
    preferredFile:
      choosePreferredFile(
        files,
        target.preferredPath,
        target.preferredDirectory,
      ),
  };
}

function installGitHubShareReceiver():
  void {
  if (
    Capacitor.getPlatform() !== 'android'
  ) {
    return;
  }

  installRemoteProjectAdapter();

  const card =
    document.createElement('aside');
  card.className = 'github-share-card';
  card.hidden = true;
  card.setAttribute(
    'aria-label',
    '来自 GitHub 的链接',
  );

  card.innerHTML = `
    <div class="github-share-card-header">
      <div>
        <strong data-github-share-title>
          GitHub 已连接
        </strong>
        <div
          class="github-share-card-repo"
          data-github-share-repo
        ></div>
      </div>
      <button
        type="button"
        class="github-share-card-close"
        data-github-share-close
        aria-label="关闭"
      >×</button>
    </div>

    <div class="github-share-card-body">
      <div
        class="github-share-card-path"
        data-github-share-path
      ></div>
      <p
        class="github-share-card-note"
        data-github-share-note
      ></p>
    </div>

    <div class="github-share-card-actions">
      <button
        type="button"
        class="github-share-copy"
        data-github-share-copy
      >
        复制链接
      </button>
      <button
        type="button"
        class="github-share-open"
        data-github-share-open
      >
        在 IDE 打开
      </button>
    </div>
  `;

  document.body.appendChild(card);

  const title =
    card.querySelector<HTMLElement>(
      '[data-github-share-title]',
    );
  const repo =
    card.querySelector<HTMLElement>(
      '[data-github-share-repo]',
    );
  const path =
    card.querySelector<HTMLElement>(
      '[data-github-share-path]',
    );
  const note =
    card.querySelector<HTMLElement>(
      '[data-github-share-note]',
    );
  const close =
    card.querySelector<HTMLButtonElement>(
      '[data-github-share-close]',
    );
  const copy =
    card.querySelector<HTMLButtonElement>(
      '[data-github-share-copy]',
    );
  const open =
    card.querySelector<HTMLButtonElement>(
      '[data-github-share-open]',
    );

  if (
    !title
      || !repo
      || !path
      || !note
      || !close
      || !copy
      || !open
  ) {
    card.remove();
    return;
  }

  let currentLocation:
    GitHubLocation | null = null;
  let loading = false;

  const setStatus = (
    message: string,
  ): void => {
    const tutorStatus =
      document.querySelector<HTMLElement>(
        '#tutor-status',
      );

    if (tutorStatus) {
      tutorStatus.textContent = message;
    }
  };

  const openInIde =
    async (
      location: GitHubLocation,
    ): Promise<void> => {
      if (loading) {
        return;
      }

      loading = true;
      open.disabled = true;
      open.textContent = '读取仓库中…';
      title.textContent =
        'GitHub 正在导入';
      note.textContent =
        '正在读取仓库文件树。公开仓库不需要登录。';
      setStatus(
        `GitHub · 正在读取 ${location.repository}…`,
      );

      try {
        const result =
          await loadGitHubRepository(
            location,
          );

        window.dispatchEvent(
          new CustomEvent(
            'android-project-snapshot',
            {
              detail: {
                rootPath:
                  `github://${location.repository}@${result.ref}`,
                projectName:
                  `${location.repo} · GitHub`,
                files: result.files,
                directories: [],
                preferredFile:
                  result.preferredFile,
                message:
                  `✓ GitHub · ${location.repository} · ${result.ref} · ${result.files.length} 个代码文件 · 只读`,
              },
            },
          ),
        );

        title.textContent =
          'GitHub 已在 IDE 打开';
        note.textContent =
          `${result.files.length} 个代码文件 · ${result.ref} · 当前为只读阅读模式。`;
        open.textContent = '重新载入';
        setStatus(
          `✓ GitHub · ${location.repository} · ${result.files.length} 个代码文件`,
        );
      } catch (error) {
        remoteSession = null;
        const message =
          error instanceof Error
            ? error.message
            : 'GitHub 仓库读取失败';

        title.textContent =
          'GitHub 导入失败';
        note.textContent = message;
        open.textContent = '重试';
        setStatus(message);
      } finally {
        loading = false;
        open.disabled = false;
      }
    };

  const present = (
    value: string,
  ): void => {
    const location =
      parseGitHubLocation(value);

    if (!location) {
      return;
    }

    currentLocation = location;
    repo.textContent =
      location.repository;
    path.textContent =
      location.displayPath;
    title.textContent =
      'GitHub 已连接';
    note.textContent =
      '正在把这个 GitHub 仓库直接载入 IDE…';
    open.textContent =
      '在 IDE 打开';
    card.hidden = false;

    void openInIde(location);
  };

  close.addEventListener(
    'click',
    () => {
      card.hidden = true;
    },
  );

  copy.addEventListener(
    'click',
    async () => {
      if (!currentLocation) {
        return;
      }

      try {
        await navigator.clipboard.writeText(
          currentLocation.url,
        );
        copy.textContent = '✓ 已复制';
        window.setTimeout(() => {
          copy.textContent = '复制链接';
        }, 1200);
      } catch {
        window.alert(
          currentLocation.url,
        );
      }
    },
  );

  open.addEventListener(
    'click',
    () => {
      if (currentLocation) {
        void openInIde(
          currentLocation,
        );
      }
    },
  );

  window.addEventListener(
    'ai-ide-github-url',
    (event) => {
      const customEvent =
        event as CustomEvent<{
          url?: string;
        }> & {
          url?: string;
        };

      present(
        customEvent.detail?.url
          ?? customEvent.url
          ?? '',
      );
    },
  );

  void AndroidProject
    .takePendingGitHubUrl()
    .then(
      (result) =>
        present(result.url ?? ''),
    )
    .catch(() => {
      // Non-fatal: normal IDE startup must keep working.
    });
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    installGitHubShareReceiver,
    { once: true },
  );
} else {
  installGitHubShareReceiver();
}
