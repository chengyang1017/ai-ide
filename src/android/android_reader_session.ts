import { Capacitor } from '@capacitor/core';

interface AndroidReaderSession {
  rootPath: string;
  filePath: string;
  line: number;
  column: number;
  updatedAt: number;
}

type AndroidReaderSessionStore =
  Record<string, AndroidReaderSession>;

const STORAGE_KEY =
  'ai-code-reader.android.reader-sessions.v1';
const MAX_PROJECT_SESSIONS = 12;
const RESTORE_RETRY_LIMIT = 50;
const RESTORE_RETRY_DELAY_MS = 80;

let pendingRestore:
  AndroidReaderSession | null = null;
let lastObservedRoot = '';

function isSession(
  value: unknown,
): value is AndroidReaderSession {
  if (
    !value
      || typeof value !== 'object'
  ) {
    return false;
  }

  const item =
    value as Record<string, unknown>;

  return (
    typeof item.rootPath === 'string'
      && typeof item.filePath === 'string'
      && typeof item.line === 'number'
      && Number.isFinite(item.line)
      && typeof item.column === 'number'
      && Number.isFinite(item.column)
      && typeof item.updatedAt === 'number'
      && Number.isFinite(item.updatedAt)
  );
}

function readStore():
  AndroidReaderSessionStore {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed =
      JSON.parse(raw) as unknown;

    if (
      !parsed
        || typeof parsed !== 'object'
        || Array.isArray(parsed)
    ) {
      return {};
    }

    const store:
      AndroidReaderSessionStore = {};

    for (
      const [rootPath, value]
      of Object.entries(parsed)
    ) {
      if (
        isSession(value)
          && value.rootPath === rootPath
      ) {
        store[rootPath] = value;
      }
    }

    return store;
  } catch {
    return {};
  }
}

function writeStore(
  store: AndroidReaderSessionStore,
): void {
  const entries =
    Object.values(store)
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt,
      )
      .slice(0, MAX_PROJECT_SESSIONS);

  const limited:
    AndroidReaderSessionStore = {};

  for (const session of entries) {
    limited[session.rootPath] = session;
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(limited),
  );
}

function loadSession(
  rootPath: string,
): AndroidReaderSession | null {
  if (!rootPath) {
    return null;
  }

  return readStore()[rootPath] ?? null;
}

function saveSession(
  session: AndroidReaderSession,
): void {
  if (
    !session.rootPath
      || !session.filePath
  ) {
    return;
  }

  const store = readStore();
  store[session.rootPath] = session;
  writeStore(store);
}

function projectRoot(): string {
  const value =
    document.querySelector<HTMLElement>(
      '#project-root',
    )?.textContent?.trim()
      ?? '';

  return value.startsWith('content://')
    ? value
    : '';
}

function activeFile(): string {
  return (
    document.querySelector<HTMLElement>(
      '#active-file',
    )?.textContent?.trim()
      ?? ''
  );
}

function projectFileExists(
  filePath: string,
): boolean {
  if (!filePath) {
    return false;
  }

  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.file-item[data-path]',
    ),
  ).some(
    (item) =>
      item.dataset.path === filePath,
  );
}

function currentPosition(): {
  line: number;
  column: number;
} | null {
  const value =
    document.querySelector<HTMLElement>(
      '#position-status',
    )?.textContent
      ?? '';

  const match =
    /Ln\s+(\d+)\s*,\s*Col\s+(\d+)/i
      .exec(value);

  if (!match) {
    return null;
  }

  return {
    line: Math.max(
      1,
      Number.parseInt(match[1], 10),
    ),
    column: Math.max(
      1,
      Number.parseInt(match[2], 10),
    ),
  };
}

function rememberActiveFile(): void {
  const rootPath = projectRoot();
  const filePath = activeFile();

  if (
    !rootPath
      || !projectFileExists(filePath)
  ) {
    return;
  }

  if (
    pendingRestore
      && pendingRestore.rootPath === rootPath
  ) {
    return;
  }

  const previous =
    loadSession(rootPath);

  saveSession({
    rootPath,
    filePath,
    line:
      previous?.filePath === filePath
        ? previous.line
        : 1,
    column:
      previous?.filePath === filePath
        ? previous.column
        : 1,
    updatedAt: Date.now(),
  });
}

function rememberPosition(): void {
  const rootPath = projectRoot();
  const filePath = activeFile();
  const position = currentPosition();

  if (
    !rootPath
      || !position
      || !projectFileExists(filePath)
  ) {
    return;
  }

  if (
    pendingRestore
      && pendingRestore.rootPath === rootPath
  ) {
    return;
  }

  saveSession({
    rootPath,
    filePath,
    line: position.line,
    column: position.column,
    updatedAt: Date.now(),
  });
}

function updateRestoreStatus(
  session: AndroidReaderSession,
): void {
  const status =
    document.querySelector<HTMLElement>(
      '#tutor-status',
    );

  if (!status) {
    return;
  }

  status.textContent =
    `✓ 已恢复阅读位置 · ${session.filePath}:${session.line}`;
}

function restoreSessionWhenReady(
  session: AndroidReaderSession,
): void {
  pendingRestore = session;
  let attempts = 0;

  const tryRestore = (): void => {
    if (
      projectRoot() !== session.rootPath
    ) {
      pendingRestore = null;
      return;
    }

    const workspaceReady =
      document.querySelector<HTMLElement>(
        '#workspace-badge',
      )?.textContent?.trim()
        === '真实项目';

    const fileReady =
      projectFileExists(session.filePath);

    if (
      !workspaceReady
        || !fileReady
    ) {
      attempts += 1;

      if (
        attempts >= RESTORE_RETRY_LIMIT
      ) {
        pendingRestore = null;
        rememberActiveFile();
        return;
      }

      window.setTimeout(
        tryRestore,
        RESTORE_RETRY_DELAY_MS,
      );
      return;
    }

    window.dispatchEvent(
      new CustomEvent(
        'ai-ide-reader-jump-request',
        {
          detail: {
            filePath: session.filePath,
            line: session.line,
            column: session.column,
            source: 'reader-session-restore',
          },
        },
      ),
    );

    window.setTimeout(
      () => {
        if (
          projectRoot() === session.rootPath
            && activeFile() === session.filePath
        ) {
          updateRestoreStatus(session);
        }

        pendingRestore = null;
      },
      450,
    );
  };

  window.setTimeout(
    tryRestore,
    RESTORE_RETRY_DELAY_MS,
  );
}

function handleProjectRootChange(): void {
  const rootPath = projectRoot();

  if (rootPath === lastObservedRoot) {
    return;
  }

  lastObservedRoot = rootPath;

  if (!rootPath) {
    pendingRestore = null;
    return;
  }

  const session = loadSession(rootPath);

  if (session) {
    restoreSessionWhenReady(session);
  }
}

function observeText(
  selector: string,
  onChange: () => void,
): MutationObserver | null {
  const element =
    document.querySelector<HTMLElement>(
      selector,
    );

  if (!element) {
    return null;
  }

  const observer =
    new MutationObserver(onChange);

  observer.observe(
    element,
    {
      childList: true,
      characterData: true,
      subtree: true,
    },
  );

  return observer;
}

function installReaderSessionTracking():
  boolean {
  if (
    document.documentElement
      .dataset.androidReaderSession
      === 'true'
  ) {
    return true;
  }

  const root =
    document.querySelector('#project-root');
  const file =
    document.querySelector('#active-file');
  const position =
    document.querySelector('#position-status');

  if (
    !root
      || !file
      || !position
  ) {
    return false;
  }

  document.documentElement
    .dataset.androidReaderSession =
      'true';

  observeText(
    '#project-root',
    handleProjectRootChange,
  );

  observeText(
    '#active-file',
    rememberActiveFile,
  );

  observeText(
    '#position-status',
    rememberPosition,
  );

  window.addEventListener(
    'pagehide',
    () => {
      rememberActiveFile();
      rememberPosition();
    },
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        rememberActiveFile();
        rememberPosition();
      }
    },
  );

  handleProjectRootChange();
  return true;
}

function bootstrapReaderSessionTracking():
  void {
  if (installReaderSessionTracking()) {
    return;
  }

  const observer =
    new MutationObserver(() => {
      if (installReaderSessionTracking()) {
        observer.disconnect();
      }
    });

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    },
  );
}

if (
  Capacitor.getPlatform() === 'android'
) {
  if (
    document.readyState === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      bootstrapReaderSessionTracking,
      { once: true },
    );
  } else {
    window.requestAnimationFrame(
      bootstrapReaderSessionTracking,
    );
  }
}
