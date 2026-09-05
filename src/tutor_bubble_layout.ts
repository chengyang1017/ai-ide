const BUBBLE_GAP = 16;
const EDGE_PADDING = 18;
const MAX_BUBBLE_WIDTH = 480;
const MAX_BUBBLE_HEIGHT = 330;
const MIN_BUBBLE_WIDTH = 260;
const MIN_BUBBLE_HEIGHT = 120;

type VerticalSide =
  | 'above'
  | 'below';

type HorizontalSide =
  | 'left'
  | 'right';

interface Candidate {
  x: number;
  y: number;
  side: VerticalSide;
  horizontal: HorizontalSide;
}

interface PositionedCandidate
  extends Candidate {
  clampedX: number;
  clampedY: number;
  score: number;
}

interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface SafeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function installTutorBubbleLayout(): void {
  const surface =
    document.querySelector<HTMLElement>(
      '#tutor-surface',
    );
  const character =
    document.querySelector<HTMLElement>(
      '#tutor-character',
    );
  const bubble =
    document.querySelector<HTMLElement>(
      '#speech-bubble',
    );

  if (
    !surface
      || !character
      || !bubble
  ) {
    window.requestAnimationFrame(
      installTutorBubbleLayout,
    );
    return;
  }

  let frame = 0;

  const syncBubbleParent =
    (): void => {
      if (bubble.parentElement !== surface) {
        surface.prepend(bubble);
      }
    };

  const scheduleLayout =
    (): void => {
      if (frame !== 0) {
        return;
      }

      frame =
        window.requestAnimationFrame(
          () => {
            frame = 0;
            syncBubbleParent();
            positionBubble();
          },
        );
    };

  const positionBubble =
    (): void => {
      const surfaceRect =
        surface.getBoundingClientRect();
      const characterRect =
        character.getBoundingClientRect();

      if (
        surfaceRect.width <= 0
          || surfaceRect.height <= 0
      ) {
        return;
      }

      const safeBounds =
        getSafeBounds(
          surfaceRect,
        );

      if (
        safeBounds.width <= 0
          || safeBounds.height <= 0
      ) {
        return;
      }

      const targetWidth =
        Math.min(
          MAX_BUBBLE_WIDTH,
          Math.max(
            MIN_BUBBLE_WIDTH,
            safeBounds.width,
          ),
        );

      const actualWidth =
        Math.min(
          targetWidth,
          safeBounds.width,
        );

      const maxHeight =
        Math.min(
          MAX_BUBBLE_HEIGHT,
          Math.max(
            MIN_BUBBLE_HEIGHT,
            safeBounds.height,
          ),
        );

      bubble.style.setProperty(
        '--tutor-dialog-width',
        `${Math.round(actualWidth)}px`,
      );
      bubble.style.setProperty(
        '--tutor-dialog-max-height',
        `${Math.round(
          Math.min(
            maxHeight,
            safeBounds.height,
          ),
        )}px`,
      );

      // Reading offsetWidth/offsetHeight here intentionally forces layout
      // after the width/max-height variables above have changed.
      const bubbleWidth =
        Math.min(
          Math.max(
            1,
            bubble.offsetWidth,
          ),
          safeBounds.width,
        );
      const bubbleHeight =
        Math.min(
          Math.max(
            1,
            bubble.offsetHeight,
          ),
          safeBounds.height,
        );

      const charLeft =
        characterRect.left
          - surfaceRect.left;
      const charTop =
        characterRect.top
          - surfaceRect.top;
      const charRight =
        characterRect.right
          - surfaceRect.left;
      const charBottom =
        characterRect.bottom
          - surfaceRect.top;

      const upperY =
        charTop
          - bubbleHeight
          - BUBBLE_GAP;
      const lowerY =
        charBottom
          + BUBBLE_GAP;
      const rightX =
        charRight
          + BUBBLE_GAP;
      const leftX =
        charLeft
          - bubbleWidth
          - BUBBLE_GAP;

      const candidates:
        Candidate[] = [
          {
            x: rightX,
            y: upperY,
            side: 'above',
            horizontal: 'right',
          },
          {
            x: rightX,
            y: lowerY,
            side: 'below',
            horizontal: 'right',
          },
          {
            x: leftX,
            y: upperY,
            side: 'above',
            horizontal: 'left',
          },
          {
            x: leftX,
            y: lowerY,
            side: 'below',
            horizontal: 'left',
          },
        ];

      const codeRects =
        visibleCodeRects(
          surfaceRect,
        );

      const characterLocalRect:
        RectLike = {
          left: charLeft,
          top: charTop,
          right: charRight,
          bottom: charBottom,
          width:
            Math.max(
              0,
              characterRect.width,
            ),
          height:
            Math.max(
              0,
              characterRect.height,
            ),
        };

      const positioned =
        candidates
          .map(
            (
              candidate,
              index,
            ): PositionedCandidate => {
              const clampedX =
                clamp(
                  candidate.x,
                  safeBounds.left,
                  Math.max(
                    safeBounds.left,
                    safeBounds.right
                      - bubbleWidth,
                  ),
                );
              const clampedY =
                clamp(
                  candidate.y,
                  safeBounds.top,
                  Math.max(
                    safeBounds.top,
                    safeBounds.bottom
                      - bubbleHeight,
                  ),
                );

              const rect:
                RectLike = {
                  left: clampedX,
                  top: clampedY,
                  right:
                    clampedX
                      + bubbleWidth,
                  bottom:
                    clampedY
                      + bubbleHeight,
                  width: bubbleWidth,
                  height: bubbleHeight,
                };

              let codeOverlap = 0;

              for (
                const codeRect
                  of codeRects
              ) {
                codeOverlap +=
                  overlapArea(
                    rect,
                    codeRect,
                  );
              }

              const characterOverlap =
                overlapArea(
                  rect,
                  characterLocalRect,
                );

              const clampDistance =
                Math.abs(
                  clampedX
                    - candidate.x,
                )
                + Math.abs(
                  clampedY
                    - candidate.y,
                );

              // Avoid covering code first, then avoid covering the robot,
              // then prefer positions that need less edge clamping.
              const score =
                codeOverlap
                + characterOverlap
                  * 200
                + clampDistance
                  * 6
                + index
                  * 0.01;

              return {
                ...candidate,
                clampedX,
                clampedY,
                score,
              };
            },
          )
          .sort(
            (a, b) =>
              a.score - b.score,
          );

      const best =
        positioned[0];

      if (!best) {
        return;
      }

      const characterCenterX =
        charLeft
          + characterRect.width / 2;

      const tailX =
        clamp(
          characterCenterX
            - best.clampedX,
          20,
          Math.max(
            20,
            bubbleWidth - 20,
          ),
        );

      const wasHeavilyClamped =
        Math.abs(
          best.clampedX - best.x,
        ) > BUBBLE_GAP * 2
        || Math.abs(
          best.clampedY - best.y,
        ) > BUBBLE_GAP * 2;

      const characterOutsideSafeArea =
        charRight
          < safeBounds.left
        || charLeft
          > safeBounds.right
        || charBottom
          < safeBounds.top
        || charTop
          > safeBounds.bottom;

      const placement =
        wasHeavilyClamped
          || characterOutsideSafeArea
          ? 'edge'
          : best.side;

      bubble.style.setProperty(
        'left',
        `${Math.round(
          best.clampedX,
        )}px`,
        'important',
      );
      bubble.style.setProperty(
        'top',
        `${Math.round(
          best.clampedY,
        )}px`,
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

      bubble.style.setProperty(
        '--tutor-tail-x',
        `${Math.round(
          tailX,
        )}px`,
      );
      bubble.style.setProperty(
        '--tutor-dialog-origin-x',
        `${Math.round(
          tailX,
        )}px`,
      );
      bubble.style.setProperty(
        '--tutor-dialog-origin-y',
        placement === 'below'
          ? '0%'
          : '100%',
      );

      bubble.dataset
        .anchorPlacement =
          placement;
      bubble.dataset
        .anchorHorizontal =
          best.horizontal;
    };

  const characterObserver =
    new MutationObserver(
      scheduleLayout,
    );

  characterObserver.observe(
    character,
    {
      attributes: true,
      attributeFilter: [
        'style',
        'class',
        'data-vertical-placement',
        'data-placement',
      ],
    },
  );

  const bubbleObserver =
    new MutationObserver(
      scheduleLayout,
    );

  bubbleObserver.observe(
    bubble,
    {
      attributes: true,
      attributeFilter: [
        'class',
      ],
      childList: true,
      subtree: true,
      characterData: true,
    },
  );

  const resizeObserver =
    new ResizeObserver(
      scheduleLayout,
    );

  resizeObserver.observe(
    surface,
  );
  resizeObserver.observe(
    character,
  );
  resizeObserver.observe(
    bubble,
  );

  window.addEventListener(
    'resize',
    scheduleLayout,
  );
  window.addEventListener(
    'ai-ide-tutor-layout',
    scheduleLayout,
  );
  window.addEventListener(
    'ai-ide-reader-viewport',
    scheduleLayout,
  );

  window.visualViewport
    ?.addEventListener(
      'resize',
      scheduleLayout,
    );
  window.visualViewport
    ?.addEventListener(
      'scroll',
      scheduleLayout,
    );

  syncBubbleParent();
  scheduleLayout();
}

function getSafeBounds(
  surfaceRect: DOMRect,
): SafeBounds {
  const viewportWidth =
    window.visualViewport
      ?.width
      ?? window.innerWidth;
  const viewportHeight =
    window.visualViewport
      ?.height
      ?? window.innerHeight;
  const viewportOffsetLeft =
    window.visualViewport
      ?.offsetLeft
      ?? 0;
  const viewportOffsetTop =
    window.visualViewport
      ?.offsetTop
      ?? 0;

  const visibleViewportLeft =
    viewportOffsetLeft;
  const visibleViewportTop =
    viewportOffsetTop;
  const visibleViewportRight =
    visibleViewportLeft
      + viewportWidth;
  const visibleViewportBottom =
    visibleViewportTop
      + viewportHeight;

  const visibleLeft =
    Math.max(
      surfaceRect.left,
      visibleViewportLeft,
    );
  const visibleTop =
    Math.max(
      surfaceRect.top,
      visibleViewportTop,
    );
  const visibleRight =
    Math.min(
      surfaceRect.right,
      visibleViewportRight,
    );
  const visibleBottom =
    Math.min(
      surfaceRect.bottom,
      visibleViewportBottom,
    );

  const left =
    Math.max(
      EDGE_PADDING,
      visibleLeft
        - surfaceRect.left
        + EDGE_PADDING,
    );
  const top =
    Math.max(
      EDGE_PADDING,
      visibleTop
        - surfaceRect.top
        + EDGE_PADDING,
    );
  const right =
    Math.min(
      surfaceRect.width
        - EDGE_PADDING,
      visibleRight
        - surfaceRect.left
        - EDGE_PADDING,
    );
  const bottom =
    Math.min(
      surfaceRect.height
        - EDGE_PADDING,
      visibleBottom
        - surfaceRect.top
        - EDGE_PADDING,
    );

  return {
    left,
    top,
    right:
      Math.max(
        left,
        right,
      ),
    bottom:
      Math.max(
        top,
        bottom,
      ),
    width:
      Math.max(
        0,
        right - left,
      ),
    height:
      Math.max(
        0,
        bottom - top,
      ),
  };
}

function visibleCodeRects(
  surfaceRect: DOMRect,
): RectLike[] {
  const elements =
    Array.from(
      document
        .querySelectorAll<HTMLElement>(
          [
            '.monaco-editor .view-lines .view-line > span',
            '.reader-code-line .reader-line-content',
          ].join(','),
        ),
    );

  return elements
    .map(
      (element) =>
        element
          .getBoundingClientRect(),
    )
    .filter(
      (rect) => (
        rect.width > 2
        && rect.height > 2
        && rect.bottom
          >= surfaceRect.top
        && rect.top
          <= surfaceRect.bottom
        && rect.right
          >= surfaceRect.left
        && rect.left
          <= surfaceRect.right
      ),
    )
    .map(
      (rect) => ({
        left:
          rect.left
            - surfaceRect.left,
        top:
          rect.top
            - surfaceRect.top,
        right:
          rect.right
            - surfaceRect.left,
        bottom:
          rect.bottom
            - surfaceRect.top,
        width: rect.width,
        height: rect.height,
      }),
    );
}

function overlapArea(
  a: RectLike,
  b: RectLike,
): number {
  const width =
    Math.max(
      0,
      Math.min(
        a.right,
        b.right,
      )
        - Math.max(
          a.left,
          b.left,
        ),
    );
  const height =
    Math.max(
      0,
      Math.min(
        a.bottom,
        b.bottom,
      )
        - Math.max(
          a.top,
          b.top,
        ),
    );

  return width * height;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(
    max,
    Math.max(
      min,
      value,
    ),
  );
}

installTutorBubbleLayout();
