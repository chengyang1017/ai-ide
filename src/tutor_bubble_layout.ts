const DESKTOP_BREAKPOINT = 1180;

function installTutorBubbleLayout(): void {
  const surface = document.querySelector<HTMLElement>('#tutor-surface');
  const character = document.querySelector<HTMLElement>('#tutor-character');
  const bubble = document.querySelector<HTMLElement>('#speech-bubble');

  if (!surface || !character || !bubble) {
    window.requestAnimationFrame(installTutorBubbleLayout);
    return;
  }

  const style = document.createElement('style');
  style.dataset.tutorBubbleRestore = 'true';
  style.textContent = `
    @media (min-width: 1181px) {
      #tutor-character > .speech-bubble {
        position: absolute !important;
        z-index: 40 !important;
        top: auto !important;
        right: auto !important;
        bottom: 76px !important;
        left: 50% !important;
        width: min(520px, calc(100vw - 64px)) !important;
        max-width: 520px !important;
        max-height: min(360px, 55vh) !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        padding: 14px 18px 18px !important;
        border: 1px solid #465064 !important;
        border-radius: 14px 14px 14px 5px !important;
        background: rgb(29 34 43 / 97%) !important;
        box-shadow: 0 18px 45px rgb(0 0 0 / 42%) !important;
        color: #edf0f6 !important;
        font-size: 14px !important;
        line-height: 1.72 !important;
        white-space: pre-wrap !important;
        text-overflow: clip !important;
        pointer-events: auto !important;
        opacity: 0 !important;
        transform: translate(-50%, 8px) scale(.985) !important;
        transform-origin: 50% 100% !important;
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
        letter-spacing: .01em;
      }

      #tutor-character > .speech-bubble.visible {
        opacity: 1 !important;
        transform: translate(-50%, 0) scale(1) !important;
      }

      #tutor-character[data-bubble-side='below'] > .speech-bubble {
        top: 76px !important;
        bottom: auto !important;
        border-radius: 5px 14px 14px 14px !important;
        transform-origin: 50% 0 !important;
      }
    }
  `;

  document.head.appendChild(style);

  const syncBubbleParent = (): void => {
    const desktop = window.innerWidth > DESKTOP_BREAKPOINT;

    if (desktop && bubble.parentElement !== character) {
      character.prepend(bubble);
    } else if (!desktop && bubble.parentElement !== surface) {
      surface.prepend(bubble);
    }

    syncBubbleSide();
  };

  const syncBubbleSide = (): void => {
    if (window.innerWidth <= DESKTOP_BREAKPOINT || bubble.parentElement !== character) {
      delete character.dataset.bubbleSide;
      return;
    }

    const surfaceRect = surface.getBoundingClientRect();
    const characterRect = character.getBoundingClientRect();
    const spaceAbove = Math.max(0, characterRect.top - surfaceRect.top);
    const spaceBelow = Math.max(0, surfaceRect.bottom - characterRect.bottom);

    character.dataset.bubbleSide =
      spaceAbove >= 220 || spaceAbove >= spaceBelow
        ? 'above'
        : 'below';
  };

  const observer = new MutationObserver(() => {
    syncBubbleSide();
  });

  observer.observe(character, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-vertical-placement'],
  });

  window.addEventListener('resize', syncBubbleParent);
  syncBubbleParent();
}

installTutorBubbleLayout();
