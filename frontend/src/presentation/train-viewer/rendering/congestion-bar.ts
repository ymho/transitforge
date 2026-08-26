export function congestionBarHeightMeters(congestion: number): number {
  return Math.max(congestion, 0) * 0.1;
}

export function congestionBarColor(congestion: number): string {
  if (congestion <= 300) return "#38b56b";
  if (congestion <= 600) return "#f0c94d";
  if (congestion <= 900) return "#df4851";
  return "#6d3fb3";
}
