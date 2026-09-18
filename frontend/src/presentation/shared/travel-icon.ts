/** Decorative presentation only; never a claim about a destination or its availability. */
export function travelIcon(kind: "trip" | "transport" | "stay" | "activity"): string {
  const paths = {
    trip: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
    transport: '<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 10h14M9 3v7M7 21l3-3M17 21l-3-3"/><path d="M8 14h1M15 14h1"/>',
    stay: '<path d="M3 20V9m18 11V9M3 17h18M3 12h18v5M6 12V6h12v6M9 9h1m4 0h1"/>',
    activity: '<path d="m3 20 7-13 4 7 3-4 4 10ZM7 12l3 2 2-2"/><circle cx="17" cy="5" r="2"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[kind]}</svg>`;
}
