const TABLET_BREAKPOINT = 1180;
const COMPACT_BREAKPOINT = 820;

function syncTabletMode(): void {
  const root = document.documentElement;

  if (window.innerWidth <= TABLET_BREAKPOINT) {
    root.dataset.tabletUi = 'true';
    root.dataset.tabletSize =
      window.innerWidth <= COMPACT_BREAKPOINT
        ? 'compact'
        : 'large';
  } else {
    delete root.dataset.tabletUi;
    delete root.dataset.tabletSize;
  }
}

function installTabletSidebarControls(): boolean {
  const shell =
    document.querySelector<HTMLElement>('.ide-shell');
  const workspace =
    document.querySelector<HTMLElement>('.workspace');
  const sidebar =
    document.querySelector<HTMLElement>('.sidebar');
  const tabbar =
    document.querySelector<HTMLElement>('.editor-tabbar');

  if (!shell || !workspace || !sidebar || !tabbar) {
    return false;
  }

  let toggle =
    tabbar.querySelector<HTMLButtonElement>(
      '.tablet-sidebar-toggle',
    );

  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tablet-sidebar-toggle';
    toggle.textContent = '☰ 文件';
    toggle.setAttribute(
      'aria-label',
      '打开或关闭文件列表',
    );
    toggle.setAttribute(
      'aria-expanded',
      'false',
    );
    tabbar.prepend(toggle);
  }

  let backdrop =
    workspace.querySelector<HTMLButtonElement>(
      '.tablet-sidebar-backdrop',
    );

  if (!backdrop) {
    backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'tablet-sidebar-backdrop';
    backdrop.setAttribute(
      'aria-label',
      '关闭文件列表',
    );
    workspace.appendChild(backdrop);
  }

  if (toggle.dataset.bound === 'true') {
    return true;
  }

  toggle.dataset.bound = 'true';

  const closeSidebar = (): void => {
    shell.classList.remove('tablet-sidebar-open');
    toggle?.setAttribute('aria-expanded', 'false');
  };

  const openSidebar = (): void => {
    shell.classList.add('tablet-sidebar-open');
    toggle?.setAttribute('aria-expanded', 'true');
  };

  toggle.addEventListener('click', () => {
    if (shell.classList.contains('tablet-sidebar-open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  backdrop.addEventListener('click', closeSidebar);

  sidebar.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.file-item')) {
      closeSidebar();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      shell.classList.contains('tablet-sidebar-open')
    ) {
      closeSidebar();
    }
  });

  return true;
}

function bootstrapTabletUi(): void {
  syncTabletMode();

  if (installTabletSidebarControls()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (installTabletSidebarControls()) {
      observer.disconnect();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  let attempts = 0;
  const retry = (): void => {
    attempts += 1;
    if (installTabletSidebarControls()) {
      return;
    }
    if (attempts < 120) {
      requestAnimationFrame(retry);
    }
  };

  requestAnimationFrame(retry);
}

window.addEventListener('resize', () => {
  syncTabletMode();
  installTabletSidebarControls();
});

window.addEventListener('orientationchange', () => {
  syncTabletMode();
  installTabletSidebarControls();
});

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    bootstrapTabletUi,
    { once: true },
  );
} else {
  bootstrapTabletUi();
}
