import './file_manager_create_dialog.css';

type CreateKind = 'file' | 'directory';

type CreateBridge = {
  createProjectFile?: (
    relativePath: string,
  ) => Promise<{ path: string }>;
  createProjectDirectory?: (
    relativePath: string,
  ) => Promise<{ path: string }>;
};

const OPEN_AFTER_RELOAD_KEY =
  'ai-code-tutor.file-manager.open-after-reload';
const SELECT_AFTER_RELOAD_KEY =
  'ai-code-tutor.file-manager.select-after-reload';
const FLASH_AFTER_RELOAD_KEY =
  'ai-code-tutor.file-manager.flash-after-reload';

function bridge(): CreateBridge | null {
  const api = (
    window as Window & {
      tutorIde?: CreateBridge;
    }
  ).tutorIde;

  if (
    typeof api?.createProjectFile !== 'function'
      || typeof api.createProjectDirectory !== 'function'
  ) {
    return null;
  }

  return api;
}

function normalizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
}

function parentDirectory(value: string): string {
  const normalized = normalizeRelativePath(value);
  const index = normalized.lastIndexOf('/');
  return index >= 0
    ? normalized.slice(0, index)
    : '';
}

function selectedDirectory(): string {
  const selected = document.querySelector<HTMLElement>(
    '[data-file-manager-selected="true"]',
  );

  if (!selected) {
    return '';
  }

  const directory = selected.dataset.directoryPath;
  if (directory) {
    return normalizeRelativePath(directory);
  }

  const file = selected.dataset.path;
  return file
    ? parentDirectory(file)
    : '';
}

function joinPath(
  directory: string,
  name: string,
): string {
  return directory
    ? `${directory}/${name}`
    : name;
}

function validName(rawName: string): string | null {
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

function setStatus(message: string): void {
  const status = document.querySelector<HTMLElement>(
    '#tutor-status',
  );
  if (status) {
    status.textContent = message;
  }
}

function realProjectOpen(): boolean {
  return document.querySelector<HTMLElement>(
    '#workspace-badge',
  )?.textContent?.trim() === '真实项目';
}

function closeDialog(): void {
  document.querySelector(
    '.file-create-backdrop',
  )?.remove();
}

function showCreateDialog(kind: CreateKind): void {
  closeDialog();

  if (!realProjectOpen()) {
    setStatus('请先打开一个真实项目');
    return;
  }

  const api = bridge();
  if (!api) {
    setStatus('✕ 文件管理桥接未就绪');
    return;
  }

  const directory = selectedDirectory();
  const label = kind === 'file'
    ? '新建文件'
    : '新建文件夹';

  const backdrop = document.createElement('div');
  backdrop.className = 'file-create-backdrop';
  backdrop.innerHTML = `
    <section class="file-create-dialog" role="dialog" aria-modal="true">
      <h3>${label}</h3>
      <p>位置：${directory || '项目根目录'}</p>
      <input type="text" autocomplete="off" spellcheck="false" aria-label="${label}名称" />
      <div class="file-create-error" aria-live="polite"></div>
      <div class="file-create-actions">
        <button type="button" data-create-cancel>取消</button>
        <button type="button" data-create-confirm data-primary="true">创建</button>
      </div>
    </section>
  `;

  document.body.append(backdrop);

  const input = backdrop.querySelector<HTMLInputElement>(
    'input',
  );
  const error = backdrop.querySelector<HTMLElement>(
    '.file-create-error',
  );
  const confirm = backdrop.querySelector<HTMLButtonElement>(
    '[data-create-confirm]',
  );
  const cancel = backdrop.querySelector<HTMLButtonElement>(
    '[data-create-cancel]',
  );

  const submit = async (): Promise<void> => {
    if (!input || !error || !confirm || !cancel) {
      return;
    }

    const name = validName(input.value);
    if (!name) {
      error.textContent =
        '名称无效，请不要使用路径分隔符、Windows 保留字符或保留设备名。';
      input.focus();
      return;
    }

    const relativePath = joinPath(directory, name);
    confirm.disabled = true;
    cancel.disabled = true;
    input.disabled = true;
    error.textContent = '';
    setStatus(`正在${label} · ${relativePath}`);

    try {
      if (kind === 'file') {
        await api.createProjectFile!(relativePath);
        sessionStorage.setItem(
          OPEN_AFTER_RELOAD_KEY,
          relativePath,
        );
      } else {
        await api.createProjectDirectory!(
          relativePath,
        );
        sessionStorage.setItem(
          SELECT_AFTER_RELOAD_KEY,
          relativePath,
        );
      }

      sessionStorage.setItem(
        FLASH_AFTER_RELOAD_KEY,
        `✓ ${label}成功 · ${relativePath}`,
      );
      window.location.reload();
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : String(caught);
      error.textContent = message;
      setStatus(`✕ ${message}`);
      confirm.disabled = false;
      cancel.disabled = false;
      input.disabled = false;
      input.focus();
    }
  };

  cancel?.addEventListener('click', closeDialog);
  confirm?.addEventListener('click', () => {
    void submit();
  });

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      closeDialog();
    }
  });

  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  });

  window.requestAnimationFrame(() => {
    input?.focus();
  });
}

function actionFromClick(
  target: Element | null,
): CreateKind | null {
  if (!target) {
    return null;
  }

  const toolbarAction = target.closest<HTMLElement>(
    '[data-file-action]',
  )?.dataset.fileAction;

  if (toolbarAction === 'new-file') {
    return 'file';
  }
  if (toolbarAction === 'new-directory') {
    return 'directory';
  }

  const contextButton = target.closest<HTMLButtonElement>(
    '.file-manager-context-menu button',
  );
  const text = contextButton?.textContent?.trim() ?? '';

  if (text.includes('新建文件夹')) {
    return 'directory';
  }
  if (text.includes('新建文件')) {
    return 'file';
  }

  return null;
}

document.addEventListener(
  'click',
  (event) => {
    const kind = actionFromClick(
      event.target as Element | null,
    );
    if (!kind) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    showCreateDialog(kind);
  },
  true,
);
