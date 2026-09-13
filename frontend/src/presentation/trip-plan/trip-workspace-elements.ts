export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function control(text: string, action: () => void): HTMLButtonElement {
  const button = element("button", "", text);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}
export function option(label: string, value: string): HTMLOptionElement {
  const node = document.createElement("option"); node.textContent = label; node.value = value; return node;
}
