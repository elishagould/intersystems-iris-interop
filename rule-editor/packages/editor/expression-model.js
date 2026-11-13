import { parseCondition, parseExpressionParts } from "../basic-builder/condition.js";

export function expressionChoices(assistant) {
  const choices = new Map();
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.enum)) {
      for (const entry of value.enum) {
        if (["operator", "function"].includes(entry?.type) && typeof entry.value === "string") {
          choices.set(`${entry.type}:${entry.value}`, entry);
        }
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(assistant.definitions ?? assistant);
  return [...choices.values()];
}

const leaf = value => ({ kind: "value", value, children: [] });

function parseTree(parts, source, choices) {
  if (!parts.length) return leaf("");
  if (parts.length === 1 && parts[0].kind === "group") return parseTree(parts[0].parts, source, choices);
  const logical = parts.some(part => part.kind === "OR") ? "OR" : parts.some(part => part.kind === "AND") ? "AND" : null;
  if (logical) {
    const groups = [[]];
    for (const part of parts) {
      if (part.kind === logical) groups.push([]);
      else groups.at(-1).push(part);
    }
    return { kind: "operator", value: logical === "AND" ? "&&" : "||", children: groups.map(group => parseTree(group, source, choices)) };
  }
  const operators = parts.map((part, index) => ({ part, index })).filter(({ part }) => part.kind === "operator"
    && choices.some(choice => choice.type === "operator" && choice.value === part.value));
  if (operators.length === 1) {
    const { part, index } = operators[0];
    if (index > 0 && index < parts.length - 1) {
      return { kind: "operator", value: part.value, children: [parseTree(parts.slice(0, index), source, choices), parseTree(parts.slice(index + 1), source, choices)] };
    }
    if (index === 0 && ["!", "-"].includes(part.value)) return { kind: "operator", value: part.value, children: [parseTree(parts.slice(1), source, choices)] };
  }
  if (parts.length === 2 && parts[0].kind === "atom" && parts[1].kind === "group"
    && choices.some(choice => choice.type === "function" && choice.value === parts[0].value)) {
    const argumentsList = parts[1].parts.length ? [[]] : [];
    for (const part of parts[1].parts) {
      if (part.kind === "comma") argumentsList.push([]);
      else argumentsList.at(-1).push(part);
    }
    return { kind: "function", value: parts[0].value, children: argumentsList.map(group => parseTree(group, source, choices)) };
  }
  return leaf(source.slice(parts[0].start, parts.at(-1).end).trim());
}

function serialize(node) {
  if (node.kind === "value") return node.value;
  if (node.kind === "function") return `${node.value}(${node.children.map(serialize).join(",")})`;
  if (node.children.length === 1 && ["!", "-"].includes(node.value)) return `${node.value}(${serialize(node.children[0])})`;
  return node.children.map(child => {
    const value = serialize(child);
    if (child.kind === "operator") return `(${value})`;
    if (child.kind === "value") {
      try {
        if (parseExpressionParts(value).some(part => ["AND", "OR", "operator"].includes(part.kind))) return `(${value})`;
      } catch { return value; }
    }
    return value;
  }).join(node.value);
}

export class ExpressionDraft {
  constructor(source, assistant) {
    this.original = String(source ?? "");
    this.choices = expressionChoices(assistant);
    this.path = [];
    this.changed = false;
    try { this.tree = parseTree(parseExpressionParts(this.original), this.original, this.choices); }
    catch { this.tree = leaf(this.original); }
  }

  node(path = this.path) {
    return path.reduce((node, index) => node?.children[index], this.tree);
  }

  select(path) { if (this.node(path)) this.path = [...path]; }
  get selected() { return this.node(); }
  get text() { return this.changed ? serialize(this.tree) : this.original; }
  get options() { return this.choices.filter(choice => choice.type === this.selected.kind); }
  get metadata() { return this.choices.find(choice => choice.type === this.selected.kind && choice.value === this.selected.value); }

  replace(node) {
    if (!this.path.length) this.tree = node;
    else this.node(this.path.slice(0, -1)).children[this.path.at(-1)] = node;
    this.changed = true;
  }

  setValue(value) { this.replace(leaf(value)); }

  setToken(value) {
    const choice = this.options.find(choice => choice.value === value);
    if (!choice) return false;
    this.selected.value = value;
    const minimum = choice.type === "function" ? (choice.parameters ?? []).filter(parameter => !parameter.optional).length
      : value === "!" ? 1 : 2;
    while (this.selected.children.length < minimum) {
      const parameter = choice.parameters?.[this.selected.children.length];
      this.selected.children.push(leaf(parameter?.default ?? ""));
    }
    this.changed = true;
    return true;
  }

  setKind(kind) {
    if (kind === this.selected.kind) return;
    if (kind === "value") { this.replace(leaf(serialize(this.selected))); return; }
    const choice = this.choices.find(choice => choice.type === kind && (kind !== "operator" || choice.value === "&&"))
      ?? this.choices.find(choice => choice.type === kind);
    if (!choice) return;
    const children = this.selected.kind === "value" ? [this.selected] : this.selected.children;
    this.replace({ kind, value: choice.value, children });
    this.setToken(choice.value);
  }

  wrap(kind) {
    const choice = this.choices.find(choice => choice.type === kind && (kind !== "operator" || choice.value === "&&"))
      ?? this.choices.find(choice => choice.type === kind);
    if (!choice) return;
    this.replace({ kind, value: choice.value, children: [this.selected] });
    this.setToken(choice.value);
  }

  canMove(direction) {
    if (!this.path.length) return false;
    const index = this.path.at(-1) + direction;
    return index >= 0 && index < this.node(this.path.slice(0, -1)).children.length;
  }

  move(direction) {
    if (!this.canMove(direction)) return false;
    const parent = this.node(this.path.slice(0, -1));
    const index = this.path.at(-1);
    const [node] = parent.children.splice(index, 1);
    parent.children.splice(index + direction, 0, node);
    this.path[this.path.length - 1] += direction;
    this.changed = true;
    return true;
  }

  add() {
    if (this.selected.kind === "value") {
      if (!this.path.length) { this.wrap("operator"); this.path.push(1); return; }
      const parentPath = this.path.slice(0, -1);
      const parent = this.node(parentPath);
      const index = this.path.at(-1) + 1;
      parent.children.splice(index, 0, leaf(""));
      this.path = [...parentPath, index];
    } else {
      this.selected.children.push(leaf(this.metadata?.parameters?.[this.selected.children.length]?.default ?? ""));
      this.path.push(this.selected.children.length - 1);
    }
    this.changed = true;
  }

  remove() {
    if (!this.path.length) { this.replace(leaf("")); return; }
    const parentPath = this.path.slice(0, -1);
    this.node(parentPath).children.splice(this.path.at(-1), 1);
    this.path = parentPath;
    this.changed = true;
  }

  get error() {
    function check(node, choices, root = false) {
      if (node.kind === "value") {
        if (!node.value.trim()) return root ? "" : "Enter a value for each operand.";
        const parsed = parseCondition(node.value);
        return parsed.valid ? "" : parsed.error;
      }
      const choice = choices.find(choice => choice.type === node.kind && choice.value === node.value);
      if (!choice) return "Choose an operation or function from RuleAssist.";
      if (node.kind === "function") {
        const parameters = choice.parameters ?? [];
        if (node.children.length < parameters.filter(parameter => !parameter.optional).length || parameters.length && node.children.length > parameters.length) return "Check the function parameter count.";
      } else if (node.value === "!" || node.value === "-" && node.children.length === 1
        ? node.children.length !== 1 : node.children.length < 2 || !["&&", "||"].includes(node.value) && node.children.length > 2) return "Check the operator operand count.";
      for (const child of node.children) { const error = check(child, choices); if (error) return error; }
      return "";
    }
    return check(this.tree, this.choices, true);
  }
}