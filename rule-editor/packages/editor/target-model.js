export function configItemNames(response) {
  return pickerItemNames(response, "configItems");
}

export function pickerItemNames(response, key) {
  if (!Array.isArray(response?.[key]) || response[key].some(item => typeof item !== "string")) {
    throw new TypeError(`Expected a ${key} array of names.`);
  }
  return [...new Set(response[key].map(item => item.trim()).filter(Boolean))];
}

export class TargetDraft {
  constructor(value = "") {
    this.items = [];
    this.add(value);
  }

  add(value) {
    let changed = false;
    for (const name of String(value).split(",").map(item => item.trim()).filter(Boolean)) {
      if (!this.items.includes(name)) { this.items.push(name); changed = true; }
    }
    return changed;
  }

  remove(index) {
    if (index >= 0 && index < this.items.length) this.items.splice(index, 1);
  }

  matches(query, names) {
    const filter = query.trim().toLocaleLowerCase();
    return names.filter(name => !this.items.includes(name) && name.toLocaleLowerCase().includes(filter));
  }

  get value() { return this.items.join(","); }
}