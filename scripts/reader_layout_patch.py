from pathlib import Path

# 1) Desktop layout + Monaco gutter alignment
styles = Path('src/styles.css')
text = styles.read_text(encoding='utf-8')

if '--sidebar-width:' not in text:
    marker = '  --code-font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;\n\n  --code-tab-size: 2;'
    replacement = '''  --code-font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  --sidebar-width: 230px;
  --sidebar-min-width: 180px;
  --sidebar-max-width: 520px;
  --sidebar-resizer-width: 5px;

  --code-tab-size: 2;'''
    if marker not in text:
        raise SystemExit('root variable marker missing')
    text = text.replace(marker, replacement, 1)

old_workspace = '''.workspace {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  min-height: 0;
}'''
new_workspace = '''.workspace {
  display: grid;
  grid-template-columns:
    var(--sidebar-width)
    var(--sidebar-resizer-width)
    minmax(0, 1fr);
  min-height: 0;
}'''
if old_workspace in text:
    text = text.replace(old_workspace, new_workspace, 1)
elif 'var(--sidebar-resizer-width)' not in text:
    raise SystemExit('workspace marker missing')

if '.sidebar-resizer {' not in text:
    marker = '.sidebar-title {'
    block = '''.sidebar-resizer {
  position: relative;
  z-index: 50;
  width: var(--sidebar-resizer-width);
  min-width: var(--sidebar-resizer-width);
  cursor: col-resize;
  touch-action: none;
  background: transparent;
}

.sidebar-resizer::before {
  content: '';
  position: absolute;
  inset: 0 1px;
  background: transparent;
  transition: background 120ms ease;
}

.sidebar-resizer:hover::before,
body.sidebar-resizing .sidebar-resizer::before {
  background: rgb(124 92 255 / 55%);
}

body.sidebar-resizing {
  cursor: col-resize !important;
  user-select: none !important;
}

body.sidebar-resizing * {
  cursor: col-resize !important;
}

'''
    if marker not in text:
        raise SystemExit('sidebar CSS marker missing')
    text = text.replace(marker, block + marker, 1)

if '.editor .monaco-editor .margin-view-overlays .line-numbers {' not in text:
    marker = '''.editor {
  position: absolute;
  inset: 0;
}
'''
    block = '''.editor {
  position: absolute;
  inset: 0;
}

/* Keep Monaco line numbers on the exact same gutter baseline as Reader mode. */
.editor .monaco-editor .margin-view-overlays .line-numbers {
  left: 0 !important;
  width:
    calc(
      var(--code-gutter-width)
        - var(--code-line-number-right-padding)
    ) !important;
  padding: 0 !important;
  color: var(--code-line-number-color) !important;
  text-align: right !important;
  font-variant-numeric: tabular-nums;
}
'''
    if marker not in text:
        raise SystemExit('editor CSS marker missing')
    text = text.replace(marker, block, 1)

styles.write_text(text, encoding='utf-8')

# 2) Tablet/mobile sidebar remains overlay-only; desktop splitter is hidden.
tablet = Path('src/tablet.css')
text = tablet.read_text(encoding='utf-8')
if '  .sidebar-resizer {' not in text:
    marker = '''  .editor-pane {
    grid-column: 1 !important;
    min-width: 0;
    min-height: 0;
  }
'''
    replacement = marker + '''
  .sidebar-resizer {
    display: none !important;
  }
'''
    if marker not in text:
        raise SystemExit('tablet editor pane marker missing')
    text = text.replace(marker, replacement, 1)
tablet.write_text(text, encoding='utf-8')

# 3) Desktop resizable file explorer.
layout_dir = Path('src/layout')
layout_dir.mkdir(parents=True, exist_ok=True)
(layout_dir / 'sidebar_resizer.ts').write_text(r'''const SIDEBAR_WIDTH_STORAGE_KEY = 'code-tutor-studio.sidebar-width';
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
''', encoding='utf-8')

# 4) Shared viewport between Reader and Monaco + desktop per-file persistence.
reader_dir = Path('src/reader')
(reader_dir / 'reader_editor_view_sync.ts').write_text(r'''import { Capacitor } from '@capacitor/core';
import type { EditorController } from '../editor/editor_controller';

interface SavedViewport {
  top: number;
  left: number;
  line: number;
  column: number;
}

type SavedViewportMap = Record<string, SavedViewport>;

const VIEWPORT_STORAGE_KEY = 'code-tutor-studio.reader-editor-viewports';

function readSavedViewports(): SavedViewportMap {
  if (Capacitor.getPlatform() === 'android') {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIEWPORT_STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as SavedViewportMap : {};
  } catch {
    return {};
  }
}

export function installReaderEditorViewSync(
  editorController: EditorController,
  editorStage: HTMLElement,
  readerScroll: HTMLElement,
): void {
  const editor = editorController.editor;
  const saved = readSavedViewports();
  let sharedTop = editor.getScrollTop();
  let sharedLeft = editor.getScrollLeft();
  let sharedLine = editor.getPosition()?.lineNumber ?? 1;
  let sharedColumn = editor.getPosition()?.column ?? 1;
  let persistTimer = 0;

  const currentPath = (): string => editorController.path;
  const readerActive = (): boolean => editorStage.dataset.editorSurface === 'reader';

  const persist = (): void => {
    if (Capacitor.getPlatform() === 'android') {
      return;
    }
    const path = currentPath();
    if (!path) return;
    saved[path] = {
      top: Math.max(0, sharedTop),
      left: Math.max(0, sharedLeft),
      line: Math.max(1, sharedLine),
      column: Math.max(1, sharedColumn),
    };
    window.localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(saved));
  };

  const schedulePersist = (): void => {
    if (Capacitor.getPlatform() === 'android') {
      return;
    }
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      persist();
    }, 120);
  };

  const captureEditor = (): void => {
    sharedTop = editor.getScrollTop();
    sharedLeft = editor.getScrollLeft();
    const position = editor.getPosition();
    if (position) {
      sharedLine = position.lineNumber;
      sharedColumn = position.column;
    }
    schedulePersist();
  };

  const captureReader = (): void => {
    sharedTop = readerScroll.scrollTop;
    sharedLeft = readerScroll.scrollLeft;
    schedulePersist();
  };

  const restoreReader = (): void => {
    readerScroll.scrollTop = Math.max(0, sharedTop);
    readerScroll.scrollLeft = Math.max(0, sharedLeft);
  };

  const restoreEditor = (): void => {
    editor.setScrollTop(Math.max(0, sharedTop));
    editor.setScrollLeft(Math.max(0, sharedLeft));
    const model = editor.getModel();
    if (model) {
      const line = Math.min(Math.max(1, sharedLine), model.getLineCount());
      const column = Math.min(
        Math.max(1, sharedColumn),
        model.getLineMaxColumn(line),
      );
      editor.setPosition({ lineNumber: line, column });
    }
  };

  const loadForCurrentFile = (): void => {
    const state = saved[currentPath()];
    if (!state || Capacitor.getPlatform() === 'android') {
      captureEditor();
      return;
    }
    sharedTop = Number.isFinite(state.top) ? state.top : 0;
    sharedLeft = Number.isFinite(state.left) ? state.left : 0;
    sharedLine = Number.isFinite(state.line) ? state.line : 1;
    sharedColumn = Number.isFinite(state.column) ? state.column : 1;
    window.requestAnimationFrame(() => {
      if (readerActive()) restoreReader();
      else restoreEditor();
    });
  };

  editor.onDidScrollChange(() => {
    if (!readerActive()) captureEditor();
  });
  editor.onDidChangeCursorPosition(() => {
    if (!readerActive()) captureEditor();
  });
  editor.onDidChangeModel(loadForCurrentFile);

  readerScroll.addEventListener('scroll', () => {
    if (readerActive()) captureReader();
  }, { passive: true });

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.attributeName === 'data-editor-surface')) {
      return;
    }

    // setMode updates the dataset before its own layout/render work finishes.
    // Two RAFs let Monaco/Reader finish layout, then apply the same viewport.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (readerActive()) restoreReader();
        else restoreEditor();
      });
    });
  });

  observer.observe(editorStage, {
    attributes: true,
    attributeFilter: ['data-editor-surface'],
  });

  loadForCurrentFile();
}
''', encoding='utf-8')

# 5) Wire the helpers into Reader Surface with minimal intrusion.
reader = Path('src/reader/reader_surface.ts')
text = reader.read_text(encoding='utf-8')

if "import { installSidebarResizer } from '../layout/sidebar_resizer';" not in text:
    marker = "import { monaco } from '../editor/monaco_setup';\n"
    replacement = marker + "import { installSidebarResizer } from '../layout/sidebar_resizer';\nimport { installReaderEditorViewSync } from './reader_editor_view_sync';\n"
    if marker not in text:
        raise SystemExit('reader import marker missing')
    text = text.replace(marker, replacement, 1)

if 'installReaderEditorViewSync(' not in text:
    marker = '''  const focusLayer =
    requireElement<HTMLElement>(
      surface,
      '[data-reader-focus-layer]',
    );
'''
    replacement = marker + '''
  installSidebarResizer();
  installReaderEditorViewSync(
    editorController,
    editorStage,
    scroll,
  );
'''
    if marker not in text:
        raise SystemExit('reader focus layer marker missing')
    text = text.replace(marker, replacement, 1)

reader.write_text(text, encoding='utf-8')

print('reader/editor alignment, viewport sync and sidebar resize patch applied')
