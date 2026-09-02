type EntryType = 'file' | 'directory';

type ExplorerEntry = {
  path: string;
  type: EntryType;
};

type ProjectSnapshot = {
  rootPath: string;
  projectName: string;
  files: string[];
  directories?: string[];
  lastOpenFile?: string;
};

type FileManagerBridge = {
  restoreProject?: () => Promise<ProjectSnapshot | null>;
  moveProjectEntry?: (
    sourceRelativePath: string,
    targetDirectoryRelativePath: string,
  ) => Promise<{ from: string; to: string }>;
  deleteProjectEntry?: (
    relativePath: string,
  ) => Promise<{ path: string; type: EntryType }>;
};

const selected = new Map<string, ExplorerEntry>();
let selectionAnchor: ExplorerEntry | null = null;
let draggedEntries: ExplorerEntry[] = [];
let busy = false;

function keyOf(entry: ExplorerEntry): string {
  return `${entry.type}:${entry.path}`;
}

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
}

function parentPath(value: string): string {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

function bridge(): FileManagerBridge | null {
  const api = (
    window as Window & {
      tutorIde?: FileManagerBridge;
    }
  ).tutorIde;

  if (
    typeof api?.restoreProject !== 'function'
      || typeof api.moveProjectEntry !== 'function'
      || typeof api.deleteProjectEntry !== 'function'
  ) {
    return null;
  }

  return api;
}

function entryFromTarget(target: Element | null): ExplorerEntry | null {
  if (!target) {
    return null;
  }

  const file = target.closest<HTMLElement>('.file-item[data-path]');
  if (file?.dataset.path) {
    return {
      path: normalizePath(file.dataset.path),
      type: 'file',
    };
  }

  const directory = target.closest<HTMLElement>(
    '.directory-item[data-directory-path]',
  );
  if (directory?.dataset.directoryPath) {
    return {
      path: normalizePath(directory.dataset.directoryPath),
      type: 'directory',
    };
  }

  return null;
}

function entryContainsPath(entry: ExplorerEntry, filePath: string): boolean {
  if (entry.type === 'file') {
    return entry.path === filePath;
  }

  return filePath === entry.path || filePath.startsWith(`${entry.path}/`);
}

function currentActiveFile(): string {
  return normalizePath(
    document.querySelector<HTMLElement>('#active-file')?.textContent?.trim()
      ?? '',
  );
}

function hasUnsavedChanges(): boolean {
  if (
    document.querySelector<HTMLElement>('#editor-tab-dot')?.dataset.dirty
      === 'true'
  ) {
    return true;
  }

  return document
    .querySelector<HTMLElement>('#editor-save-state')
    ?.textContent?.includes('未保存') ?? false;
}

function setStatus(message: string): void {
  const status = document.querySelector<HTMLElement>('#tutor-status');
  if (status) {
    status.textContent = message;
  }
}

function elementForEntry(entry: ExplorerEntry): HTMLElement | null {
  const selector = entry.type === 'file'
    ? '.file-item[data-path]'
    : '.directory-item[data-directory-path]';

  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const path = entry.type === 'file'
      ? element.dataset.path
      : element.dataset.directoryPath;
    if (normalizePath(path ?? '') === entry.path) {
      return element;
    }
  }

  return null;
}

function repaintSelection(): void {
  for (
    const element of document.querySelectorAll<HTMLElement>(
      '.file-item[data-path], .directory-item[data-directory-path]',
    )
  ) {
    delete element.dataset.fileManagerSelected;
  }

  for (const entry of selected.values()) {
    const element = elementForEntry(entry);
    if (element) {
      element.dataset.fileManagerSelected = 'true';
    }
  }
}

function replaceSelection(entry: ExplorerEntry): void {
  selected.clear();
  selected.set(keyOf(entry), entry);
  selectionAnchor = entry;
  repaintSelection();
}

function toggleSelection(entry: ExplorerEntry): void {
  const key = keyOf(entry);
  if (selected.has(key)) {
    selected.delete(key);
  } else {
    selected.set(key, entry);
  }

  selectionAnchor = entry;
  repaintSelection();
  setStatus(
    selected.size > 1
      ? `已选择 ${selected.size} 个项目`
      : selected.size === 1
        ? `已选择 ${entry.path}`
        : '已取消选择',
  );
}

function topLevelEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
  return entries.filter((entry, index, all) => {
    return !all.some((candidate, candidateIndex) => {
      if (
        index === candidateIndex
          || candidate.type !== 'directory'
      ) {
        return false;
      }

      return entry.path.startsWith(`${candidate.path}/`);
    });
  });
}

function selectedEntriesFor(entry?: ExplorerEntry): ExplorerEntry[] {
  if (entry && !selected.has(keyOf(entry))) {
    return [entry];
  }

  const entries = Array.from(selected.values());
  return topLevelEntries(entries.length > 0 ? entries : entry ? [entry] : []);
}

function ensureSafeToMutate(entries: ExplorerEntry[]): boolean {
  const activeFile = currentActiveFile();
  if (
    hasUnsavedChanges()
      && activeFile
      && entries.some((entry) => entryContainsPath(entry, activeFile))
  ) {
    window.alert(
      '这个操作会影响当前未保存的文件。请先按 Ctrl+S 保存，再继续。',
    );
    return false;
  }

  return true;
}

function visibleDirectories(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.directory-item[data-directory-path]',
    ),
  )
    .map((element) => normalizePath(element.dataset.directoryPath ?? ''))
    .filter(Boolean);
}

async function refreshExplorer(
  message: string,
  preferredFile?: string,
): Promise<void> {
  const api = bridge();
  if (!api?.restoreProject) {
    throw new Error('文件管理桥接未就绪');
  }

  const snapshot = await api.restoreProject();
  if (!snapshot) {
    throw new Error('项目刷新失败，请重新打开项目');
  }

  const directories = new Set<string>([
    ...(snapshot.directories ?? []),
    ...visibleDirectories(),
  ]);

  window.dispatchEvent(
    new CustomEvent('android-project-snapshot', {
      detail: {
        ...snapshot,
        directories: Array.from(directories),
        preferredFile:
          preferredFile && snapshot.files.includes(preferredFile)
            ? preferredFile
            : undefined,
        message,
      },
    }),
  );
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

function dropTarget(
  target: Element | null,
  fileTree: HTMLElement,
): { path: string; visual: HTMLElement } | null {
  const directory = target?.closest<HTMLElement>(
    '.directory-item[data-directory-path]',
  );
  if (directory?.dataset.directoryPath) {
    return {
      path: normalizePath(directory.dataset.directoryPath),
      visual: directory,
    };
  }

  const file = target?.closest<HTMLElement>('.file-item[data-path]');
  if (file?.dataset.path) {
    return {
      path: parentPath(file.dataset.path),
      visual: file,
    };
  }

  if (!target || target === fileTree || target.closest('#file-tree') === fileTree) {
    return { path: '', visual: fileTree };
  }

  return null;
}

function destinationForMovedEntry(
  entry: ExplorerEntry,
  targetDirectory: string,
): string {
  const name = entry.path.split('/').filter(Boolean).pop() ?? entry.path;
  return targetDirectory ? `${targetDirectory}/${name}` : name;
}

function remapPathAfterMove(
  filePath: string,
  entry: ExplorerEntry,
  destination: string,
): string | null {
  if (entry.type === 'file') {
    return filePath === entry.path ? destination : null;
  }

  if (filePath === entry.path) {
    return destination;
  }

  if (filePath.startsWith(`${entry.path}/`)) {
    return destination + filePath.slice(entry.path.length);
  }

  return null;
}

async function deleteEntries(entries: ExplorerEntry[]): Promise<void> {
  if (busy || entries.length === 0 || !ensureSafeToMutate(entries)) {
    return;
  }

  const folders = entries.filter((entry) => entry.type === 'directory').length;
  const files = entries.length - folders;
  const warning = entries.length === 1
    ? entries[0].type === 'directory'
      ? `确定删除文件夹“${entries[0].path}”吗？\n\n文件夹内的所有文件和子文件夹都会一起删除。`
      : `确定删除文件“${entries[0].path}”吗？`
    : `确定删除选中的 ${entries.length} 个项目吗？\n\n文件 ${files} 个，文件夹 ${folders} 个。文件夹内容会一起删除。`;

  if (!window.confirm(warning)) {
    return;
  }

  const api = bridge();
  if (!api?.deleteProjectEntry) {
    return;
  }

  busy = true;
  const activeFile = currentActiveFile();
  const activeAffected = Boolean(
    activeFile && entries.some((entry) => entryContainsPath(entry, activeFile)),
  );

  try {
    for (const entry of entries) {
      await api.deleteProjectEntry(entry.path);
    }

    selected.clear();
    selectionAnchor = null;
    const message = entries.length === 1
      ? `✓ 已删除 · ${entries[0].path}`
      : `✓ 已删除 ${entries.length} 个项目`;

    const snapshot = await api.restoreProject?.();
    if (!snapshot) {
      throw new Error('项目刷新失败，请重新打开项目');
    }

    const preferredFile = activeAffected
      ? snapshot.files[0]
      : undefined;

    window.dispatchEvent(
      new CustomEvent('android-project-snapshot', {
        detail: {
          ...snapshot,
          directories: snapshot.directories ?? [],
          preferredFile,
          message,
        },
      }),
    );
    setStatus(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`✕ ${message}`);
    window.alert(message);
  } finally {
    busy = false;
  }
}

async function moveEntries(
  entries: ExplorerEntry[],
  targetDirectory: string,
): Promise<void> {
  if (busy || entries.length === 0 || !ensureSafeToMutate(entries)) {
    return;
  }

  const movable = entries.filter((entry) => {
    if (parentPath(entry.path) === targetDirectory) {
      return false;
    }
    if (
      entry.type === 'directory'
        && (
          targetDirectory === entry.path
            || targetDirectory.startsWith(`${entry.path}/`)
        )
    ) {
      return false;
    }
    return true;
  });

  if (movable.length === 0) {
    setStatus('所选项目已经在这个位置');
    return;
  }

  const api = bridge();
  if (!api?.moveProjectEntry) {
    return;
  }

  busy = true;
  const activeFile = currentActiveFile();
  let activeDestination: string | undefined;
  const movedSelections: ExplorerEntry[] = [];

  try {
    for (const entry of movable) {
      const result = await api.moveProjectEntry(entry.path, targetDirectory);
      const destination = normalizePath(result.to);
      movedSelections.push({ path: destination, type: entry.type });

      if (activeFile && !activeDestination) {
        activeDestination = remapPathAfterMove(
          activeFile,
          entry,
          destination,
        ) ?? undefined;
      }
    }

    selected.clear();
    for (const entry of movedSelections) {
      selected.set(keyOf(entry), entry);
    }
    selectionAnchor = movedSelections.at(-1) ?? null;

    const message = movable.length === 1
      ? `✓ 已移动 · ${movable[0].path} → ${movedSelections[0].path}`
      : `✓ 已移动 ${movable.length} 个项目`;

    await refreshExplorer(message, activeDestination);
    setStatus(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`✕ ${message}`);
    window.alert(message);
  } finally {
    busy = false;
    clearDropTargets();
  }
}

function removeContextMenu(): void {
  document.querySelector('.file-manager-context-menu')?.remove();
}

function addMenuButton(
  menu: HTMLElement,
  label: string,
  action: () => void,
  danger = false,
): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (danger) {
    button.className = 'file-manager-danger';
  }
  button.addEventListener('click', () => {
    removeContextMenu();
    action();
  });
  menu.append(button);
}

function openContextMenu(event: MouseEvent, entry: ExplorerEntry): void {
  if (!selected.has(keyOf(entry))) {
    replaceSelection(entry);
  } else {
    repaintSelection();
  }

  removeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'file-manager-context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  const entries = selectedEntriesFor(entry);
  if (entries.length === 1) {
    addMenuButton(menu, '＋ 新建文件', () => {});
    addMenuButton(menu, '＋ 新建文件夹', () => {});

    const divider = document.createElement('div');
    divider.className = 'file-manager-context-divider';
    menu.append(divider);
  }

  addMenuButton(
    menu,
    entries.length > 1
      ? `删除 ${entries.length} 个项目`
      : entries[0]?.type === 'directory'
        ? '删除文件夹'
        : '删除文件',
    () => {
      void deleteEntries(entries);
    },
    true,
  );

  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) {
    menu.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  }
  if (rect.bottom > window.innerHeight - 8) {
    menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  }
}

function install(): boolean {
  const fileTree = document.querySelector<HTMLElement>('#file-tree');
  if (!fileTree || !bridge()) {
    return false;
  }

  if (document.documentElement.dataset.projectFileMultiSelect === 'true') {
    return true;
  }
  document.documentElement.dataset.projectFileMultiSelect = 'true';

  fileTree.addEventListener(
    'click',
    (event) => {
      const entry = entryFromTarget(event.target as Element | null);
      if (!entry) {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        toggleSelection(entry);
        return;
      }

      replaceSelection(entry);
    },
    true,
  );

  fileTree.addEventListener(
    'contextmenu',
    (event) => {
      const entry = entryFromTarget(event.target as Element | null);
      if (!entry) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openContextMenu(event, entry);
    },
    true,
  );

  fileTree.addEventListener(
    'dragstart',
    (event) => {
      const entry = entryFromTarget(event.target as Element | null);
      if (!entry) {
        return;
      }

      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!selected.has(keyOf(entry))) {
        replaceSelection(entry);
      }
      draggedEntries = selectedEntriesFor(entry);
      event.dataTransfer?.setData('text/plain', entry.path);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    },
    true,
  );

  fileTree.addEventListener(
    'dragover',
    (event) => {
      if (draggedEntries.length === 0) {
        return;
      }

      const target = dropTarget(event.target as Element | null, fileTree);
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      clearDropTargets();
      target.visual.dataset.fileManagerDropTarget = 'true';
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    },
    true,
  );

  fileTree.addEventListener(
    'drop',
    (event) => {
      if (draggedEntries.length === 0) {
        return;
      }

      const target = dropTarget(event.target as Element | null, fileTree);
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const entries = draggedEntries;
      draggedEntries = [];
      clearDropTargets();
      void moveEntries(entries, target.path);
    },
    true,
  );

  fileTree.addEventListener(
    'dragend',
    (event) => {
      if (draggedEntries.length > 0) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      draggedEntries = [];
      clearDropTargets();
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.matches(
        'input, textarea, select, [contenteditable="true"]',
      ) ?? false;

      if (event.key !== 'Delete' || editable || selected.size === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void deleteEntries(selectedEntriesFor());
    },
    true,
  );

  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (!target?.closest('.file-manager-context-menu')) {
      removeContextMenu();
    }
  });

  const treeObserver = new MutationObserver(() => {
    repaintSelection();
  });
  treeObserver.observe(fileTree, { childList: true, subtree: true });

  const projectRoot = document.querySelector('#project-root');
  if (projectRoot) {
    new MutationObserver(() => {
      selected.clear();
      selectionAnchor = null;
      draggedEntries = [];
      repaintSelection();
      removeContextMenu();
    }).observe(projectRoot, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  return true;
}

function bootstrap(): void {
  if (install()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (install()) {
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
