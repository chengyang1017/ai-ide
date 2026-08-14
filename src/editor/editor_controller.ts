import type { DemoFile } from '../demo/demo_project';
import { monaco } from './monaco_setup';

export interface EditorFile {
  path: string;
  language: string;
  content: string;
}

export class EditorController {
  readonly editor: monaco.editor.IStandaloneCodeEditor;

  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private currentPath = '';
  private highlightCollection: monaco.editor.IEditorDecorationsCollection;

  constructor(container: HTMLElement, files: DemoFile[]) {
    for (const file of files) {
      this.registerModel(file);
    }

    const first = files[0];
    if (!first) {
      throw new Error('Demo project must contain at least one file.');
    }

    this.currentPath = first.path;
    this.editor = monaco.editor.create(container, {
      model: this.requireModel(first.path),
      automaticLayout: true,
      fontSize: 15,
      lineHeight: 24,
      fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
      minimap: { enabled: true },
      smoothScrolling: true,
      scrollBeyondLastLine: false,
      padding: { top: 18, bottom: 18 },
      glyphMargin: true,
      renderLineHighlight: 'all',
      cursorSmoothCaretAnimation: 'on',
    });

    this.highlightCollection = this.editor.createDecorationsCollection();
  }

  get path(): string {
    return this.currentPath;
  }

  hasFile(path: string): boolean {
    return this.models.has(path);
  }

  openFile(path: string): void {
    const model = this.requireModel(path);
    this.currentPath = path;
    this.editor.setModel(model);
    this.highlightCollection.clear();
  }

  openFileContent(file: EditorFile): void {
    let model = this.models.get(file.path);

    if (!model) {
      model = this.registerModel(file);
    } else if (model.getValue() !== file.content) {
      model.setValue(file.content);
      monaco.editor.setModelLanguage(model, file.language);
    }

    this.currentPath = file.path;
    this.editor.setModel(model);
    this.highlightCollection.clear();
  }

  replaceWorkspace(file: EditorFile): void {
    this.highlightCollection.clear();

    for (const model of this.models.values()) {
      model.dispose();
    }
    this.models.clear();

    const model = this.registerModel(file);
    this.currentPath = file.path;
    this.editor.setModel(model);
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
    this.editor.dispose();
    for (const model of this.models.values()) {
      model.dispose();
    }
  }

  private registerModel(file: EditorFile): monaco.editor.ITextModel {
    const uri = monaco.Uri.parse(`file:///workspace/${file.path}`);
    const existing = monaco.editor.getModel(uri);
    existing?.dispose();

    const model = monaco.editor.createModel(file.content, file.language, uri);
    this.models.set(file.path, model);
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
