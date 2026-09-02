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

  // The speech bubble must move with the robot. Keeping it as a sibling of
  // #tutor-character makes its absolute position relative to tutor-surface,
  // which is why the bubble stayed in the editor corner while the robot moved.
  // Re-parent the existing bubble instead of creating another caption so the
  // exact same DOM node/text is still controlled by CharacterController.
  if (bubble.parentElement !== character) {
    character.appendChild(bubble);
  }

  let activeLine: number | null = null;
  let activeTargetKey = '';
  let positionFrame = 0;
  let bubbleFrame = 0;

  const isReaderMode =
    (): boolean =>
      stage.dataset.editorSurface
        === 'reader';

  const syncBubbleAnchor =
    (): void => {
      bubbleFrame = 0;

      const availableWidth =
        Math.max(
          120,
          stage.clientWidth - 24,
        );

      bubble.style.maxWidth =
        `${availableWidth}px`;

      if (isReaderMode()) {
        bubble.style.width =
          `${Math.min(
            460,
            availableWidth,
          )}px`;
      } else {
        bubble.style.width = '';
      }

      const stageRect =
        stage.getBoundingClientRect();
      const characterRect =
        character.getBoundingClientRect();

      const bubbleWidth =
        Math.max(
          1,
          bubble.offsetWidth,
        );
      const bubbleHeight =
        Math.max(
          1,
          bubble.offsetHeight,
        );

      const inset = 12;
      const gap = 10;

      const minViewportLeft =
        stageRect.left + inset;
      const maxViewportLeft =
        Math.max(
          minViewportLeft,
          stageRect.right
            - inset
            - bubbleWidth,
        );

      const preferredViewportLeft =
        characterRect.left
          + characterRect.width / 2
          - bubbleWidth / 2;

      const viewportLeft =
        Math.max(
          minViewportLeft,
          Math.min(
            maxViewportLeft,
            preferredViewportLeft,
          ),
        );

      const aboveViewportTop =
        characterRect.top
          - gap
          - bubbleHeight;
      const belowViewportTop =
        characterRect.bottom + gap;

      let viewportTop: number;
      let verticalPlacement:
        | 'above'
        | 'below'
        | 'edge';

      if (
        aboveViewportTop
          >= stageRect.top + inset
      ) {
        viewportTop = aboveViewportTop;
        verticalPlacement = 'above';
      } else if (
        belowViewportTop
          + bubbleHeight
          <= stageRect.bottom - inset
      ) {
        viewportTop = belowViewportTop;
        verticalPlacement = 'below';
      } else {
        const minViewportTop =
          stageRect.top + inset;
        const maxViewportTop =
          Math.max(
            minViewportTop,
            stageRect.bottom
              - inset
              - bubbleHeight,
          );

        viewportTop =
          Math.max(
            minViewportTop,
            Math.min(
              maxViewportTop,
              characterRect.top,
            ),
          );
        verticalPlacement = 'edge';
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
        verticalPlacement;
    };

  const scheduleBubbleAnchor =
    (): void => {
      if (bubbleFrame !== 0) {
        return;
      }

      bubbleFrame =
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
        // CharacterController uses the exact same speech string for this
        // bubble and VoiceController. This bridge only anchors that existing
        // caption to the robot; it never creates or rewrites speech text.
        bubble.classList.add(
          'visible',
        );
      }

      scheduleBubbleAnchor();
    };

  const positionCharacter =
    (): void => {
      positionFrame = 0;

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
        scheduleBubbleAnchor();
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
        scheduleBubbleAnchor();
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

      scheduleBubbleAnchor();
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

      schedulePosition();
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

  const characterObserver =
    new MutationObserver(
      () => {
        ensureSpeechDialog();
        schedulePosition();
        scheduleBubbleAnchor();
      },
    );

  characterObserver.observe(
    character,
    {
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'data-placement',
        'data-vertical-placement',
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
      schedulePosition();
      scheduleBubbleAnchor();
    },
  );

  window.addEventListener(
    'resize',
    () => {
      schedulePosition();
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
