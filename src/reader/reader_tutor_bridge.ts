import './tutor_dialog.css';

const TARGET_PATTERN =
  /·\s+(.+):(\d+)\s*$/;

let installed = false;

function splitSpeechIntoChunks(
  text: string,
): string[] {
  if (!text) {
    return [];
  }

  const chunks: string[] = [];
  let chunkStart = 0;
  let sentenceCount = 0;

  const strongBoundary =
    new Set([
      '。',
      '！',
      '？',
      '；',
      '!',
      '?',
      ';',
    ]);

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    const char = text[index] ?? '';
    const next = text[index + 1] ?? '';

    const englishPeriod =
      char === '.'
      && (
        index === text.length - 1
        || /\s/.test(next)
      );

    const lineBreak = char === '\n';
    const sentenceBoundary =
      strongBoundary.has(char)
      || englishPeriod;

    if (
      !lineBreak
      && !sentenceBoundary
    ) {
      continue;
    }

    if (sentenceBoundary) {
      sentenceCount += 1;
    }

    let end = index + 1;

    while (
      end < text.length
      && /[\t \r\n]/.test(
        text[end] ?? '',
      )
    ) {
      end += 1;
    }

    const candidate =
      text.slice(
        chunkStart,
        end,
      );

    const visibleLength =
      candidate
        .replace(/\s+/g, '')
        .length;

    if (
      lineBreak
      || sentenceCount >= 2
      || visibleLength >= 72
    ) {
      chunks.push(candidate);
      chunkStart = end;
      sentenceCount = 0;
      index = end - 1;
    }
  }

  if (chunkStart < text.length) {
    chunks.push(
      text.slice(chunkStart),
    );
  }

  return chunks.length > 0
    ? chunks
    : [text];
}

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

  // CharacterController remains the only speech-text source. Moving the
  // existing bubble inside the robot means Edit and Reader mode share the
  // same caption node and therefore cannot drift into different wording.
  if (bubble.parentElement !== character) {
    character.appendChild(bubble);
  }

  bubble.classList.add(
    'tutor-dialog-card',
  );
  bubble.setAttribute(
    'role',
    'status',
  );
  bubble.setAttribute(
    'aria-live',
    'polite',
  );

  let activeLine: number | null = null;
  let activeTargetKey = '';
  let readerPositionFrame = 0;
  let bubblePositionFrame = 0;

  const isReaderMode =
    (): boolean =>
      stage.dataset.editorSurface
        === 'reader';

  const formatSpeechBubble =
    (): void => {
      if (
        bubble.querySelector(
          '.tutor-dialog-chunk',
        )
      ) {
        return;
      }

      const speech =
        bubble.textContent ?? '';

      if (!speech.trim()) {
        return;
      }

      const chunks =
        splitSpeechIntoChunks(
          speech,
        );

      const fragment =
        document.createDocumentFragment();

      for (const chunk of chunks) {
        const row =
          document.createElement('span');

        row.className =
          'tutor-dialog-chunk';
        row.textContent = chunk;
        fragment.appendChild(row);
      }

      // The spans contain slices of the original string without adding or
      // deleting characters. bubble.textContent therefore still equals the
      // exact text sent to speechSynthesis.
      bubble.replaceChildren(
        fragment,
      );
    };

  const syncBubbleAnchor =
    (): void => {
      bubblePositionFrame = 0;

      formatSpeechBubble();

      const availableWidth =
        Math.max(
          220,
          stage.clientWidth - 24,
        );

      const preferredWidth =
        stage.clientWidth <= 820
          ? 340
          : 420;

      const dialogWidth =
        Math.min(
          preferredWidth,
          availableWidth,
        );

      // Tablet CSS historically pinned the old one-line bubble using
      // !important. Inline important values deliberately win here so the
      // dialog can stay attached to the robot on every layout.
      bubble.style.setProperty(
        'width',
        `${dialogWidth}px`,
        'important',
      );
      bubble.style.setProperty(
        'max-width',
        `${availableWidth}px`,
        'important',
      );

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
      const gap = 12;
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

      const localLeft =
        viewportLeft
          - characterRect.left;
      const localTop =
        viewportTop
          - characterRect.top;

      bubble.style.setProperty(
        'left',
        `${Math.round(localLeft)}px`,
        'important',
      );
      bubble.style.setProperty(
        'top',
        `${Math.round(localTop)}px`,
        'important',
      );
      bubble.style.setProperty(
        'right',
        'auto',
        'important',
      );
      bubble.style.setProperty(
        'bottom',
        'auto',
        'important',
      );

      const tailX =
        Math.max(
          20,
          Math.min(
            bubbleWidth - 20,
            characterRect.left
              + characterRect.width / 2
              - viewportLeft,
          ),
        );

      bubble.style.setProperty(
        '--tutor-tail-x',
        `${Math.round(tailX)}px`,
      );
      bubble.style.setProperty(
        '--tutor-dialog-origin-x',
        `${Math.round(tailX)}px`,
      );
      bubble.style.setProperty(
        '--tutor-dialog-origin-y',
        placement === 'below'
          ? '0%'
          : '100%',
      );

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

  const characterPositionObserver =
    new MutationObserver(
      scheduleBubbleAnchor,
    );

  characterPositionObserver.observe(
    character,
    {
      attributes: true,
      attributeFilter: [
        'style',
        'data-placement',
        'data-vertical-placement',
      ],
    },
  );

  const bubbleObserver =
    new MutationObserver(
      () => {
        formatSpeechBubble();
        scheduleBubbleAnchor();
      },
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

  formatSpeechBubble();
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
