export interface TypewriterTextOptions {
  maximumDurationMs?: number;
  minimumCharactersPerFrame?: number;
}

/** Reveals existing safe DOM text without rebuilding its semantic structure. */
export function typewriteText(
  container: HTMLElement,
  options: TypewriterTextOptions = {},
): () => void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => undefined;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; value: string }> = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text && current.data.length > 0) {
      nodes.push({ node: current, value: current.data });
      current.data = "";
    }
    current = walker.nextNode();
  }
  const total = nodes.reduce((sum, item) => sum + Array.from(item.value).length, 0);
  if (total === 0) return () => undefined;
  const maximumFrames = Math.max(1, Math.round((options.maximumDurationMs ?? 3_200) / 16));
  const charactersPerFrame = Math.max(
    options.minimumCharactersPerFrame ?? 1,
    Math.ceil(total / maximumFrames),
  );
  let nodeIndex = 0;
  let characterIndex = 0;
  let frame = 0;
  let cancelled = false;
  const reveal = () => {
    let remaining = charactersPerFrame;
    while (remaining > 0 && nodeIndex < nodes.length) {
      const item = nodes[nodeIndex]!;
      const characters = Array.from(item.value);
      const take = Math.min(remaining, characters.length - characterIndex);
      characterIndex += take;
      remaining -= take;
      item.node.data = characters.slice(0, characterIndex).join("");
      if (characterIndex >= characters.length) {
        nodeIndex += 1;
        characterIndex = 0;
      }
    }
    if (!cancelled && nodeIndex < nodes.length && container.isConnected) {
      frame = requestAnimationFrame(reveal);
    }
  };
  frame = requestAnimationFrame(reveal);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    for (const item of nodes) item.node.data = item.value;
  };
}
