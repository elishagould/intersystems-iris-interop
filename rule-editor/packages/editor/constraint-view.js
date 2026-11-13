import { ConstraintDraft, constraintOptions, messageClassSections } from "./constraint-model.js";
import { configItemNames } from "./target-model.js";

export function createConstraintEditor(document, { value, loadMessageClasses, loadConstraintOptions, loadConfigItems, onChange = () => {} }) {
  const draft = new ConstraintDraft(value);
  const lifetime = new AbortController();
  let request;
  let generation = 0;
  let sections = [];
  let destroyed = false;
  let loading = true;
  let failure = "";
  const element = document.createElement("div");
  element.className = "constraint-editor";
  const sectionSelect = document.createElement("select");
  sectionSelect.setAttribute("aria-label", "Message class section");
  sectionSelect.disabled = true;
  const classSelect = document.createElement("select");
  classSelect.setAttribute("aria-label", "Message class");
  classSelect.disabled = true;
  const fields = document.createElement("div");
  fields.className = "constraint-options";
  const status = document.createElement("p");
  status.className = "constraint-status";
  status.setAttribute("role", "status");

  function labeled(text, control) {
    const label = document.createElement("label");
    label.className = "constraint-field";
    const caption = document.createElement("span");
    caption.textContent = text;
    label.append(caption, control);
    return label;
  }

  function option(value, text = value) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = text;
    return item;
  }

  function update(message = "") {
    status.textContent = message || failure;
    status.hidden = !status.textContent;
    status.classList.toggle("constraint-error", !!failure);
    onChange(loading || !!failure);
  }

  function renderClasses() {
    const classes = sections.find(section => section.name === sectionSelect.value)?.classes ?? [];
    classSelect.replaceChildren(option("", "None"), ...classes.map(name => option(name)));
    if (draft.messageClass && !classes.includes(draft.messageClass)) classSelect.append(option(draft.messageClass));
    classSelect.value = draft.messageClass;
    classSelect.disabled = !classes.length && !draft.messageClass;
  }

  function renderOptions(options, configItems) {
    fields.replaceChildren();
    for (const metadata of options) {
      const multiple = metadata.control?.split(/\s+/).includes("multiple");
      const selected = multiple ? String(draft.get(metadata.name)).split(",").filter(Boolean) : [String(draft.get(metadata.name))];
      let control;
      if (metadata.control?.startsWith("select")) {
        control = document.createElement("select");
        control.multiple = !!multiple;
        const values = [...new Set([...(metadata.configItem === 1 ? configItems : metadata.options), ...selected.filter(Boolean)])];
        if (multiple) control.size = Math.min(8, Math.max(3, values.length));
        else control.append(option("", "None"));
        for (const value of values) {
          const item = option(value);
          item.selected = selected.includes(value);
          control.append(item);
        }
        if (!multiple) control.value = selected[0];
      } else {
        control = document.createElement("input");
        control.type = "text";
        control.value = String(draft.get(metadata.name));
      }
      control.dataset.constraintName = metadata.name;
      control.setAttribute("aria-label", metadata.description);
      control.addEventListener("change", () => {
        draft.set(metadata.name, multiple ? [...control.selectedOptions].map(item => item.value) : control.value);
      });
      fields.append(labeled(metadata.description, control));
    }
  }

  async function refreshOptions() {
    request?.abort();
    request = new AbortController();
    const current = ++generation;
    const { signal } = request;
    fields.replaceChildren();
    failure = "";
    loading = !!draft.messageClass;
    update(loading ? "Loading constraint options..." : "");
    if (!draft.messageClass) return;
    try {
      if (!loadConstraintOptions) throw new Error("No constraint-options loader configured.");
      const response = await loadConstraintOptions(draft.messageClass, signal);
      if (destroyed || current !== generation) return;
      const options = constraintOptions(response);
      let configItems = [];
      if (options.some(metadata => metadata.configItem === 1)) {
        if (!loadConfigItems) throw new Error("No config-items loader configured.");
        configItems = configItemNames(await loadConfigItems(signal));
      }
      if (destroyed || current !== generation) return;
      renderOptions(options, configItems);
      loading = false;
      update();
    } catch (error) {
      if (destroyed || current !== generation || error.name === "AbortError") return;
      loading = false;
      failure = "Constraint options could not be loaded.";
      update();
    }
  }

  sectionSelect.addEventListener("change", () => {
    draft.set("msgClass", "");
    renderClasses();
    refreshOptions();
  });
  classSelect.addEventListener("change", () => {
    draft.set("msgClass", classSelect.value);
    refreshOptions();
  });
  element.append(labeled("Message class section", sectionSelect), labeled("Message class", classSelect), fields, status);
  update("Loading message classes...");
  Promise.resolve().then(() => {
    if (!loadMessageClasses) throw new Error("No message-classes loader configured.");
    return loadMessageClasses(lifetime.signal);
  }).then(response => {
    if (destroyed) return;
    sections = messageClassSections(response);
    sectionSelect.replaceChildren(...sections.map(section => option(section.name)));
    sectionSelect.value = (sections.find(section => section.classes.includes(draft.messageClass)) ?? sections[0]).name;
    sectionSelect.disabled = false;
    renderClasses();
    refreshOptions();
  }).catch(error => {
    if (destroyed || error.name === "AbortError") return;
    loading = false;
    failure = "Message classes could not be loaded.";
    update();
  });

  return {
    element,
    focus() { sectionSelect.focus(); },
    get value() {
      if (loading || failure) throw new TypeError(failure || "Constraint options are still loading.");
      return draft.value;
    },
    destroy() { destroyed = true; generation++; lifetime.abort(); request?.abort(); element.remove(); }
  };
}