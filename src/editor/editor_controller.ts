import type { DemoFile } from '../demo/demo_project';
import type { TutorFocus } from '../core/ai_tutor_plan';
import type { SemanticFocus } from '../core/semantic_navigation';
import { monaco } from './monaco_setup';

interface CodeLayout {
  fontSize: number;
  lineHeight: number;
  gutterWidth: number;
  contentGap: number;
  topPadding: number;
  bottomPadding: number;
  fontFamily: string;
}

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

function readCssText(
  name: string,
  fallback: string,
): string {
  const value =
    getComputedStyle(
      document.documentElement,
    )
      .getPropertyValue(name)
      .trim();

  return value || fallback;
}

function readCodeLayout(): CodeLayout {
  return {
    fontSize:
      readCssNumber(
        '--code-font-size',
        15,
      ),
    lineHeight:
      readCssNumber(
        '--code-line-height',
        24,
      ),
    gutterWidth:
      readCssNumber(
        '--code-gutter-width',
        56,
      ),
    contentGap:
      readCssNumber(
        '--code-content-gap',
        12,
      ),
    topPadding:
      readCssNumber(
        '--code-top-padding',
        42,
      ),
    bottomPadding:
      readCssNumber(
        '--code-bottom-padding',
        18,
      ),
    fontFamily:
      readCssText(
        '--code-font-family',
        'Cascadia Code, JetBrains Mono, Consolas, monospace',
      ),
  };
}


interface RuntimeTextModel extends monaco.editor.ITextModel {
  getWordAtPosition(position: { lineNumber: number; column: number }): {
    word: string;
    startColumn: number;
    endColumn: number;
  } | null;
  getLineCount(): number;
  getLineMaxColumn(lineNumber: number): number;
}

interface RuntimeEditorLayoutInfo {
  contentLeft: number;
  contentWidth: number;
}

interface RuntimeStandaloneEditor {
  getLayoutInfo(): RuntimeEditorLayoutInfo;
}

export interface EditorFile {
  path: string;
  language: string;
  content: string;
}

export interface SelectedCode {
  filePath: string;
  code: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export class EditorController {
  readonly editor: monaco.editor.IStandaloneCodeEditor;

  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private readonly savedValues = new Map<string, string>();
  private readonly dirtyListeners = new Set<(path: string, dirty: boolean) => void>();
  private currentPath = '';
  private highlightCollection: monaco.editor.IEditorDecorationsCollection;
  private definitionHintCollection: monaco.editor.IEditorDecorationsCollection;

  constructor(container: HTMLElement, files: DemoFile[]) {
    for (const file of files) {
      this.registerModel(file);
    }

    const first = files[0];
    if (!first) {
      throw new Error('Demo project must contain at least one file.');
    }

    this.currentPath = first.path;

    const codeLayout =
      readCodeLayout();

    this.editor = monaco.editor.create(container, {
      model: this.requireModel(first.path),
      automaticLayout: true,
      fontSize: codeLayout.fontSize,
      lineHeight: codeLayout.lineHeight,
      fontFamily: codeLayout.fontFamily,
      minimap: {
        enabled: true,
        side: 'right',
        // 回到正常 IDE 的比例：不再为了填满高度而拉伸整份源码。
        // 短文件可以短，长文件按内容比例滚动；可读性优先。
        size: 'proportional',
        scale: 1,
        renderCharacters: true,
        maxColumn: 100,
        showSlider: 'always',
      },
      // 完整高度的位置提示交给 overview ruler / scrollbar，
      // 不再让 minimap 同时承担“预览 + 强制铺满”的两个职责。
      overviewRulerLanes: 3,
      overviewRulerBorder: false,
      scrollbar: {
        vertical: 'visible',
        verticalScrollbarSize: 12,
        useShadows: false,
      },
      smoothScrolling: false,
      scrollBeyondLastLine: false,
      /*
      * Reader 没有 Sticky Scroll。
      *
      * 如果 Editor 开启 sticky header，
      * 即使 scrollTop 完全相同，
      * 可见代码也会被顶部 sticky lines
      * 向下顶 24 / 48 / 72px。
      *
      * 要求 Reader / Editor 无缝切换，
      * 这里必须关闭。
      */
      stickyScroll: {
        enabled: false,
      },
      padding: {
        top: codeLayout.topPadding,
        bottom: codeLayout.bottomPadding,
      },
      glyphMargin: false,
      folding: false,
      lineNumbers: 'on',

      /*
      * 固定 Monaco gutter 的最小数字宽度。
      *
      * 否则：
      * 9 行文件
      * 99 行文件
      * 999 行文件
      *
      * Monaco 的 contentLeft 会变化，
      * 而 Reader gutter 永远是固定 56px。
      *
      * 这就是切换时正文左右跳的来源之一。
      */
      lineNumbersMinChars: 4,

      lineDecorationsWidth: 0,
      renderLineHighlight: 'none',
      cursorSmoothCaretAnimation: 'on',
    });

    const initialLayout =
      this.editor.getLayoutInfo();

    const targetContentLeft =
      codeLayout.gutterWidth
        + codeLayout.contentGap;

    const correctedDecorationsWidth =
      Math.max(
        0,
        Math.round(
          targetContentLeft
            - initialLayout.contentLeft,
        ),
      );

    this.editor.updateOptions({
      lineDecorationsWidth:
        correctedDecorationsWidth,
    });

    this.highlightCollection = this.editor.createDecorationsCollection();
    this.definitionHintCollection = this.editor.createDecorationsCollection();
  }

  get path(): string {
    return this.currentPath;
  }

  getSelectedCode(): SelectedCode | null {
    const model = this.editor.getModel();
    const selection = this.editor.getSelection();

    if (!model || !selection || selection.isEmpty()) {
      return null;
    }

    const code = model.getValueInRange(selection);
    if (code.trim().length === 0) {
      return null;
    }

    return {
      filePath: this.currentPath,
      code,
      startLine: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLine: selection.endLineNumber,
      endColumn: selection.endColumn,
    };
  }

  hasFile(path: string): boolean {
    return this.models.has(path);
  }

  openFile(path: string): void {
    const model = this.requireModel(path);
    this.currentPath = path;
    this.editor.setModel(model);
    this.highlightCollection.clear();
    this.definitionHintCollection.clear();
    this.emitDirtyState();
  }

  openFileContent(file: EditorFile): void {
    let model = this.models.get(file.path);

    if (!model) {
      model = this.registerModel(file);
    } else {
      // 如果这个文件在 IDE 里还有未保存修改，切换回来时必须保留内存版本，
      // 不能再次从磁盘读取后把用户刚写的代码覆盖掉。
      if (!this.isDirty(file.path) && model.getValue() !== file.content) {
        this.savedValues.set(file.path, file.content);
        model.setValue(file.content);
      }
      monaco.editor.setModelLanguage(model, file.language);
    }

    this.currentPath = file.path;
    this.editor.setModel(model);
    this.highlightCollection.clear();
    this.definitionHintCollection.clear();
    this.emitDirtyState();
  }

  replaceWorkspace(file: EditorFile): void {
    this.highlightCollection.clear();
    this.definitionHintCollection.clear();

    for (const model of this.models.values()) {
      model.dispose();
    }
    this.models.clear();
    this.savedValues.clear();

    const model = this.registerModel(file);
    this.currentPath = file.path;
    this.editor.setModel(model);
    this.emitDirtyState();
  }

  getCurrentContent(): string {
    return this.editor.getModel()?.getValue() ?? '';
  }

  isDirty(path = this.currentPath): boolean {
    const model = this.models.get(path);
    if (!model) {
      return false;
    }
    return model.getValue() !== (this.savedValues.get(path) ?? model.getValue());
  }

  replaceFileContentFromDisk(file: EditorFile): void {
    const model = this.models.get(file.path);
    if (!model) {
      return;
    }

    const wasCurrent = file.path === this.currentPath;
    const position = wasCurrent ? this.editor.getPosition() : null;
    const scrollTop = wasCurrent ? this.editor.getScrollTop() : 0;
    const scrollLeft = wasCurrent ? this.editor.getScrollLeft() : 0;

    this.savedValues.set(file.path, file.content);
    if (model.getValue() !== file.content) {
      model.setValue(file.content);
    }
    monaco.editor.setModelLanguage(model, file.language);

    if (wasCurrent) {
      if (position) {
        const lineNumber = Math.max(1, Math.min(position.lineNumber, model.getLineCount()));
        const column = Math.max(1, Math.min(position.column, model.getLineMaxColumn(lineNumber)));
        this.editor.setPosition({ lineNumber, column });
      }
      this.editor.setScrollTop(scrollTop);
      this.editor.setScrollLeft(scrollLeft);
      this.highlightCollection.clear();
      this.definitionHintCollection.clear();
      this.emitDirtyState();
    }
  }

  markSaved(path = this.currentPath, savedContent?: string): void {
    const model = this.models.get(path);
    if (!model) {
      return;
    }
    // 保存是异步的：如果用户在磁盘写入期间继续输入，baseline 必须对应
    // 真正写到磁盘的那份快照，而不是保存完成瞬间的最新内存内容。
    this.savedValues.set(path, savedContent ?? model.getValue());
    if (path === this.currentPath) {
      this.emitDirtyState();
    }
  }

  onDirtyStateChanged(listener: (path: string, dirty: boolean) => void): () => void {
    this.dirtyListeners.add(listener);
    listener(this.currentPath, this.isDirty());
    return () => this.dirtyListeners.delete(listener);
  }

  reveal(line: number, column: number): void {
    this.editor.revealPositionInCenter(
      { lineNumber: line, column },
      monaco.editor.ScrollType.Smooth,
    );
  }

  highlightLine(line: number): void {
    this.highlightCollection.set([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'tutor-target-line',
          linesDecorationsClassName: 'tutor-target-gutter',
        },
      },
    ]);
  }

  clearHighlight(): void {
    this.highlightCollection.clear();
  }

  showDefinitionHint(line: number, column: number): void {
    const model = this.editor.getModel();
    if (!model || !this.currentPath.toLowerCase().endsWith('.dart')) {
      this.definitionHintCollection.clear();
      return;
    }

    const runtimeModel = model as RuntimeTextModel;
    const word = runtimeModel.getWordAtPosition({ lineNumber: line, column });
    if (!word?.word) {
      this.definitionHintCollection.clear();
      return;
    }

    this.definitionHintCollection.set([
      {
        range: new monaco.Range(line, word.startColumn, line, word.endColumn),
        options: {
          inlineClassName: 'ctrl-click-link',
          hoverMessage: { value: `Ctrl+Click 跳转到 **${word.word}** 的定义` },
        },
      },
    ]);
  }

  clearDefinitionHint(): void {
    this.definitionHintCollection.clear();
  }

  getTutorPlacement(line: number): { left: number; top: number; placement: 'code-end' | 'gutter' } | null {
    const model = this.editor.getModel();
    if (!model) {
      return null;
    }

    const target = this.editor.getScrolledVisiblePosition({
      lineNumber: line,
      column: 1,
    });
    if (!target) {
      return null;
    }

    const runtimeEditor = this.editor as unknown as RuntimeStandaloneEditor;
    const runtimeModel = model as RuntimeTextModel;
    const layout = runtimeEditor.getLayoutInfo();
    const firstLine = Math.max(1, line - 2);
    const lastLine = Math.min(runtimeModel.getLineCount(), line + 2);
    let furthestVisibleCode = layout.contentLeft;

    for (let currentLine = firstLine; currentLine <= lastLine; currentLine += 1) {
      const endPosition = this.editor.getScrolledVisiblePosition({
        lineNumber: currentLine,
        column: runtimeModel.getLineMaxColumn(currentLine),
      });
      if (endPosition) {
        furthestVisibleCode = Math.max(furthestVisibleCode, endPosition.left);
      }
    }

    const characterWidth = 58;
    const gap = 14;
    const contentRight = layout.contentLeft + layout.contentWidth;
    const preferredLeft = furthestVisibleCode + gap;
    const hasSafeWhitespace = preferredLeft + characterWidth <= contentRight - 8;

    return {
      left: hasSafeWhitespace
        ? preferredLeft
        : Math.max(6, layout.contentLeft - characterWidth - 8),
      top: target.top,
      placement: hasSafeWhitespace ? 'code-end' : 'gutter',
    };
  }

  getVisiblePosition(line: number, column: number): { left: number; top: number; height: number } | null {
    return this.editor.getScrolledVisiblePosition({
      lineNumber: line,
      column,
    });
  }


  getNavigationSeed(): { query: string; line: number; column: number } | null {
    const model = this.editor.getModel();
    const position = this.editor.getPosition();
    if (!model || !position) {
      return null;
    }

    const selection = this.editor.getSelection();
    if (selection && !selection.isEmpty()) {
      const selected = model.getValueInRange(selection).trim();
      if (
        selected.length >= 2
        && selected.length <= 80
        && /^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(selected)
      ) {
        return {
          query: selected,
          line: position.lineNumber,
          column: position.column,
        };
      }
    }

    const word = model.getWordAtPosition(position);
    if (!word || word.word.length < 2) {
      return null;
    }

    return {
      query: word.word,
      line: position.lineNumber,
      column: position.column,
    };
  }

  getSemanticFocusAtPosition(line: number, column: number): SemanticFocus | null {
    const model = this.editor.getModel();
    if (!model || !this.currentPath.toLowerCase().endsWith('.dart')) {
      return null;
    }

    const lineCount = Math.max(1, model.getValue().split(/\r?\n/).length);
    const safeLine = Math.max(1, Math.min(line, lineCount));
    const safeColumn = Math.max(1, Math.min(column, model.getLineContent(safeLine).length + 1));
    const word = model.getWordAtPosition({ lineNumber: safeLine, column: safeColumn });
    if (!word?.word) {
      return null;
    }

    return {
      filePath: this.currentPath,
      line: safeLine,
      column: safeColumn,
      query: word.word,
      documentText: model.getValue(),
    };
  }

  getSemanticFocus(): SemanticFocus | null {
    const model = this.editor.getModel();
    const position = this.editor.getPosition();
    if (!model || !position || !this.currentPath.toLowerCase().endsWith('.dart')) {
      return null;
    }

    const selection = this.editor.getSelection();
    const hasSelection = Boolean(selection && !selection.isEmpty());
    let query = '';

    if (hasSelection && selection) {
      const selectedText = model.getValueInRange(selection).trim();
      if (
        selectedText.length >= 2
        && selectedText.length <= 120
        && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(selectedText)
      ) {
        query = selectedText;
      }
    }

    if (!query) {
      const word = model.getWordAtPosition(position);
      if (word?.word) {
        query = word.word;
      }
    }

    // 选中整个函数时，selection 起点可能落在 Future / void 上。
    // Alpha 0.7 会把完整 Selection 一起交给 Dart LSP，让它自动找到
    // selection 内部（或包含 selection）的真正函数 / 方法声明。
    if (!query && hasSelection) {
      query = '当前 Dart 函数';
    }

    if (!query) {
      return null;
    }

    return {
      filePath: this.currentPath,
      line: position.lineNumber,
      column: position.column,
      query,
      documentText: model.getValue(),
      ...(hasSelection && selection ? {
        selectionStartLine: selection.startLineNumber,
        selectionStartColumn: selection.startColumn,
        selectionEndLine: selection.endLineNumber,
        selectionEndColumn: selection.endColumn,
      } : {}),
    };
  }

  getTutorFocus(): TutorFocus | null {
    const model = this.editor.getModel();
    const position = this.editor.getPosition();
    if (!model || !position) {
      return null;
    }

    const selection = this.editor.getSelection();
    let selectedText = '';
    let line = position.lineNumber;
    let column = position.column;
    let query: string | null = null;

    if (selection && !selection.isEmpty()) {
      selectedText = model.getValueInRange(selection).trim();
      line = selection.startLineNumber;
      column = selection.startColumn;

      if (
        selectedText.length >= 2
        && selectedText.length <= 80
        && /^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(selectedText)
      ) {
        query = selectedText;
      }
    }

    if (!query) {
      const word = model.getWordAtPosition(position);
      if (word?.word && word.word.length >= 2 && word.word.length <= 80) {
        query = word.word;
      }
    }

    if (selectedText.length === 0) {
      selectedText = model.getLineContent(position.lineNumber).trim();
    }

    if (selectedText.length === 0 && !query) {
      return null;
    }

    return {
      filePath: this.currentPath,
      line,
      column,
      selectedText: selectedText.slice(0, 6000),
      query,
    };
  }

  onViewportChanged(listener: () => void): () => void {
    const scroll = this.editor.onDidScrollChange(listener);
    const layout = this.editor.onDidLayoutChange(listener);

    return () => {
      scroll.dispose();
      layout.dispose();
    };
  }

  dispose(): void {
    this.highlightCollection.clear();
    this.definitionHintCollection.clear();
    this.editor.dispose();
    this.dirtyListeners.clear();
    for (const model of this.models.values()) {
      model.dispose();
    }
    this.savedValues.clear();
  }

  private emitDirtyState(): void {
    const dirty = this.isDirty();
    for (const listener of this.dirtyListeners) {
      listener(this.currentPath, dirty);
    }
  }

  private registerModel(file: EditorFile): monaco.editor.ITextModel {
    const uri = monaco.Uri.parse(`file:///workspace/${file.path}`);
    const existing = monaco.editor.getModel(uri);
    existing?.dispose();

    const model = monaco.editor.createModel(file.content, file.language, uri);


    model.updateOptions({

      tabSize:

        Math.max(

          1,

          Math.round(

            readCssNumber(

              '--code-tab-size',

              2,

            ),

          ),

        ),

    });
    const observableModel = model as unknown as {
      onDidChangeContent(listener: () => void): { dispose(): void };
    };
    observableModel.onDidChangeContent(() => {
      if (this.currentPath === file.path) {
        this.emitDirtyState();
      }
    });
    this.models.set(file.path, model);
    this.savedValues.set(file.path, file.content);
    return model;
  }

  private requireModel(path: string): monaco.editor.ITextModel {
    const model = this.models.get(path);
    if (!model) {
      throw new Error(`Unknown file: ${path}`);
    }
    return model;
  }
}
