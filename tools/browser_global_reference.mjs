import ts from "typescript";

/** Inspect syntax, not text: schedule's "window" literal is not a browser dependency. */
export function browserGlobalReference(content) {
  const source = ts.createSourceFile("domain.ts", content, ts.ScriptTarget.Latest, true);
  const forbidden = new Set(["window", "document", "localStorage"]);
  let position = -1;
  function visit(node) {
    if (position >= 0) return;
    if ((ts.isIdentifier(node) && forbidden.has(node.text)) ||
        (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) &&
         ["globalThis", "self"].includes(node.expression.text) &&
         ts.isStringLiteralLike(node.argumentExpression) && forbidden.has(node.argumentExpression.text))) {
      position = node.getStart(source);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return position;
}
