interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }

/** Screen offset only; never alter the verified geographic coordinate. */
export function placeCameraOffset(viewport: Rect, panels: readonly Rect[]): [number, number] {
  let right = 0; let bottom = 0;
  for (const panel of panels) {
    if (panel.width <= 0 || panel.height <= 0 || panel.left >= viewport.right || panel.top >= viewport.bottom) continue;
    if (panel.width < viewport.width * 0.65 && panel.left > viewport.left + viewport.width * 0.3) {
      right = Math.max(right, viewport.right - panel.left + 16);
    } else if (panel.top > viewport.top + viewport.height * 0.2) {
      bottom = Math.max(bottom, viewport.bottom - panel.top + 16);
    }
  }
  return [-Math.min(right, viewport.width * 0.8) / 2, -Math.min(bottom, viewport.height * 0.8) / 2];
}
