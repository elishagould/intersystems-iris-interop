import { isCollapsibleNode, renderRuleTree } from "../basic-builder/index.js";
import { projectEditorTree } from "./model.js";
import { createConditionEditor, expressionPopupKind } from "./expression-view.js";
import { createTargetPicker } from "./target-view.js";
import { createConstraintEditor } from "./constraint-view.js";
import { createRuleSaveDialog } from "./save-view.js";

export function mountRuleEditor(container, state, { ruleName = "", saveContainer, onSave, onSaved, loadConfigItems, loadTransforms, loadMessageClasses, loadConstraintOptions } = {}) {
  const document = container.ownerDocument;
  const icons = document.defaultView.lucide;
  const root = document.createElement("section");
  root.className = "editor-root";
  root.setAttribute("aria-label", "Rule editor");
  const toolbar = document.createElement("div");
  toolbar.className = "editor-toolbar";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Editor commands");
  const controls = document.createElement("div");
  controls.className = "editor-commands";
  const saveCommands = document.createElement("div");
  saveCommands.className = "editor-save-commands";
  const buttons = new Map();
  let mountedTree;
  let restoring = false;
  let typing = false;
  let hasCollapsibleBranches = false;
  const collapsed = new Set();

  function button(label, icon, action) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "editor-icon-button";
    element.title = label;
    element.setAttribute("aria-label", label);
    element.append(icons.createElement(icons[icon], { width: 18, height: 18, "stroke-width": 1.8, "aria-hidden": "true" }));
    element.addEventListener("click", action);
    return element;
  }

  function run(action) {
    typing = false;
    hideAdd();
    if (action()) draw();
  }

  const saveDialog = createRuleSaveDialog(document, { name: ruleName, getDefinition: () => state.definition, button, onSave, onSaved });
  const actions = [
    ["Save", "Save", () => { typing = false; hideAdd(); saveDialog.open("save"); }],
    ["Save As", "SaveAll", () => { typing = false; hideAdd(); saveDialog.open("saveAs"); }],
    ["Move up", "ArrowUp", () => run(() => state.move(-1))],
    ["Move down", "ArrowDown", () => run(() => state.move(1))],
    ["Add", "Plus", () => toggleAdd()],
    ["Remove", "Trash2", () => run(() => state.remove())],
    ["Undo", "Undo2", () => run(() => state.undo())],
    ["Redo", "Redo2", () => run(() => state.redo())],
    ["Expression (fx)", "SquareFunction", () => openExpression()],
    ["Expand all", "UnfoldVertical", () => { collapsed.clear(); draw(); }],
    ["Collapse all", "FoldVertical", () => {
      const roots = projectEditorTree(state.definition, state.schema);
      function collapse(nodes) {
        for (const node of nodes) {
          if (isCollapsibleNode(node)) collapsed.add(node.id);
          collapse(node.children);
        }
      }
      collapse(roots);
      const selected = roots.find(node => state.selection?.path === node.id || state.selection?.path.startsWith(`${node.id}/`));
      if (selected && state.selection.path !== selected.id) state.select(selected.id);
      draw();
    }]
  ];
  for (const [label, icon, action] of actions) {
    const element = button(label, icon, action);
    if (["Save", "Save As"].includes(label)) {
      element.classList.add("editor-save-command");
      element.append(document.createTextNode(label));
      element.disabled = !ruleName;
    }
    buttons.set(label, element);
    (saveContainer && ["Save", "Save As"].includes(label) ? saveCommands : controls).append(element);
  }
  buttons.get("Add").setAttribute("aria-haspopup", "menu");
  buttons.get("Add").setAttribute("aria-expanded", "false");

  const valueLabel = document.createElement("label");
  valueLabel.className = "editor-value-control";
  const caption = document.createElement("span");
  caption.textContent = "Value";
  const field = document.createElement("textarea");
  field.rows = 1;
  field.className = "editor-value-field";
  field.setAttribute("aria-label", "Selected value");
  field.spellcheck = false;
  field.addEventListener("input", () => {
    try {
      field.setCustomValidity("");
      if (state.setValue(field.value, { merge: typing })) {
        typing = true;
        draw();
      }
    } catch (error) {
      field.setCustomValidity(error.message);
      field.reportValidity();
    }
  });
  field.addEventListener("blur", () => { typing = false; });
  field.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      field.blur();
    } else if (event.key === "Escape") {
      field.setCustomValidity("");
      field.value = state.selectedValue.text;
      field.blur();
    }
  });
  valueLabel.append(caption, field);

  const menu = document.createElement("div");
  menu.className = "editor-add-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Add object");
  menu.hidden = true;
  function hideAdd() {
    menu.hidden = true;
    buttons.get("Add").setAttribute("aria-expanded", "false");
  }
  function toggleAdd() {
    if (!menu.hidden) { hideAdd(); return; }
    menu.replaceChildren();
    for (const choice of state.addChoices) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.textContent = choice.label;
      item.addEventListener("click", () => run(() => state.add(choice)));
      menu.append(item);
    }
    menu.style.left = `${buttons.get("Add").offsetLeft}px`;
    menu.hidden = false;
    buttons.get("Add").setAttribute("aria-expanded", "true");
    menu.firstElementChild?.focus();
  }
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape") { hideAdd(); buttons.get("Add").focus(); }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.children];
      const index = items.indexOf(document.activeElement);
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });

  const canvas = document.createElement("div");
  canvas.className = "editor-canvas";
  canvas.setAttribute("aria-label", "Editable rule tree");
  function onSelection(event) {
    if (event.target.closest(".re-branch-toggle")) return;
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    const block = event.target.closest(".re-block");
    const row = block?.closest(".re-node-row");
    if (!row) return;
    if (!restoring) {
      state.select(row.dataset.nodeId, block.querySelector(".re-values") ? block.querySelector(".re-label").textContent : null);
      typing = false;
    }
    field.setCustomValidity("");
    updateToolbar();
  }
  canvas.addEventListener("click", onSelection);
  canvas.addEventListener("keydown", onSelection);
  canvas.addEventListener("dblclick", event => {
    onSelection(event);
    if (event.target.closest(".re-block") && expressionPopupKind(state.selectedValue)) openExpression();
  });

  const dialog = document.createElement("dialog");
  dialog.className = "editor-expression-dialog";
  dialog.setAttribute("aria-label", "Expression");
  const form = document.createElement("form");
  const heading = document.createElement("h2");
  heading.textContent = "Expression";
  const expression = document.createElement("textarea");
  expression.className = "editor-expression-value";
  expression.rows = 10;
  expression.spellcheck = false;
  expression.setAttribute("aria-label", "Expression value");
  const footer = document.createElement("div");
  footer.className = "editor-dialog-actions";
  const cancel = button("Cancel", "X", () => dialog.close());
  const apply = button("Apply", "Check", () => form.requestSubmit());
  cancel.append(document.createTextNode("Cancel"));
  apply.append(document.createTextNode("OK"));
  footer.append(cancel, apply);
  const popupError = document.createElement("p");
  popupError.className = "expression-error";
  popupError.setAttribute("role", "alert");
  popupError.hidden = true;
  let conditionEditor;
  let targetEditor;
  let constraintEditor;
  let popupKind;
  let popupSelection;
  form.append(heading, expression, popupError, footer);
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const value = constraintEditor ? constraintEditor.value : targetEditor ? targetEditor.value : conditionEditor ? conditionEditor.value : expression.value;
      const parsed = popupKind === "constraint" && typeof value === "string" ? JSON.parse(value) : value;
      if (popupKind === "constraint" && !Array.isArray(parsed)) throw new TypeError("Constraints must be a JSON array.");
      state.select(popupSelection.path, popupSelection.field);
      run(() => popupKind === "constraint" ? state.setCollection(parsed) : state.setValue(parsed));
      dialog.close();
    } catch (error) {
      popupError.textContent = error.message;
      popupError.hidden = false;
    }
  });
  dialog.append(form);
  dialog.addEventListener("close", () => {
    if (!dialog.open) {
      targetEditor?.destroy(); targetEditor = null;
      constraintEditor?.destroy(); constraintEditor = null;
      field.focus();
    }
  });
  function openExpression() {
    typing = false;
    hideAdd();
    const selected = state.selectedValue;
    popupKind = expressionPopupKind(selected);
    popupSelection = { ...state.selection };
    conditionEditor?.destroy();
    conditionEditor = null;
    targetEditor?.destroy();
    targetEditor = null;
    constraintEditor?.destroy();
    constraintEditor = null;
    popupError.hidden = true;
    apply.disabled = false;
    const titles = { condition: "Expression Editor", constraint: "Constraint", target: "Target", transform: "Transform", ruleName: "Rule Name", value: "Value" };
    const title = titles[popupKind] ?? "Expression";
    heading.textContent = title;
    dialog.setAttribute("aria-label", title);
    dialog.classList.toggle("editor-condition-dialog", popupKind === "condition");
    dialog.classList.toggle("editor-constraint-dialog", popupKind === "constraint");
    expression.classList.toggle("expression-source", popupKind === "condition");
    expression.rows = popupKind === "condition" ? 2 : 10;
    expression.readOnly = popupKind === "condition";
    expression.hidden = ["target", "transform", "constraint"].includes(popupKind);
    expression.setAttribute("aria-label", popupKind === "condition" ? "Full expression" : popupKind === "constraint" ? "Constraint values" : "Expression value");
    expression.value = popupKind === "constraint" ? JSON.stringify(JSON.parse(selected.text || "[]"), null, 2) : selected.text;
    if (popupKind === "condition") {
      conditionEditor = createConditionEditor(document, {
        source: selected.text, assistant: state.schema, button,
        onChange(value, error) { expression.value = value; apply.disabled = !!error; }
      });
      form.insertBefore(conditionEditor.element, popupError);
    } else if (["target", "transform"].includes(popupKind)) {
      targetEditor = createTargetPicker(document, {
        value: selected.text, button, fieldName: popupKind,
        loadItems: popupKind === "target" ? loadConfigItems : loadTransforms,
        sourceName: popupKind === "target" ? "config items" : "transforms",
        responseKey: popupKind === "target" ? "configItems" : "transforms"
      });
      form.insertBefore(targetEditor.element, popupError);
    } else if (popupKind === "constraint") {
      constraintEditor = createConstraintEditor(document, {
        value: JSON.parse(selected.text || "[]"), loadMessageClasses, loadConstraintOptions, loadConfigItems,
        onChange(blocked) { apply.disabled = blocked; }
      });
      form.insertBefore(constraintEditor.element, popupError);
    }
    dialog.showModal();
    if (constraintEditor) constraintEditor.focus();
    else if (targetEditor) targetEditor.focus();
    else expression.focus();
  }

  function updateToolbar() {
    const selected = state.selectedValue;
    if (field.value !== selected.text) field.value = selected.text;
    field.disabled = !state.selection;
    field.readOnly = !selected.editable;
    buttons.get("Move up").disabled = !state.canMove(-1);
    buttons.get("Move down").disabled = !state.canMove(1);
    buttons.get("Add").disabled = !state.addChoices.length;
    buttons.get("Remove").disabled = !state.selection;
    buttons.get("Undo").disabled = !state.past.length;
    buttons.get("Redo").disabled = !state.future.length;
    buttons.get("Expression (fx)").disabled = (!selected.editable && !selected.collectionEditable) || selected.boolean;
    buttons.get("Expand all").disabled = !collapsed.size;
    buttons.get("Collapse all").disabled = !hasCollapsibleBranches;
  }

  function draw() {
    const { scrollTop, scrollLeft } = canvas;
    mountedTree?.destroy();
    const roots = projectEditorTree(state.definition, state.schema);
    const validBranches = new Set();
    function revealSelection(nodes) {
      for (const node of nodes) {
        if (isCollapsibleNode(node)) validBranches.add(node.id);
        if (state.selection?.path.startsWith(`${node.id}/`)) collapsed.delete(node.id);
        revealSelection(node.children);
      }
    }
    revealSelection(roots);
    hasCollapsibleBranches = validBranches.size > 0;
    for (const key of collapsed) if (!validBranches.has(key)) collapsed.delete(key);
    mountedTree = renderRuleTree(canvas, roots, {
      collapsed,
      onToggle(node, hidden) {
        if (hidden && state.selection?.path.startsWith(`${node.id}/`)) {
          typing = false;
          state.select(node.id);
          [...canvas.querySelectorAll(".re-node-row")].find(row => row.dataset.nodeId === node.id)?.firstElementChild.click();
        }
        updateToolbar();
      }
    });
    canvas.scrollTop = scrollTop;
    canvas.scrollLeft = scrollLeft;
    if (state.selection) {
      const row = [...canvas.querySelectorAll(".re-node-row")].find(element => element.dataset.nodeId === state.selection.path);
      const selectedBlock = state.selection.field
        ? [...(row?.children ?? [])].find(block => block.querySelector(".re-label")?.textContent === state.selection.field)
        : row?.firstElementChild;
      restoring = true;
      (selectedBlock ?? row?.firstElementChild)?.click();
      restoring = false;
    }
    updateToolbar();
  }

  controls.append(menu);
  const closeMenu = event => { if (!toolbar.contains(event.target)) hideAdd(); };
  document.addEventListener("click", closeMenu);
  if (saveContainer) saveContainer.append(saveCommands);
  toolbar.append(controls, valueLabel);
  root.append(toolbar, canvas, dialog, saveDialog.element);
  container.append(root);
  if (!state.selection && state.definition.ruleSets.length) state.select("/ruleSets/0");
  draw();
  return {
    destroy() {
      document.removeEventListener("click", closeMenu);
      saveDialog.destroy();
      if (dialog.open) dialog.close();
      conditionEditor?.destroy();
      targetEditor?.destroy();
      targetEditor = null;
      constraintEditor?.destroy();
      constraintEditor = null;
      mountedTree?.destroy();
      saveCommands.remove();
      root.remove();
    }
  };
}