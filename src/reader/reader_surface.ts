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

export interface ReaderFocusDetail {
  filePath: string;
  line: number;
  column: number;
}

export interface ReaderRemoteFocusDetail {
  peerId: string;
  name: string;
  focus: ReaderFocusDetail;
}

export interface ReaderSelectionDetail {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface ReaderRemoteSelectionDetail {
  peerId: string;
  name: string;
  selection: ReaderSelectionDetail;
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
        class="reader-code"
        data-reader-code
      ><code data-reader-code-content></code></pre>
    </div>
    <div
      class="reader-focus-layer"
      data-reader-focus-layer
      aria-hidden="true"
    ></div>
  `;

  const scroll =
    requireElement<HTMLElement>(
      surface,
      '[data-reader-scroll]',
    );
  const code =
    requireElement<HTMLElement>(
      surface,
      '[data-reader-code-content]',
    );

  const focusLayer =
    requireElement<HTMLElement>(
      surface,
      '[data-reader-focus-layer]',
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
  let localFocus:
    ReaderFocusDetail | null = null;
  let remoteFocuses:
    ReaderRemoteFocusDetail[] = [];
  let remoteSelections:
    ReaderRemoteSelectionDetail[] = [];
  let lastSharedSelectionKey = '';
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

  const sourceLines =
    (): string[] =>
      currentContent.split('\n');

  const lineElement = (
    line: number,
  ): HTMLElement | null =>
    code.querySelector<HTMLElement>(
      `.reader-code-line[data-line-number="${line}"]`,
    );

  const appendPlainLine = (
    line: HTMLElement,
    text: string,
  ): void => {
    line.textContent = text;
  };

  const renderCodeLines =
    (): void => {
      const lines =
        sourceLines();

      const model =
        editor.getModel();

      const editorDom =
        editor.getDomNode();

      const themeClasses =
        [
          'vs',
          'vs-dark',
          'hc-black',
          'hc-light',
        ];

      const fragment =
        document.createDocumentFragment();

      for (
        let index = 0;
        index < lines.length;
        index += 1
      ) {
        const row =
          document.createElement(
            'span',
          );

        row.className =
          'reader-code-line';

        row.dataset.lineNumber =
          String(index + 1);

        const number =
          document.createElement(
            'span',
          );

        number.className =
          'reader-line-number';

        number.dataset.lineNumber =
          String(index + 1);

        number.setAttribute(
          'aria-hidden',
          'true',
        );

        const content =
          document.createElement(
            'span',
          );

        content.className =
          'reader-line-content monaco-editor';

        for (
          const themeClass
            of themeClasses
        ) {
          if (
            editorDom?.classList
              .contains(
                themeClass,
              )
          ) {
            content.classList.add(
              themeClass,
            );
          }
        }

        const sourceLine =
          lines[index] ?? '';

        let rendered = false;

        if (
          model
            && index + 1
              <= model.getLineCount()
        ) {
          try {
            const html =
              monaco.editor
                .colorizeModelLine(
                  model,
                  index + 1,
                  2,
                );

            const template =
              document.createElement(
                'template',
              );

            template.innerHTML =
              html;

            content.append(
              template.content
                .cloneNode(true),
            );

            rendered = true;
          } catch {
            // Fall back to plain text for this line only.
          }
        }

        if (!rendered) {
          appendPlainLine(
            content,
            sourceLine,
          );
        }

        row.append(
          number,
          content,
        );

        fragment.append(row);
      }

      code.replaceChildren(
        fragment,
      );
    };

  const sourceOffsetFromDomPoint = (
    node: Node,
    offset: number,
  ): number | null => {
    const element =
      node instanceof Element
        ? node
        : node.parentElement;

    const row =
      element?.closest<HTMLElement>(
        '.reader-code-line',
      );

    if (
      !row
        || !code.contains(row)
    ) {
      return null;
    }

    const line =
      Number.parseInt(
        row.dataset.lineNumber
          ?? '',
        10,
      );

    if (
      !Number.isFinite(line)
        || line < 1
    ) {
      return null;
    }

    const content =
      row.querySelector<HTMLElement>(
        '.reader-line-content',
      );

    if (
      !content
        || !content.contains(node)
          && content !== node
    ) {
      return null;
    }

    const columnOffset =
      textOffsetWithin(
        content,
        node,
        offset,
      );

    if (columnOffset === null) {
      return null;
    }

    const lines =
      sourceLines();

    let sourceOffset = 0;

    for (
      let index = 0;
      index < line - 1;
      index += 1
    ) {
      sourceOffset +=
        (lines[index]?.length ?? 0)
          + 1;
    }

    return (
      sourceOffset
        + Math.min(
          lines[line - 1]
            ?.length
              ?? 0,
          columnOffset,
        )
    );
  };

  const domPointWithinLine = (
    line: number,
    columnOffset: number,
  ): {
    node: Text;
    offset: number;
  } | null => {
    const row =
      lineElement(line);

    if (!row) {
      return null;
    }

    const content =
      row.querySelector<HTMLElement>(
        '.reader-line-content',
      );

    if (!content) {
      return null;
    }

    const walker =
      document.createTreeWalker(
        content,
        NodeFilter.SHOW_TEXT,
      );

    let remaining =
      Math.max(
        0,
        columnOffset,
      );

    let node =
      walker.nextNode();

    while (node) {
      const textNode =
        node as Text;

      if (
        remaining
          <= textNode.data.length
      ) {
        return {
          node: textNode,
          offset: remaining,
        };
      }

      remaining -=
        textNode.data.length;

      node =
        walker.nextNode();
    }

    if (
      content.textContent?.length === 0
    ) {
      const placeholder =
        document.createTextNode('');

      content.append(placeholder);

      return {
        node: placeholder,
        offset: 0,
      };
    }

    return null;
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

      if (
        sequence
          !== renderSequence
      ) {
        return;
      }

      renderCodeLines();

      syncBackground();
      syncSelection();
      renderFocusMarkers();
      scheduleViewportEvent();
    };

  const offsetFromLineColumn = (
    source: string,
    line: number,
    column: number,
  ): number => {
    const lines =
      source.split('\n');

    const safeLine =
      Math.max(
        1,
        Math.min(
          lines.length,
          line,
        ),
      );

    let offset = 0;

    for (
      let index = 0;
      index < safeLine - 1;
      index += 1
    ) {
      offset +=
        lines[index].length + 1;
    }

    const lineText =
      lines[safeLine - 1]
        ?? '';

    return (
      offset
        + Math.max(
          0,
          Math.min(
            lineText.length,
            column - 1,
          ),
        )
    );
  };

  const domPointFromOffset = (
    targetOffset: number,
  ): {
    node: Text;
    offset: number;
  } | null => {
    const position =
      positionFromOffset(
        currentContent,
        targetOffset,
      );

    return domPointWithinLine(
      position.line,
      position.column - 1,
    );
  };

  const rectForFocus = (
    focus: ReaderFocusDetail,
  ): DOMRect | null => {
    if (
      focus.filePath
        !== editorController.path
    ) {
      return null;
    }

    const offset =
      offsetFromLineColumn(
        currentContent,
        focus.line,
        focus.column,
      );

    const point =
      domPointFromOffset(offset);

    if (!point) {
      return null;
    }

    const range =
      document.createRange();

    range.setStart(
      point.node,
      point.offset,
    );

    const nextOffset =
      Math.min(
        point.node.data.length,
        point.offset + 1,
      );

    range.setEnd(
      point.node,
      nextOffset,
    );

    let rect =
      range.getBoundingClientRect();

    if (
      rect.width === 0
        && point.offset > 0
    ) {
      range.setStart(
        point.node,
        point.offset - 1,
      );
      range.setEnd(
        point.node,
        point.offset,
      );
      rect =
        range.getBoundingClientRect();

      return new DOMRect(
        rect.right,
        rect.top,
        1,
        rect.height,
      );
    }

    return rect;
  };

  const rangesForSelection = (
    selection: ReaderSelectionDetail,
  ): Range[] => {
    if (
      selection.filePath
        !== editorController.path
    ) {
      return [];
    }

    const lines =
      sourceLines();

    const startLine =
      Math.max(
        1,
        Math.min(
          lines.length,
          selection.startLine,
        ),
      );

    const endLine =
      Math.max(
        startLine,
        Math.min(
          lines.length,
          selection.endLine,
        ),
      );

    const ranges:
      Range[] = [];

    for (
      let line = startLine;
      line <= endLine;
      line += 1
    ) {
      const lineText =
        lines[line - 1]
          ?? '';

      const startColumn =
        line === startLine
          ? selection.startColumn
          : 1;

      const endColumn =
        line === endLine
          ? selection.endColumn
          : lineText.length + 1;

      const safeStartColumn =
        Math.max(
          1,
          Math.min(
            lineText.length + 1,
            startColumn,
          ),
        );

      const safeEndColumn =
        Math.max(
          safeStartColumn,
          Math.min(
            lineText.length + 1,
            endColumn,
          ),
        );

      if (
        safeEndColumn
          <= safeStartColumn
      ) {
        continue;
      }

      const startPoint =
        domPointWithinLine(
          line,
          safeStartColumn - 1,
        );

      const endPoint =
        domPointWithinLine(
          line,
          safeEndColumn - 1,
        );

      if (
        !startPoint
          || !endPoint
      ) {
        continue;
      }

      const range =
        document.createRange();

      try {
        range.setStart(
          startPoint.node,
          startPoint.offset,
        );
        range.setEnd(
          endPoint.node,
          endPoint.offset,
        );
      } catch {
        continue;
      }

      ranges.push(
        range,
      );
    }

    return ranges;
  };

  const renderFocusMarkers =
    (): void => {
      focusLayer.replaceChildren();

      if (
        effectiveMode
          !== 'reader'
      ) {
        return;
      }

      const surfaceRect =
        surface.getBoundingClientRect();

      for (
        const remote
          of remoteSelections
      ) {
        const ranges =
          rangesForSelection(
            remote.selection,
          );

        if (
          ranges.length === 0
        ) {
          continue;
        }

        const rawRects =
          ranges
            .flatMap(
              (range) =>
                Array.from(
                  range.getClientRects(),
                ),
            )
            .filter(
              (rect) =>
                rect.width > 0
                  && rect.height > 0,
            );

        const lineRects:
          Array<{
            left: number;
            right: number;
            top: number;
            bottom: number;
          }> = [];

        for (const rect of rawRects) {
          const existing =
            lineRects.find(
              (line) =>
                Math.abs(line.top - rect.top) <= 2
                  && Math.abs(
                    (line.bottom - line.top)
                      - rect.height,
                  ) <= 3,
            );

          if (existing) {
            existing.left =
              Math.min(existing.left, rect.left);
            existing.right =
              Math.max(existing.right, rect.right);
            existing.top =
              Math.min(existing.top, rect.top);
            existing.bottom =
              Math.max(existing.bottom, rect.bottom);
          } else {
            lineRects.push({
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            });
          }
        }

        lineRects.sort(
          (a, b) =>
            a.top - b.top
              || a.left - b.left,
        );

        let labeled = false;

        for (const rect of lineRects) {
          if (
            rect.bottom < surfaceRect.top
              || rect.top > surfaceRect.bottom
              || rect.right < surfaceRect.left
              || rect.left > surfaceRect.right
          ) {
            continue;
          }

          const highlight =
            document.createElement(
              'div',
            );

          highlight.className =
            'reader-shared-selection is-remote';

          highlight.style.left =
            `${rect.left - surfaceRect.left}px`;
          highlight.style.top =
            `${
              rect.top
                - surfaceRect.top
                - 3
            }px`;
          highlight.style.width =
            `${Math.max(1, rect.right - rect.left)}px`;
          highlight.style.height =
            `${
              Math.max(
                1,
                rect.bottom
                  - rect.top
                  + 6,
              )
            }px`;

          if (!labeled) {
            const label =
              document.createElement(
                'span',
              );
            label.textContent =
              remote.name;
            highlight.append(label);
            labeled = true;
          }

          focusLayer.append(highlight);
        }
      }

      const peersWithSelection =
        new Set(
          remoteSelections.map(
            (remote) =>
              remote.peerId,
          ),
        );

      const renderOne = (
        focus: ReaderFocusDetail,
        name: string,
        remote: boolean,
      ): void => {
        const rect =
          rectForFocus(focus);

        if (!rect) {
          return;
        }

        if (
          rect.bottom
            < surfaceRect.top
          || rect.top
            > surfaceRect.bottom
          || rect.right
            < surfaceRect.left
          || rect.left
            > surfaceRect.right
        ) {
          return;
        }

        const marker =
          document.createElement(
            'div',
          );

        marker.className =
          remote
            ? 'reader-shared-cursor is-remote'
            : 'reader-shared-cursor is-local';

        marker.style.left =
          `${
            rect.left
              - surfaceRect.left
          }px`;

        marker.style.top =
          `${
            rect.top
              - surfaceRect.top
          }px`;

        marker.style.height =
          `${
            Math.max(
              18,
              rect.height,
            )
          }px`;

        const label =
          document.createElement(
            'span',
          );
        label.textContent =
          name;

        marker.append(label);
        focusLayer.append(marker);
      };

      if (localFocus) {
        renderOne(
          localFocus,
          '你',
          false,
        );
      }

      for (
        const remote
          of remoteFocuses
      ) {
        if (
          peersWithSelection.has(
            remote.peerId,
          )
        ) {
          continue;
        }

        renderOne(
          remote.focus,
          remote.name,
          true,
        );
      }
    };

  const focusFromPoint = (
    clientX: number,
    clientY: number,
  ): ReaderFocusDetail | null => {
    const documentWithCaret =
      document as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number,
        ) => {
          offsetNode: Node;
          offset: number;
        } | null;
        caretRangeFromPoint?: (
          x: number,
          y: number,
        ) => Range | null;
      };

    let node: Node | null = null;
    let offset = 0;

    const position =
      documentWithCaret
        .caretPositionFromPoint?.(
          clientX,
          clientY,
        );

    if (position) {
      node =
        position.offsetNode;
      offset =
        position.offset;
    } else {
      const range =
        documentWithCaret
          .caretRangeFromPoint?.(
            clientX,
            clientY,
          );

      if (range) {
        node =
          range.startContainer;
        offset =
          range.startOffset;
      }
    }

    if (
      !node
        || (
          node !== code
            && !code.contains(node)
        )
    ) {
      return null;
    }

    const textOffset =
      sourceOffsetFromDomPoint(
        node,
        offset,
      );

    if (textOffset === null) {
      return null;
    }

    const positionInSource =
      positionFromOffset(
        currentContent,
        textOffset,
      );

    return {
      filePath:
        editorController.path,
      line:
        positionInSource.line,
      column:
        positionInSource.column,
    };
  };

  const setLocalFocus = (
    focus: ReaderFocusDetail | null,
  ): void => {
    localFocus =
      focus;

    renderFocusMarkers();

    window.dispatchEvent(
      new CustomEvent<
        ReaderFocusDetail | null
      >(
        'ai-ide-reader-focus',
        {
          detail: focus
            ? { ...focus }
            : null,
        },
      ),
    );
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

  const emitSharedSelection = (
    payload: SelectedCode | null,
  ): void => {
    const detail:
      ReaderSelectionDetail | null =
        payload
          ? {
              filePath:
                payload.filePath,
              startLine:
                payload.startLine,
              startColumn:
                payload.startColumn,
              endLine:
                payload.endLine,
              endColumn:
                payload.endColumn,
            }
          : null;

    const key =
      detail
        ? [
            detail.filePath,
            detail.startLine,
            detail.startColumn,
            detail.endLine,
            detail.endColumn,
          ].join(':')
        : '';

    if (
      key
        === lastSharedSelectionKey
    ) {
      return;
    }

    lastSharedSelectionKey =
      key;

    window.dispatchEvent(
      new CustomEvent<
        ReaderSelectionDetail | null
      >(
        'ai-ide-reader-selection',
        {
          detail,
        },
      ),
    );
  };

  const clearReaderSelection =
    (): void => {
      selectionPayload = null;
      emitSharedSelection(null);
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
        sourceOffsetFromDomPoint(
          range.startContainer,
          range.startOffset,
        );

      const endOffset =
        sourceOffsetFromDomPoint(
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

    emitSharedSelection(
      selectionPayload,
    );

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

  const onReaderClick = (
    event: MouseEvent,
  ): void => {
    if (
      effectiveMode
        !== 'reader'
    ) {
      return;
    }

    const selection =
      window.getSelection();

    if (
      selection
        && !selection.isCollapsed
    ) {
      return;
    }

    const focus =
      focusFromPoint(
        event.clientX,
        event.clientY,
      );

    if (!focus) {
      return;
    }

    setLocalFocus(focus);
  };

  code.addEventListener(
    'click',
    onReaderClick,
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

  const onRevealLine = (
    event: Event,
  ): void => {
    const detail =
      (
        event as CustomEvent<{
          line?: number;
        }>
      ).detail;

    const line =
      Math.max(
        1,
        Math.floor(
          detail?.line
            ?? 1,
        ),
      );

    if (
      effectiveMode
        !== 'reader'
    ) {
      void setMode(
        'reader',
        false,
      ).then(
        () => {
          requestAnimationFrame(
            () => {
              revealReaderLine(
                line,
              );
            },
          );
        },
      );
      return;
    }

    revealReaderLine(
      line,
    );
  };

  const modelDisposable =
    editor.onDidChangeModel(
      () => {
        clearReaderSelection();
        setLocalFocus(null);

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

  window.addEventListener(
    'ai-ide-reader-reveal-line',
    onRevealLine,
  );

  scroll.addEventListener(
    'scroll',
    () => {
      memorizeButton.hidden =
        true;
      renderFocusMarkers();
      scheduleViewportEvent();
    },
    {
      passive: true,
    },
  );

  const onRemoteFocuses = (
    event: Event,
  ): void => {
    const detail =
      (
        event as CustomEvent<
          ReaderRemoteFocusDetail[]
        >
      ).detail;

    remoteFocuses =
      Array.isArray(detail)
        ? detail
        : [];

    renderFocusMarkers();
  };

  window.addEventListener(
    'ai-ide-reader-remote-focuses',
    onRemoteFocuses,
  );

  const onRemoteSelections = (
    event: Event,
  ): void => {
    const detail =
      (
        event as CustomEvent<
          ReaderRemoteSelectionDetail[]
        >
      ).detail;

    remoteSelections =
      Array.isArray(detail)
        ? detail
        : [];

    renderFocusMarkers();
  };

  window.addEventListener(
    'ai-ide-reader-remote-selections',
    onRemoteSelections,
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

    window.removeEventListener(
      'ai-ide-reader-reveal-line',
      onRevealLine,
    );

    window.removeEventListener(
      'ai-ide-reader-remote-focuses',
      onRemoteFocuses,
    );

    window.removeEventListener(
      'ai-ide-reader-remote-selections',
      onRemoteSelections,
    );

    code.removeEventListener(
      'click',
      onReaderClick,
    );

    control.remove();
    memorizeButton.remove();
    surface.remove();

    delete editorStage.dataset
      .editorSurface;

    editor.layout();
  };
}
