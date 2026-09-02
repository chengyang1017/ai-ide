interface ReaderViewportDetail {
  filePath: string;
  startLine: number;
  endLine: number;
  centerLine: number;
}

const TARGET_PATTERN =
  /·\s+(.+):(\d+)\s*$/;

let installed = false;

function installReaderTutorBridge(): void {
  if (installed) {
    return;
  }

  const stage =
    document.querySelector<HTMLElement>(
      '#editor-stage',
    );

  const character =
    document.querySelector<HTMLElement>(
      '#tutor-character',
    );

  const bubble =
    document.querySelector<HTMLElement>(
      '#speech-bubble',
    );

  const status =
    document.querySelector<HTMLElement>(
      '#tutor-status',
    );

  if (
    !stage
      || !character
      || !bubble
      || !status
  ) {
    window.requestAnimationFrame(
      installReaderTutorBridge,
    );
    return;
  }

  installed = true;

  let activeLine: number | null = null;
  let activeTargetKey = '';
  let positionFrame = 0;

  const isReaderMode =
    (): boolean =>
      stage.dataset.editorSurface
        === 'reader';

  const ensureSpeechDialog =
    (): void => {
      if (
        character.dataset.voiceState
          !== 'speaking'
      ) {
        return;
      }

      // CharacterController sends the same speech string to the bubble
      // and VoiceController. Do not invent a second caption here; only
      // make sure the existing spoken text is actually visible.
      if (
        bubble.textContent?.trim()
      ) {
        bubble.classList.add(
          'visible',
        );
      }
    };

  const positionCharacter =
    (): void => {
      positionFrame = 0;

      if (
        !isReaderMode()
          || activeLine === null
      ) {
        return;
      }

      const row =
        stage.querySelector<HTMLElement>(
          `.reader-code-line[data-line-number="${activeLine}"]`,
        );

      if (!row) {
        return;
      }

      const stageRect =
        stage.getBoundingClientRect();
      const rowRect =
        row.getBoundingClientRect();

      if (
        rowRect.bottom
          < stageRect.top
          || rowRect.top
            > stageRect.bottom
      ) {
        character.classList.add(
          'offscreen',
        );
        return;
      }

      const content =
        row.querySelector<HTMLElement>(
          '.reader-line-content',
        );

      const contentRect =
        content?.getBoundingClientRect()
          ?? rowRect;

      const characterWidth =
        Math.max(
          58,
          character.offsetWidth || 0,
        );
      const characterHeight =
        Math.max(
          70,
          character.offsetHeight || 0,
        );
      const stageWidth =
        Math.max(
          characterWidth + 16,
          stage.clientWidth,
        );
      const stageHeight =
        Math.max(
          characterHeight + 16,
          stage.clientHeight,
        );

      const gap = 14;
      const preferredLeft =
        contentRect.right
          - stageRect.left
          + gap;
      const maxLeft =
        Math.max(
          8,
          stageWidth
            - characterWidth
            - 8,
        );

      const left =
        Math.max(
          8,
          Math.min(
            maxLeft,
            preferredLeft,
          ),
        );

      const lineHeight =
        Math.max(
          18,
          rowRect.height || 24,
        );
      const targetTop =
        rowRect.top
          - stageRect.top;
      const safeTop =
        targetTop
          - lineHeight * 2;
      const safeBottom =
        targetTop
          + lineHeight * 3;
      const belowY =
        safeBottom + gap;
      const aboveY =
        safeTop
          - characterHeight
          - gap;
      const maxY =
        Math.max(
          8,
          stageHeight
            - characterHeight
            - 8,
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
        y =
          targetTop
            < stageHeight / 2
            ? maxY
            : 8;
        verticalPlacement = 'edge';
      }

      character.dataset.placement =
        'code-end';
      character.dataset.verticalPlacement =
        verticalPlacement;
      character.style.transform =
        `translate3d(${Math.round(left)}px, ${Math.round(y)}px, 0)`;
      character.classList.remove(
        'offscreen',
      );
    };

  const schedulePosition =
    (): void => {
      if (positionFrame !== 0) {
        return;
      }

      positionFrame =
        window.requestAnimationFrame(
          positionCharacter,
        );
    };

  const revealActiveLine =
    (): void => {
      if (
        !isReaderMode()
          || activeLine === null
      ) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent<{
          line: number;
        }>(
          'ai-ide-reader-reveal-line',
          {
            detail: {
              line: activeLine,
            },
          },
        ),
      );

      schedulePosition();
    };

  const syncTargetFromStatus =
    (): void => {
      const value =
        status.textContent?.trim()
          ?? '';
      const match =
        value.match(
          TARGET_PATTERN,
        );

      if (match) {
        const line =
          Number.parseInt(
            match[2] ?? '',
            10,
          );

        if (
          Number.isFinite(line)
            && line >= 1
        ) {
          const key =
            `${match[1] ?? ''}:${line}`;
          const changed =
            key !== activeTargetKey;

          activeLine = line;
          activeTargetKey = key;

          if (changed) {
            revealActiveLine();
          } else {
            schedulePosition();
          }
        }
      }

      ensureSpeechDialog();
    };

  const statusObserver =
    new MutationObserver(
      syncTargetFromStatus,
    );

  statusObserver.observe(
    status,
    {
      childList: true,
      subtree: true,
      characterData: true,
    },
  );

  const stageObserver =
    new MutationObserver(
      () => {
        if (isReaderMode()) {
          revealActiveLine();
        }
      },
    );

  stageObserver.observe(
    stage,
    {
      attributes: true,
      attributeFilter: [
        'data-editor-surface',
      ],
    },
  );

  const characterObserver =
    new MutationObserver(
      () => {
        ensureSpeechDialog();
        schedulePosition();
      },
    );

  characterObserver.observe(
    character,
    {
      attributes: true,
      attributeFilter: [
        'data-voice-state',
      ],
    },
  );

  window.addEventListener(
    'ai-ide-reader-viewport',
    (
      _event: Event,
    ) => {
      schedulePosition();
    },
  );

  window.addEventListener(
    'resize',
    schedulePosition,
  );

  syncTargetFromStatus();
}

if (
  document.readyState
    === 'loading'
) {
  document.addEventListener(
    'DOMContentLoaded',
    installReaderTutorBridge,
    {
      once: true,
    },
  );
} else {
  queueMicrotask(
    installReaderTutorBridge,
  );
}

export {};
