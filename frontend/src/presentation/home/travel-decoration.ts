/** CSS illustration from the v6 design reference. Decoration, never place evidence. */
export function travelDecoration(kind: "hero" | "landscape" | "canal" | "retreat" | "rail" = "landscape"): string {
  const scene = kind === "hero" ? '<div class="scenery-route route-one"></div><div class="scenery-route route-two"></div><i class="scenery-station station-one"></i><i class="scenery-station station-two"></i><i class="scenery-station station-three"></i>'
    : kind === "rail" ? '<div class="scenery-rail"></div><div class="scenery-train"></div>'
    : kind === "canal" ? '<div class="scenery-canal"></div><div class="scenery-warehouse"></div><div class="scenery-warehouse second"></div>'
    : kind === "retreat" ? '<div class="scenery-retreat"></div>'
    : '<div class="scenery-pagoda"><i class="spire"></i><i class="pillar"></i><i class="roof"></i><i class="roof"></i><i class="roof"></i><i class="roof"></i><i class="roof"></i></div><div class="scenery-town">' + '<i></i>'.repeat(6) + '</div>';
  return `<div class="travel-scenery scenery-${kind}" aria-hidden="true">${scene}</div>`;
}
