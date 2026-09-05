const SIDEBAR_WIDTH_STORAGE_KEY = 'code-tutor-studio.sidebar-width';
const DESKTOP_BREAKPOINT = 1180;
const DEFAULT_WIDTH = 230;
const MIN_WIDTH = 180;
const MAX_WIDTH = 520;

function clampWidth(value: number, workspaceWidth: number): number {
  const editorReserve = 420;
  const dynamicMax = Math.max(
    MIN_WIDTH,
    Math.min(MAX_WIDTH, workspaceWidth - editorReserve),
  );
  return Math.min(dynamicMax, Math.max(MIN_WIDTH, value));
}

function readSavedWidth(): number | null {
  const value = Number.parseFloat(
    window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? '',
  );
  return Number.isFinite(value) ? value : null;
}

export function installSidebarResizer(): void {
  const workspace = document.querySelector<HTMLElement>('.workspace');
  const sidebar = workspace?.querySelector<HTMLElement>(':scope > .sidebar');
  const editorPane = workspace?.querySelector<HTMLElement>(':scope > .editor-pane');

  if (!workspace || !sidebar || !editorPane) {
    return;
  }

  if (workspace.querySelector(':scope > .sidebar-resizer')) {
    return;
  }

  const applyWidth = (requested: number, persist: boolean): void => {
    if (window.innerWidth <= DESKTOP_BREAKPOINT) {
      return;
    }
    const width = clampWidth(requested, workspace.getBoundingClientRect().width);
    document.documentElement.style.setProperty('--sidebar-width', `${Math.round(width)}px`);
    if (persist) {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
    }
  };

  const savedWidth = readSavedWidth();
  if (savedWidth !== null) {
    applyWidth(savedWidth, false);
  }

  const resizer = document.createElement('div');
  resizer.className = 'sidebar-resizer';
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', 'Resize file explorer');
  resizer.tabIndex = 0;
  sidebar.after(resizer);

  let dragging = false;
  let pointerId = -1;

  const stopDragging = (): void => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('sidebar-resizing');
    if (pointerId >= 0 && resizer.hasPointerCapture(pointerId)) {
      resizer.releasePointerCapture(pointerId);
    }
    pointerId = -1;
  };

  resizer.addEventListener('pointerdown', (event) => {
    if (window.innerWidth <= DESKTOP_BREAKPOINT || event.button !== 0) {
      return;
    }
    dragging = true;
    pointerId = event.pointerId;
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add('sidebar-resizing');
    event.preventDefault();
  });

  resizer.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) {
      return;
    }
    const bounds = workspace.getBoundingClientRect();
    applyWidth(event.clientX - bounds.left, false);
  });

  resizer.addEventListener('pointerup', (event) => {
    if (!dragging || event.pointerId !== pointerId) {
      return;
    }
    const bounds = workspace.getBoundingClientRect();
    applyWidth(event.clientX - bounds.left, true);
    stopDragging();
  });

  resizer.addEventListener('pointercancel', stopDragging);
  resizer.addEventListener('dblclick', () => applyWidth(DEFAULT_WIDTH, true));

  resizer.addEventListener('keydown', (event) => {
    if (window.innerWidth <= DESKTOP_BREAKPOINT) {
      return;
    }
    const current = sidebar.getBoundingClientRect().width;
    const step = event.shiftKey ? 40 : 12;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applyWidth(current - step, true);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      applyWidth(current + step, true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      applyWidth(MIN_WIDTH, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      applyWidth(MAX_WIDTH, true);
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > DESKTOP_BREAKPOINT) {
      applyWidth(readSavedWidth() ?? sidebar.getBoundingClientRect().width, false);
    }
  });
}
