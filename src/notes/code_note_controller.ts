import { monaco } from '../editor/monaco_setup';

export type CodeNotePlacement = 'inline' | 'gutter';

export interface CodeNote {
  id: string;
  filePath: string;
  placement: CodeNotePlacement;
  line: number;
  column: number;
  anchorText: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface RuntimeTextModel extends monaco.editor.ITextModel {
  getLineCount(): number;
  getLineMaxColumn(lineNumber: number): number;
}

interface RuntimeMouseTarget {
  type: number;
  position?: { lineNumber: number; column: number } | null;
  element?: HTMLElement | null;
  detail?: { mightBeForeignElement?: boolean } | null;
}

interface RuntimeMouseEvent {
  target: RuntimeMouseTarget;
  event: { preventDefault(): void };
}

interface RuntimeStandaloneEditor {
  onMouseDown(listener: (event: RuntimeMouseEvent) => void): { dispose(): void };
  onDidChangeModelContent(listener: () => void): { dispose(): void };
  focus(): void;
}

const GUTTER_GLYPH_MARGIN = 2;
const INLINE_MARKER_SIZE = 18;

interface DraftNote {
  id: string;
  placement: CodeNotePlacement;
  line: number;
  column: number;
  text: string;
}

export class CodeNoteController {
  private readonly noteDecorations: monaco.editor.IEditorDecorationsCollection;
  private readonly addDecoration: monaco.editor.IEditorDecorationsCollection;
  private readonly inlineNoteDecorations: monaco.editor.IEditorDecorationsCollection;
  private readonly inlineAddDecoration: monaco.editor.IEditorDecorationsCollection;
  private readonly popover: HTMLDivElement;
  private readonly lineLabel: HTMLSpanElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private notes: CodeNote[] = [];
  private enabled = false;
  private filePath = '';
  private loadSequence = 0;
  private draft: DraftNote | null = null;

  constructor(
    private readonly editor: monaco.editor.IStandaloneCodeEditor,
    private readonly stage: HTMLElement,
    private readonly onStatus: (message: string) => void,
  ) {
    this.noteDecorations = this.editor.createDecorationsCollection();
    this.addDecoration = this.editor.createDecorationsCollection();
    this.inlineNoteDecorations = this.editor.createDecorationsCollection();
    this.inlineAddDecoration = this.editor.createDecorationsCollection();

    this.popover = document.createElement('div');
    this.popover.className = 'code-note-popover';
    this.popover.hidden = true;
    this.popover.innerHTML = `
      <div class="code-note-header">
        <div class="code-note-title-row">
          <strong>📝 代码便签</strong>
          <span class="code-note-line"></span>
        </div>
        <button type="button" class="code-note-close" title="关闭便签">×</button>
      </div>
      <textarea class="code-note-textarea" placeholder="写下理解、TODO、问题……" spellcheck="false"></textarea>
      <div class="code-note-actions">
        <span>Ctrl+Enter 保存</span>
        <button type="button" class="code-note-delete">删除</button>
        <button type="button" class="code-note-save">保存</button>
      </div>
    `;
    this.stage.appendChild(this.popover);

    this.lineLabel = this.requireInside<HTMLSpanElement>('.code-note-line');
    this.textarea = this.requireInside<HTMLTextAreaElement>('.code-note-textarea');
    this.saveButton = this.requireInside<HTMLButtonElement>('.code-note-save');
    this.deleteButton = this.requireInside<HTMLButtonElement>('.code-note-delete');
    this.closeButton = this.requireInside<HTMLButtonElement>('.code-note-close');

    this.editor.onDidChangeCursorPosition(() => this.renderAllMarkers());
    const runtimeEditor = this.editor as unknown as RuntimeStandaloneEditor;
    runtimeEditor.onDidChangeModelContent(() => {
      if (!this.enabled) {
        return;
      }
      if (this.notes.length > 0) {
        this.notes = this.notes.map((note) => this.reanchor(note));
      }
      this.renderAllMarkers();
      this.repositionPopover();
    });
    this.editor.onDidScrollChange(() => {
      this.repositionPopover();
    });
    this.editor.onDidLayoutChange(() => {
      this.repositionPopover();
    });
    runtimeEditor.onMouseDown((event) => {
      if (!this.enabled) {
        return;
      }

      if (event.target.type === GUTTER_GLYPH_MARGIN) {
        const line = event.target.position?.lineNumber;
        if (!line) {
          return;
        }
        event.event.preventDefault();
        this.openGutterAtLine(line);
        return;
      }

      const position = event.target.position;
      if (!position) {
        return;
      }

      const injectedElement = event.target.element?.closest<HTMLElement>(
        '.code-note-injected-existing, .code-note-injected-add',
      );
      const isInjectedTextTarget = Boolean(
        injectedElement || event.target.detail?.mightBeForeignElement,
      );
      if (!isInjectedTextTarget) {
        return;
      }

      const note = this.inlineNoteNearPosition(position.lineNumber, position.column);
      if (note) {
        event.event.preventDefault();
        this.openInlineAtPosition(note.line, note.column, note);
        return;
      }

      // “＋” 只会渲染在当前光标位置。mouseDown 发生时光标尚未被 Monaco 移动，
      // 所以用当前光标作为新增便签的真实锚点，比依赖 injected text 的近似 position 更稳定。
      const cursor = this.editor.getPosition();
      if (
        cursor
        && cursor.lineNumber === position.lineNumber
        && Math.abs(cursor.column - position.column) <= 1
      ) {
        event.event.preventDefault();
        this.openInlineAtPosition(cursor.lineNumber, cursor.column);
      }
    });

    this.saveButton.addEventListener('click', () => void this.saveDraft());
    this.deleteButton.addEventListener('click', () => void this.deleteDraft());
    this.closeButton.addEventListener('click', () => this.close());
    this.textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void this.saveDraft();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        runtimeEditor.focus();
      }
    });
  }

  async openFile(filePath: string): Promise<void> {
    this.enabled = true;
    this.filePath = filePath;
    this.close();
    const sequence = ++this.loadSequence;

    try {
      const notes = await window.tutorIde.listCodeNotes(filePath);
      if (sequence !== this.loadSequence || filePath !== this.filePath) {
        return;
      }
      this.notes = notes.map((note) => this.reanchor(note));
      this.renderAllMarkers();
    } catch (error) {
      if (sequence === this.loadSequence) {
        this.notes = [];
        this.renderAllMarkers();
        this.onStatus(error instanceof Error ? error.message : '读取代码便签失败');
      }
    }
  }

  disable(): void {
    this.enabled = false;
    this.filePath = '';
    this.notes = [];
    this.loadSequence += 1;
    this.close();
    this.noteDecorations.clear();
    this.addDecoration.clear();
    this.inlineNoteDecorations.clear();
    this.inlineAddDecoration.clear();
  }

  dispose(): void {
    this.disable();
    this.noteDecorations.clear();
    this.addDecoration.clear();
    this.inlineNoteDecorations.clear();
    this.inlineAddDecoration.clear();
    this.popover.remove();
  }

  private openGutterAtLine(line: number): void {
    const note = this.gutterNoteAtLine(line);
    this.openDraft({
      id: note?.id ?? '',
      placement: 'gutter',
      line,
      column: 1,
      text: note?.text ?? '',
    });
  }

  private openInlineAtPosition(line: number, column: number, note?: CodeNote): void {
    const normalizedColumn = this.clampColumn(line, column);
    this.openDraft({
      id: note?.id ?? '',
      placement: 'inline',
      line,
      column: note?.column ?? normalizedColumn,
      text: note?.text ?? '',
    });
  }

  private openDraft(draft: DraftNote): void {
    this.draft = draft;
    this.textarea.value = draft.text;
    this.lineLabel.textContent = draft.placement === 'gutter'
      ? `L${draft.line} · 行号旁`
      : `L${draft.line}:C${draft.column} · 代码中`;
    this.popover.title = this.filePath;
    this.deleteButton.hidden = !draft.id;
    this.popover.hidden = false;
    this.repositionPopover();
    window.setTimeout(() => this.textarea.focus(), 0);
  }

  private close(): void {
    this.draft = null;
    this.popover.hidden = true;
    this.textarea.value = '';
  }

  private async saveDraft(): Promise<void> {
    if (!this.enabled || !this.draft || !this.filePath) {
      return;
    }

    const text = this.textarea.value.trim();
    if (!text) {
      this.onStatus('便签内容为空；写一点内容后再保存，或直接关闭。');
      this.textarea.focus();
      return;
    }

    const line = this.currentTrackedLine(this.draft.id, this.draft.line);
    const column = this.draft.placement === 'gutter' ? 1 : this.clampColumn(line, this.draft.column);
    const anchorText = this.lineAnchor(line);
    this.saveButton.disabled = true;
    this.saveButton.textContent = '保存中…';

    try {
      const saved = await window.tutorIde.upsertCodeNote({
        id: this.draft.id,
        filePath: this.filePath,
        placement: this.draft.placement,
        line,
        column,
        anchorText,
        text,
      });
      const existingIndex = this.notes.findIndex((note) => note.id === saved.id);
      if (existingIndex >= 0) {
        this.notes[existingIndex] = saved;
      } else {
        this.notes.push(saved);
      }
      this.renderAllMarkers();
      this.onStatus(
        saved.placement === 'gutter'
          ? `📝 已保存行号便签 · ${saved.filePath}:${saved.line}`
          : `📝 已保存代码便签 · ${saved.filePath}:${saved.line}:${saved.column}`,
      );
      this.close();
      (this.editor as unknown as RuntimeStandaloneEditor).focus();
    } catch (error) {
      this.onStatus(error instanceof Error ? error.message : '保存代码便签失败');
    } finally {
      this.saveButton.disabled = false;
      this.saveButton.textContent = '保存';
    }
  }

  private async deleteDraft(): Promise<void> {
    if (!this.draft?.id) {
      this.close();
      return;
    }

    this.deleteButton.disabled = true;
    try {
      await window.tutorIde.deleteCodeNote(this.draft.id);
      this.notes = this.notes.filter((note) => note.id !== this.draft?.id);
      this.renderAllMarkers();
      this.onStatus('📝 已删除代码便签');
      this.close();
      (this.editor as unknown as RuntimeStandaloneEditor).focus();
    } catch (error) {
      this.onStatus(error instanceof Error ? error.message : '删除代码便签失败');
    } finally {
      this.deleteButton.disabled = false;
    }
  }

  private renderAllMarkers(): void {
    this.renderGutterMarkers();
    this.renderInlineMarkers();
  }

  private renderGutterMarkers(): void {
    if (!this.enabled) {
      this.noteDecorations.clear();
      this.addDecoration.clear();
      return;
    }

    const gutterNotes = this.notes.filter((note) => note.placement === 'gutter');
    this.noteDecorations.set(gutterNotes.map((note) => ({
      range: new monaco.Range(note.line, 1, note.line, 1),
      options: {
        glyphMarginClassName: 'code-note-glyph',
        glyphMarginHoverMessage: { value: `📝 **行号便签**\n\n${this.preview(note.text)}` },
      },
    })));

    const position = this.editor.getPosition();
    if (!position || this.gutterNoteAtLine(position.lineNumber)) {
      this.addDecoration.clear();
      return;
    }

    this.addDecoration.set([{
      range: new monaco.Range(position.lineNumber, 1, position.lineNumber, 1),
      options: {
        glyphMarginClassName: 'code-note-add-glyph',
        glyphMarginHoverMessage: { value: '点击在行号旁添加持久便签' },
      },
    }]);
  }

  private renderInlineMarkers(): void {
    if (!this.enabled) {
      this.inlineNoteDecorations.clear();
      this.inlineAddDecoration.clear();
      return;
    }

    const inlineNotes = this.notes.filter((note) => note.placement === 'inline');
    this.inlineNoteDecorations.set(inlineNotes.map((note) => {
      const line = this.currentTrackedLine(note.id, note.line);
      const column = this.clampColumn(line, note.column);
      return this.inlineInjectedDecoration(
        line,
        column,
        ' 📝 ',
        'code-note-injected-existing',
        `📝 **代码便签**\n\n${this.preview(note.text)}`,
      );
    }));

    const position = this.editor.getPosition();
    if (!position || this.inlineNoteAtPosition(position.lineNumber, position.column)) {
      this.inlineAddDecoration.clear();
      return;
    }

    this.inlineAddDecoration.set([this.inlineInjectedDecoration(
      position.lineNumber,
      position.column,
      ' ＋ ',
      'code-note-injected-add',
      `点击 **＋** 在 L${position.lineNumber}:C${position.column} 添加持久便签`,
    )]);
  }

  private inlineInjectedDecoration(
    line: number,
    column: number,
    content: string,
    className: string,
    hover: string,
  ): monaco.editor.IModelDeltaDecoration {
    const model = this.editor.getModel();
    const runtimeModel = model as RuntimeTextModel | null;
    const safeColumn = this.clampColumn(line, column);
    const maxColumn = runtimeModel?.getLineMaxColumn(line) ?? safeColumn;
    const injected = {
      content,
      inlineClassName: className,
      inlineClassNameAffectsLetterSpacing: true,
    };

    // Monaco 0.56 对零长度 range 的 injected text 命中与渲染不够稳定。
    // 尽量把装饰绑定到真实字符，再用 before/after 把便签插在锚点处；
    // 源文件本身仍然完全不会增加任何字符。
    if (safeColumn < maxColumn) {
      return {
        range: new monaco.Range(line, safeColumn, line, safeColumn + 1),
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          hoverMessage: { value: hover },
          before: injected,
        },
      };
    }

    if (safeColumn > 1) {
      return {
        range: new monaco.Range(line, safeColumn - 1, line, safeColumn),
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          hoverMessage: { value: hover },
          after: injected,
        },
      };
    }

    return {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        hoverMessage: { value: hover },
        before: injected,
      },
    };
  }

  private inlineMarkerPoint(line: number, column: number): { left: number; top: number } | null {
    const model = this.editor.getModel();
    if (!model) {
      return null;
    }

    const runtimeModel = model as RuntimeTextModel;
    if (line < 1 || line > runtimeModel.getLineCount()) {
      return null;
    }

    const position = this.editor.getScrolledVisiblePosition({
      lineNumber: line,
      column: this.clampColumn(line, column),
    });
    if (!position) {
      return null;
    }

    const left = Math.min(
      Math.max(4, position.left + 3),
      Math.max(4, this.stage.clientWidth - INLINE_MARKER_SIZE - 8),
    );
    const top = position.top + Math.max(0, (position.height - INLINE_MARKER_SIZE) / 2);

    if (top + INLINE_MARKER_SIZE < 0 || top > this.stage.clientHeight) {
      return null;
    }

    return { left, top };
  }

  private gutterNoteAtLine(line: number): CodeNote | undefined {
    return this.notes.find((note) => (
      note.placement === 'gutter'
      && this.currentTrackedLine(note.id, note.line) === line
    ));
  }

  private inlineNoteAtPosition(line: number, column: number): CodeNote | undefined {
    return this.notes.find((note) => (
      note.placement === 'inline'
      && this.currentTrackedLine(note.id, note.line) === line
      && note.column === column
    ));
  }

  private inlineNoteNearPosition(line: number, column: number): CodeNote | undefined {
    return this.notes.find((note) => (
      note.placement === 'inline'
      && this.currentTrackedLine(note.id, note.line) === line
      && Math.abs(note.column - column) <= 1
    ));
  }

  private currentTrackedLine(_noteId: string, fallbackLine: number): number {
    return fallbackLine;
  }

  private reanchor(note: CodeNote): CodeNote {
    const model = this.editor.getModel();
    if (!model) {
      return note;
    }

    const runtimeModel = model as RuntimeTextModel;
    const maxLine = runtimeModel.getLineCount();
    const original = Math.max(1, Math.min(note.line, maxLine));
    const anchor = note.anchorText.trim();
    if (!anchor) {
      return {
        ...note,
        line: original,
        column: note.placement === 'gutter' ? 1 : this.clampColumn(original, note.column),
      };
    }

    if (this.normalizedLine(original) === anchor) {
      return {
        ...note,
        line: original,
        column: note.placement === 'gutter' ? 1 : this.clampColumn(original, note.column),
      };
    }

    for (let distance = 1; distance <= 50; distance += 1) {
      const before = original - distance;
      const after = original + distance;
      if (before >= 1 && this.normalizedLine(before) === anchor) {
        return {
          ...note,
          line: before,
          column: note.placement === 'gutter' ? 1 : this.clampColumn(before, note.column),
        };
      }
      if (after <= maxLine && this.normalizedLine(after) === anchor) {
        return {
          ...note,
          line: after,
          column: note.placement === 'gutter' ? 1 : this.clampColumn(after, note.column),
        };
      }
    }

    for (let line = 1; line <= maxLine; line += 1) {
      if (this.normalizedLine(line) === anchor) {
        return {
          ...note,
          line,
          column: note.placement === 'gutter' ? 1 : this.clampColumn(line, note.column),
        };
      }
    }

    return {
      ...note,
      line: original,
      column: note.placement === 'gutter' ? 1 : this.clampColumn(original, note.column),
    };
  }

  private lineAnchor(line: number): string {
    return this.normalizedLine(line).slice(0, 500);
  }

  private normalizedLine(line: number): string {
    const model = this.editor.getModel();
    const runtimeModel = model as RuntimeTextModel | null;
    if (!runtimeModel || line < 1 || line > runtimeModel.getLineCount()) {
      return '';
    }
    return runtimeModel.getLineContent(line).trim().replace(/\s+/g, ' ');
  }

  private clampColumn(line: number, column: number): number {
    const model = this.editor.getModel();
    const runtimeModel = model as RuntimeTextModel | null;
    if (!runtimeModel || line < 1 || line > runtimeModel.getLineCount()) {
      return Math.max(1, column);
    }
    return Math.max(1, Math.min(column, runtimeModel.getLineMaxColumn(line)));
  }

  private repositionPopover(): void {
    if (this.popover.hidden || !this.draft) {
      return;
    }

    const model = this.editor.getModel();
    if (!model) {
      return;
    }

    const line = this.currentTrackedLine(this.draft.id, this.draft.line);
    const lineStart = this.editor.getScrolledVisiblePosition({ lineNumber: line, column: 1 });
    if (!lineStart) {
      this.popover.hidden = true;
      return;
    }

    const inlinePoint = this.draft.placement === 'inline'
      ? this.inlineMarkerPoint(line, this.draft.column)
      : null;
    const anchorLeft = inlinePoint?.left ?? Math.max(8, lineStart.left + 6);
    const anchorTop = inlinePoint?.top ?? lineStart.top;

    const width = Math.min(270, Math.max(220, this.stage.clientWidth - 24));
    const estimatedHeight = 170;
    const rightGap = 8;
    const preferredRight = anchorLeft + INLINE_MARKER_SIZE + 8;
    const preferredLeft = anchorLeft - width - 8;
    const left = preferredRight + width <= this.stage.clientWidth - rightGap
      ? preferredRight
      : Math.max(rightGap, preferredLeft);

    const belowTop = anchorTop + 24;
    const aboveTop = anchorTop - estimatedHeight - 8;
    const top = belowTop + estimatedHeight <= this.stage.clientHeight - 8
      ? belowTop
      : Math.max(8, aboveTop);

    this.popover.style.width = `${width}px`;
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
  }

  private preview(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
  }

  private requireInside<T extends Element>(selector: string): T {
    const element = this.popover.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing code note UI element ${selector}`);
    }
    return element;
  }
}
