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

  // Keep one caption source only. CharacterController already writes the
  // exact spoken text into #speech-bubble, so move that existing node into
  // the robot instead of creating a second Reader/Edit caption.
  // Once nested, every robot transform automatically carries the dialog too.
  if (bubble.parentElement !== character) {
    character.appendChild(bubble);
  }

  let activeLine: number | null = null;
  let activeTargetKey = '';
  let readerPositionFrame = 0;
  let bubblePositionFrame = 0;

  const isReaderMode =
    (): boolean =>
      stage.dataset.editorSurface
        === 'reader';

  const syncBubbleAnchor =
    (): void => {
      bubblePositionFrame = 0;

      const availableWidth =
        Math.max(
          120,
          stage.clientWidth - 24,
        );

      bubble.style.maxWidth =
        `${availableWidth}px`;
      bubble.style.width =
        isReaderMode()
          ? `${Math.min(460, availableWidth)}px`
          : '';

      const stageRect =
        stage.getBoundingClientRect();
      const characterRect =
        character.getBoundingClientRect();
      const bubbleWidth =
        Math.max(1, bubble.offsetWidth);
      const bubbleHeight =
        Math.max(1, bubble.offsetHeight);

      const inset = 12;
      const gap = 10;
      const minLeft =
        stageRect.left + inset;
      const maxLeft =
        Math.max(
          minLeft,
          stageRect.right
            - inset
            - bubbleWidth,
        );
      const preferredLeft =
        characterRect.left
          + characterRect.width / 2
          - bubbleWidth / 2;
      const viewportLeft =
        Math.max(
          minLeft,
          Math.min(
            maxLeft,
            preferredLeft,
          ),
        );

      const aboveTop =
        characterRect.top
          - gap
          - bubbleHeight;
      const belowTop =
        characterRect.bottom + gap;

      let viewportTop: number;
      let placement:
        | 'above'
        | 'below'
        | 'edge';

      if (
        aboveTop
          >= stageRect.top + inset
      ) {
        viewportTop = aboveTop;
        placement = 'above';
      } else if (
        belowTop + bubbleHeight
          <= stageRect.bottom - inset
      ) {
        viewportTop = belowTop;
        placement = 'below';
      } else {
        const minTop =
          stageRect.top + inset;
        const maxTop =
          Math.max(
            minTop,
            stageRect.bottom
              - inset
              - bubbleHeight,
          );

        viewportTop =
          Math.max(
            minTop,
            Math.min(
              maxTop,
              characterRect.top,
            ),
          );
        placement = 'edge';
      }

      bubble.style.left =
        `${Math.round(
          viewportLeft
            - characterRect.left,
        )}px`;
      bubble.style.top =
        `${Math.round(
          viewportTop
            - characterRect.top,
        )}px`;
      bubble.style.right = 'auto';
      bubble.style.bottom = 'auto';
      bubble.dataset.anchorPlacement =
        placement;
    };

  const scheduleBubbleAnchor =
    (): void => {
      if (bubblePositionFrame !== 0) {
        return;
      }

      bubblePositionFrame =
        window.requestAnimationFrame(
          syncBubbleAnchor,
        );
    };

  const ensureSpeechDialog =
    (): void => {
      if (
        character.dataset.voiceState
          === 'speaking'
        && bubble.textContent?.trim()
      ) {
        bubble.classList.add(
          'visible',
        );
      }

      scheduleBubbleAnchor();
    };

  const positionReaderCharacter =
    (): void => {
      readerPositionFrame = 0;

      if (
        !isReaderMode()
          || activeLine === null
      ) {
        scheduleBubbleAnchor();
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
        rowRect.bottom < stageRect.top
          || rowRect.top > stageRect.bottom
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
        rowRect.top - stageRect.top;
      const safeTop =
        targetTop - lineHeight * 2;
      const safeBottom =
        targetTop + lineHeight * 3;
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
          targetTop < stageHeight / 2
            ? maxY
            : 8;
        verticalPlacement = 'edge';
      }

      character.dataset.placement =
        'code-end';
      character.dataset.verticalPlacement =
        verticalPlacement;

      const nextTransform =
        `translate3d(${Math.round(left)}px, ${Math.round(y)}px, 0)`;

      if (
        character.style.transform
          !== nextTransform
      ) {
        character.style.transform =
          nextTransform;
      }

      character.classList.remove(
        'offscreen',
      );
      scheduleBubbleAnchor();
    };

  const scheduleReaderPosition =
    (): void => {
      if (readerPositionFrame !== 0) {
        return;
      }

      readerPositionFrame =
        window.requestAnimationFrame(
          positionReaderCharacter,
        );
    };

  const revealActiveLine =
    (): void => {
      if (
        !isReaderMode()
          || activeLine === null
      ) {
        scheduleBubbleAnchor();
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

      scheduleReaderPosition();
      scheduleBubbleAnchor();
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
            scheduleReaderPosition();
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
        } else {
          scheduleBubbleAnchor();
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

  const voiceObserver =
    new MutationObserver(
      ensureSpeechDialog,
    );

  voiceObserver.observe(
    character,
    {
      attributes: true,
      attributeFilter: [
        'data-voice-state',
      ],
    },
  );

  const bubbleObserver =
    new MutationObserver(
      scheduleBubbleAnchor,
    );

  bubbleObserver.observe(
    bubble,
    {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'class',
      ],
    },
  );

  window.addEventListener(
    'ai-ide-reader-viewport',
    () => {
      scheduleReaderPosition();
      scheduleBubbleAnchor();
    },
  );

  window.addEventListener(
    'resize',
    () => {
      scheduleReaderPosition();
      scheduleBubbleAnchor();
    },
  );

  syncTargetFromStatus();
  scheduleBubbleAnchor();
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
