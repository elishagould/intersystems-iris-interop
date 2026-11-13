import { ExpressionDraft } from "./expression-model.js";

export function expressionPopupKind(selected) {
  if (selected.format === "condition" && selected.editable) return "condition";
  const key = selected.path?.split("/").at(-1);
  if (key === "constraints" && selected.collectionEditable) return "constraint";
  return selected.editable && ["target", "transform", "ruleName", "value"].includes(key) ? key : null;
}

export function createConditionEditor(document, { source, assistant, button, onChange }) {
  const draft = new ExpressionDraft(source, assistant);
  const element = document.createElement("div");
  element.className = "expression-editor";
  const toolbar = document.createElement("div");
  toolbar.className = "expression-toolbar";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Expression commands");
  const commands = new Map();
  const actions = [
    ["Move operand up", "ArrowUp", () => draft.move(-1)],
    ["Move operand down", "ArrowDown", () => draft.move(1)],
    ["Add operator (op)", "GitBranch", () => draft.wrap("operator")],
    ["Add function (fx)", "SquareFunction", () => draft.wrap("function")],
    ["Add operand", "Plus", () => draft.add()],
    ["Remove operand", "Trash2", () => draft.remove()]
  ];
  for (const [label, icon, action] of actions) {
    const control = button(label, icon, () => { action(); render(); });
    commands.set(label, control);
    toolbar.append(control);
  }
  const type = document.createElement("select");
  type.className = "expression-kind";
  type.setAttribute("aria-label", "Expression node type");
  for (const kind of ["value", "operator", "function"]) {
    if (kind !== "value" && !draft.choices.some(choice => choice.type === kind)) continue;
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    type.append(option);
  }
  type.addEventListener("change", () => { draft.setKind(type.value); render(); });
  const token = document.createElement("select");
  token.className = "expression-token";
  token.setAttribute("aria-label", "Operation or function");
  token.addEventListener("change", () => { draft.setToken(token.value); render(); });
  const input = document.createElement("input");
  input.className = "expression-input";
  input.setAttribute("aria-label", "Operand value");
  input.spellcheck = false;
  input.addEventListener("input", () => { draft.setValue(input.value); render(); });
  toolbar.append(type, token, input);
  const canvas = document.createElement("div");
  canvas.className = "expression-canvas";
  canvas.setAttribute("aria-label", "Expression tree");
  const error = document.createElement("p");
  error.className = "expression-error";
  error.setAttribute("role", "alert");

  function tree(node, path = [], parameter) {
    const branch = document.createElement("div");
    branch.className = `expression-tree-node${node.children.length ? " expression-has-children" : ""}`;
    const value = document.createElement("button");
    value.type = "button";
    value.className = `expression-node expression-node-${node.kind}`;
    value.textContent = node.value === "&&" ? "AND" : node.value === "||" ? "OR" : node.value || " ";
    value.dataset.expressionPath = path.join("/");
    value.setAttribute("aria-label", `${node.kind}: ${node.value || "empty"}`);
    value.setAttribute("aria-pressed", String(JSON.stringify(path) === JSON.stringify(draft.path)));
    const metadata = draft.choices.find(choice => choice.type === node.kind && choice.value === node.value);
    value.title = metadata?.description ?? node.value;
    value.addEventListener("click", () => { draft.select(path); render(); });
    if (parameter) {
      const label = document.createElement("span");
      label.className = "expression-parameter";
      label.textContent = parameter.name;
      label.title = `${parameter.name}${parameter.irisType ? `: ${parameter.irisType}` : ""}${parameter.optional ? " (optional)" : ""}`;
      branch.append(label);
    }
    branch.append(value);
    if (node.children.length) {
      const children = document.createElement("div");
      children.className = "expression-children";
      node.children.forEach((child, index) => {
        const row = document.createElement("div");
        row.className = "expression-child";
        row.append(tree(child, [...path, index], node.kind === "function" ? metadata?.parameters?.[index] : undefined));
        children.append(row);
      });
      branch.append(children);
    }
    return branch;
  }

  function canAdd() {
    const parent = draft.selected.kind !== "value" ? draft.selected : draft.path.length ? draft.node(draft.path.slice(0, -1)) : null;
    if (!parent) return draft.choices.some(choice => choice.type === "operator");
    if (parent.kind === "operator") return ["&&", "||"].includes(parent.value) || parent.children.length < (parent.value === "!" ? 1 : 2);
    const parameters = draft.choices.find(choice => choice.type === "function" && choice.value === parent.value)?.parameters;
    return !parameters?.length || parent.children.length < parameters.length;
  }

  function render() {
    type.value = draft.selected.kind;
    token.hidden = draft.selected.kind === "value";
    input.hidden = !token.hidden;
    token.replaceChildren();
    for (const choice of draft.options) {
      const option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.value === "&&" ? "AND" : choice.value === "||" ? "OR" : choice.value;
      option.title = choice.description ?? choice.value;
      token.append(option);
    }
    token.value = draft.selected.value;
    if (input.value !== draft.selected.value) input.value = draft.selected.value;
    commands.get("Move operand up").disabled = !draft.canMove(-1);
    commands.get("Move operand down").disabled = !draft.canMove(1);
    commands.get("Add operand").disabled = !canAdd();
    commands.get("Add function (fx)").disabled = !draft.choices.some(choice => choice.type === "function");
    commands.get("Add operator (op)").disabled = !draft.choices.some(choice => choice.type === "operator");
    const { scrollTop, scrollLeft } = canvas;
    canvas.replaceChildren(tree(draft.tree));
    canvas.scrollTop = scrollTop;
    canvas.scrollLeft = scrollLeft;
    error.textContent = draft.error;
    error.hidden = !draft.error;
    onChange(draft.text, draft.error);
  }

  element.append(toolbar, canvas, error);
  render();
  return {
    element,
    get value() { if (draft.error) throw new TypeError(draft.error); return draft.text; },
    destroy() { element.remove(); }
  };
}