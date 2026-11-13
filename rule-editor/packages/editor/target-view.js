import { pickerItemNames, TargetDraft } from "./target-model.js";

let pickerSequence = 0;

export function createTargetPicker(document, {
  value, loadConfigItems, loadItems = loadConfigItems, button,
  fieldName = "target", sourceName = "config items", responseKey = "configItems"
}) {
  const draft = new TargetDraft(value);
  const abort = new AbortController();
  const id = `target-picker-${++pickerSequence}`;
  const element = document.createElement("div");
  element.className = "target-picker";
  const label = document.createElement("label");
  label.className = "target-picker-label";
  label.htmlFor = id;
  label.textContent = fieldName[0].toUpperCase() + fieldName.slice(1);
  const box = document.createElement("div");
  box.className = "target-picker-box";
  const chips = document.createElement("div");
  chips.className = "target-picker-chips";
  const input = document.createElement("input");
  input.id = id;
  input.className = "target-picker-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", `Add ${fieldName}`);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", `${id}-list`);
  input.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.id = `${id}-list`;
  list.className = "target-picker-options";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", sourceName[0].toUpperCase() + sourceName.slice(1));
  list.hidden = true;
  const status = document.createElement("p");
  status.className = "target-picker-status";
  status.setAttribute("role", "status");
  status.textContent = `Loading ${sourceName}...`;
  let names = [];
  let matches = [];
  let activeIndex = -1;
  let expanded = false;
  let loaded = false;
  let failed = false;
  let destroyed = false;

  function renderChips() {
    chips.replaceChildren();
    draft.items.forEach((name, index) => {
      const chip = document.createElement("span");
      chip.className = "target-picker-chip";
      const text = document.createElement("span");
      text.className = "target-picker-name";
      text.textContent = name;
      const remove = button(`Remove ${fieldName} ${name}`, "X", () => {
        draft.remove(index);
        activeIndex = -1;
        renderChips();
        input.focus();
        renderSuggestions();
      });
      remove.classList.add("target-picker-remove");
      chip.append(text, remove);
      chips.append(chip);
    });
  }

  function renderSuggestions() {
    matches = draft.matches(input.value, names);
    if (activeIndex >= matches.length) activeIndex = -1;
    list.replaceChildren();
    matches.forEach((name, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `${id}-option-${index}`;
      option.tabIndex = -1;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(activeIndex === index));
      option.textContent = name;
      option.addEventListener("pointerdown", event => event.preventDefault());
      option.addEventListener("click", () => commit(name));
      list.append(option);
    });
    list.hidden = !expanded || !matches.length;
    input.setAttribute("aria-expanded", String(!list.hidden));
    if (!list.hidden && activeIndex >= 0) {
      input.setAttribute("aria-activedescendant", `${id}-option-${activeIndex}`);
      list.children[activeIndex].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
    if (!failed && loaded) {
      status.textContent = expanded && !matches.length ? `No matching ${sourceName}.` : "";
      status.hidden = !status.textContent;
    }
  }

  function commit(value = input.value) {
    draft.add(value);
    input.value = "";
    activeIndex = -1;
    expanded = true;
    renderChips();
    renderSuggestions();
    input.focus();
  }

  input.addEventListener("input", () => { activeIndex = -1; expanded = true; renderSuggestions(); });
  input.addEventListener("focus", () => { expanded = true; renderSuggestions(); });
  input.addEventListener("blur", () => {
    queueMicrotask(() => {
      if (!destroyed && !element.contains(document.activeElement)) { expanded = false; renderSuggestions(); }
    });
  });
  input.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commit(activeIndex >= 0 && expanded ? matches[activeIndex] : input.value);
    } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      expanded = true;
      if (matches.length) activeIndex = activeIndex < 0 ? (event.key === "ArrowDown" ? 0 : matches.length - 1)
        : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      renderSuggestions();
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      expanded = false;
      activeIndex = -1;
      renderSuggestions();
    }
  });
  box.addEventListener("click", event => { if (event.target === box || event.target === chips) input.focus(); });
  box.append(chips, input);
  element.append(label, box, list, status);
  renderChips();

  Promise.resolve().then(() => {
    if (!loadItems) throw new Error(`No ${sourceName} loader configured.`);
    return loadItems(abort.signal);
  }).then(response => {
    if (destroyed) return;
    names = pickerItemNames(response, responseKey);
    loaded = true;
    renderSuggestions();
  }).catch(error => {
    if (destroyed || error.name === "AbortError") return;
    failed = true;
    status.hidden = false;
    status.textContent = `${sourceName[0].toUpperCase() + sourceName.slice(1)} could not be loaded.`;
  });

  return {
    element,
    focus() { input.focus(); },
    get value() { if (input.value.trim()) commit(); return draft.value; },
    destroy() { destroyed = true; abort.abort(); element.remove(); }
  };
}