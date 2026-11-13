export { availableBlockTypes, blockFields, flattenRuleTree, projectRuleDefinition } from "./model.js";
export { conditionValueText, parseCondition } from "./condition.js";
import { conditionValueText, parseCondition } from "./condition.js";

const selectedBlocks = new WeakMap();
let branchSequence = 0;

function selectBlock(document, block, target) {
  const previous = selectedBlocks.get(document);
  if (previous) {
    previous.target.classList.remove("re-selected");
    previous.block.setAttribute("aria-pressed", "false");
  }
  target.classList.add("re-selected");
  block.setAttribute("aria-pressed", "true");
  selectedBlocks.set(document, { block, target });
}

export function createBlock(document, { text, values, count, kind = "default" }) {
  const block = document.createElement("div");
  block.className = "re-block";
  block.dataset.kind = kind;
  if (count !== undefined) {
    const counter = document.createElement("span");
    counter.className = "re-count";
    counter.textContent = String(count);
    block.append(counter);
  }
  const label = document.createElement("span");
  label.className = "re-label";
  label.textContent = text;
  block.append(label);
  let selectionTarget = label;
  if (values?.length) {
    block.classList.add("re-block-with-value");
    const section = document.createElement("span");
    section.className = "re-values";
    for (const value of values) {
      const row = document.createElement("span");
      row.className = "re-value-row";
      row.textContent = String(value);
      section.append(row);
    }
    block.append(section);
    selectionTarget = section;
  }
  block.tabIndex = 0;
  block.setAttribute("role", "button");
  block.setAttribute("aria-pressed", "false");
  block.addEventListener("click", () => selectBlock(document, block, selectionTarget));
  block.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectBlock(document, block, selectionTarget);
    }
  });
  return block;
}

export function createConditionBlock(document, { text = "condition", value = "" }) {
  const source = String(value ?? "");
  const parsed = parseCondition(source);
  const block = createBlock(document, { text, values: [source], kind: "property" });
  block.classList.add("re-condition-block");
  block.title = parsed.valid ? source : `${source}\n${parsed.error}`;
  const section = block.children[block.children.length - 1];
  section.classList.add("re-condition-value");
  section.dataset.rawValue = source;
  section.dataset.invalid = String(!parsed.valid);

  function render(node) {
    const element = document.createElement("span");
    if (node.type === "value") {
      element.className = "re-condition-leaf";
      element.dataset.rawValue = node.value;
      element.textContent = conditionValueText(node.value);
      return element;
    }
    element.className = "re-condition-branch";
    const operator = document.createElement("span");
    operator.className = "re-condition-operator";
    operator.textContent = node.operator;
    const operands = document.createElement("span");
    operands.className = "re-condition-operands";
    for (const child of node.operands) {
      const operand = document.createElement("span");
      operand.className = "re-condition-operand";
      operand.append(render(child));
      operands.append(operand);
    }
    element.append(operator, operands);
    return element;
  }

  section.replaceChildren(render(parsed.tree));
  return block;
}

export function createNodeRow(document, node) {
  const row = document.createElement("div");
  row.className = "re-node-row";
  row.dataset.nodeId = node.id;
  row.append(createBlock(document, { text: node.text, count: node.count, kind: node.type }));
  for (const field of node.fields) {
    row.append(field.format === "condition"
      ? createConditionBlock(document, { text: field.name, value: field.values.join("\n") })
      : createBlock(document, { text: field.name, values: field.values, kind: "property" }));
  }
  return row;
}

export function treeLineBounds(parent, child, anchor = 14) {
  const left = parent.left + Math.min(anchor, parent.width / 2);
  const top = parent.top + parent.height / 2;
  return { left, top, width: Math.max(0, child.left - left), height: Math.max(0, child.top + child.height / 2 - top) };
}

export function createTreeLine(document, bounds) {
  const line = document.createElement("div");
  line.className = "re-tree-line";
  for (const [name, value] of Object.entries(bounds)) line.style[name] = `${value}px`;
  return line;
}

export function ruleOutlineBounds(header, content, anchor) {
  const left = treeLineBounds(header, header, anchor).left;
  const top = header.top + header.height / 2;
  return { left, top, width: content.right - left, height: content.bottom - top };
}

export function branchTogglePosition(header, parent, anchor, diameter) {
  return {
    left: treeLineBounds(parent ?? header, header, anchor).left - header.left,
    top: parent ? header.height / 2 : header.height + diameter / 2
  };
}

export function isCollapsibleNode(node) {
  return node.children.length > 0 && (node.type !== "ruleSet" || node.parentId != null);
}

export function renderRuleTree(container, roots, { collapsed = new Set(), onToggle = () => {} } = {}) {
  const document = container.ownerDocument;
  const view = document.defaultView;
  const diagram = document.createElement("div");
  diagram.className = "re-diagram";
  const lines = document.createElement("div");
  lines.className = "re-tree-lines";
  lines.setAttribute("aria-hidden", "true");
  const entries = [];

  function renderList(nodes, ancestors = []) {
    const list = document.createElement("ul");
    list.className = "re-tree-list";
    for (const node of nodes) {
      const item = document.createElement("li");
      if (node.type === "rule") item.className = "re-rule-group";
      const row = createNodeRow(document, node);
      entries.push({ node, row, item, ancestors });
      item.append(row);
      if (node.children.length) {
        if (!isCollapsibleNode(node)) collapsed.delete(node.id);
        const children = renderList(node.children, [...ancestors, node.id]);
        children.id = `re-branch-${++branchSequence}`;
        children.hidden = collapsed.has(node.id);
        if (isCollapsibleNode(node)) {
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "re-branch-toggle";
          toggle.dataset.nodeId = node.id;
          toggle.setAttribute("aria-controls", children.id);
          const icons = view.lucide;
          function updateToggle() {
            const expanded = !collapsed.has(node.id);
            toggle.dataset.collapsed = String(!expanded);
            toggle.setAttribute("aria-expanded", String(expanded));
            toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${node.text}`);
            toggle.title = `${expanded ? "Collapse" : "Expand"} ${node.text}`;
            if (icons) toggle.replaceChildren(icons.createElement(expanded ? icons.Minus : icons.Plus, { "aria-hidden": "true", width: 16, height: 16 }));
            else toggle.textContent = expanded ? "-" : "+";
          }
          toggle.addEventListener("click", event => {
            event.stopPropagation();
            if (collapsed.has(node.id)) collapsed.delete(node.id);
            else collapsed.add(node.id);
            children.hidden = collapsed.has(node.id);
            updateToggle();
            schedule();
            onToggle(node, children.hidden);
          });
          updateToggle();
          row.append(toggle);
        }
        item.append(children);
      }
      list.append(item);
    }
    return list;
  }

  const anchor = document.createElement("span");
  anchor.className = "re-tree-anchor";
  anchor.setAttribute("aria-hidden", "true");
  diagram.append(lines, renderList(roots), anchor);
  container.replaceChildren(diagram);
  let frame;
  let destroyed = false;

  function measure() {
    frame = undefined;
    if (destroyed || !diagram.isConnected) return;
    const origin = diagram.getBoundingClientRect();
    const anchorWidth = anchor.getBoundingClientRect().width;
    const visible = entries.filter(({ ancestors }) => !ancestors.some(id => collapsed.has(id)));
    const boxes = new Map(visible.map(({ node, row }) => {
      const box = row.firstElementChild.getBoundingClientRect();
      row.style.setProperty("--re-row-middle", `${box.height / 2}px`);
      return [node.id, { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height }];
    }));
    for (const { node, row } of visible) {
      const toggle = row.querySelector(".re-branch-toggle");
      if (!toggle) continue;
      const position = branchTogglePosition(boxes.get(node.id), boxes.get(node.parentId), anchorWidth, toggle.getBoundingClientRect().height);
      row.style.setProperty("--re-toggle-left", `${position.left}px`);
      row.style.setProperty("--re-toggle-top", `${position.top}px`);
    }
    const connectors = visible.filter(({ node }) => boxes.has(node.parentId)).map(({ node }) =>
      createTreeLine(document, treeLineBounds(boxes.get(node.parentId), boxes.get(node.id), anchorWidth)));
    const outlines = visible.filter(({ node }) => node.type === "rule").map(({ node, item }) => {
      const content = item.getBoundingClientRect();
      const bounds = ruleOutlineBounds(boxes.get(node.id), { right: content.right - origin.left, bottom: content.bottom - origin.top }, anchorWidth);
      const outline = document.createElement("div");
      outline.className = "re-rule-outline";
      outline.dataset.ruleId = node.id;
      for (const [name, value] of Object.entries(bounds)) outline.style[name] = `${value}px`;
      return outline;
    });
    lines.replaceChildren(...outlines, ...connectors);
  }

  function schedule() {
    if (!destroyed && frame === undefined) frame = view.requestAnimationFrame(measure);
  }

  const observer = view.ResizeObserver ? new view.ResizeObserver(schedule) : null;
  observer?.observe(anchor);
  for (const { row } of entries) observer?.observe(row);
  view.addEventListener("resize", schedule);
  document.fonts?.ready.then(schedule);
  schedule();
  return {
    destroy() {
      destroyed = true;
      observer?.disconnect();
      view.removeEventListener("resize", schedule);
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      diagram.remove();
    }
  };
}