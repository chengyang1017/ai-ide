import type { DemoFile } from '../demo/demo_project';
import { monaco } from './monaco_setup';

export class EditorController {
  readonly editor: monaco.editor.IStandaloneCodeEditor;

  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private currentPath = '';
  private highlightCollection: monaco.editor.IEditorDecorationsCollection;

  constructor(container: HTMLElement, files: DemoFile[]) {
    for (const file of files) {
      const uri = monaco.Uri.parse(`file:///${file.path}`);
      const model = monaco.editor.createModel(file.content, file.language, uri);
      this.models.set(file.path, model);
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

  openFile(path: string): void {
    if (path === this.currentPath) {
      return;
    }

    const model = this.requireModel(path);
    this.currentPath = path;
    this.editor.setModel(model);
    this.highlightCollection.clear();
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

  getVisiblePosition(line: number, column: number): { left: number; top: number; height: number } | null {
    return this.editor.getScrolledVisiblePosition({
      lineNumber: line,
      column,
    });
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

  private requireModel(path: string): monaco.editor.ITextModel {
    const model = this.models.get(path);
    if (!model) {
      throw new Error(`Unknown file: ${path}`);
    }
    return model;
  }
}
