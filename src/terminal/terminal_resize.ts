import './terminal_resize.css';

const STORAGE_KEY = 'ai-code-tutor.terminal.height';
const DEFAULT_HEIGHT = 260;
const MIN_TERMINAL_HEIGHT = 120;
const MIN_EDITOR_HEIGHT = 120;
const TAB_BAR_HEIGHT = 35;
const RESIZE_HANDLE_HEIGHT = 6;
const KEYBOARD_STEP = 20;

function storedHeight(): number {
  const value = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_HEIGHT;
}

function maximumHeight(editorPane: HTMLElement): number {
  const available =
    editorPane.getBoundingClientRect().height
      - TAB_BAR_HEIGHT
      - RESIZE_HANDLE_HEIGHT
      - MIN_EDITOR_HEIGHT;

  return Math.max(
    MIN_TERMINAL_HEIGHT,
    Math.floor(available),
  );
}

function clampHeight(
  editorPane: HTMLElement,
  requestedHeight: number,
): number {
  return Math.min(
    maximumHeight(editorPane),
    Math.max(
      MIN_TERMINAL_HEIGHT,
      Math.round(requestedHeight),
    ),
  );
}

function applyHeight(
  editorPane: HTMLElement,
  requestedHeight: number,
  persist = false,
): number {
  const height = clampHeight(
    editorPane,
    requestedHeight,
  );

  editorPane.style.setProperty(
    '--terminal-panel-height',
    `${height}px`,
  );

  if (persist) {
    localStorage.setItem(
      STORAGE_KEY,
      String(height),
    );
  }

  return height;
}

function currentHeight(editorPane: HTMLElement): number {
  const cssValue = getComputedStyle(editorPane)
    .getPropertyValue('--terminal-panel-height')
    .trim();
  const parsed = Number.parseFloat(cssValue);

  return Number.isFinite(parsed)
    ? parsed
    : storedHeight();
}

function installTerminalResize(): boolean {
  const editorPane =
    document.querySelector<HTMLElement>(
      '.editor-pane',
    );
  const terminalPanel =
    editorPane?.querySelector<HTMLElement>(
      '.terminal-panel',
    );

  if (!editorPane || !terminalPanel) {
    return false;
  }

  if (
    editorPane.querySelector(
      '.terminal-resize-handle',
    )
  ) {
    return true;
  }

  const handle = document.createElement('div');
  handle.className = 'terminal-resize-handle';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', '调整终端高度');
  handle.title = '上下拖动调整终端高度 · 双击恢复默认';

  terminalPanel.before(handle);
  applyHeight(editorPane, storedHeight());

  let dragging = false;
  let activePointerId: number | null = null;

  const stopDragging = (
    event?: PointerEvent,
  ): void => {
    if (!dragging) {
      return;
    }

    if (
      event
        && activePointerId !== null
        && event.pointerId !== activePointerId
    ) {
      return;
    }

    dragging = false;
    document.body.dataset.terminalResizing = 'false';

    if (
      activePointerId !== null
        && handle.hasPointerCapture(activePointerId)
    ) {
      handle.releasePointerCapture(activePointerId);
    }

    activePointerId = null;
    applyHeight(
      editorPane,
      currentHeight(editorPane),
      true,
    );
  };

  handle.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      dragging = true;
      activePointerId = event.pointerId;
      handle.setPointerCapture(event.pointerId);
      document.body.dataset.terminalResizing = 'true';
    },
  );

  handle.addEventListener(
    'pointermove',
    (event) => {
      if (
        !dragging
          || activePointerId !== event.pointerId
      ) {
        return;
      }

      const paneBottom =
        editorPane.getBoundingClientRect().bottom;
      applyHeight(
        editorPane,
        paneBottom - event.clientY,
      );
    },
  );

  handle.addEventListener(
    'pointerup',
    stopDragging,
  );
  handle.addEventListener(
    'pointercancel',
    stopDragging,
  );
  handle.addEventListener(
    'lostpointercapture',
    () => {
      if (dragging) {
        stopDragging();
      }
    },
  );

  handle.addEventListener(
    'dblclick',
    () => {
      applyHeight(
        editorPane,
        DEFAULT_HEIGHT,
        true,
      );
    },
  );

  handle.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== 'ArrowUp'
          && event.key !== 'ArrowDown'
          && event.key !== 'Home'
      ) {
        return;
      }

      event.preventDefault();

      if (event.key === 'Home') {
        applyHeight(
          editorPane,
          DEFAULT_HEIGHT,
          true,
        );
        return;
      }

      const direction =
        event.key === 'ArrowUp'
          ? 1
          : -1;
      applyHeight(
        editorPane,
        currentHeight(editorPane)
          + direction * KEYBOARD_STEP,
        true,
      );
    },
  );

  const resizeObserver = new ResizeObserver(() => {
    if (!dragging) {
      applyHeight(
        editorPane,
        currentHeight(editorPane),
      );
    }
  });
  resizeObserver.observe(editorPane);

  window.addEventListener(
    'beforeunload',
    () => {
      resizeObserver.disconnect();
    },
    { once: true },
  );

  return true;
}

function bootstrapTerminalResize(): void {
  if (installTerminalResize()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (installTerminalResize()) {
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
    bootstrapTerminalResize,
    { once: true },
  );
} else {
  bootstrapTerminalResize();
}
