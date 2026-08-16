const referenceZoom = 15.5;
const referenceVisualScale = 4;
const zoomResponseExponent = 1.06;
const minimumZoomedOutScreenSizeRatio = 0.3;
const zoomedOutScreenSizeDecay = 0.35;
// 近接時に地図上の建物より小さくならない最小の列車サイズ。
const minimumVisualScale = 1.5;
const maximumVisualScale = 250_000;

export function trainVisualScaleForZoom(zoom: number): number {
  const zoomDifference = referenceZoom - zoom;
  const scale =
    zoomDifference <= 0
      ? referenceVisualScale *
        2 ** (zoomDifference * zoomResponseExponent)
      : referenceVisualScale *
        zoomedOutScreenSizeRatio(zoomDifference) *
        2 ** zoomDifference;

  return Math.min(Math.max(scale, minimumVisualScale), maximumVisualScale);
}

function zoomedOutScreenSizeRatio(zoomDifference: number): number {
  return (
    minimumZoomedOutScreenSizeRatio +
    (1 - minimumZoomedOutScreenSizeRatio) *
      2 ** (-zoomDifference * zoomedOutScreenSizeDecay)
  );
}
