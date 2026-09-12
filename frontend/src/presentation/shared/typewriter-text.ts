export interface TypewriterTextOptions {
  maximumDurationMs?: number;
  minimumCharactersPerFrame?: number;
}

const activeAnimations = new WeakMap<HTMLElement, () => void>();

/** Reveals safe DOM in reading order, including list markers and block borders. */
export function typewriteText(
  container: HTMLElement,
  options: TypewriterTextOptions = {},
): () => void {
  activeAnimations.get(container)?.();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => undefined;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const nodes: Array<
    { node: Text; value: string; characters: string[] } |
    { node: HTMLElement; display: string; priority: string }
  > = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text && current.data.length > 0) {
      nodes.push({ node: current, value: current.data, characters: Array.from(current.data) });
      current.data = "";
    } else if (current instanceof HTMLElement) {
      nodes.push({ node: current, display: current.style.getPropertyValue("display"), priority: current.style.getPropertyPriority("display") });
      current.style.setProperty("display", "none", "important");
    }
    current = walker.nextNode();
  }
  const restore = (item: typeof nodes[number]) => {
    if ("value" in item) item.node.data = item.value;
    else if (item.display) item.node.style.setProperty("display", item.display, item.priority);
    else item.node.style.removeProperty("display");
  };
  const total = nodes.reduce((sum, item) => sum + ("characters" in item ? item.characters.length : 0), 0);
  if (total === 0) {
    nodes.forEach(restore);
    return () => undefined;
  }
  const maximumFrames = Math.max(1, Math.round((options.maximumDurationMs ?? 3_200) / 16));
  const charactersPerFrame = Math.max(
    options.minimumCharactersPerFrame ?? 1,
    Math.ceil(total / maximumFrames),
  );
  let nodeIndex = 0;
  let characterIndex = 0;
  let frame = 0;
  let cancelled = false;
  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(frame);
    nodes.forEach(restore);
    activeAnimations.delete(container);
  };
  const reveal = () => {
    if (cancelled) return;
    if (!container.isConnected) { finish(); return; }
    let remaining = charactersPerFrame;
    while (remaining > 0 && nodeIndex < nodes.length) {
      const item = nodes[nodeIndex]!;
      if (!("characters" in item)) {
        restore(item);
        nodeIndex += 1;
        continue;
      }
      const characters = item.characters;
      const take = Math.min(remaining, characters.length - characterIndex);
      characterIndex += take;
      remaining -= take;
      item.node.data = characters.slice(0, characterIndex).join("");
      if (characterIndex >= characters.length) {
        nodeIndex += 1;
        characterIndex = 0;
      }
    }
    if (nodeIndex < nodes.length) {
      frame = requestAnimationFrame(reveal);
    } else finish();
  };
  activeAnimations.set(container, finish);
  frame = requestAnimationFrame(reveal);
  return finish;
}
