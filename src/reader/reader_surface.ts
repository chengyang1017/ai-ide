import {
  Capacitor,
} from '@capacitor/core';

import type {
  EditorController,
  SelectedCode,
} from '../editor/editor_controller';
import { monaco } from '../editor/monaco_setup';
import './reader_surface.css';

export interface ReaderViewportDetail {
  filePath: string;
  startLine: number;
  endLine: number;
  centerLine: number;
}

type SurfaceMode = 'reader' | 'editor';

const MODE_STORAGE_KEY =
  'ai-code-tutor.reader-surface-mode';

function readSavedMode():
  SurfaceMode | null {
  const value =
    localStorage.getItem(
      MODE_STORAGE_KEY,
    );

  return value === 'reader'
      || value === 'editor'
    ? value
    : null;
}

function isRemoteGitHubProject():
  boolean {
  const root =
    document.querySelector<HTMLElement>(
      '#project-root',
    )?.textContent?.trim()
      ?? '';

  return root.startsWith(
    'github://',
  );
}

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element =
    root.querySelector<T>(
      selector,
    );

  if (!element) {
    throw new Error(
      `Missing reader element: ${selector}`,
    );
  }

  return element;
}

function createLineNumbers(
  lineCount: number,
): DocumentFragment {
  const fragment =
    document.createDocumentFragment();

  for (
    let line = 1;
    line <= lineCount;
    line += 1
  ) {
    const number =
      document.createElement('span');
    number.textContent =
      String(line);
    fragment.append(number);
  }

  return fragment;
}

function replaceBreaksWithNewlines(
  fragment: DocumentFragment,
): void {
  for (
    const br of fragment
      .querySelectorAll('br')
  ) {
    br.replaceWith(
      document.createTextNode('\n'),
    );
  }
}

function textOffsetWithin(
  container: Node,
  node: Node,
  offset: number,
): number | null {
  if (
    node !== container
      && !container.contains(node)
  ) {
    return null;
  }

  const range =
    document.createRange();

  range.selectNodeContents(
    container,
  );

  try {
    range.setEnd(
      node,
      offset,
    );
  } catch {
    return null;
  }

  return range
    .toString()
    .length;
}

function positionFromOffset(
  source: string,
  offset: number,
): {
  line: number;
  column: number;
} {
  const safeOffset =
    Math.max(
      0,
      Math.min(
        source.length,
        offset,
      ),
    );

  const before =
    source.slice(
      0,
      safeOffset,
    );

  const lastNewline =
    before.lastIndexOf('\n');

  const line =
    before.length === 0
      ? 1
      : before
          .split('\n')
          .length;

  const column =
    safeOffset
      - lastNewline;

  return {
    line,
    column:
      Math.max(
        1,
        column,
      ),
  };
}

export function installReaderSurface(
  editorController: EditorController,
): () => void {
  const editorStage =
    document.querySelector<HTMLElement>(
      '#editor-stage',
    );

  const tabbar =
    document.querySelector<HTMLElement>(
      '.editor-tabbar',
    );

  if (!editorStage || !tabbar) {
    throw new Error(
      'Reader Surface requires #editor-stage and .editor-tabbar.',
    );
  }

  const existing =
    editorStage.querySelector(
      '.reader-surface',
    );

  if (existing) {
    return () => {};
  }

  const editor =
    editorController.editor;

  const control =
    document.createElement('div');
  control.className =
    'reader-mode-control';
  control.setAttribute(
    'role',
    'group',
  );
  control.setAttribute(
    'aria-label',
    '阅读或编辑代码',
  );

  const readerButton =
    document.createElement('button');
  readerButton.type = 'button';
  readerButton.className =
    'reader-mode-button';
  readerButton.textContent =
    '📖 阅读';

  const editorButton =
    document.createElement('button');
  editorButton.type = 'button';
  editorButton.className =
    'reader-mode-button';
  editorButton.textContent =
    '✏ 编辑';

  control.append(
    readerButton,
    editorButton,
  );

  const workspaceBadge =
    document.querySelector<HTMLElement>(
      '#workspace-badge',
    );

  if (workspaceBadge) {
    workspaceBadge.before(
      control,
    );
  } else {
    tabbar.append(
      control,
    );
  }

  const surface =
    document.createElement('section');
  surface.className =
    'reader-surface';
  surface.hidden = true;
  surface.setAttribute(
    'aria-label',
    '代码阅读模式',
  );

  surface.innerHTML = `
    <div class="reader-scroll" data-reader-scroll>
      <pre
        class="reader-line-numbers"
        data-reader-lines
        aria-hidden="true"
      ></pre>
      <pre
        class="reader-code"
        data-reader-code
      ><code data-reader-code-content></code></pre>
    </div>
  `;

  const scroll =
    requireElement<HTMLElement>(
      surface,
      '[data-reader-scroll]',
    );
  const lineNumbers =
    requireElement<HTMLElement>(
      surface,
      '[data-reader-lines]',
    );
  const code =
    requireElement<HTMLElement>(
      surface,
      '[data-reader-code-content]',
    );

  const memorizeButton =
    document.createElement('button');
  memorizeButton.type = 'button';
  memorizeButton.className =
    'reader-memorize-entry';
  memorizeButton.textContent =
    '✍ 默写';
  memorizeButton.hidden = true;
  memorizeButton.setAttribute(
    'aria-label',
    '默写阅读模式中选中的代码',
  );

  editorStage.append(
    surface,
    memorizeButton,
  );

  const defaultMode:
    SurfaceMode =
      Capacitor.getPlatform()
        === 'android'
        ? 'reader'
        : 'editor';

  let requestedMode:
    SurfaceMode =
      readSavedMode()
        ?? defaultMode;

  let effectiveMode:
    SurfaceMode = 'editor';

  let currentContent = '';
  let currentLanguage =
    'plaintext';
  let renderSequence = 0;
  let selectionPayload:
    SelectedCode | null = null;
  let viewportFrame = 0;

  const setStatus = (
    message: string,
  ): void => {
    const status =
      document.querySelector<HTMLElement>(
        '#tutor-status',
      );

    if (status) {
      status.textContent =
        message;
    }
  };

  const syncBackground =
    (): void => {
      const editorDom =
        editor.getDomNode();

      if (!editorDom) {
        return;
      }

      const monacoRoot =
        editorDom.querySelector<HTMLElement>(
          '.monaco-editor',
        );

      const source =
        monacoRoot
          ?? editorDom;

      const computed =
        getComputedStyle(
          source,
        );

      surface.style.setProperty(
        '--reader-surface-bg',
        computed.backgroundColor
          || '#111318',
      );
    };

  const renderCurrentFile =
    async (): Promise<void> => {
      const model =
        editor.getModel();

      const sequence =
        ++renderSequence;

      currentContent =
        model?.getValue()
          ?? '';

      currentLanguage =
        model?.getLanguageId()
          ?? 'plaintext';

      const lineCount =
        Math.max(
          1,
          currentContent
            .split('\n')
            .length,
        );

      lineNumbers.replaceChildren(
        createLineNumbers(
          lineCount,
        ),
      );

      try {
        const html =
          await monaco.editor.colorize(
            currentContent,
            currentLanguage,
            {
              tabSize: 2,
            },
          );

        if (
          sequence
            !== renderSequence
        ) {
          return;
        }

        const template =
          document.createElement(
            'template',
          );

        template.innerHTML =
          html;

        replaceBreaksWithNewlines(
          template.content,
        );

        code.replaceChildren(
          template.content
            .cloneNode(true),
        );
      } catch {
        if (
          sequence
            !== renderSequence
        ) {
          return;
        }

        code.textContent =
          currentContent;
      }

      syncBackground();
      syncSelection();
      scheduleViewportEvent();
    };

  const lineHeight =
    (): number => {
      const value =
        Number.parseFloat(
          getComputedStyle(
            code,
          ).lineHeight,
        );

      return Number.isFinite(value)
        && value > 0
        ? value
        : 24;
    };

  const currentViewport =
    (): ReaderViewportDetail => {
      const count =
        Math.max(
          1,
          currentContent
            .split('\n')
            .length,
        );

      const height =
        lineHeight();

      const startLine =
        Math.max(
          1,
          Math.min(
            count,
            Math.floor(
              scroll.scrollTop
                / height,
            ) + 1,
          ),
        );

      const visibleLines =
        Math.max(
          1,
          Math.ceil(
            scroll.clientHeight
              / height,
          ),
        );

      const endLine =
        Math.max(
          startLine,
          Math.min(
            count,
            startLine
              + visibleLines
              - 1,
          ),
        );

      return {
        filePath:
          editorController.path,
        startLine,
        endLine,
        centerLine:
          Math.round(
            (
              startLine
                + endLine
            ) / 2,
          ),
      };
    };

  const emitViewport =
    (): void => {
      viewportFrame = 0;

      if (
        effectiveMode
          !== 'reader'
      ) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent<ReaderViewportDetail>(
          'ai-ide-reader-viewport',
          {
            detail:
              currentViewport(),
          },
        ),
      );
    };

  function scheduleViewportEvent():
    void {
    if (viewportFrame !== 0) {
      return;
    }

    viewportFrame =
      requestAnimationFrame(
        emitViewport,
      );
  }

  const revealReaderLine = (
    line: number,
  ): void => {
    const safeLine =
      Math.max(
        1,
        line,
      );

    scroll.scrollTop =
      Math.max(
        0,
        (
          safeLine - 1
        ) * lineHeight(),
      );

    scheduleViewportEvent();
  };

  const clearReaderSelection =
    (): void => {
      selectionPayload = null;
      memorizeButton.hidden = true;

      const selection =
        window.getSelection();

      if (
        selection
          && selection.rangeCount > 0
      ) {
        const range =
          selection.getRangeAt(0);

        if (
          code.contains(
            range.startContainer,
          )
            || code.contains(
              range.endContainer,
            )
        ) {
          selection.removeAllRanges();
        }
      }
    };

  const selectionFromDom =
    (): SelectedCode | null => {
      if (
        effectiveMode
          !== 'reader'
      ) {
        return null;
      }

      const selection =
        window.getSelection();

      if (
        !selection
          || selection.isCollapsed
          || selection.rangeCount === 0
      ) {
        return null;
      }

      const range =
        selection.getRangeAt(0);

      if (
        !code.contains(
          range.startContainer,
        )
          || !code.contains(
            range.endContainer,
          )
      ) {
        return null;
      }

      const startOffset =
        textOffsetWithin(
          code,
          range.startContainer,
          range.startOffset,
        );

      const endOffset =
        textOffsetWithin(
          code,
          range.endContainer,
          range.endOffset,
        );

      if (
        startOffset === null
          || endOffset === null
      ) {
        return null;
      }

      const safeStart =
        Math.max(
          0,
          Math.min(
            currentContent.length,
            startOffset,
          ),
        );

      const safeEnd =
        Math.max(
          safeStart,
          Math.min(
            currentContent.length,
            endOffset,
          ),
        );

      const selected =
        currentContent.slice(
          safeStart,
          safeEnd,
        );

      if (
        selected.trim().length
          === 0
      ) {
        return null;
      }

      const start =
        positionFromOffset(
          currentContent,
          safeStart,
        );

      const end =
        positionFromOffset(
          currentContent,
          safeEnd,
        );

      return {
        filePath:
          editorController.path,
        code: selected,
        startLine:
          start.line,
        startColumn:
          start.column,
        endLine:
          end.line,
        endColumn:
          end.column,
      };
    };

  const positionMemorizeButton =
    (): void => {
      if (
        !selectionPayload
          || effectiveMode
            !== 'reader'
      ) {
        memorizeButton.hidden =
          true;
        return;
      }

      const selection =
        window.getSelection();

      if (
        !selection
          || selection.rangeCount
            === 0
      ) {
        memorizeButton.hidden =
          true;
        return;
      }

      const rect =
        selection
          .getRangeAt(0)
          .getBoundingClientRect();

      const stageRect =
        editorStage
          .getBoundingClientRect();

      const left =
        Math.min(
          Math.max(
            12,
            rect.right
              - stageRect.left
              + 10,
          ),
          Math.max(
            12,
            editorStage.clientWidth
              - 104,
          ),
        );

      const preferredTop =
        rect.top
          - stageRect.top
          - 46;

      const top =
        preferredTop >= 10
          ? preferredTop
          : rect.bottom
              - stageRect.top
              + 10;

      memorizeButton.style.left =
        `${left}px`;
      memorizeButton.style.top =
        `${Math.max(
          10,
          top,
        )}px`;
      memorizeButton.hidden =
        false;
    };

  function syncSelection():
    void {
    selectionPayload =
      selectionFromDom();

    if (!selectionPayload) {
      memorizeButton.hidden =
        true;
      return;
    }

    positionMemorizeButton();
  }

  const setMode = async (
    next: SurfaceMode,
    announce: boolean,
  ): Promise<void> => {
    const remote =
      isRemoteGitHubProject();

    requestedMode =
      next;

    effectiveMode =
      remote
        ? 'reader'
        : next;

    localStorage.setItem(
      MODE_STORAGE_KEY,
      requestedMode,
    );

    readerButton.dataset.active =
      String(
        effectiveMode
          === 'reader',
      );
    editorButton.dataset.active =
      String(
        effectiveMode
          === 'editor',
      );

    readerButton.setAttribute(
      'aria-pressed',
      String(
        effectiveMode
          === 'reader',
      ),
    );
    editorButton.setAttribute(
      'aria-pressed',
      String(
        effectiveMode
          === 'editor',
      ),
    );

    editorButton.disabled =
      remote;

    editorButton.title =
      remote
        ? 'GitHub 在线仓库当前保持只读阅读模式'
        : '进入 Monaco 编辑模式';

    if (
      effectiveMode
        === 'reader'
    ) {
      const firstVisible =
        editor
          .getVisibleRanges()[0]
          ?.startLineNumber
          ?? 1;

      editorStage.dataset
        .editorSurface =
          'reader';

      surface.hidden = false;

      await renderCurrentFile();

      requestAnimationFrame(
        () => {
          revealReaderLine(
            firstVisible,
          );
        },
      );

      if (announce) {
        setStatus(
          remote
            ? '📖 GitHub 阅读模式 · 无输入光标与软键盘'
            : '📖 阅读模式 · 无输入光标与软键盘',
        );
      }

      return;
    }

    const readerLine =
      currentViewport()
        .startLine;

    editorStage.dataset
      .editorSurface =
        'editor';

    surface.hidden = true;
    clearReaderSelection();

    requestAnimationFrame(
      () => {
        editor.layout();
        editor.revealLineNearTop(
          readerLine,
        );
      },
    );

    if (announce) {
      setStatus(
        '✏ 编辑模式 · 点击代码后可以输入',
      );
    }
  };

  readerButton.addEventListener(
    'click',
    () => {
      void setMode(
        'reader',
        true,
      );
    },
  );

  editorButton.addEventListener(
    'click',
    () => {
      void setMode(
        'editor',
        true,
      );
    },
  );

  memorizeButton.addEventListener(
    'pointerdown',
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      const payload =
        selectionPayload;

      if (!payload) {
        return;
      }

      memorizeButton.hidden =
        true;

      window.dispatchEvent(
        new CustomEvent<SelectedCode>(
          'ai-ide-memorize-selection',
          {
            detail: {
              ...payload,
            },
          },
        ),
      );
    },
  );

  const onSelectionChange =
    (): void => {
      if (
        effectiveMode
          !== 'reader'
      ) {
        return;
      }

      syncSelection();
    };

  const onMemorizeClosed =
    (): void => {
      if (
        effectiveMode
          === 'reader'
      ) {
        requestAnimationFrame(
          syncSelection,
        );
      }
    };

  const modelDisposable =
    editor.onDidChangeModel(
      () => {
        clearReaderSelection();

        if (
          effectiveMode
            === 'reader'
        ) {
          void renderCurrentFile();
        }
      },
    );

  const contentDisposable =
    editor.onDidChangeModelContent(
      () => {
        if (
          effectiveMode
            === 'reader'
        ) {
          void renderCurrentFile();
        }
      },
    );

  document.addEventListener(
    'selectionchange',
    onSelectionChange,
  );

  window.addEventListener(
    'ai-ide-memorize-closed',
    onMemorizeClosed,
  );

  scroll.addEventListener(
    'scroll',
    () => {
      memorizeButton.hidden =
        true;
      scheduleViewportEvent();
    },
    {
      passive: true,
    },
  );

  const projectRoot =
    document.querySelector<HTMLElement>(
      '#project-root',
    );

  const rootObserver =
    projectRoot
      ? new MutationObserver(
          () => {
            void setMode(
              requestedMode,
              false,
            );
          },
        )
      : null;

  rootObserver?.observe(
    projectRoot!,
    {
      childList: true,
      subtree: true,
      characterData: true,
    },
  );

  void setMode(
    requestedMode,
    false,
  );

  return () => {
    renderSequence += 1;

    if (viewportFrame !== 0) {
      cancelAnimationFrame(
        viewportFrame,
      );
    }

    modelDisposable.dispose();
    contentDisposable.dispose();
    rootObserver?.disconnect();

    document.removeEventListener(
      'selectionchange',
      onSelectionChange,
    );

    window.removeEventListener(
      'ai-ide-memorize-closed',
      onMemorizeClosed,
    );

    control.remove();
    memorizeButton.remove();
    surface.remove();

    delete editorStage.dataset
      .editorSurface;

    editor.layout();
  };
}
