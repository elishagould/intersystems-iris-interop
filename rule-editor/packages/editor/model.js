import { createSchemaObject, describeFields, ensureSchemaPath, pointerParts, projectAssistantTree, pruneConditionalProperties, resolveSchema, schemaAddChoices, schemaAt, valueAt } from "./rule-assist.js";

export function projectEditorTree(definition, schema) {
  return projectAssistantTree(definition, schema);
}

export function objectAt(definition, path) {
  return valueAt(definition, path);
}

function parentEntry(definition, path) {
  const keys = pointerParts(path);
  const key = keys.pop();
  const parentPath = path.slice(0, path.lastIndexOf("/"));
  return { parent: objectAt(definition, parentPath), key, parentPath };
}

export class RuleEditorState {
  constructor(definition, schema) {
    this.definition = structuredClone(definition);
    this.schema = schema;
    this.selection = null;
    this.past = [];
    this.future = [];
  }

  select(path, field = null) {
    this.selection = objectAt(this.definition, path) ? { path, field } : null;
  }

  get selectedObject() {
    return this.selection ? objectAt(this.definition, this.selection.path) : null;
  }

  get selectedValue() {
    const node = this.selectedObject;
    if (!node) return { text: "", editable: false };
    const fields = describeFields(this.schema, schemaAt(this.schema, this.definition, this.selection.path), node);
    const field = this.selection.field ? fields.find(field => field.name === this.selection.field)
      : fields.find(field => !field.readOnly) ?? fields[0];
    if (!field) return { text: node.type, editable: false };
    const value = objectAt(node, field.path);
    return {
      text: field.schema.type === "array" ? JSON.stringify(value ?? []) : String(value ?? ""),
      editable: !field.readOnly, field: field.name, path: field.path, schema: field.schema,
      boolean: field.schema.type === "boolean", format: field.format, collectionEditable: field.collectionEditable
    };
  }

  change(mutator, selection = this.selection, { merge = false } = {}) {
    const draft = structuredClone(this.definition);
    mutator(draft);
    if (JSON.stringify(draft) === JSON.stringify(this.definition)) return false;
    if (!merge || !this.past.length) this.past.push({ definition: this.definition, selection: this.selection });
    this.future = [];
    this.definition = draft;
    this.selection = selection;
    return true;
  }

  setValue(text, { merge = false } = {}) {
    const value = this.selectedValue;
    if (!value.editable) return false;
    if (value.boolean && !["true", "false"].includes(text)) throw new TypeError(`${value.field} must be true or false.`);
    let parsed = value.boolean ? text === "true" : text;
    if (["integer", "number"].includes(value.schema.type)) {
      parsed = Number(text);
      if (!text.trim() || !Number.isFinite(parsed) || value.schema.type === "integer" && !Number.isInteger(parsed)) {
        throw new TypeError(`${value.field} must be a valid ${value.schema.type}.`);
      }
    }
    if (value.schema.enum && !value.schema.enum.includes(parsed)) throw new TypeError(`${value.field} must match a RuleAssist option.`);
    return this.change(draft => {
      const path = `${this.selection.path}${value.path}`;
      const { parentPath, key } = parentEntry(draft, path);
      const parent = ensureSchemaPath(draft, this.schema, parentPath);
      parent[key] = parsed;
      if (key === "value") {
        const definition = schemaAt(this.schema, draft, parentPath);
        for (const [name, property] of Object.entries(definition?.properties ?? {})) {
          const expression = resolveSchema(this.schema, property);
          if (expression?.oneOf?.some(option => option.properties?.operator && option.properties?.operands)) delete parent[name];
        }
      }
    }, this.selection, { merge });
  }

  canMove(direction) {
    if (!this.selection || ![-1, 1].includes(direction)) return false;
    const { parent, key } = parentEntry(this.definition, this.selection.path);
    const index = Number(key);
    return Array.isArray(parent) && Number.isInteger(index) && index + direction >= 0 && index + direction < parent.length;
  }

  setCollection(items) {
    const selected = this.selectedValue;
    if (!selected.collectionEditable || !Array.isArray(items)) return false;
    return this.change(draft => {
      const { parentPath, key } = parentEntry(draft, `${this.selection.path}${selected.path}`);
      ensureSchemaPath(draft, this.schema, parentPath)[key] = structuredClone(items);
    });
  }

  move(direction) {
    if (!this.canMove(direction)) return false;
    const { parentPath, key } = parentEntry(this.definition, this.selection.path);
    const index = Number(key);
    return this.change(draft => {
      const array = objectAt(draft, parentPath);
      const [node] = array.splice(index, 1);
      array.splice(index + direction, 0, node);
    }, { ...this.selection, path: `${parentPath}/${index + direction}` });
  }

  remove() {
    if (!this.selection) return false;
    const { parent, parentPath, key } = parentEntry(this.definition, this.selection.path);
    let next = Array.isArray(parent)
      ? (parent.length > 1 ? `${parentPath}/${Math.min(Number(key), parent.length - 2)}` : parentPath.slice(0, parentPath.lastIndexOf("/")))
      : parentPath;
    if (next.endsWith("/then")) next = next.slice(0, -"/then".length);
    return this.change(draft => {
      const entry = parentEntry(draft, this.selection.path);
      if (Array.isArray(entry.parent)) entry.parent.splice(Number(entry.key), 1);
      else delete entry.parent[entry.key];
      const ownerPath = Array.isArray(entry.parent) ? parentPath.slice(0, parentPath.lastIndexOf("/")) : parentPath;
      pruneConditionalProperties(this.schema, schemaAt(this.schema, draft, ownerPath), objectAt(draft, ownerPath));
    }, next && objectAt(this.definition, next)?.type ? { path: next, field: null } : null);
  }

  get addChoices() {
    return schemaAddChoices(this.schema, this.definition, this.selection?.path ?? "");
  }

  add(choice) {
    choice = this.addChoices.find(item => item.type === choice?.type && item.path === choice.path);
    if (!choice) return false;
    const array = objectAt(this.definition, choice.path);
    const index = choice.index ?? array?.length ?? 0;
    const nextPath = choice.single ? choice.path : `${choice.path}/${index}`;
    return this.change(draft => {
      const { parentPath, key } = parentEntry(draft, choice.path);
      const parent = ensureSchemaPath(draft, this.schema, parentPath);
      if (choice.single) parent[key] = createSchemaObject(this.schema, choice.nodeSchema);
      else {
        parent[key] ??= [];
        parent[key].splice(index, 0, createSchemaObject(this.schema, choice.nodeSchema));
      }
    }, { path: nextPath, field: null });
  }

  undo() {
    if (!this.past.length) return false;
    this.future.push({ definition: this.definition, selection: this.selection });
    Object.assign(this, this.past.pop());
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push({ definition: this.definition, selection: this.selection });
    Object.assign(this, this.future.pop());
    return true;
  }
}