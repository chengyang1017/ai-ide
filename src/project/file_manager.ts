import './file_manager.css';

type ProjectEntryType = 'file' | 'directory';

interface ProjectEntrySelection {
  path: string;
  type: ProjectEntryType;
}

interface FileManagerApi {
  createProjectFile(relativePath: string): Promise<{ path: string }>;
  createProjectDirectory(relativePath: string): Promise<{ path: string }>;
  moveProjectEntry(
    sourceRelativePath: string,
    targetDirectoryRelativePath: string,
  ): Promise<{ from: string; to: string }>;
  deleteProjectEntry(relativePath: string): Promise<{ path: string; type: ProjectEntryType }>;
}

const OPEN_AFTER_RELOAD_KEY =
  'ai-code-tutor.file-manager.open-after-reload';
const SELECT_AFTER_RELOAD_KEY =
  'ai-code-tutor.file-manager.select-after-reload';
const FLASH_AFTER_RELOAD_KEY =
  'ai-code-tutor.file-manager.flash-after-reload';

let selectedEntry: ProjectEntrySelection | null = null;
let draggedEntry: ProjectEntrySelection | null = null;
let busy = false;

function fileManagerApi(): FileManagerApi | null {
  const candidate = (
    window as Window & {
      tutorIde?: Partial<FileManagerApi>;
    }
  ).tutorIde;

  if (
    typeof candidate?.createProjectFile !== 'function'
      || typeof candidate.createProjectDirectory !== 'function'
      || typeof candidate.moveProjectEntry !== 'function'
      || typeof candidate.deleteProjectEntry !== 'function'
  ) {
    return null;
  }

  return candidate as FileManagerApi;
}

function normalizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
}

function pathDirectory(value: string): string {
  const normalized = normalizeRelativePath(value);
  const separator = normalized.lastIndexOf('/');
  return separator >= 0
    ? normalized.slice(0, separator)
    : '';
}

function joinRelativePath(
  directory: string,
  name: string,
): string {
  const normalizedDirectory =
    normalizeRelativePath(directory);

  return normalizedDirectory
    ? `${normalizedDirectory}/${name}`
    : name;
}

function isRealProjectOpen(): boolean {
  return (
    document.querySelector<HTMLElement>(
      '#workspace-badge',
    )?.textContent?.trim()
      === '真实项目'
  );
}

function setStatus(message: string): void {
  const status =
    document.querySelector<HTMLElement>(
      '#tutor-status',
    );

  if (status) {
    status.textContent = message;
  }
}

function setFlashAfterReload(message: string): void {
  sessionStorage.setItem(
    FLASH_AFTER_RELOAD_KEY,
    message,
  );
}

function showStoredFlash(): void {
  const message =
    sessionStorage.getItem(
      FLASH_AFTER_RELOAD_KEY,
    );

  if (!message) {
    return;
  }

  sessionStorage.removeItem(
    FLASH_AFTER_RELOAD_KEY,
  );
  setStatus(message);
}

function currentActiveFile(): string {
  return normalizeRelativePath(
    document.querySelector<HTMLElement>(
      '#active-file',
    )?.textContent?.trim()
      ?? '',
  );
}

function hasUnsavedChanges(): boolean {
  const dot =
    document.querySelector<HTMLElement>(
      '#editor-tab-dot',
    );

  if (dot?.dataset.dirty === 'true') {
    return true;
  }

  return (
    document.querySelector<HTMLElement>(
      '#editor-save-state',
    )?.textContent?.includes('未保存')
      ?? false
  );
}

function entryContainsPath(
  entry: ProjectEntrySelection,
  filePath: string,
): boolean {
  if (entry.type === 'file') {
    return filePath === entry.path;
  }

  return (
    filePath === entry.path
      || filePath.startsWith(
        `${entry.path}/`,
      )
  );
}

function ensureSafeToMutate(
  entry: ProjectEntrySelection,
): boolean {
  const activeFile = currentActiveFile();

  if (
    hasUnsavedChanges()
      && activeFile
      && entryContainsPath(entry, activeFile)
  ) {
    window.alert(
      '这个操作会影响当前未保存的文件。请先按 Ctrl+S 保存，再继续。',
    );
    return false;
  }

  return true;
}

function validEntryName(
  rawName: string,
): string | null {
  const name = rawName.trim();

  if (
    !name
      || name === '.'
      || name === '..'
      || /[<>:"/\\|?*\u0000-\u001F]/.test(name)
      || /[. ]$/.test(name)
  ) {
    return null;
  }

  const stem =
    name.split('.')[0]?.toUpperCase() ?? '';

  if (
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(
      stem,
    )
  ) {
    return null;
  }

  return name;
}

function selectedTargetDirectory(): string {
  if (!selectedEntry) {
    return '';
  }

  return selectedEntry.type === 'directory'
    ? selectedEntry.path
    : pathDirectory(selectedEntry.path);
}

function clearSelectionVisuals(): void {
  for (
    const element of document.querySelectorAll<HTMLElement>(
      '[data-file-manager-selected="true"]',
    )
  ) {
    delete element.dataset.fileManagerSelected;
  }
}

function markSelectedEntry(
  entry: ProjectEntrySelection | null,
): void {
  selectedEntry = entry;
  clearSelectionVisuals();

  if (!entry) {
    return;
  }

  const selector =
    entry.type === 'directory'
      ? '.directory-item'
      : '.file-item';

  for (
    const element of document.querySelectorAll<HTMLElement>(
      selector,
    )
  ) {
    const path =
      entry.type === 'directory'
        ? element.dataset.directoryPath
        : element.dataset.path;

    if (path === entry.path) {
      element.dataset.fileManagerSelected =
        'true';
      break;
    }
  }
}

function entryFromElement(
  element: Element | null,
): ProjectEntrySelection | null {
  if (!element) {
    return null;
  }

  const file =
    element.closest<HTMLElement>(
      '.file-item[data-path]',
    );

  if (file?.dataset.path) {
    return {
      path: file.dataset.path,
      type: 'file',
    };
  }

  const directory =
    element.closest<HTMLElement>(
      '.directory-item[data-directory-path]',
    );

  if (directory?.dataset.directoryPath) {
    return {
      path: directory.dataset.directoryPath,
      type: 'directory',
    };
  }

  return null;
}

function refreshDraggableEntries(): void {
  for (
    const element of document.querySelectorAll<HTMLElement>(
      '.file-item[data-path], .directory-item[data-directory-path]',
    )
  ) {
    element.draggable = true;
  }

  if (selectedEntry) {
    markSelectedEntry(selectedEntry);
  }
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;

  for (
    const button of document.querySelectorAll<HTMLButtonElement>(
      '.explorer-file-actions button',
    )
  ) {
    button.disabled = nextBusy;
  }
}

async function runMutation(
  action: () => Promise<void>,
): Promise<void> {
  if (busy) {
    return;
  }

  if (!isRealProjectOpen()) {
    window.alert('请先打开一个真实项目。');
    return;
  }

  setBusy(true);

  try {
    await action();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);
    setStatus(`✕ ${message}`);
    window.alert(message);
    setBusy(false);
  }
}

function promptForEntryName(
  label: string,
): string | null {
  const rawName = window.prompt(label, '');

  if (rawName === null) {
    return null;
  }

  const name = validEntryName(rawName);

  if (!name) {
    window.alert(
      '名称无效。不能使用路径分隔符、Windows 保留字符、保留设备名，也不能以空格或句点结尾。',
    );
    return null;
  }

  return name;
}

async function createFile(): Promise<void> {
  const api = fileManagerApi();
  if (!api) {
    return;
  }

  const name = promptForEntryName('新文件名称');
  if (!name) {
    return;
  }

  const relativePath =
    joinRelativePath(
      selectedTargetDirectory(),
      name,
    );

  await runMutation(async () => {
    await api.createProjectFile(relativePath);
    sessionStorage.setItem(
      OPEN_AFTER_RELOAD_KEY,
      relativePath,
    );
    setFlashAfterReload(
      `✓ 已新建文件 · ${relativePath}`,
    );
    window.location.reload();
  });
}

async function createDirectory(): Promise<void> {
  const api = fileManagerApi();
  if (!api) {
    return;
  }

  const name = promptForEntryName('新文件夹名称');
  if (!name) {
    return;
  }

  const relativePath =
    joinRelativePath(
      selectedTargetDirectory(),
      name,
    );

  await runMutation(async () => {
    await api.createProjectDirectory(
      relativePath,
    );
    sessionStorage.setItem(
      SELECT_AFTER_RELOAD_KEY,
      relativePath,
    );
    setFlashAfterReload(
      `✓ 已新建文件夹 · ${relativePath}`,
    );
    window.location.reload();
  });
}

async function deleteEntry(
  entry: ProjectEntrySelection,
): Promise<void> {
  const api = fileManagerApi();
  if (!api || !ensureSafeToMutate(entry)) {
    return;
  }

  const warning =
    entry.type === 'directory'
      ? `确定删除文件夹“${entry.path}”吗？\n\n文件夹内的所有文件和子文件夹都会一起删除。`
      : `确定删除文件“${entry.path}”吗？`;

  if (!window.confirm(warning)) {
    return;
  }

  await runMutation(async () => {
    await api.deleteProjectEntry(entry.path);
    setFlashAfterReload(
      `✓ 已删除 · ${entry.path}`,
    );
    window.location.reload();
  });
}

function remapActiveFileAfterMove(
  entry: ProjectEntrySelection,
  destinationPath: string,
): string | null {
  const activeFile = currentActiveFile();

  if (!activeFile) {
    return null;
  }

  if (entry.type === 'file') {
    return activeFile === entry.path
      ? destinationPath
      : null;
  }

  if (activeFile === entry.path) {
    return destinationPath;
  }

  if (
    activeFile.startsWith(
      `${entry.path}/`,
    )
  ) {
    return (
      destinationPath
        + activeFile.slice(entry.path.length)
    );
  }

  return null;
}

async function moveEntry(
  entry: ProjectEntrySelection,
  targetDirectory: string,
): Promise<void> {
  const api = fileManagerApi();
  if (!api || !ensureSafeToMutate(entry)) {
    return;
  }

  const currentParent = pathDirectory(entry.path);
  if (currentParent === targetDirectory) {
    setStatus('文件已经在这个文件夹里');
    return;
  }

  await runMutation(async () => {
    const result =
      await api.moveProjectEntry(
        entry.path,
        targetDirectory,
      );

    const activeDestination =
      remapActiveFileAfterMove(
        entry,
        result.to,
      );

    if (activeDestination) {
      sessionStorage.setItem(
        OPEN_AFTER_RELOAD_KEY,
        activeDestination,
      );
    } else {
      sessionStorage.setItem(
        SELECT_AFTER_RELOAD_KEY,
        result.to,
      );
    }

    setFlashAfterReload(
      `✓ 已移动 · ${result.from} → ${result.to}`,
    );
    window.location.reload();
  });
}

function clearDropTargets(): void {
  for (
    const element of document.querySelectorAll<HTMLElement>(
      '[data-file-manager-drop-target="true"]',
    )
  ) {
    delete element.dataset.fileManagerDropTarget;
  }
}

function dropDirectoryFromTarget(
  target: Element | null,
  fileTree: HTMLElement,
): {
  path: string;
  visual: HTMLElement;
} | null {
  if (!target) {
    return {
      path: '',
      visual: fileTree,
    };
  }

  const directory =
    target.closest<HTMLElement>(
      '.directory-item[data-directory-path]',
    );

  if (directory?.dataset.directoryPath) {
    return {
      path: directory.dataset.directoryPath,
      visual: directory,
    };
  }

  const file =
    target.closest<HTMLElement>(
      '.file-item[data-path]',
    );

  if (file?.dataset.path) {
    return {
      path: pathDirectory(file.dataset.path),
      visual: file,
    };
  }

  if (
    target === fileTree
      || target.closest('#file-tree') === fileTree
  ) {
    return {
      path: '',
      visual: fileTree,
    };
  }

  return null;
}

function removeContextMenu(): void {
  document.querySelector(
    '.file-manager-context-menu',
  )?.remove();
}

function addContextMenuButton(
  menu: HTMLElement,
  label: string,
  action: () => void,
  danger = false,
): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = danger
    ? 'file-manager-danger'
    : '';
  button.addEventListener('click', () => {
    removeContextMenu();
    action();
  });
  menu.append(button);
}

function openContextMenu(
  event: MouseEvent,
  entry: ProjectEntrySelection,
): void {
  removeContextMenu();
  markSelectedEntry(entry);

  const menu = document.createElement('div');
  menu.className = 'file-manager-context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  addContextMenuButton(
    menu,
    '＋ 新建文件',
    () => {
      void createFile();
    },
  );
  addContextMenuButton(
    menu,
    '＋ 新建文件夹',
    () => {
      void createDirectory();
    },
  );

  const divider = document.createElement('div');
  divider.className =
    'file-manager-context-divider';
  menu.append(divider);

  addContextMenuButton(
    menu,
    entry.type === 'directory'
      ? '删除文件夹'
      : '删除文件',
    () => {
      void deleteEntry(entry);
    },
    true,
  );

  document.body.append(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) {
    menu.style.left = `${Math.max(
      8,
      window.innerWidth - rect.width - 8,
    )}px`;
  }
  if (rect.bottom > window.innerHeight - 8) {
    menu.style.top = `${Math.max(
      8,
      window.innerHeight - rect.height - 8,
    )}px`;
  }
}

function restorePendingTreeTarget(): void {
  const openPath =
    sessionStorage.getItem(
      OPEN_AFTER_RELOAD_KEY,
    );
  const selectPath =
    sessionStorage.getItem(
      SELECT_AFTER_RELOAD_KEY,
    );

  if (openPath) {
    for (
      const item of document.querySelectorAll<HTMLButtonElement>(
        '.file-item[data-path]',
      )
    ) {
      if (item.dataset.path === openPath) {
        sessionStorage.removeItem(
          OPEN_AFTER_RELOAD_KEY,
        );
        markSelectedEntry({
          path: openPath,
          type: 'file',
        });
        item.click();
        return;
      }
    }
  }

  if (selectPath) {
    for (
      const item of document.querySelectorAll<HTMLButtonElement>(
        '.directory-item[data-directory-path]',
      )
    ) {
      if (
        item.dataset.directoryPath
          === selectPath
      ) {
        sessionStorage.removeItem(
          SELECT_AFTER_RELOAD_KEY,
        );
        markSelectedEntry({
          path: selectPath,
          type: 'directory',
        });
        if (
          item.dataset.expanded !== 'true'
        ) {
          item.click();
        }
        return;
      }
    }
  }
}

function installFileManager(): boolean {
  if (
    document.documentElement
      .dataset.projectFileManager
      === 'true'
  ) {
    return true;
  }

  if (!fileManagerApi()) {
    return false;
  }

  const sidebarTitle =
    document.querySelector<HTMLElement>(
      '.sidebar-title',
    );
  const fileTree =
    document.querySelector<HTMLElement>(
      '#file-tree',
    );

  if (!sidebarTitle || !fileTree) {
    return false;
  }

  document.documentElement
    .dataset.projectFileManager = 'true';

  const actions = document.createElement('div');
  actions.className = 'explorer-file-actions';
  actions.innerHTML = `
    <button type="button" data-file-action="new-file" title="在当前选中的文件夹中新增文件">＋ 文件</button>
    <button type="button" data-file-action="new-directory" title="在当前选中的文件夹中新增文件夹">＋ 文件夹</button>
  `;
  sidebarTitle.insertAdjacentElement(
    'afterend',
    actions,
  );

  actions
    .querySelector('[data-file-action="new-file"]')
    ?.addEventListener('click', () => {
      void createFile();
    });
  actions
    .querySelector('[data-file-action="new-directory"]')
    ?.addEventListener('click', () => {
      void createDirectory();
    });

  fileTree.addEventListener(
    'click',
    (event) => {
      const entry =
        entryFromElement(
          event.target as Element | null,
        );
      if (entry) {
        markSelectedEntry(entry);
      }
    },
    true,
  );

  fileTree.addEventListener(
    'contextmenu',
    (event) => {
      const entry =
        entryFromElement(
          event.target as Element | null,
        );
      if (!entry) {
        return;
      }
      event.preventDefault();
      openContextMenu(event, entry);
    },
  );

  fileTree.addEventListener(
    'dragstart',
    (event) => {
      const entry =
        entryFromElement(
          event.target as Element | null,
        );
      if (!entry) {
        return;
      }

      draggedEntry = entry;
      markSelectedEntry(entry);
      event.dataTransfer?.setData(
        'text/plain',
        entry.path,
      );
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed =
          'move';
      }
    },
  );

  fileTree.addEventListener(
    'dragover',
    (event) => {
      if (!draggedEntry) {
        return;
      }

      const target =
        dropDirectoryFromTarget(
          event.target as Element | null,
          fileTree,
        );
      if (!target) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect =
          'move';
      }
      clearDropTargets();
      target.visual.dataset.fileManagerDropTarget =
        'true';
    },
  );

  fileTree.addEventListener(
    'drop',
    (event) => {
      if (!draggedEntry) {
        return;
      }

      const target =
        dropDirectoryFromTarget(
          event.target as Element | null,
          fileTree,
        );
      if (!target) {
        return;
      }

      event.preventDefault();
      const entry = draggedEntry;
      draggedEntry = null;
      clearDropTargets();
      void moveEntry(entry, target.path);
    },
  );

  fileTree.addEventListener(
    'dragend',
    () => {
      draggedEntry = null;
      clearDropTargets();
    },
  );

  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (
      !target?.closest(
        '.file-manager-context-menu',
      )
    ) {
      removeContextMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const editable =
      target?.matches(
        'input, textarea, select, [contenteditable="true"]',
      )
        ?? false;

    if (
      event.key === 'Delete'
        && selectedEntry
        && !editable
    ) {
      event.preventDefault();
      void deleteEntry(selectedEntry);
    }
  });

  const treeObserver =
    new MutationObserver(() => {
      refreshDraggableEntries();
      restorePendingTreeTarget();
    });
  treeObserver.observe(fileTree, {
    childList: true,
    subtree: true,
  });

  const projectRoot =
    document.querySelector('#project-root');
  if (projectRoot) {
    new MutationObserver(() => {
      markSelectedEntry(null);
      removeContextMenu();
    }).observe(projectRoot, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  refreshDraggableEntries();
  restorePendingTreeTarget();
  showStoredFlash();
  return true;
}

function bootstrapFileManager(): void {
  if (installFileManager()) {
    return;
  }

  const observer =
    new MutationObserver(() => {
      if (installFileManager()) {
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

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    bootstrapFileManager,
    { once: true },
  );
} else {
  bootstrapFileManager();
}
