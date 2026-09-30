// A details panel (.kjg-detail): shows everything the archive holds about one item,
// loading it on open. Used by the chest and the museum; each adds its own buttons.
// Its ← → buttons (and arrow keys) call onStep(-1 | 1); the view decides what the
// earlier or later item is and calls setNav with whether each exists.
import { loadDetails, renderDetails } from './details.js';

export function createDetailsPanel(panel, { onStep } = {}) {
  const body = panel.querySelector('.kjg-detail-body');
  const prev = panel.querySelector('[data-action="prev"]');
  const next = panel.querySelector('[data-action="next"]');
  let openKey = null;

  prev?.addEventListener('click', () => onStep?.(-1));
  next?.addEventListener('click', () => onStep?.(1));
  addEventListener('keydown', (e) => {
    if (!openKey || panel.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // Arrows seek a focused video and move the caret in fields; leave those alone.
    if (e.target.closest?.('video, audio, input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    onStep?.(e.key === 'ArrowLeft' ? -1 : 1);
  });

  const message = (text) => Object.assign(document.createElement('p'), { className: 'kjg-muted', textContent: text });

  return {
    key: () => openKey,

    setNav({ hasPrev, hasNext }) {
      if (prev) prev.disabled = !hasPrev;
      if (next) next.disabled = !hasNext;
    },

    async open(key) {
      openKey = key;
      panel.hidden = false;
      panel.dataset.key = key;
      body.scrollTop = 0;
      body.replaceChildren(message('Loading…'));
      try {
        const details = await loadDetails(key);
        if (openKey === key) body.replaceChildren(renderDetails(details));
      } catch (err) {
        if (openKey === key) body.replaceChildren(message(`Could not load details: ${err.message}`));
      }
    },

    // Also stops a playing video, since its element is removed.
    close() {
      openKey = null;
      panel.hidden = true;
      body.replaceChildren();
    },
  };
}
