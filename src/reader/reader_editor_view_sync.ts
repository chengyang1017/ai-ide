import { Capacitor } from '@capacitor/core';

import type {
  EditorController,
} from '../editor/editor_controller';

interface SavedViewport {
  anchorLine: number;
  lineOffset: number;
  scrollLeft: number;
  cursorLine: number;
  cursorColumn: number;
}

type SavedViewportMap =
  Record<string, SavedViewport>;

const VIEWPORT_STORAGE_KEY =
  'code-tutor-studio.reader-editor-viewports-v2';

function readCssNumber(
  name: string,
  fallback: number,
): number {
  const raw =
    getComputedStyle(
      document.documentElement,
    )
      .getPropertyValue(name)
      .trim();

  const parsed =
    Number.parseFloat(raw);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function codeLineHeight(): number {
  return readCssNumber(
    '--code-line-height',
    24,
  );
}

function codeTopPadding(): number {
  return readCssNumber(
    '--code-top-padding',
    42,
  );
}

function readSavedViewports():
  SavedViewportMap {
  if (
    Capacitor.getPlatform()
      === 'android'
  ) {
    return {};
  }

  try {
    const parsed =
      JSON.parse(
        window.localStorage
          .getItem(
            VIEWPORT_STORAGE_KEY,
          )
          ?? '{}',
      );

    if (
      !parsed
      || typeof parsed
        !== 'object'
    ) {
      return {};
    }

    return parsed as
      SavedViewportMap;
  } catch {
    return {};
  }
}

export function installReaderEditorViewSync(
  editorController:
    EditorController,
  editorStage:
    HTMLElement,
  readerScroll:
    HTMLElement,
): void {
  const editor =
    editorController.editor;

  const saved =
    readSavedViewports();

  let anchorLine = 1;

  /*
   * lineOffset 的意思：
   *
   * 当前 viewport 顶部
   * 相对于 anchorLine 顶部
   * 已经向下滚了多少 px。
   *
   * 例如：
   *
   * line 20 top = 498px
   * scrollTop = 505px
   *
   * offset = 7px
   *
   * 切换模式以后仍然：
   *
   * line 20
   * + 7px
   *
   * 而不是直接复制 scrollTop。
   */
  let lineOffset =
    -codeTopPadding();

  let sharedScrollLeft = 0;

  let cursorLine =
    editor
      .getPosition()
      ?.lineNumber
      ?? 1;

  let cursorColumn =
    editor
      .getPosition()
      ?.column
      ?? 1;

  let persistTimer = 0;

  let restoring = false;

  let transitionVersion = 0;

  const currentPath =
    (): string =>
      editorController.path;

  const readerActive =
    (): boolean =>
      editorStage
        .dataset
        .editorSurface
        === 'reader';

  const modelLineCount =
    (): number =>
      Math.max(
        1,
        editor
          .getModel()
          ?.getLineCount()
          ?? 1,
      );

  const clampLine =
    (
      line: number,
    ): number =>
      Math.max(
        1,
        Math.min(
          modelLineCount(),
          line,
        ),
      );

  /*
   * Reader 的每行位置非常确定：
   *
   * topPadding
   * +
   * (line - 1) * lineHeight
   */
  const readerLineTop =
    (
      line: number,
    ): number =>
      codeTopPadding()
      + (
        clampLine(line) - 1
      )
      * codeLineHeight();

  /*
   * 根据 Reader scrollTop
   * 找到 viewport 顶部对应哪一行。
   */
  const readerAnchorFromScroll =
    (
      scrollTop: number,
    ): {
      line: number;
      offset: number;
    } => {
      const topPadding =
        codeTopPadding();

      const lineHeight =
        codeLineHeight();

      /*
       * 还没有滚过顶部 padding 时，
       * 第一行仍然是 anchor。
       */
      if (
        scrollTop
          <= topPadding
      ) {
        return {
          line: 1,
          offset:
            scrollTop
            - topPadding,
        };
      }

      const contentTop =
        scrollTop
        - topPadding;

      const line =
        clampLine(
          Math.floor(
            contentTop
              / lineHeight,
          )
          + 1,
        );

      const lineTop =
        topPadding
        + (
          line - 1
        )
        * lineHeight;

      return {
        line,
        offset:
          scrollTop
          - lineTop,
      };
    };

  /*
   * 不使用 getVisibleRanges()。
   *
   * 因为切换 Reader 时，
   * Monaco 可能已经 display:none，
   * getVisibleRanges() 会变得不可靠。
   *
   * 直接根据每行的真实 Monaco top
   * 做二分搜索。
   */
  const editorAnchorFromScroll =
    (
      scrollTop: number,
    ): {
      line: number;
      offset: number;
    } => {
      const count =
        modelLineCount();

      const firstTop =
        editor
          .getTopForLineNumber(
            1,
          );

      if (
        scrollTop
          <= firstTop
      ) {
        return {
          line: 1,
          offset:
            scrollTop
            - firstTop,
        };
      }

      let low = 1;
      let high = count;
      let result = 1;

      while (
        low <= high
      ) {
        const middle =
          Math.floor(
            (
              low + high
            ) / 2,
          );

        const top =
          editor
            .getTopForLineNumber(
              middle,
            );

        if (
          top
            <= scrollTop
        ) {
          result = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      const line =
        clampLine(result);

      const lineTop =
        editor
          .getTopForLineNumber(
            line,
          );

      return {
        line,
        offset:
          scrollTop
          - lineTop,
      };
    };

  const persist =
    (): void => {
      if (
        Capacitor.getPlatform()
          === 'android'
      ) {
        return;
      }

      const path =
        currentPath();

      if (!path) {
        return;
      }

      saved[path] = {
        anchorLine:
          clampLine(
            anchorLine,
          ),

        lineOffset:
          Number.isFinite(
            lineOffset,
          )
            ? lineOffset
            : 0,

        scrollLeft:
          Math.max(
            0,
            sharedScrollLeft,
          ),

        cursorLine:
          clampLine(
            cursorLine,
          ),

        cursorColumn:
          Math.max(
            1,
            cursorColumn,
          ),
      };

      window.localStorage
        .setItem(
          VIEWPORT_STORAGE_KEY,
          JSON.stringify(saved),
        );
    };

  const schedulePersist =
    (): void => {
      if (
        Capacitor.getPlatform()
          === 'android'
      ) {
        return;
      }

      if (persistTimer) {
        window.clearTimeout(
          persistTimer,
        );
      }

      persistTimer =
        window.setTimeout(
          () => {
            persistTimer = 0;
            persist();
          },
          120,
        );
    };

  const captureEditor =
    (): void => {
      const state =
        editorAnchorFromScroll(
          editor.getScrollTop(),
        );

      anchorLine =
        state.line;

      lineOffset =
        state.offset;

      sharedScrollLeft =
        editor.getScrollLeft();

      const position =
        editor.getPosition();

      if (position) {
        cursorLine =
          position.lineNumber;

        cursorColumn =
          position.column;
      }

      schedulePersist();
    };

  const captureReader =
    (): void => {
      const state =
        readerAnchorFromScroll(
          readerScroll.scrollTop,
        );

      anchorLine =
        state.line;

      lineOffset =
        state.offset;

      sharedScrollLeft =
        readerScroll.scrollLeft;

      schedulePersist();
    };

  const restoreReader =
    (): void => {
      const line =
        clampLine(
          anchorLine,
        );

      const targetTop =
        readerLineTop(line)
        + lineOffset;

      readerScroll.scrollTop =
        Math.max(
          0,
          targetTop,
        );

      readerScroll.scrollLeft =
        Math.max(
          0,
          sharedScrollLeft,
        );
    };

  const restoreEditor =
    (): void => {
      editor.layout();

      const model =
        editor.getModel();

      if (!model) {
        return;
      }

      const line =
        clampLine(
          anchorLine,
        );

      const lineTop =
        editor
          .getTopForLineNumber(
            line,
          );

      const targetTop =
        lineTop
        + lineOffset;

      /*
       * 注意：
       * 先恢复 scroll，
       * 再恢复 cursor。
       *
       * setPosition 本身不会再
       * reveal / 改 viewport。
       */
      editor.setScrollTop(
        Math.max(
          0,
          targetTop,
        ),
      );

      editor.setScrollLeft(
        Math.max(
          0,
          sharedScrollLeft,
        ),
      );

      const safeCursorLine =
        Math.max(
          1,
          Math.min(
            model.getLineCount(),
            cursorLine,
          ),
        );

      const safeCursorColumn =
        Math.max(
          1,
          Math.min(
            model.getLineMaxColumn(
              safeCursorLine,
            ),
            cursorColumn,
          ),
        );

      editor.setPosition({
        lineNumber:
          safeCursorLine,
        column:
          safeCursorColumn,
      });
    };

  const finishRestoreLater =
    (): void => {
      /*
       * 保留一帧 restoring=true，
       * 防止 setScrollTop 触发的事件
       * 又把共享 anchor 覆盖掉。
       */
      window
        .requestAnimationFrame(
          () => {
            restoring = false;
          },
        );
    };

  const restoreCurrentMode =
    (): void => {
      restoring = true;

      if (readerActive()) {
        restoreReader();
      } else {
        restoreEditor();
      }

      finishRestoreLater();
    };

  const loadForCurrentFile =
    (): void => {
      const path =
        currentPath();

      const state =
        saved[path];

      if (
        state
        && Capacitor.getPlatform()
          !== 'android'
      ) {
        anchorLine =
          Number.isFinite(
            state.anchorLine,
          )
            ? clampLine(
                state.anchorLine,
              )
            : 1;

        lineOffset =
          Number.isFinite(
            state.lineOffset,
          )
            ? state.lineOffset
            : -codeTopPadding();

        sharedScrollLeft =
          Number.isFinite(
            state.scrollLeft,
          )
            ? Math.max(
                0,
                state.scrollLeft,
              )
            : 0;

        cursorLine =
          Number.isFinite(
            state.cursorLine,
          )
            ? clampLine(
                state.cursorLine,
              )
            : 1;

        cursorColumn =
          Number.isFinite(
            state.cursorColumn,
          )
            ? Math.max(
                1,
                state.cursorColumn,
              )
            : 1;

        window
          .requestAnimationFrame(
            () => {
              window
                .requestAnimationFrame(
                  restoreCurrentMode,
                );
            },
          );

        return;
      }

      /*
       * 新文件没有保存状态：
       * 直接以当前 Monaco 状态为准。
       */
      captureEditor();
    };

  editor.onDidScrollChange(
    () => {
      if (
        restoring
        || readerActive()
      ) {
        return;
      }

      captureEditor();
    },
  );

  editor
    .onDidChangeCursorPosition(
      () => {
        if (
          restoring
          || readerActive()
        ) {
          return;
        }

        const position =
          editor.getPosition();

        if (!position) {
          return;
        }

        cursorLine =
          position.lineNumber;

        cursorColumn =
          position.column;

        schedulePersist();
      },
    );

  editor.onDidChangeModel(
    () => {
      window
        .requestAnimationFrame(
          loadForCurrentFile,
        );
    },
  );

  readerScroll.addEventListener(
    'scroll',
    () => {
      if (
        restoring
        || !readerActive()
      ) {
        return;
      }

      captureReader();
    },
    {
      passive: true,
    },
  );

  /*
   * 最重要的一段：
   *
   * MutationObserver 开启 oldValue。
   *
   * 切换之后 dataset 已经变成新模式，
   * 但我们利用 oldValue 判断
   * “刚才离开的到底是哪一个模式”。
   *
   * 所以：
   *
   * Editor -> Reader
   * 先 captureEditor()
   *
   * Reader -> Editor
   * 先 captureReader()
   *
   * 不会再出现两个 view
   * 相互覆盖 scrollTop。
   */
  const observer =
    new MutationObserver(
      (
        mutations,
      ) => {
        const mutation =
          mutations.find(
            (item) =>
              item.attributeName
                ===
                'data-editor-surface',
          );

        if (!mutation) {
          return;
        }

        const oldMode =
          mutation.oldValue;

        /*
         * 此时虽然 DOM 已经切换，
         * 但两个滚动容器的 scroll 状态
         * 本身仍然保留。
         */
        if (
          oldMode === 'reader'
        ) {
          captureReader();
        } else {
          captureEditor();
        }

        const version =
          ++transitionVersion;

        /*
         * Reader render 和 Monaco layout
         * 都先完成，再恢复 viewport。
         */
        window
          .requestAnimationFrame(
            () => {
              window
                .requestAnimationFrame(
                  () => {
                    if (
                      version
                        !==
                        transitionVersion
                    ) {
                      return;
                    }

                    restoreCurrentMode();
                  },
                );
            },
          );
      },
    );

  observer.observe(
    editorStage,
    {
      attributes: true,

      attributeFilter: [
        'data-editor-surface',
      ],

      attributeOldValue:
        true,
    },
  );

  /*
   * 窗口 resize 后：
   * Monaco 重新 layout，
   * 但 anchor 不变。
   */
  window.addEventListener(
    'resize',
    () => {
      if (restoring) {
        return;
      }

      window
        .requestAnimationFrame(
          restoreCurrentMode,
        );
    },
  );

  loadForCurrentFile();
}