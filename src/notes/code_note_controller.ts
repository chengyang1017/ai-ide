import { monaco } from '../editor/monaco_setup';

export type CodeNotePlacement = 'inline' | 'gutter';

export interface CodeNoteImage {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  createdAt: string;
}

export interface CodeNote {
  id: string;
  filePath: string;
  placement: CodeNotePlacement;
  line: number;
  column: number;
  anchorText: string;
  text: string;
  images: CodeNoteImage[];
  createdAt: string;
  updatedAt: string;
}

interface RuntimeTextModel extends monaco.editor.ITextModel {
  getLineCount(): number;
  getLineMaxColumn(lineNumber: number): number;
  getLineContent(lineNumber: number): string;
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

interface DraftNote {
  id: string;
  placement: CodeNotePlacement;
  line: number;
  column: number;
  text: string;
  images: CodeNoteImage[];
  originalText: string;
  originalImagePaths: string[];
}

interface PersistDraftSnapshot {
  id: string;
  placement: CodeNotePlacement;
  line: number;
  column: number;
  text: string;
  images: CodeNoteImage[];
  filePath: string;
  anchorText: string;
}

const GUTTER_GLYPH_MARGIN = 2;
const INLINE_MARKER_SIZE = 18;
const MAX_NOTE_IMAGES = 12;
const WORD_CHARACTER = /[\p{L}\p{N}_$]/u;

export class CodeNoteController {
  private readonly noteDecorations: monaco.editor.IEditorDecorationsCollection;
  private readonly addDecoration: monaco.editor.IEditorDecorationsCollection;
  private readonly inlineNoteDecorations: monaco.editor.IEditorDecorationsCollection;
  private readonly inlineAddDecoration: monaco.editor.IEditorDecorationsCollection;
  private readonly popover: HTMLDivElement;
  private readonly lineLabel: HTMLSpanElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly imagesElement: HTMLDivElement;
  private readonly addImageButton: HTMLButtonElement;
  private readonly imageInput: HTMLInputElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly imageLightbox: HTMLDivElement;
  private readonly imageLightboxImage: HTMLImageElement;
  private readonly imageDataUrls = new Map<string, string>();
  private notes: CodeNote[] = [];
  private enabled = false;
  private filePath = '';
  private loadSequence = 0;
  private draft: DraftNote | null = null;
  private disposed = false;

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
        <button type="button" class="code-note-close" title="关闭便签（Esc 放弃未保存修改）">×</button>
      </div>
      <textarea class="code-note-textarea" placeholder="写下理解、TODO、问题……" spellcheck="false"></textarea>
      <div class="code-note-media">
        <div class="code-note-images"></div>
        <button type="button" class="code-note-add-image" title="也可以直接粘贴截图或把图片拖进便签">＋ 图片</button>
        <span class="code-note-media-hint">可粘贴 / 拖入</span>
        <input class="code-note-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" multiple hidden />
      </div>
      <div class="code-note-actions">
        <span>点到别处会自动保存并收起</span>
        <button type="button" class="code-note-delete">删除</button>
        <button type="button" class="code-note-save">保存</button>
      </div>
    `;
    this.stage.appendChild(this.popover);

    this.imageLightbox = document.createElement('div');
    this.imageLightbox.className = 'code-note-image-lightbox';
    this.imageLightbox.hidden = true;
    this.imageLightbox.innerHTML = '<button type="button" aria-label="关闭图片预览">×</button><img alt="代码便签图片预览" />';
    this.stage.appendChild(this.imageLightbox);
    this.imageLightboxImage = this.imageLightbox.querySelector('img') as HTMLImageElement;

    this.lineLabel = this.requireInside<HTMLSpanElement>('.code-note-line');
    this.textarea = this.requireInside<HTMLTextAreaElement>('.code-note-textarea');
    this.imagesElement = this.requireInside<HTMLDivElement>('.code-note-images');
    this.addImageButton = this.requireInside<HTMLButtonElement>('.code-note-add-image');
    this.imageInput = this.requireInside<HTMLInputElement>('.code-note-image-input');
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
    this.editor.onDidScrollChange(() => this.repositionPopover());
    this.editor.onDidLayoutChange(() => this.repositionPopover());

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

      const cursor = this.editor.getPosition();
      if (
        cursor
        && cursor.lineNumber === position.lineNumber
        && Math.abs(cursor.column - position.column) <= 1
        && this.isValidInlineAnchor(cursor.lineNumber, cursor.column)
      ) {
        event.event.preventDefault();
        this.openInlineAtPosition(cursor.lineNumber, cursor.column);
      }
    });

    this.saveButton.addEventListener('click', () => void this.saveDraft());
    this.deleteButton.addEventListener('click', () => void this.deleteDraft());
    this.closeButton.addEventListener('click', () => this.autoSaveAndClose());
    this.addImageButton.addEventListener('click', () => this.imageInput.click());
    this.imageInput.addEventListener('change', () => {
      const files = Array.from(this.imageInput.files ?? []);
      this.imageInput.value = '';
      void this.addImages(files);
    });

    this.popover.addEventListener('paste', (event) => {
      const fileImages = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
      const itemImages = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      const images = fileImages.length > 0 ? fileImages : itemImages;
      if (images.length > 0) {
        event.preventDefault();
        void this.addImages(images);
      }
    });
    this.popover.addEventListener('dragover', (event) => {
      if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file' && item.type.startsWith('image/'))) {
        event.preventDefault();
        this.popover.dataset.draggingImage = 'true';
      }
    });
    this.popover.addEventListener('dragleave', () => {
      delete this.popover.dataset.draggingImage;
    });
    this.popover.addEventListener('drop', (event) => {
      delete this.popover.dataset.draggingImage;
      const images = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'));
      if (images.length > 0) {
        event.preventDefault();
        void this.addImages(images);
      }
    });

    this.textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void this.saveDraft();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close(false);
        runtimeEditor.focus();
      }
    });

    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    this.imageLightbox.addEventListener('click', () => this.closeImageLightbox());
  }

  async openFile(filePath: string): Promise<void> {
    this.autoSaveAndClose();
    this.enabled = true;
    this.filePath = filePath;
    const sequence = ++this.loadSequence;

    try {
      const notes = await window.tutorIde.listCodeNotes(filePath);
      if (sequence !== this.loadSequence || filePath !== this.filePath) {
        return;
      }
      this.notes = notes.map((note) => this.reanchor({ ...note, images: note.images ?? [] }));
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
    this.autoSaveAndClose();
    this.enabled = false;
    this.filePath = '';
    this.notes = [];
    this.loadSequence += 1;
    this.noteDecorations.clear();
    this.addDecoration.clear();
    this.inlineNoteDecorations.clear();
    this.inlineAddDecoration.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.disable();
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    this.noteDecorations.clear();
    this.addDecoration.clear();
    this.inlineNoteDecorations.clear();
    this.inlineAddDecoration.clear();
    this.popover.remove();
    this.imageLightbox.remove();
  }

  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    if (this.popover.hidden || !this.draft) {
      return;
    }
    const target = event.target as Node | null;
    if (target && (this.popover.contains(target) || this.imageLightbox.contains(target))) {
      return;
    }
    this.autoSaveAndClose();
  };

  private openGutterAtLine(line: number): void {
    const note = this.gutterNoteAtLine(line);
    this.openDraft({
      id: note?.id ?? '',
      placement: 'gutter',
      line,
      column: 1,
      text: note?.text ?? '',
      images: [...(note?.images ?? [])],
      originalText: note?.text ?? '',
      originalImagePaths: (note?.images ?? []).map((image) => image.path),
    });
  }

  private openInlineAtPosition(line: number, column: number, note?: CodeNote): void {
    const normalizedColumn = note
      ? this.nearestSafeColumn(line, note.column)
      : this.nearestSafeColumn(line, column);
    if (!note && !this.isValidInlineAnchor(line, normalizedColumn)) {
      this.onStatus('📝 完整单词中间不能插入便签；请把光标移到空格、标点或单词边界。');
      return;
    }
    this.openDraft({
      id: note?.id ?? '',
      placement: 'inline',
      line,
      column: normalizedColumn,
      text: note?.text ?? '',
      images: [...(note?.images ?? [])],
      originalText: note?.text ?? '',
      originalImagePaths: (note?.images ?? []).map((image) => image.path),
    });
  }

  private openDraft(draft: DraftNote): void {
    if (this.draft) {
      this.autoSaveAndClose();
    }
    this.draft = draft;
    this.textarea.value = draft.text;
    this.lineLabel.textContent = draft.placement === 'gutter'
      ? `L${draft.line} · 行号旁`
      : `L${draft.line}:C${draft.column} · 代码中`;
    this.popover.title = `${this.filePath}\n项目便签保存在 .ai-code-tutor/notes.json`;
    this.deleteButton.hidden = !draft.id;
    this.popover.hidden = false;
    void this.renderDraftImages();
    this.repositionPopover();
    window.setTimeout(() => this.textarea.focus(), 0);
  }

  private close(clearTextarea = true): void {
    this.draft = null;
    this.popover.hidden = true;
    if (clearTextarea) {
      this.textarea.value = '';
      this.imagesElement.replaceChildren();
    }
  }

  private autoSaveAndClose(): void {
    if (!this.draft || this.popover.hidden) {
      this.close();
      return;
    }

    const snapshot = this.snapshotDraft();
    const changed = this.isDraftChanged();
    this.close();
    if (!changed) {
      return;
    }

    if (!snapshot.text && snapshot.images.length === 0) {
      this.onStatus(snapshot.id
        ? '📝 便签内容已清空；未自动覆盖原便签，如要删除请使用“删除”。'
        : '📝 空便签已收起。');
      return;
    }

    void this.persistSnapshot(snapshot, false);
  }

  private async saveDraft(): Promise<void> {
    if (!this.draft) {
      return;
    }
    const snapshot = this.snapshotDraft();
    if (!snapshot.text && snapshot.images.length === 0) {
      this.onStatus('便签至少需要文字或图片。');
      this.textarea.focus();
      return;
    }

    this.saveButton.disabled = true;
    this.saveButton.textContent = '保存中…';
    try {
      await this.persistSnapshot(snapshot, true);
    } finally {
      this.saveButton.disabled = false;
      this.saveButton.textContent = '保存';
    }
  }

  private snapshotDraft(): PersistDraftSnapshot {
    if (!this.draft) {
      throw new Error('没有正在编辑的便签。');
    }
    const line = this.currentTrackedLine(this.draft.id, this.draft.line);
    const column = this.draft.placement === 'gutter'
      ? 1
      : this.nearestSafeColumn(line, this.draft.column);
    return {
      id: this.draft.id,
      placement: this.draft.placement,
      line,
      column,
      text: this.textarea.value.trim(),
      images: [...this.draft.images],
      filePath: this.filePath,
      anchorText: this.lineAnchor(line),
    };
  }

  private async persistSnapshot(snapshot: PersistDraftSnapshot, closeAfter: boolean): Promise<void> {
    try {
      const saved = await window.tutorIde.upsertCodeNote({
        id: snapshot.id,
        filePath: snapshot.filePath,
        placement: snapshot.placement,
        line: snapshot.line,
        column: snapshot.column,
        anchorText: snapshot.anchorText,
        text: snapshot.text,
        images: snapshot.images,
      });

      if (snapshot.filePath === this.filePath && this.enabled && !this.disposed) {
        const existingIndex = this.notes.findIndex((note) => note.id === saved.id);
        if (existingIndex >= 0) {
          this.notes[existingIndex] = this.reanchor(saved);
        } else {
          this.notes.push(this.reanchor(saved));
        }
        this.renderAllMarkers();
      }

      this.onStatus(
        saved.placement === 'gutter'
          ? `📝 已保存项目便签 · ${saved.filePath}:${saved.line}`
          : `📝 已保存项目便签 · ${saved.filePath}:${saved.line}:${saved.column}`,
      );
      if (closeAfter) {
        this.close();
        (this.editor as unknown as RuntimeStandaloneEditor).focus();
      }
    } catch (error) {
      this.onStatus(error instanceof Error ? error.message : '保存代码便签失败');
    }
  }

  private isDraftChanged(): boolean {
    if (!this.draft) {
      return false;
    }
    const currentPaths = this.draft.images.map((image) => image.path);
    return this.textarea.value.trim() !== this.draft.originalText.trim()
      || currentPaths.length !== this.draft.originalImagePaths.length
      || currentPaths.some((path, index) => path !== this.draft?.originalImagePaths[index]);
  }

  private async deleteDraft(): Promise<void> {
    if (!this.draft?.id) {
      this.close();
      return;
    }

    this.deleteButton.disabled = true;
    try {
      const id = this.draft.id;
      await window.tutorIde.deleteCodeNote(id);
      this.notes = this.notes.filter((note) => note.id !== id);
      this.renderAllMarkers();
      this.onStatus('📝 已删除项目代码便签');
      this.close();
      (this.editor as unknown as RuntimeStandaloneEditor).focus();
    } catch (error) {
      this.onStatus(error instanceof Error ? error.message : '删除代码便签失败');
    } finally {
      this.deleteButton.disabled = false;
    }
  }

  private async addImages(files: File[]): Promise<void> {
    if (!this.draft || files.length === 0) {
      return;
    }
    const draft = this.draft;
    const remaining = MAX_NOTE_IMAGES - draft.images.length;
    if (remaining <= 0) {
      this.onStatus(`单个便签最多 ${MAX_NOTE_IMAGES} 张图片。`);
      return;
    }

    const selected = files.filter((file) => file.type.startsWith('image/')).slice(0, remaining);
    if (selected.length === 0) {
      this.onStatus('这里只能插入图片。');
      return;
    }

    this.addImageButton.disabled = true;
    this.addImageButton.textContent = '导入中…';
    try {
      for (const file of selected) {
        const dataBase64 = await this.fileToBase64(file);
        const imported = await window.tutorIde.importCodeNoteImage({
          name: file.name || 'pasted-image.png',
          mimeType: file.type,
          dataBase64,
        });
        this.imageDataUrls.set(imported.path, imported.dataUrl);
        const { dataUrl: _dataUrl, ...image } = imported;
        if (this.draft !== draft) {
          continue;
        }
        draft.images.push(image);
      }
      if (this.draft === draft) {
        await this.renderDraftImages();
        this.repositionPopover();
      }
      this.onStatus(`🖼 已加入 ${selected.length} 张项目便签图片`);
    } catch (error) {
      this.onStatus(error instanceof Error ? error.message : '导入便签图片失败');
    } finally {
      this.addImageButton.disabled = false;
      this.addImageButton.textContent = '＋ 图片';
    }
  }

  private async renderDraftImages(): Promise<void> {
    this.imagesElement.replaceChildren();
    if (!this.draft || this.draft.images.length === 0) {
      this.imagesElement.hidden = true;
      return;
    }
    this.imagesElement.hidden = false;

    for (const image of this.draft.images) {
      const card = document.createElement('figure');
      card.className = 'code-note-image-card';
      const img = document.createElement('img');
      img.alt = image.name;
      img.title = '点击查看大图';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'code-note-image-remove';
      remove.textContent = '×';
      remove.title = '从便签移除图片';
      card.append(img, remove);
      this.imagesElement.appendChild(card);

      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!this.draft) {
          return;
        }
        this.draft.images = this.draft.images.filter((item) => item.path !== image.path);
        void this.renderDraftImages();
      });

      try {
        let dataUrl = this.imageDataUrls.get(image.path);
        if (!dataUrl) {
          const loaded = await window.tutorIde.readCodeNoteImage(image.path);
          dataUrl = loaded.dataUrl;
          this.imageDataUrls.set(image.path, dataUrl);
        }
        img.src = dataUrl;
        img.addEventListener('click', () => this.openImageLightbox(dataUrl ?? '', image.name));
      } catch {
        card.dataset.broken = 'true';
        img.alt = `无法读取：${image.name}`;
      }
    }
  }

  private openImageLightbox(dataUrl: string, name: string): void {
    if (!dataUrl) {
      return;
    }
    this.imageLightboxImage.src = dataUrl;
    this.imageLightboxImage.alt = name;
    this.imageLightbox.hidden = false;
  }

  private closeImageLightbox(): void {
    this.imageLightbox.hidden = true;
    this.imageLightboxImage.removeAttribute('src');
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
        glyphMarginHoverMessage: { value: this.noteHover(note, '行号便签') },
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
        glyphMarginHoverMessage: { value: '点击在行号旁添加项目便签' },
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
      const column = this.nearestSafeColumn(line, note.column);
      return this.inlineInjectedDecoration(
        line,
        column,
        ' 📝 ',
        'code-note-injected-existing',
        this.noteHover(note, '代码便签'),
      );
    }));

    const position = this.editor.getPosition();
    if (
      !position
      || !this.isValidInlineAnchor(position.lineNumber, position.column)
      || this.inlineNoteAtPosition(position.lineNumber, position.column)
    ) {
      this.inlineAddDecoration.clear();
      return;
    }

    this.inlineAddDecoration.set([this.inlineInjectedDecoration(
      position.lineNumber,
      position.column,
      ' ＋ ',
      'code-note-injected-add',
      `点击 **＋** 在 L${position.lineNumber}:C${position.column} 添加项目便签`,
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
    const safeColumn = this.nearestSafeColumn(line, column);
    const maxColumn = runtimeModel?.getLineMaxColumn(line) ?? safeColumn;
    const injected: monaco.editor.InjectedTextOptions = {
      content,
      inlineClassName: className,
      inlineClassNameAffectsLetterSpacing: true,
      // 便签只是视图层装饰，不是源码字符。只允许光标停在它左侧，
      // 禁止出现第二个“便签后方”的假光标位置，Backspace/Delete 也就
      // 不会让人误以为正在删除便签，实际却删到了源代码。
      cursorStops: monaco.editor.InjectedTextCursorStops.Left,
    };

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
      column: this.nearestSafeColumn(line, column),
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
      && this.nearestSafeColumn(line, note.column) === column
    ));
  }

  private inlineNoteNearPosition(line: number, column: number): CodeNote | undefined {
    return this.notes.find((note) => (
      note.placement === 'inline'
      && this.currentTrackedLine(note.id, note.line) === line
      && Math.abs(this.nearestSafeColumn(line, note.column) - column) <= 1
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
    const withSafeColumn = (line: number): CodeNote => ({
      ...note,
      images: note.images ?? [],
      line,
      column: note.placement === 'gutter' ? 1 : this.nearestSafeColumn(line, note.column),
    });

    if (!anchor || this.normalizedLine(original) === anchor) {
      return withSafeColumn(original);
    }

    for (let distance = 1; distance <= 50; distance += 1) {
      const before = original - distance;
      const after = original + distance;
      if (before >= 1 && this.normalizedLine(before) === anchor) {
        return withSafeColumn(before);
      }
      if (after <= maxLine && this.normalizedLine(after) === anchor) {
        return withSafeColumn(after);
      }
    }

    for (let line = 1; line <= maxLine; line += 1) {
      if (this.normalizedLine(line) === anchor) {
        return withSafeColumn(line);
      }
    }

    return withSafeColumn(original);
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

  private isValidInlineAnchor(line: number, column: number): boolean {
    const model = this.editor.getModel();
    const runtimeModel = model as RuntimeTextModel | null;
    if (!runtimeModel || line < 1 || line > runtimeModel.getLineCount()) {
      return false;
    }
    const safeColumn = this.clampColumn(line, column);
    const content = runtimeModel.getLineContent(line);
    const left = safeColumn > 1 ? content[safeColumn - 2] ?? '' : '';
    const right = safeColumn <= content.length ? content[safeColumn - 1] ?? '' : '';
    return !(this.isWordCharacter(left) && this.isWordCharacter(right));
  }

  private nearestSafeColumn(line: number, column: number): number {
    const clamped = this.clampColumn(line, column);
    if (this.isValidInlineAnchor(line, clamped)) {
      return clamped;
    }

    const model = this.editor.getModel() as RuntimeTextModel | null;
    const maxColumn = model?.getLineMaxColumn(line) ?? clamped;
    for (let distance = 1; distance <= maxColumn; distance += 1) {
      const right = clamped + distance;
      if (right <= maxColumn && this.isValidInlineAnchor(line, right)) {
        return right;
      }
      const left = clamped - distance;
      if (left >= 1 && this.isValidInlineAnchor(line, left)) {
        return left;
      }
    }
    return clamped;
  }

  private isWordCharacter(value: string): boolean {
    return Boolean(value && WORD_CHARACTER.test(value));
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

    const width = Math.min(320, Math.max(240, this.stage.clientWidth - 24));
    const estimatedHeight = this.draft.images.length > 0 ? 270 : 190;
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

  private noteHover(note: CodeNote, title: string): string {
    const imageText = note.images?.length ? `\n\n🖼 ${note.images.length} 张图片` : '';
    return `📝 **${title}**\n\n${this.preview(note.text) || '（图片便签）'}${imageText}`;
  }

  private preview(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
  }

  private async fileToBase64(file: File): Promise<string> {
    if (file.size > 8 * 1024 * 1024) {
      throw new Error(`${file.name || '图片'} 超过 8 MB。`);
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(',');
    if (comma < 0) {
      throw new Error('图片编码失败。');
    }
    return dataUrl.slice(comma + 1);
  }

  private requireInside<T extends Element>(selector: string): T {
    const element = this.popover.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing code note UI element ${selector}`);
    }
    return element;
  }
}
