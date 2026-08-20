import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import './android_app_shell.css';

type AndroidPanel = 'project' | 'ai' | 'more';

function isVisible(element: HTMLElement): boolean {
  if (element.hidden) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function installAndroidAppShell(): boolean {
  if (Capacitor.getPlatform() !== 'android') return true;

  const shell = document.querySelector<HTMLElement>('.ide-shell');
  const commandbar = document.querySelector<HTMLElement>('.commandbar');
  const workspace = document.querySelector<HTMLElement>('.workspace');

  if (!shell || !commandbar || !workspace) return false;

  document.documentElement.dataset.androidApp = 'true';

  let bottomNav = document.querySelector<HTMLElement>('.android-bottom-nav');
  let sheet = document.querySelector<HTMLElement>('.android-action-sheet');

  if (!bottomNav || !sheet) {
    bottomNav = document.createElement('nav');
    bottomNav.className = 'android-bottom-nav';
    bottomNav.setAttribute('aria-label', 'Android 主导航');
    bottomNav.innerHTML = `
      <button type="button" data-android-nav="files"><span>☰</span><small>文件</small></button>
      <button type="button" data-android-nav="save" aria-label="&#20445;&#23384;&#24403;&#21069;&#25991;&#20214;"><span>&#128190;</span><small>&#20445;&#23384;</small></button>
      <button type="button" data-android-nav="project"><span>📂</span><small>项目</small></button>
      <button type="button" data-android-nav="collab"><span>👥</span><small>协作</small></button>
      <button type="button" data-android-nav="ai"><span>✨</span><small>AI</small></button>
      <button type="button" data-android-nav="more"><span>•••</span><small>更多</small></button>
    `;

    sheet = document.createElement('div');
    sheet.className = 'android-action-sheet';
    sheet.hidden = true;
    sheet.innerHTML = `
      <button type="button" class="android-sheet-backdrop" data-android-sheet-close aria-label="关闭操作面板"></button>
      <section class="android-sheet-card" role="dialog" aria-modal="true" aria-label="操作面板">
        <div class="android-sheet-handle"></div>
        <header class="android-sheet-header">
          <strong data-android-sheet-title>项目</strong>
          <button type="button" data-android-sheet-close aria-label="关闭">×</button>
        </header>
        <div class="android-sheet-panel" data-android-panel="project">
          <div class="android-sheet-slot" data-android-slot="project"></div>
        </div>
        <div class="android-sheet-panel" data-android-panel="ai" hidden>
          <div class="android-sheet-slot" data-android-slot="ai"></div>
        </div>
        <div class="android-sheet-panel" data-android-panel="more" hidden>
          <div class="android-sheet-slot" data-android-slot="more"></div>
        </div>
      </section>
    `;

    document.body.append(sheet, bottomNav);
  }

  if (!bottomNav || !sheet) return false;

  const nav = bottomNav;
  const actionSheet = sheet;
  const ideShell = shell;

  let editorToolbar =
    document.querySelector<HTMLElement>(
      '.android-editor-toolbar',
    );

  if (!editorToolbar) {
    editorToolbar =
      document.createElement('nav');
    editorToolbar.className =
      'android-editor-toolbar';
    editorToolbar.hidden = true;
    editorToolbar.setAttribute(
      'aria-label',
      'Touch editor tools',
    );

    editorToolbar.innerHTML = `
      <button type="button" data-android-edit="select"><span>&#10010;</span><small>\u9009\u53d6</small></button>
      <button type="button" data-android-edit="copy"><span>&#128203;</span><small>\u590d\u5236</small></button>
      <button type="button" data-android-edit="paste"><span>&#128221;</span><small>\u7c98\u8d34</small></button>
      <button type="button" data-android-edit="all"><span>A</span><small>\u5168\u9009</small></button>
      <button type="button" data-android-edit="undo"><span>&#8630;</span><small>\u64a4\u9500</small></button>
      <button type="button" data-android-edit="redo"><span>&#8631;</span><small>\u91cd\u505a</small></button>
    `;

    document.body.append(
      editorToolbar,
    );
  }

  const touchToolbar =
    editorToolbar;

  function setTouchSelectionActive(
    active: boolean,
  ): void {
    const button =
      touchToolbar
        .querySelector<HTMLButtonElement>(
          '[data-android-edit="select"]',
        );

    if (button) {
      button.dataset.active =
        String(active);
    }

    window.dispatchEvent(
      new CustomEvent(
        'ai-ide-editor-touch-select-toggle',
        {
          detail: {
            active,
          },
        },
      ),
    );
  }

  function syncEditorToolbar(): void {
    const stage =
      document.querySelector<HTMLElement>(
        '.editor-stage',
      );

    const visible =
      stage?.dataset.editorSurface
        === 'editor';

    touchToolbar.hidden =
      !visible;

    document.documentElement
      .dataset.androidEditorToolbar =
        String(visible);

    if (!visible) {
      setTouchSelectionActive(
        false,
      );
    }
  }

  if (
    touchToolbar.dataset.bound
      !== 'true'
  ) {
    touchToolbar.dataset.bound =
      'true';

    touchToolbar.addEventListener(
      'click',
      (event) => {
        const element =
          event.target as HTMLElement | null;

        const button =
          element?.closest<HTMLButtonElement>(
            '[data-android-edit]',
          );

        if (!button) {
          return;
        }

        const action =
          button.dataset.androidEdit;

        if (action === 'select') {
          setTouchSelectionActive(
            button.dataset.active
              !== 'true',
          );
          return;
        }

        if (action === 'copy') {
          window.dispatchEvent(
            new Event(
              'ai-ide-editor-copy-request',
            ),
          );
          return;
        }

        if (action === 'paste') {
          setTouchSelectionActive(
            false,
          );
          window.dispatchEvent(
            new Event(
              'ai-ide-editor-native-paste-request',
            ),
          );
          return;
        }

        if (action === 'all') {
          window.dispatchEvent(
            new Event(
              'ai-ide-editor-select-all',
            ),
          );
          return;
        }

        if (
          action === 'undo'
            || action === 'redo'
        ) {
          window.dispatchEvent(
            new CustomEvent(
              'ai-ide-editor-history',
              {
                detail: {
                  action,
                },
              },
            ),
          );
        }
      },
    );
  }

  const projectSlot = actionSheet.querySelector<HTMLElement>('[data-android-slot="project"]')!;
  const aiSlot = actionSheet.querySelector<HTMLElement>('[data-android-slot="ai"]')!;
  const moreSlot = actionSheet.querySelector<HTMLElement>('[data-android-slot="more"]')!;
  const sheetTitle = actionSheet.querySelector<HTMLElement>('[data-android-sheet-title]')!;

  function moveChildren(parent: HTMLElement | null, target: HTMLElement): void {
    if (!parent) return;
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.classList.contains('command-group-label')) continue;
      if (child.id === 'tutor-status') continue;
      if (target.contains(child)) continue;
      target.append(child);
    }
  }

  function syncControls(): void {
    moveChildren(
      document.querySelector<HTMLElement>('.command-group-project'),
      projectSlot,
    );
    moveChildren(
      document.querySelector<HTMLElement>('.command-group-ai'),
      aiSlot,
    );
    const navigateParent =
      document.querySelector<HTMLElement>('#jump-to-cursor')?.parentElement ?? null;
    moveChildren(navigateParent, moreSlot);
    moveChildren(
      document.querySelector<HTMLElement>('.titlebar-right'),
      moreSlot,
    );
  }

  function closeSheet(): void {
    actionSheet.hidden = true;
    actionSheet.classList.remove('is-open');
    for (const button of nav.querySelectorAll<HTMLButtonElement>('[data-android-nav]')) {
      button.dataset.active = 'false';
    }
  }

  function openPanel(panel: AndroidPanel): void {
    syncControls();
    for (const element of actionSheet.querySelectorAll<HTMLElement>('[data-android-panel]')) {
      element.hidden = element.dataset.androidPanel !== panel;
    }

    const titles: Record<AndroidPanel, string> = {
      project: '项目',
      ai: 'AI 导师',
      more: '更多工具',
    };
    sheetTitle.textContent = titles[panel];
    actionSheet.hidden = false;
    requestAnimationFrame(() => actionSheet.classList.add('is-open'));

    for (const button of nav.querySelectorAll<HTMLButtonElement>('[data-android-nav]')) {
      button.dataset.active = String(button.dataset.androidNav === panel);
    }
  }

  function toggleFiles(): void {
    closeSheet();
    document.querySelector<HTMLButtonElement>('.tablet-sidebar-toggle')?.click();
  }

  function openCollab(): void {
    closeSheet();
    const button = document.querySelector<HTMLButtonElement>('.reader-collab-open');
    if (button) {
      button.click();
      return;
    }
    openPanel('project');
  }

  if (nav.dataset.bound !== 'true') {
    nav.dataset.bound = 'true';

    nav.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('[data-android-nav]');
      if (!button) return;

      const action = button.dataset.androidNav;
      if (action === 'files') {
        toggleFiles();
      } else if (action === 'save') {
        closeSheet();
        window.dispatchEvent(
          new Event(
            'ai-ide-save-current-file',
          ),
        );
      } else if (action === 'collab') {
        openCollab();
      } else if (action === 'project' || action === 'ai' || action === 'more') {
        openPanel(action);
      }
    });

    actionSheet.addEventListener(
      'click',
      (event) => {
        const target =
          event.target as HTMLElement | null;

        if (
          target?.closest(
            [
              '.github-account-button',
              '.reader-collab-open',
              '#appearance-settings',
              '#set-api-key',
            ].join(','),
          )
        ) {
          closeSheet();
        }
      },
      true,
    );

    actionSheet.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;

      if (
        target?.closest(
          '[data-android-sheet-close]',
        )
      ) {
        closeSheet();
        return;
      }

      const action =
        target?.closest<HTMLElement>(
          [
            '.android-sheet-slot > button',
            '.android-sheet-slot .github-account-button',
            '.android-sheet-slot #open-project',
            '.android-sheet-slot #appearance-settings',
            '.android-sheet-slot #set-api-key',
            '.android-sheet-slot #explain-current-code',
            '.android-sheet-slot #semantic-ai-tour',
            '.android-sheet-slot #ai-tour',
            '.android-sheet-slot #jump-to-cursor',
            '.android-sheet-slot #find-related',
            '.android-sheet-slot #semantic-related',
            '.android-sheet-slot #voice-toggle',
          ].join(','),
        );

      if (action) {
        requestAnimationFrame(
          closeSheet,
        );
      }
    });

    window.addEventListener(
      'ai-ide-github-url',
      () => {
        if (!actionSheet.hidden) {
          closeSheet();
        }
      },
    );
  }

  syncControls();

  const editorStageForToolbar =
    document.querySelector<HTMLElement>(
      '.editor-stage',
    );

  if (
    editorStageForToolbar
      && editorStageForToolbar
        .dataset
        .androidEditorToolbarObserved
        !== 'true'
  ) {
    editorStageForToolbar
      .dataset
      .androidEditorToolbarObserved =
        'true';

    const editorToolbarObserver =
      new MutationObserver(
        syncEditorToolbar,
      );

    editorToolbarObserver.observe(
      editorStageForToolbar,
      {
        attributes: true,
        attributeFilter: [
          'data-editor-surface',
        ],
      },
    );
  }

  syncEditorToolbar();

  const overlayVisibilityObserver =
    new MutationObserver(() => {
      const visibleOverlay =
        document.querySelector(
          [
            '.github-account-modal:not([hidden])',
            '.reader-collab-modal:not([hidden])',
            '#appearance-modal:not([hidden])',
            '#api-key-modal:not([hidden])',
          ].join(','),
        );

      if (
        visibleOverlay
          && !actionSheet.hidden
      ) {
        closeSheet();
      }
    });

  overlayVisibilityObserver.observe(
    document.body,
    {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: [
        'hidden',
        'class',
      ],
    },
  );

  if (ideShell.dataset.androidShellObserved !== 'true') {
    ideShell.dataset.androidShellObserved = 'true';
    const observer = new MutationObserver(syncControls);
    observer.observe(commandbar, { childList: true, subtree: true });
  }

  function repairReaderViewport():
    void {
    const stage =
      document.querySelector<HTMLElement>(
        '.editor-stage',
      );

    const reader =
      document.querySelector<HTMLElement>(
        '.reader-surface:not([hidden])',
      );

    const scroller =
      reader?.querySelector<HTMLElement>(
        '.reader-scroll',
      );

    if (
      !stage
        || !reader
        || !scroller
    ) {
      return;
    }

    const stageHeight =
      Math.floor(
        stage.getBoundingClientRect()
          .height,
      );

    const scrollHeight =
      Math.floor(
        scroller.getBoundingClientRect()
          .height,
      );

    if (stageHeight < 120) {
      return;
    }

    if (
      scrollHeight
        >= stageHeight - 4
    ) {
      reader.style.removeProperty(
        'height',
      );
      reader.style.removeProperty(
        'max-height',
      );
      scroller.style.removeProperty(
        'height',
      );
      scroller.style.removeProperty(
        'max-height',
      );
      return;
    }

    const height =
      `${stageHeight}px`;

    reader.style.height =
      height;
    reader.style.maxHeight =
      height;
    scroller.style.height =
      height;
    scroller.style.maxHeight =
      height;
  }

  function scheduleReaderViewportRepair():
    void {
    requestAnimationFrame(
      () => {
        requestAnimationFrame(
          repairReaderViewport,
        );
      },
    );
  }

  function closeVisibleOverlay(): boolean {
    const selectors = [
      '.reader-collab-modal:not([hidden])',
      '.github-account-modal:not([hidden])',
      '.memorize-overlay:not([hidden])',
      '.modal-backdrop:not([hidden])',
      '.github-share-card:not([hidden])',
      '.desktop-github-modal:not([hidden])',
    ];

    for (const selector of selectors) {
      const nodes = document.querySelectorAll<HTMLElement>(selector);
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const overlay = nodes[index];
        if (!isVisible(overlay)) continue;

        const close = overlay.querySelector<HTMLElement>(
          [
            '[data-memorize-close]',
            '[data-github-close]',
            '[data-github-share-close]',
            '.reader-collab-close',
            '[aria-label="关闭"]',
            '.icon-button',
          ].join(','),
        );

        if (close) close.click();
        else overlay.hidden = true;
        return true;
      }
    }

    const details = document.querySelectorAll<HTMLDetailsElement>('details[open]');
    for (let index = details.length - 1; index >= 0; index -= 1) {
      const item = details[index];
      if (!isVisible(item)) continue;
      item.open = false;
      return true;
    }

    return false;
  }

  function closeSidebar(): boolean {
    if (!ideShell.classList.contains('tablet-sidebar-open')) return false;
    document.querySelector<HTMLButtonElement>('.tablet-sidebar-toggle')?.click();
    return true;
  }

  const editorStage =
    document.querySelector<HTMLElement>(
      '.editor-stage',
    );

  if (
    editorStage
      && editorStage.dataset
        .androidReaderViewportObserved
        !== 'true'
  ) {
    editorStage.dataset
      .androidReaderViewportObserved =
        'true';

    const readerResizeObserver =
      new ResizeObserver(
        scheduleReaderViewportRepair,
      );

    readerResizeObserver.observe(
      editorStage,
    );

    const readerMutationObserver =
      new MutationObserver(
        scheduleReaderViewportRepair,
      );

    readerMutationObserver.observe(
      editorStage,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'hidden',
          'data-editor-surface',
          'class',
        ],
      },
    );

    window.addEventListener(
      'android-project-snapshot',
      scheduleReaderViewportRepair,
    );

    window.addEventListener(
      'ai-ide-reader-reveal-line',
      scheduleReaderViewportRepair,
    );

    window.addEventListener(
      'resize',
      scheduleReaderViewportRepair,
    );

    window.addEventListener(
      'orientationchange',
      scheduleReaderViewportRepair,
    );

    scheduleReaderViewportRepair();
  }

  if (document.documentElement.dataset.androidBackBound !== 'true') {
    document.documentElement.dataset.androidBackBound = 'true';

    void App.addListener('backButton', () => {
      if (closeVisibleOverlay()) return;
      if (!actionSheet.hidden) {
        closeSheet();
        return;
      }
      if (closeSidebar()) return;
      void App.exitApp();
    });
  }

  return true;
}

function bootstrapAndroidAppShell(): void {
  if (Capacitor.getPlatform() !== 'android') return;
  if (installAndroidAppShell()) return;

  const observer = new MutationObserver(() => {
    if (installAndroidAppShell()) observer.disconnect();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  let attempts = 0;
  const retry = (): void => {
    attempts += 1;
    if (installAndroidAppShell()) {
      observer.disconnect();
      return;
    }
    if (attempts < 180) requestAnimationFrame(retry);
  };

  requestAnimationFrame(retry);
}

bootstrapAndroidAppShell();
