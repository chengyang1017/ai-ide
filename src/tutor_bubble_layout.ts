const DESKTOP_BREAKPOINT = 1180;
const BUBBLE_GAP = 16;
const EDGE_PADDING = 18;
const MAX_BUBBLE_WIDTH = 480;
const MAX_BUBBLE_HEIGHT = 330;

interface Candidate {
  x: number;
  y: number;
  side: 'above' | 'below';
  horizontal: 'left' | 'right';
}

interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function installTutorBubbleLayout(): void {
  const surface = document.querySelector<HTMLElement>('#tutor-surface');
  const character = document.querySelector<HTMLElement>('#tutor-character');
  const bubble = document.querySelector<HTMLElement>('#speech-bubble');

  if (!surface || !character || !bubble) {
    window.requestAnimationFrame(installTutorBubbleLayout);
    return;
  }

  const style = document.createElement('style');
  style.dataset.tutorBubbleSmartLayout = 'true';
  style.textContent = `
    @media (min-width: 1181px) {
      #tutor-character > .speech-bubble {
        position: absolute !important;
        z-index: 40 !important;
        top: var(--tutor-bubble-top, -230px) !important;
        right: auto !important;
        bottom: auto !important;
        left: var(--tutor-bubble-left, 86px) !important;
        width: min(${MAX_BUBBLE_WIDTH}px, calc(100vw - 64px)) !important;
        max-width: ${MAX_BUBBLE_WIDTH}px !important;
        max-height: min(${MAX_BUBBLE_HEIGHT}px, 52vh) !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        padding: 14px 18px 18px !important;
        border: 1px solid #465064 !important;
        border-radius: 14px !important;
        background: rgb(29 34 43 / 97%) !important;
        box-shadow: 0 18px 45px rgb(0 0 0 / 42%) !important;
        color: #edf0f6 !important;
        font-size: 14px !important;
        line-height: 1.72 !important;
        white-space: pre-wrap !important;
        text-overflow: clip !important;
        pointer-events: auto !important;
        opacity: 0 !important;
        transform: translateY(8px) scale(.985) !important;
        transition: opacity 160ms ease, transform 160ms ease !important;
      }

      #tutor-character > .speech-bubble::before {
        content: '✦  AI Tutor';
        display: block;
        width: max-content;
        margin: 0 0 12px;
        padding: 4px 9px;
        border: 1px solid rgb(137 116 255 / 42%);
        border-radius: 999px;
        background: rgb(106 84 214 / 22%);
        color: #bdb2ff;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.2;
      }

      #tutor-character > .speech-bubble.visible {
        opacity: 1 !important;
        transform: translateY(0) scale(1) !important;
      }

      #tutor-character[data-bubble-horizontal='right'] > .speech-bubble {
        border-top-left-radius: 5px !important;
      }

      #tutor-character[data-bubble-horizontal='left'] > .speech-bubble {
        border-top-right-radius: 5px !important;
      }

      #tutor-character[data-bubble-side='above'] > .speech-bubble {
        transform-origin: 50% 100% !important;
      }

      #tutor-character[data-bubble-side='below'] > .speech-bubble {
        transform-origin: 50% 0 !important;
      }
    }
  `;
  document.head.appendChild(style);

  let frame = 0;

  const scheduleLayout = (): void => {
    if (frame) {
      return;
    }
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      syncBubbleParent();
      positionBubble();
    });
  };

  const syncBubbleParent = (): void => {
    const desktop = window.innerWidth > DESKTOP_BREAKPOINT;

    if (desktop && bubble.parentElement !== character) {
      character.prepend(bubble);
    } else if (!desktop && bubble.parentElement !== surface) {
      surface.prepend(bubble);
    }

    if (!desktop) {
      delete character.dataset.bubbleSide;
      delete character.dataset.bubbleHorizontal;
      character.style.removeProperty('--tutor-bubble-left');
      character.style.removeProperty('--tutor-bubble-top');
    }
  };

  const positionBubble = (): void => {
    if (window.innerWidth <= DESKTOP_BREAKPOINT || bubble.parentElement !== character) {
      return;
    }

    const surfaceRect = surface.getBoundingClientRect();
    const characterRect = character.getBoundingClientRect();
    if (!surfaceRect.width || !surfaceRect.height || !characterRect.width || !characterRect.height) {
      return;
    }

    const bubbleWidth = Math.min(
      MAX_BUBBLE_WIDTH,
      Math.max(300, surfaceRect.width - EDGE_PADDING * 2),
    );
    const measuredHeight = Math.max(bubble.scrollHeight, 180);
    const bubbleHeight = Math.min(
      MAX_BUBBLE_HEIGHT,
      Math.max(180, Math.min(measuredHeight, surfaceRect.height - EDGE_PADDING * 2)),
    );

    const charLeft = characterRect.left - surfaceRect.left;
    const charTop = characterRect.top - surfaceRect.top;
    const charRight = characterRect.right - surfaceRect.left;
    const charBottom = characterRect.bottom - surfaceRect.top;

    const upperY = charTop - bubbleHeight - BUBBLE_GAP;
    const lowerY = charBottom + BUBBLE_GAP;
    const rightX = charRight + BUBBLE_GAP;
    const leftX = charLeft - bubbleWidth - BUBBLE_GAP;

    const candidates: Candidate[] = [
      { x: rightX, y: upperY, side: 'above', horizontal: 'right' },
      { x: rightX, y: lowerY, side: 'below', horizontal: 'right' },
      { x: leftX, y: upperY, side: 'above', horizontal: 'left' },
      { x: leftX, y: lowerY, side: 'below', horizontal: 'left' },
    ];

    const codeRects = visibleCodeRects(surfaceRect);
    const best = candidates
      .map((candidate, index) => ({
        candidate,
        score: candidateScore(
          candidate,
          bubbleWidth,
          bubbleHeight,
          surfaceRect.width,
          surfaceRect.height,
          codeRects,
        ) + index * 0.01,
      }))
      .sort((a, b) => a.score - b.score)[0]?.candidate;

    if (!best) {
      return;
    }

    const clampedX = clamp(
      best.x,
      EDGE_PADDING,
      Math.max(EDGE_PADDING, surfaceRect.width - bubbleWidth - EDGE_PADDING),
    );
    const clampedY = clamp(
      best.y,
      EDGE_PADDING,
      Math.max(EDGE_PADDING, surfaceRect.height - bubbleHeight - EDGE_PADDING),
    );

    character.dataset.bubbleSide = best.side;
    character.dataset.bubbleHorizontal = best.horizontal;
    character.style.setProperty(
      '--tutor-bubble-left',
      `${Math.round(clampedX - charLeft)}px`,
    );
    character.style.setProperty(
      '--tutor-bubble-top',
      `${Math.round(clampedY - charTop)}px`,
    );
  };

  const characterObserver = new MutationObserver(scheduleLayout);
  characterObserver.observe(character, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-vertical-placement', 'data-placement'],
  });

  const bubbleObserver = new MutationObserver(scheduleLayout);
  bubbleObserver.observe(bubble, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
    characterData: true,
  });

  const resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(surface);
  resizeObserver.observe(bubble);

  window.addEventListener('resize', scheduleLayout);
  scheduleLayout();
}

function visibleCodeRects(surfaceRect: DOMRect): RectLike[] {
  const spans = Array.from(
    document.querySelectorAll<HTMLElement>('.monaco-editor .view-lines .view-line > span'),
  );

  return spans
    .map((span) => span.getBoundingClientRect())
    .filter((rect) => (
      rect.width > 2
      && rect.height > 2
      && rect.bottom >= surfaceRect.top
      && rect.top <= surfaceRect.bottom
    ))
    .map((rect) => ({
      left: rect.left - surfaceRect.left,
      top: rect.top - surfaceRect.top,
      right: rect.right - surfaceRect.left,
      bottom: rect.bottom - surfaceRect.top,
      width: rect.width,
      height: rect.height,
    }));
}

function candidateScore(
  candidate: Candidate,
  width: number,
  height: number,
  surfaceWidth: number,
  surfaceHeight: number,
  codeRects: RectLike[],
): number {
  const rect: RectLike = {
    left: candidate.x,
    top: candidate.y,
    right: candidate.x + width,
    bottom: candidate.y + height,
    width,
    height,
  };

  const overflow =
    Math.max(0, -rect.left)
    + Math.max(0, -rect.top)
    + Math.max(0, rect.right - surfaceWidth)
    + Math.max(0, rect.bottom - surfaceHeight);

  let codeOverlap = 0;
  for (const codeRect of codeRects) {
    codeOverlap += overlapArea(rect, codeRect);
  }

  return overflow * 10000 + codeOverlap;
}

function overlapArea(a: RectLike, b: RectLike): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

installTutorBubbleLayout();
