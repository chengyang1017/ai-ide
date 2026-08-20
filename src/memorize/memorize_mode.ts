import type {
  EditorController,
  SelectedCode,
} from '../editor/editor_controller';
import { compareMemorizeCode } from './memorize_compare';
import './memorize.css';

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing memorize element: ${selector}`);
  }
  return element;
}

export function installMemorizeMode(
  editorController: EditorController,
): () => void {
  const editorStage =
    document.querySelector<HTMLElement>('#editor-stage');

  if (!editorStage) {
    throw new Error('Missing #editor-stage for memorize mode.');
  }

  const entryButton = document.createElement('button');
  entryButton.type = 'button';
  entryButton.className = 'memorize-entry';
  entryButton.textContent = '✍ 默写';
  entryButton.hidden = true;
  entryButton.setAttribute('aria-label', '默写选中的代码');

  const overlay = document.createElement('section');
  overlay.className = 'memorize-overlay';
  overlay.hidden = true;
  overlay.setAttribute('aria-label', '闭卷默写模式');
  overlay.innerHTML = `
    <header class="memorize-header">
      <div>
        <strong>闭卷默写</strong>
        <div class="memorize-meta">
          <span data-memorize-file></span>
          <span aria-hidden="true">·</span>
          <span data-memorize-range></span>
        </div>
      </div>
      <button
        type="button"
        class="memorize-close"
        data-memorize-close
        aria-label="退出默写"
      >
        ×
      </button>
    </header>

    <div class="memorize-body">
      <p class="memorize-instruction">
        原代码已隐藏。空格、换行和缩进不计错；文字、标识符和符号必须一致。
      </p>

      <textarea
        class="memorize-input"
        data-memorize-input
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        placeholder="从记忆里把刚才选中的代码写出来…"
        aria-label="默写代码"
      ></textarea>

      <div
        class="memorize-result"
        data-memorize-result
        aria-live="polite"
      ></div>

      <div
        class="memorize-answer"
        data-memorize-answer
        hidden
      >
        <div class="memorize-answer-title">原代码</div>
        <pre><code data-memorize-answer-code></code></pre>
      </div>
    </div>

    <footer class="memorize-actions">
      <button
        type="button"
        class="memorize-secondary"
        data-memorize-answer-toggle
      >
        查看答案
      </button>
      <button
        type="button"
        class="memorize-primary"
        data-memorize-check
      >
        检查
      </button>
    </footer>
  `;

  editorStage.append(entryButton, overlay);

  const fileLabel =
    requireElement<HTMLElement>(overlay, '[data-memorize-file]');
  const rangeLabel =
    requireElement<HTMLElement>(overlay, '[data-memorize-range]');
  const input =
    requireElement<HTMLTextAreaElement>(
      overlay,
      '[data-memorize-input]',
    );
  const result =
    requireElement<HTMLElement>(
      overlay,
      '[data-memorize-result]',
    );
  const answer =
    requireElement<HTMLElement>(
      overlay,
      '[data-memorize-answer]',
    );
  const answerCode =
    requireElement<HTMLElement>(
      overlay,
      '[data-memorize-answer-code]',
    );
  const answerToggle =
    requireElement<HTMLButtonElement>(
      overlay,
      '[data-memorize-answer-toggle]',
    );
  const checkButton =
    requireElement<HTMLButtonElement>(
      overlay,
      '[data-memorize-check]',
    );
  const closeButton =
    requireElement<HTMLButtonElement>(
      overlay,
      '[data-memorize-close]',
    );

  let latestSelection: SelectedCode | null = null;
  let activeSelection: SelectedCode | null = null;
  let answerVisible = false;

  const hideEntryButton = (): void => {
    entryButton.hidden = true;
  };

  const positionEntryButton = (): void => {
    if (overlay.hidden === false) {
      hideEntryButton();
      return;
    }

    const selection = editorController.editor.getSelection();
    if (!selection || selection.isEmpty()) {
      hideEntryButton();
      return;
    }

    const visiblePosition =
      editorController.editor.getScrolledVisiblePosition({
        lineNumber: selection.endLineNumber,
        column: selection.endColumn,
      });

    if (!visiblePosition) {
      hideEntryButton();
      return;
    }

    const buttonWidth = 92;
    const horizontalGap = 12;
    const verticalGap = 10;
    const maxLeft = Math.max(
      horizontalGap,
      editorStage.clientWidth - buttonWidth - horizontalGap,
    );

    const left = Math.min(
      maxLeft,
      Math.max(
        horizontalGap,
        visiblePosition.left + horizontalGap,
      ),
    );

    const preferredTop =
      visiblePosition.top - 44;

    const top =
      preferredTop >= verticalGap
        ? preferredTop
        : visiblePosition.top
          + visiblePosition.height
          + verticalGap;

    entryButton.style.left = `${left}px`;
    entryButton.style.top = `${Math.max(verticalGap, top)}px`;
    entryButton.hidden = false;
  };

  const syncSelection = (): void => {
    if (!overlay.hidden) {
      return;
    }

    latestSelection = editorController.getSelectedCode();

    if (!latestSelection) {
      hideEntryButton();
      return;
    }

    positionEntryButton();
  };

  const resetResult = (): void => {
    result.textContent = '';
    result.dataset.state = '';
  };

  const setAnswerVisible = (visible: boolean): void => {
    answerVisible = visible;
    answer.hidden = !visible;
    answerToggle.textContent =
      visible
        ? '隐藏答案'
        : '查看答案';
  };

  const openMemorize = (selection: SelectedCode): void => {
    activeSelection = { ...selection };
    latestSelection = { ...selection };
    hideEntryButton();

    const lineCount =
      selection.endLine - selection.startLine + 1;

    fileLabel.textContent = selection.filePath;
    rangeLabel.textContent =
      selection.startLine === selection.endLine
        ? `第 ${selection.startLine} 行`
        : `第 ${selection.startLine}–${selection.endLine} 行 · ${lineCount} 行代码`;

    input.value = '';
    answerCode.textContent = selection.code;
    resetResult();
    setAnswerVisible(false);

    overlay.hidden = false;
    editorStage.classList.add('memorize-active');

    requestAnimationFrame(() => {
      input.focus();
    });
  };

  const closeMemorize = (): void => {
    overlay.hidden = true;
    editorStage.classList.remove('memorize-active');
    activeSelection = null;
    input.value = '';
    answerCode.textContent = '';
    resetResult();
    setAnswerVisible(false);

    if (
      editorStage.dataset.editorSurface
        !== 'reader'
    ) {
      editorController.editor.focus();
      syncSelection();
    } else {
      hideEntryButton();
    }

    window.dispatchEvent(
      new Event(
        'ai-ide-memorize-closed',
      ),
    );
  };

  const checkAnswer = (): void => {
    if (!activeSelection) {
      return;
    }

    const comparison = compareMemorizeCode(
      activeSelection.code,
      input.value,
    );

    if (comparison.correct) {
      result.textContent = '✅ 完全正确';
      result.dataset.state = 'correct';
      return;
    }

    result.textContent =
      '❌ 还不正确。继续修改后可以再次检查。';
    result.dataset.state = 'incorrect';
  };

  entryButton.addEventListener(
    'pointerdown',
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      const selection =
        latestSelection
        ?? editorController.getSelectedCode();

      if (selection) {
        openMemorize(selection);
      }
    },
  );

  checkButton.addEventListener('click', checkAnswer);

  answerToggle.addEventListener('click', () => {
    if (!activeSelection) {
      return;
    }
    setAnswerVisible(!answerVisible);
  });

  closeButton.addEventListener('click', closeMemorize);

  const onExternalSelection = (
    event: Event,
  ): void => {
    const detail =
      (
        event as CustomEvent<
          SelectedCode
        >
      ).detail;

    if (
      !detail
        || detail.code.trim().length
          === 0
    ) {
      return;
    }

    openMemorize({
      ...detail,
    });
  };

  window.addEventListener(
    'ai-ide-memorize-selection',
    onExternalSelection,
  );

  const selectionDisposable =
    editorController.editor.onDidChangeCursorSelection(
      syncSelection,
    );
  const scrollDisposable =
    editorController.editor.onDidScrollChange(
      positionEntryButton,
    );
  const layoutDisposable =
    editorController.editor.onDidLayoutChange(
      positionEntryButton,
    );

  const onKeyDown = (event: KeyboardEvent): void => {
    if (overlay.hidden || event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    closeMemorize();
  };

  window.addEventListener(
    'keydown',
    onKeyDown,
    true,
  );

  syncSelection();

  return () => {
    selectionDisposable.dispose();
    scrollDisposable.dispose();
    layoutDisposable.dispose();
    window.removeEventListener(
      'keydown',
      onKeyDown,
      true,
    );
    window.removeEventListener(
      'ai-ide-memorize-selection',
      onExternalSelection,
    );
    entryButton.remove();
    overlay.remove();
  };
}
