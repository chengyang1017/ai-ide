import type { TutorMove } from '../core/tutor_move';
import type { EditorController } from '../editor/editor_controller';
import { monaco } from '../editor/monaco_setup';
import type { VoiceController } from '../voice/voice_controller';

function tutorText(
  chinese: string,
  english: string,
): string {
  const language = document
    .querySelector<HTMLSelectElement>('#voice-language')
    ?.value
    ?.toLowerCase() ?? '';
  return language.startsWith('en') ? english : chinese;
}

type AgentEditFocusDetail = {
  type: 'modified' | 'created' | 'deleted';
  filePath: string;
  line: number;
  endLine: number;
  oldPreview: string;
  newPreview: string;
};

export class CharacterController {
  private currentMove: TutorMove | null = null;
  private moveSequence = 0;
  private questionPaused = false;
  private questionResume: (() => void) | null = null;
  private agentEditZoneId: string | null = null;
  private agentEditSequence = 0;
  private agentEditQueue: Promise<void> = Promise.resolve();

  private readonly character: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly status: HTMLElement;
  private readonly agentEditDecorations:
    monaco.editor.IEditorDecorationsCollection;

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
    this.agentEditDecorations =
      this.editorController.editor.createDecorationsCollection();

    // Monaco 的 Ctrl+F / Replace 搜索框优先于 Tutor 气泡。
    // 搜索打开时只隐藏气泡，不停止语音，也不打断当前讲解。
    const editorStage =
      this.character.closest('.editor-stage');

    const syncBubbleWithFindWidget = (): void => {
      const findWidgetVisible = Boolean(
        editorStage?.querySelector(
          '.monaco-editor .find-widget.visible',
        ),
      );

      this.bubble.style.visibility =
        findWidgetVisible ? 'hidden' : '';

      this.bubble.style.opacity =
        findWidgetVisible ? '0' : '';
    };

    if (editorStage) {
      const findWidgetObserver =
        new MutationObserver(
          syncBubbleWithFindWidget,
        );

      findWidgetObserver.observe(
        editorStage,
        {
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        },
      );

      syncBubbleWithFindWidget();
    }

    this.editorController.onViewportChanged(() => {
      this.syncToEditor(false);
    });

    window.addEventListener(
      'ai-ide-agent-edit-focus',
      (event) => {
        const detail =
          (event as CustomEvent<AgentEditFocusDetail>)
            .detail;

        if (
          !detail
            || !detail.filePath
            || !Number.isFinite(detail.line)
        ) {
          return;
        }

        this.agentEditQueue = this.agentEditQueue
          .then(() => this.presentAgentEdit(detail))
          .catch(() => {
            // A failed presentation must not block later Agent edits.
          });
      },
    );
  }

  async moveTo(move: TutorMove): Promise<void> {
    const moveId = ++this.moveSequence;

    await this.waitForQuestionResume(moveId);
    if (moveId !== this.moveSequence) return;

    const changedFile =
      move.filePath !== this.editorController.path;

    if (changedFile) {
      this.setStatus('跨文件跳跃');
      this.character.classList.add('portal-out');

      await delay(220);

      if (moveId !== this.moveSequence) return;

      await this.waitForQuestionResume(moveId);
      if (moveId !== this.moveSequence) return;

      if (!this.editorController.hasFile(move.filePath)) {
        if (!this.loadFile) {
          throw new Error(
            `角色还没有加载目标文件：${move.filePath}`,
          );
        }

        await this.loadFile(move.filePath);

        if (moveId !== this.moveSequence) return;
      } else {
        this.editorController.openFile(move.filePath);
      }

      this.character.classList.remove('portal-out');
      this.character.classList.add('portal-in');

      window.setTimeout(() => {
        this.character.classList.remove('portal-in');
      }, 420);
    }

    if (moveId !== this.moveSequence) return;

    this.currentMove = move;

    this.editorController.highlightLine(move.line);
    this.editorController.reveal(
      move.line,
      move.column,
    );

    await delay(changedFile ? 240 : 120);

    if (moveId !== this.moveSequence) return;

    await this.waitForQuestionResume(moveId);
    if (moveId !== this.moveSequence) return;

    this.syncToEditor(true);

    this.character.dataset.action = move.action;

    this.bubble.textContent = move.speech;
    this.bubble.classList.add('visible');

    const actionLabel =
      move.action === 'point'
        ? '正在指代码'
        : move.action === 'think'
          ? '正在思考'
          : '跳到目标';

    this.setStatus(
      `${actionLabel} · ${move.filePath}:${move.line}`,
    );

    if (
      move.voice !== false
        && this.voiceController?.isEnabled
    ) {
      await this.voiceController.speak(move.speech);
    }

    await this.waitForQuestionResume(moveId);
  }

  pauseForQuestion(question: string): void {
    if (!this.currentMove) return;

    this.questionPaused = true;

    this.voiceController?.stop();

    this.bubble.textContent = `${tutorText('你问：', 'You asked: ')}${question}`;
    this.bubble.classList.add('visible');

    this.setStatus(
      '讲解已暂停 · 正在回答你的问题',
    );
  }

  async presentQuestionAnswer(
    answer: string,
  ): Promise<void> {
    this.bubble.textContent = answer;
    this.bubble.classList.add('visible');

    this.setStatus('回答问题中');

    if (this.voiceController?.isEnabled) {
      await this.voiceController.speak(answer);
    }
  }

  resumeAfterQuestion(): void {
    this.questionPaused = false;

    const resume = this.questionResume;
    this.questionResume = null;

    resume?.();

    this.setStatus('继续刚才的讲解');
  }

  getTeachingContext(): {
    filePath: string;
    line: number;
    column: number;
    speech: string;
  } | null {
    if (!this.currentMove) {
      return null;
    }

    return {
      filePath: this.currentMove.filePath,
      line: this.currentMove.line,
      column: this.currentMove.column,
      speech: this.currentMove.speech,
    };
  }

  stopSpeech(): void {
    this.moveSequence += 1;

    this.voiceController?.stop();
  }

  interrupt(
    message = tutorText('讲解已打断', 'Explanation interrupted'),
  ): void {
    this.stopSpeech();

    this.questionPaused = false;

    const resume = this.questionResume;
    this.questionResume = null;

    resume?.();

    this.currentMove = null;

    this.editorController.clearHighlight();
    this.clearAgentEditDiff();

    this.hideBubble();

    this.character.classList.remove(
      'jumping',
      'portal-in',
      'portal-out',
    );

    this.character.classList.add('offscreen');

    this.setStatus(message);
  }

  get voiceEnabled(): boolean {
    return this.voiceController?.isEnabled ?? false;
  }

  clear(
    message = tutorText('等待操作', 'Waiting for action'),
  ): void {
    this.stopSpeech();

    this.questionPaused = false;

    const resume = this.questionResume;
    this.questionResume = null;

    resume?.();

    this.currentMove = null;

    this.editorController.clearHighlight();
    this.clearAgentEditDiff();

    this.hideBubble();

    this.character.classList.add('offscreen');

    this.setStatus(message);
  }

  hideBubble(): void {
    this.bubble.classList.remove('visible');
  }

  private async presentAgentEdit(
    detail: AgentEditFocusDetail,
  ): Promise<void> {
    if (detail.type === 'deleted') {
      return;
    }

    const sequence = ++this.agentEditSequence;
    this.clearAgentEditDiff();

  const speech =
    detail.type === 'created'
      ? tutorText(
          '我正在新建这段代码。你可以直接看编辑器里的红色删除和绿色新增。',
          'I am adding this code. You can watch the red deletions and green additions directly in the editor.',
        )
      : detail.oldPreview && detail.newPreview
        ? tutorText(
            '我正在把这里的旧代码换成新的实现。你可以直接看编辑器里的红色删除和绿色新增。',
            'I am replacing the old code with the new implementation. You can watch the red deletions and green additions directly in the editor.',
          )
        : detail.oldPreview
          ? tutorText(
              '我正在删掉这里的旧代码。你可以直接看编辑器里的红色删除和绿色新增。',
              'I am removing the old code here. You can watch the red deletions and green additions directly in the editor.',
            )
          : tutorText(
              '我正在这里加入新代码。你可以直接看编辑器里的红色删除和绿色新增。',
              'I am adding new code here. You can watch the red deletions and green additions directly in the editor.',
            );

  await this.moveTo({
    filePath: detail.filePath,
    line: Math.max(1, detail.line),
    column: 1,
    speech,
      action: 'point',
      voice: false,
    });

    if (sequence !== this.agentEditSequence) {
      return;
    }

    this.showAgentEditDiff(detail);
    this.syncToEditor(false);

    this.character.dataset.agentEditing = 'true';
    this.setStatus(
      `🤖 Agent 正在修改 · ${detail.filePath}:${detail.line}`,
    );

    // 这一小段停留时间是给用户真正“看它改”的，而不是为了等 I/O。
    await delay(720);

    if (sequence !== this.agentEditSequence) {
      return;
    }

    this.character.dataset.agentEditing = 'false';
  }

  private showAgentEditDiff(
    detail: AgentEditFocusDetail,
  ): void {
    const editor = this.editorController.editor;
    const model = editor.getModel();

    if (
      !model
        || this.editorController.path !== detail.filePath
    ) {
      return;
    }

    const lineCount = Math.max(1, model.getLineCount());
    const startLine = Math.max(
      1,
      Math.min(detail.line, lineCount),
    );
    const endLine = Math.max(
      startLine,
      Math.min(detail.endLine, lineCount),
    );

    if (detail.newPreview.trim()) {
      this.agentEditDecorations.set([
        {
          range: new monaco.Range(
            startLine,
            1,
            endLine,
            model.getLineMaxColumn(endLine),
          ),
          options: {
            isWholeLine: true,
            className: 'agent-edit-added-line',
            linesDecorationsClassName:
              'agent-edit-added-gutter',
          },
        },
      ]);
    } else {
      this.agentEditDecorations.clear();
    }

    const deletedLines = detail.oldPreview
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .slice(0, 4);

    if (deletedLines.length === 0) {
      return;
    }

    const zoneNode = document.createElement('div');
    zoneNode.className = 'agent-edit-deleted-zone';

    for (const deletedLine of deletedLines) {
      const row = document.createElement('div');
      row.className = 'agent-edit-deleted-line';

      const prefix = document.createElement('span');
      prefix.className = 'agent-edit-deleted-prefix';
      prefix.textContent = '−';

      const code = document.createElement('span');
      code.className = 'agent-edit-deleted-code';
      code.textContent = deletedLine;

      row.append(prefix, code);
      zoneNode.append(row);
    }

    editor.changeViewZones((accessor) => {
      this.agentEditZoneId = accessor.addZone({
        afterLineNumber: Math.max(0, startLine - 1),
        heightInLines: deletedLines.length,
        domNode: zoneNode,
      });
    });
  }

  private clearAgentEditDiff(): void {
    this.agentEditDecorations.clear();

    if (!this.agentEditZoneId) {
      return;
    }

    const zoneId = this.agentEditZoneId;
    this.agentEditZoneId = null;

    this.editorController.editor.changeViewZones(
      (accessor) => {
        accessor.removeZone(zoneId);
      },
    );
  }

  private syncToEditor(
    animate: boolean,
  ): void {
    if (!this.currentMove) {
      return;
    }

    const placement =
      this.editorController.getTutorPlacement(
        this.currentMove.line,
      );

    if (!placement) {
      this.character.classList.add('offscreen');
      return;
    }

    this.character.classList.remove('offscreen');

    this.character.classList.toggle(
      'jumping',
      animate,
    );

    this.character.dataset.placement =
      placement.placement;

    // Alpha 0.18：
    // 给正在讲解的目标代码上下保留安全区域，
    // 尽量避免机器人身体盖住附近代码。
    const surfaceHeight =
      this.character.parentElement?.clientHeight ?? 0;

    const characterHeight = Math.max(
      76,
      this.character.offsetHeight || 0,
    );

    const lineHeight = 24;
    const safeGap = 14;

    const safeTop =
      placement.top - lineHeight * 2;

    const safeBottom =
      placement.top + lineHeight * 3;

    const belowY =
      safeBottom + safeGap;

    const aboveY =
      safeTop - characterHeight - safeGap;

    const maxY = Math.max(
      8,
      surfaceHeight - characterHeight - 8,
    );

    let y: number;

    let verticalPlacement:
      | 'below'
      | 'above'
      | 'edge';

    if (belowY <= maxY) {
      y = belowY;
      verticalPlacement = 'below';
    } else if (aboveY >= 8) {
      y = aboveY;
      verticalPlacement = 'above';
    } else {
      const targetCenter =
        placement.top + lineHeight / 2;

      y =
        targetCenter < surfaceHeight / 2
          ? maxY
          : 8;

      verticalPlacement = 'edge';
    }

    this.character.dataset.verticalPlacement =
      verticalPlacement;

    this.character.style.transform =
      `translate3d(` +
      `${placement.left}px, ` +
      `${Math.round(y)}px, ` +
      `0)`;

    if (animate) {
      window.setTimeout(() => {
        this.character.classList.remove(
          'jumping',
        );
      }, 520);
    }
  }

  private async waitForQuestionResume(
    moveId: number,
  ): Promise<void> {
    if (
      !this.questionPaused ||
      moveId !== this.moveSequence
    ) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.questionResume = resolve;
    });
  }

  private setStatus(
    value: string,
  ): void {
    this.status.textContent = value;
  }
}

function delay(
  ms: number,
): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
