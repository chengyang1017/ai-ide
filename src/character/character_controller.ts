import type { TutorMove } from '../demo/demo_project';
import type { EditorController } from '../editor/editor_controller';

export class CharacterController {
  private currentMove: TutorMove | null = null;
  private readonly character: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly status: HTMLElement;

  constructor(
    private readonly editorController: EditorController,
    character: HTMLElement,
    bubble: HTMLElement,
    status: HTMLElement,
  ) {
    this.character = character;
    this.bubble = bubble;
    this.status = status;

    this.editorController.onViewportChanged(() => {
      this.syncToEditor(false);
    });
  }

  async moveTo(move: TutorMove): Promise<void> {
    const changedFile = move.filePath !== this.editorController.path;

    if (changedFile) {
      if (!this.editorController.hasFile(move.filePath)) {
        throw new Error(`角色还没有加载目标文件：${move.filePath}`);
      }

      this.setStatus('跨文件跳跃');
      this.character.classList.add('portal-out');
      await delay(220);
      this.editorController.openFile(move.filePath);
      this.character.classList.remove('portal-out');
      this.character.classList.add('portal-in');
      window.setTimeout(() => this.character.classList.remove('portal-in'), 420);
    }

    this.currentMove = move;
    this.editorController.highlightLine(move.line);
    this.editorController.reveal(move.line, move.column);

    await delay(changedFile ? 240 : 120);
    this.syncToEditor(true);

    this.character.dataset.action = move.action;
    this.bubble.textContent = move.speech;
    this.bubble.classList.add('visible');

    const actionLabel = move.action === 'point'
      ? '正在指代码'
      : move.action === 'think'
        ? '正在思考'
        : '跳到目标';
    this.setStatus(`${actionLabel} · ${move.filePath}:${move.line}`);
  }

  clear(message = '等待操作'): void {
    this.currentMove = null;
    this.editorController.clearHighlight();
    this.hideBubble();
    this.character.classList.add('offscreen');
    this.setStatus(message);
  }

  hideBubble(): void {
    this.bubble.classList.remove('visible');
  }

  private syncToEditor(animate: boolean): void {
    if (!this.currentMove) {
      return;
    }

    const position = this.editorController.getVisiblePosition(
      this.currentMove.line,
      this.currentMove.column,
    );

    if (!position) {
      this.character.classList.add('offscreen');
      return;
    }

    this.character.classList.remove('offscreen');
    this.character.classList.toggle('jumping', animate);

    const x = Math.max(8, position.left + 14);
    const y = Math.max(8, position.top - 58);
    this.character.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    if (animate) {
      window.setTimeout(() => this.character.classList.remove('jumping'), 520);
    }
  }

  private setStatus(value: string): void {
    this.status.textContent = value;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
