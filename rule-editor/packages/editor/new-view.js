import { createRuleNameFields } from "./save-view.js";
import { pickerItemNames } from "./target-model.js";

let packageListSequence = 0;

export function createNewRuleDialog(document, { getRuleTypes, getSourceName = () => "", loadClassPackages, button, onCreate, onCreated = () => {} }) {
  const dialog = document.createElement("dialog");
  dialog.className = "editor-expression-dialog editor-new-dialog";
  dialog.setAttribute("aria-label", "New business rule");
  const form = document.createElement("form");
  const heading = document.createElement("h2");
  heading.textContent = "New Business Rule";
  const identity = createRuleNameFields(document, { prefix: "New" });
  const packageList = document.createElement("datalist");
  packageList.id = `new-rule-packages-${++packageListSequence}`;
  identity.package.setAttribute("list", packageList.id);
  const packageStatus = document.createElement("p");
  packageStatus.className = "constraint-status";
  packageStatus.setAttribute("role", "status");
  packageStatus.hidden = true;
  function field(text, tag, accessibleName) {
    const label = document.createElement("label");
    label.className = "editor-save-name";
    const caption = document.createElement("span");
    caption.textContent = text;
    const input = document.createElement(tag);
    input.setAttribute("aria-label", accessibleName);
    label.append(caption, input);
    form.append(label);
    return input;
  }
  form.append(heading, identity.element, packageList, packageStatus);
  const description = field("Description", "textarea", "New description");
  description.rows = 3;
  const type = field("Rule Type", "select", "Rule Type");
  type.required = true;
  const context = field("Context class", "input", "Context class");
  context.type = "text";
  context.required = true;
  context.spellcheck = false;
  const error = document.createElement("p");
  error.className = "expression-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  const footer = document.createElement("div");
  footer.className = "editor-dialog-actions";
  const cancel = button("Cancel New rule", "X", () => dialog.close());
  cancel.append("Cancel");
  const create = button("Create business rule", "FilePlus2", () => submit());
  create.append("Create");
  footer.append(cancel, create);
  form.append(error, footer);
  dialog.append(form);
  let types = [];
  let busy = false;
  let destroyed = false;
  let request;
  let packageRequest;
  let packageGeneration = 0;
  async function loadPackages() {
    packageRequest?.abort();
    const generation = ++packageGeneration;
    packageList.replaceChildren();
    if (!loadClassPackages) return;
    packageRequest = new AbortController();
    packageStatus.textContent = "Loading packages...";
    packageStatus.hidden = false;
    try {
      const response = await loadClassPackages(packageRequest.signal);
      if (destroyed || generation !== packageGeneration) return;
      for (const name of pickerItemNames(response, "classPackages")) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        packageList.append(option);
      }
      packageStatus.hidden = true;
    } catch (failure) {
      if (!destroyed && generation === packageGeneration && failure.name !== "AbortError") {
        packageStatus.textContent = "Packages could not be loaded.";
        packageStatus.hidden = false;
      }
    }
  }
  type.addEventListener("change", () => { context.value = types.find(item => item.name === type.value)?.contextClass ?? ""; });
  async function submit() {
    if (busy) return;
    try {
      const ruleType = types.find(item => item.name === type.value);
      if (!ruleType) throw new TypeError("Select a Rule Type.");
      const fullName = identity.value;
      if (!context.value.trim()) throw new TypeError("Enter a context class.");
      request = new AbortController();
      busy = true;
      error.hidden = true;
      for (const control of [identity.package, identity.name, description, type, context, cancel, create]) control.disabled = true;
      dialog.setAttribute("aria-busy", "true");
      const result = await onCreate({ name: fullName, description: description.value, ruleType, contextClass: context.value.trim() }, request.signal);
      if (destroyed || request.signal.aborted) return;
      dialog.close();
      onCreated(result, { name: fullName });
    } catch (failure) {
      if (!destroyed && !request?.signal.aborted) { error.textContent = failure.message; error.hidden = false; }
    } finally {
      if (!destroyed) {
        busy = false;
        for (const control of [identity.package, identity.name, description, type, context, cancel, create]) control.disabled = false;
        dialog.setAttribute("aria-busy", "false");
      }
    }
  }
  form.addEventListener("submit", event => { event.preventDefault(); return submit(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { if (!dialog.open) { packageRequest?.abort(); packageGeneration++; } });
  return {
    element: dialog,
    open() {
      types = getRuleTypes();
      identity.set(getSourceName());
      identity.name.value = "";
      description.value = "";
      type.replaceChildren();
      for (const entry of types) {
        const option = document.createElement("option");
        option.value = entry.name;
        option.textContent = entry.description || entry.name;
        option.title = entry.name;
        type.append(option);
      }
      type.value = types[0]?.name ?? "";
      context.value = types[0]?.contextClass ?? "";
      error.hidden = true;
      create.disabled = !types.length;
      dialog.showModal();
      identity.name.focus();
      return loadPackages();
    },
    destroy() { destroyed = true; packageGeneration++; packageRequest?.abort(); request?.abort(); if (dialog.open) dialog.close(); dialog.remove(); }
  };
}