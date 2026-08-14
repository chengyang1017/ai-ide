import type { TutorMove } from '../core/tutor_move';
import type { EditorController } from '../editor/editor_controller';
import type { VoiceController } from '../voice/voice_controller';

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
    private readonly loadFile?: (path: string) => Promise<void>,
    private readonly voiceController?: VoiceController,
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
      this.setStatus('跨文件跳跃');
      this.character.classList.add('portal-out');
      await delay(220);

      if (!this.editorController.hasFile(move.filePath)) {
        if (!this.loadFile) {
          throw new Error(`角色还没有加载目标文件：${move.filePath}`);
        }
        await this.loadFile(move.filePath);
      } else {
        this.editorController.openFile(move.filePath);
      }

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

    if (this.voiceController?.isEnabled) {
      await this.voiceController.speak(move.speech);
    }
  }

  stopSpeech(): void {
    this.voiceController?.stop();
  }

  get voiceEnabled(): boolean {
    return this.voiceController?.isEnabled ?? false;
  }

  clear(message = '等待操作'): void {
    this.stopSpeech();
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

    const placement = this.editorController.getTutorPlacement(this.currentMove.line);

    if (!placement) {
      this.character.classList.add('offscreen');
      return;
    }

    this.character.classList.remove('offscreen');
    this.character.classList.toggle('jumping', animate);
    this.character.dataset.placement = placement.placement;

    // Alpha 0.12：角色重新进入代码区，但优先站在目标行附近的空白处。
    // 会检查目标行上下两行最远的代码位置；空间不足时退到 gutter，
    // 因此角色靠近正在讲解的代码，又不会压在代码字符上。
    const surfaceHeight = this.character.parentElement?.clientHeight ?? 0;
    const maxY = Math.max(8, surfaceHeight - 76);
    const y = Math.min(Math.max(48, placement.top - 20), maxY);
    this.character.style.transform = `translate3d(${placement.left}px, ${y}px, 0)`;

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
