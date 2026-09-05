import { Capacitor } from '@capacitor/core';
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
