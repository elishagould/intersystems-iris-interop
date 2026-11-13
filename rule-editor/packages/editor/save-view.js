import { createRuleExport, joinRuleName, splitRuleName } from "./save.js";

export function createRuleNameFields(document, { prefix }) {
  const element = document.createElement("div");
  element.className = "editor-rule-identity";
  const controls = {};
  for (const key of ["Package", "Name"]) {
    const label = document.createElement("label");
    label.className = "editor-save-name";
    const caption = document.createElement("span");
    caption.textContent = key;
    const input = document.createElement("input");
    input.type = "text";
    input.required = true;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", `${prefix} ${key.toLowerCase()}`);
    label.append(caption, input);
    element.append(label);
    controls[key.toLowerCase()] = input;
  }
  return {
    element, ...controls,
    set(value) { const parts = splitRuleName(value); controls.package.value = parts.packageName; controls.name.value = parts.name; },
    get value() { return joinRuleName(controls.package.value, controls.name.value); }
  };
}

export function createRuleSaveDialog(document, { name, getDefinition, button, onSave, onSaved = () => {} }) {
  const view = document.defaultView;
  const dialog = document.createElement("dialog");
  dialog.className = "editor-expression-dialog editor-save-dialog";
  const form = document.createElement("form");
  const heading = document.createElement("h2");
  const identity = createRuleNameFields(document, { prefix: "Save As" });
  const destination = document.createElement("p");
  destination.className = "editor-save-destination";
  destination.setAttribute("aria-label", "Export destination");
  const json = document.createElement("textarea");
  json.className = "editor-save-json";
  json.readOnly = true;
  json.spellcheck = false;
  json.setAttribute("aria-label", "Rule JSON");
  const error = document.createElement("p");
  error.className = "expression-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  const footer = document.createElement("div");
  footer.className = "editor-dialog-actions";
  const close = button("Close JSON output", "X", () => dialog.close());
  close.append("Close");
  let output;
  let snapshot;
  let mode;
  let busy = false;
  let destroyed = false;
  let request;
  const download = button("Download JSON", "Download", () => {
    if (!output) return;
    const url = view.URL.createObjectURL(new view.Blob([output.json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = output.filename;
    document.body.append(link);
    link.click();
    link.remove();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
  });
  download.append("Download JSON");
  const submit = button("Save rule", "Save", () => persist());
  const submitLabel = document.createElement("span");
  submit.append(submitLabel);
  footer.append(close, download, submit);
  form.append(heading, identity.element, destination, json, error, footer);
  dialog.append(form);

  function generate() {
    try {
      output = createRuleExport(snapshot, { name: mode === "saveAs" ? identity.value : name, sourceName: name, mode });
      json.value = output.json;
      destination.textContent = `${output.method} ${output.name}`;
      error.hidden = true;
      download.disabled = false;
      submit.disabled = !onSave || busy;
    } catch (failure) {
      output = undefined;
      json.value = "";
      destination.textContent = "";
      error.textContent = failure.message;
      error.hidden = false;
      download.disabled = true;
      submit.disabled = true;
    }
  }

  async function persist() {
    if (busy || !onSave) return;
    generate();
    if (!output) return;
    const sent = output;
    request = new AbortController();
    busy = true;
    submit.disabled = close.disabled = download.disabled = true;
    identity.package.disabled = identity.name.disabled = true;
    dialog.setAttribute("aria-busy", "true");
    try {
      const result = await onSave(sent, request.signal);
      if (destroyed || request.signal.aborted) return;
      dialog.close();
      onSaved(result, sent);
    } catch (failure) {
      if (!destroyed && !request.signal.aborted) { error.textContent = failure.message; error.hidden = false; }
    } finally {
      if (!destroyed) {
        busy = false;
        submit.disabled = !output || !onSave;
        close.disabled = download.disabled = false;
        identity.package.disabled = identity.name.disabled = false;
        dialog.setAttribute("aria-busy", "false");
      }
    }
  }

  identity.package.addEventListener("input", generate);
  identity.name.addEventListener("input", generate);
  form.addEventListener("submit", event => { event.preventDefault(); return persist(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  return {
    element: dialog,
    open(saveMode = "save") {
      mode = saveMode;
      snapshot = structuredClone(getDefinition());
      identity.set(mode === "saveAs" ? `${name}Copy` : name);
      identity.element.hidden = mode !== "saveAs";
      heading.textContent = mode === "saveAs" ? "Save As" : "Save";
      submitLabel.textContent = mode === "saveAs" ? "Save As" : "Save";
      dialog.setAttribute("aria-label", heading.textContent);
      generate();
      if (!dialog.open) dialog.showModal();
      if (mode === "saveAs") { identity.name.focus(); identity.name.select(); }
      else json.focus();
    },
    destroy() { destroyed = true; request?.abort(); if (dialog.open) dialog.close(); dialog.remove(); }
  };
}