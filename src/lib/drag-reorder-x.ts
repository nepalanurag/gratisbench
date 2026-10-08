// Drag-to-reorder helper for the tool file lists (merge, images-to-pdf, …).
// Event delegation: attach once to the <ul>, rows can be re-rendered freely.
// Rows must have draggable="true" and a data-idx attribute with their position.
// A drag handle (any element with [data-drag]) makes touch/mouse intent clear,
// but the whole row is draggable so keyboard users keep the up/down buttons.
export function enableDragReorder(
  list: HTMLElement,
  onMove: (from: number, to: number) => void
): void {
  let dragFrom = -1;
  let indicator: HTMLElement | null = null;

  function rowAt(el: EventTarget | null): HTMLElement | null {
    const t = el as HTMLElement | null;
    return t && typeof t.closest === 'function' ? t.closest('[data-idx]') : null;
  }

  function clearIndicator(): void {
    if (indicator) {
      indicator.style.borderTop = '';
      indicator = null;
    }
  }

  list.addEventListener('dragstart', (e) => {
    const row = rowAt(e.target);
    if (!row) return;
    dragFrom = Number(row.dataset.idx);
    if (Number.isNaN(dragFrom)) dragFrom = -1;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Required for Firefox to fire dragover/drop.
      e.dataTransfer.setData('text/plain', String(dragFrom));
    }
    row.style.opacity = '0.45';
  });

  list.addEventListener('dragend', (e) => {
    const row = rowAt(e.target);
    if (row) row.style.opacity = '';
    dragFrom = -1;
    clearIndicator();
  });

  list.addEventListener('dragover', (e) => {
    if (dragFrom < 0) return;
    const row = rowAt(e.target);
    if (!row || Number(row.dataset.idx) === dragFrom) {
      clearIndicator();
      return;
    }
    e.preventDefault(); // allow drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearIndicator();
    row.style.borderTop = '2px solid currentColor';
    indicator = row;
  });

  list.addEventListener('drop', (e) => {
    if (dragFrom < 0) return;
    const row = rowAt(e.target);
    e.preventDefault();
    if (!row) return;
    const to = Number(row.dataset.idx);
    if (!Number.isNaN(to) && to !== dragFrom) onMove(dragFrom, to);
    clearIndicator();
  });

  list.addEventListener('dragleave', (e) => {
    // Leaving the list entirely clears the indicator.
    const to = e.relatedTarget as Node | null;
    if (!to || !list.contains(to)) clearIndicator();
  });
}

/** Six-dot grip icon for drag handles (ICONS lives in tools/common.ts, which this lib must not touch). */
export const GRIP_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>' +
  '<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>' +
  '<circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
