export function messageClassSections(response) {
  const sections = [];
  function visit(object, path = "") {
    for (const [key, value] of Object.entries(object ?? {})) {
      const name = path ? `${path}.${key}` : key;
      if (Array.isArray(value)) {
        if (value.some(item => typeof item !== "string")) throw new TypeError(`Invalid message class list: ${name}`);
        sections.push({ name, classes: [...new Set(value.map(item => item.trim()).filter(Boolean))] });
      } else if (value && typeof value === "object") visit(value, name);
    }
  }
  visit(response);
  if (!sections.length) throw new TypeError("No message class sections were returned.");
  return sections;
}

export function constraintOptions(response) {
  if (!Array.isArray(response?.constraintOptions)) throw new TypeError("Expected a constraintOptions array.");
  const names = new Set();
  return response.constraintOptions.map(option => {
    if (typeof option.name !== "string" || !option.name || names.has(option.name)) throw new TypeError("Invalid or duplicate constraint name.");
    if (option.options !== undefined && (!Array.isArray(option.options) || option.options.some(value => typeof value !== "string"))) {
      throw new TypeError(`Invalid options for ${option.name}.`);
    }
    names.add(option.name);
    return { ...option, description: option.description || option.name, options: option.options ?? [] };
  });
}

export class ConstraintDraft {
  constructor(items = []) {
    if (!Array.isArray(items)) throw new TypeError("Expected a constraint array.");
    this.items = structuredClone(items);
  }

  get(name) { return this.items.find(item => item.name === name)?.value ?? ""; }
  get messageClass() { return this.get("msgClass"); }

  set(name, value) {
    const text = Array.isArray(value) ? [...new Set(value)].join(",") : String(value ?? "");
    if (!text) { this.items = this.items.filter(item => item.name !== name); return; }
    const index = this.items.findIndex(item => item.name === name);
    if (index >= 0) this.items[index] = { ...this.items[index], value: text };
    else {
      const item = { type: "constraint", name, value: text };
      if (name === "msgClass") this.items.unshift(item);
      else this.items.push(item);
    }
  }

  get value() { return structuredClone(this.items); }
}