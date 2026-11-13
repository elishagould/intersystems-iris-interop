const typeLabels = { condition: "when", else: "otherwise" };
const propertyLabels = { constraints: "constraint" };
const transparentTypes = new Set(["ruleDefinition", "then"]);
const countedTypes = new Set(["rule", "condition"]);
const scalarTypes = new Set(["string", "boolean", "integer", "number"]);

export function pointerParts(path) {
  return path.split("/").slice(1).map(part => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

export function pointerKey(key) {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function valueAt(object, path) {
  return pointerParts(path).reduce((value, key) => value?.[key], object);
}

export function resolveSchema(assistant, definition, value) {
  let resolved = definition;
  const visited = new Set();
  while (resolved?.$ref) {
    if (!resolved.$ref.startsWith("#/")) throw new TypeError("Only local RuleAssist references are supported.");
    if (visited.has(resolved.$ref)) throw new TypeError("Circular RuleAssist reference.");
    visited.add(resolved.$ref);
    resolved = valueAt(assistant, resolved.$ref.slice(1));
    if (!resolved) throw new TypeError(`Missing RuleAssist reference: ${definition.$ref}`);
  }
  if (resolved?.oneOf && value?.type) {
    return resolved.oneOf.map(option => resolveSchema(assistant, option))
      .find(option => option?.properties?.type?.const === value.type);
  }
  return resolved;
}

export function schemaAt(assistant, data, path) {
  let definition = assistant;
  let value = data;
  for (const key of pointerParts(path)) {
    const resolved = resolveSchema(assistant, definition, value);
    definition = resolved?.type === "array" ? resolved.items : resolved?.properties?.[key];
    value = value?.[key];
  }
  return resolveSchema(assistant, definition, value);
}

function nodeOptions(assistant, definition) {
  const resolved = resolveSchema(assistant, definition);
  return (resolved?.oneOf ?? [resolved]).map(option => resolveSchema(assistant, option))
    .filter(option => typeof option?.properties?.type?.const === "string");
}

function matches(value, condition) {
  if ((condition.required ?? []).some(key => !Object.hasOwn(value ?? {}, key))) return false;
  return Object.entries(condition.properties ?? {}).every(([key, property]) => {
    if (!Object.hasOwn(value ?? {}, key)) return true;
    const actual = value[key];
    if (property.const !== undefined && property.const !== actual) return false;
    if (property.maxItems !== undefined && (!Array.isArray(actual) || actual.length > property.maxItems)) return false;
    if (property.minItems !== undefined && (!Array.isArray(actual) || actual.length < property.minItems)) return false;
    return true;
  });
}

function forbiddenProperties(definition, value) {
  const branch = definition?.if && matches(value, definition.if) ? definition.then : definition?.else;
  return branch?.not?.required ?? [];
}

export function pruneConditionalProperties(assistant, definition, value) {
  for (const key of forbiddenProperties(resolveSchema(assistant, definition, value), value)) delete value[key];
}

export function createSchemaObject(assistant, definition) {
  const resolved = resolveSchema(assistant, definition);
  if (resolved?.default !== undefined) return structuredClone(resolved.default);
  if (resolved?.const !== undefined) return structuredClone(resolved.const);
  if (resolved?.type === "string") return "";
  if (resolved?.type === "boolean") return false;
  if (["integer", "number"].includes(resolved?.type)) return 0;
  if (resolved?.type === "array") return [];
  if (!resolved?.properties) return undefined;
  const object = {};
  for (const [key, property] of Object.entries(resolved.properties)) {
    const child = resolveSchema(assistant, property);
    const type = child?.properties?.type?.const;
    if (type && !transparentTypes.has(type)) continue;
    const value = createSchemaObject(assistant, property);
    if (value !== undefined) object[key] = value;
  }
  for (const key of forbiddenProperties(resolved, object)) delete object[key];
  return object;
}

export function describeFields(assistant, definition, object, prefix = "", inheritedReadOnly = false) {
  const resolved = resolveSchema(assistant, definition, object);
  const fields = [];
  for (const [key, property] of Object.entries(resolved?.properties ?? {})) {
    const child = resolveSchema(assistant, property, object?.[key]);
    if (!child || key === "type" && child.const !== undefined) continue;
    const path = `${prefix}/${pointerKey(key)}`;
    const name = child.title ?? propertyLabels[key] ?? (prefix ? `${prefix.slice(1).replaceAll("/", ".")}.${key}` : key);
    const readOnly = inheritedReadOnly || !!resolved.readOnly || !!property.readOnly || !!child.readOnly;
    if (scalarTypes.has(child.type)) {
      fields.push({ name, path, schema: child, readOnly });
    } else if (child.type === "array") {
      if (!nodeOptions(assistant, child.items).length) fields.push({ name, path, schema: child, readOnly: true, collectionEditable: !readOnly });
    } else if (!nodeOptions(assistant, child).length && child.properties) {
      const nested = describeFields(assistant, child, object?.[key], path, readOnly);
      for (const field of nested) {
        if (nested.length === 1 && field.path.endsWith("/value")) field.name = child.title ?? (key === "if" ? "condition" : key);
        if (key === "if" && field.path === `${path}/value`) field.format = "condition";
        fields.push(field);
      }
    }
  }
  return fields;
}

function fieldValues(value) {
  if (value === undefined || value === null || value === "") return [""];
  if (Array.isArray(value)) return value.length ? value.flatMap(fieldValues) : [""];
  if (typeof value === "object") return ["name" in value && "value" in value ? `${value.name} = ${value.value}` : JSON.stringify(value)];
  return String(value).split(/\r?\n/);
}

export function assistantBlockFields(assistant, definition, object) {
  return describeFields(assistant, definition, object)
    .map(field => ({ name: field.name, values: fieldValues(valueAt(object, field.path)), ...(field.format ? { format: field.format } : {}) }));
}

export function projectAssistantTree(data, assistant) {
  function children(object, definition, path, parentId) {
    const nodes = [];
    const resolved = resolveSchema(assistant, definition, object);
    for (const [key, property] of Object.entries(resolved?.properties ?? {})) {
      const value = object?.[key];
      const childPath = `${path}/${pointerKey(key)}`;
      const childSchema = resolveSchema(assistant, property, value);
      if (childSchema?.type === "array" && nodeOptions(assistant, childSchema.items).length) {
        let count = 0;
        for (const [index, item] of (value ?? []).entries()) {
          const itemSchema = resolveSchema(assistant, childSchema.items, item);
          if (!itemSchema?.properties?.type?.const) continue;
          nodes.push(project(item, itemSchema, `${childPath}/${index}`, parentId, countedTypes.has(item.type) ? ++count : undefined));
        }
      } else if (value && childSchema?.properties) {
        const type = childSchema.properties.type?.const;
        if (type && !transparentTypes.has(type)) nodes.push(project(value, childSchema, childPath, parentId));
        else nodes.push(...children(value, childSchema, childPath, parentId));
      }
    }
    return nodes;
  }
  function project(object, definition, id, parentId, count) {
    return {
      id, parentId, type: object.type, text: definition.title ?? typeLabels[object.type] ?? object.type, count,
      fields: assistantBlockFields(assistant, definition, object),
      children: children(object, definition, id, id)
    };
  }
  return children(data, assistant, "", null);
}

export function schemaAddChoices(assistant, data, path = "") {
  const object = valueAt(data, path);
  const definition = schemaAt(assistant, data, path);
  const choices = [];
  function collect(value, schema, ownerPath) {
    const resolved = resolveSchema(assistant, schema, value);
    if (resolved?.readOnly) return;
    for (const [key, property] of Object.entries(resolved?.properties ?? {})) {
      if (forbiddenProperties(resolved, value).includes(key) || property.readOnly) continue;
      const childPath = `${ownerPath}/${pointerKey(key)}`;
      const child = resolveSchema(assistant, property, value?.[key]);
      if (child?.readOnly) continue;
      if (child?.type === "array") {
        if (child.maxItems !== undefined && (value?.[key]?.length ?? 0) >= child.maxItems) continue;
        for (const option of nodeOptions(assistant, child.items)) {
          const type = option.properties.type.const;
          choices.push({ type, label: option.title ?? typeLabels[type] ?? type, path: childPath, nodeSchema: option });
        }
      } else if (child?.properties) {
        const type = child.properties.type?.const;
        if (type && !transparentTypes.has(type)) {
          if (!value?.[key]) choices.push({ type, label: child.title ?? typeLabels[type] ?? type, path: childPath, single: true, nodeSchema: child });
        } else collect(value?.[key], child, childPath);
      }
    }
  }
  collect(object, definition, path);
  const hasTransparentChild = Object.values(definition?.properties ?? {})
    .some(property => transparentTypes.has(resolveSchema(assistant, property)?.properties?.type?.const));
  if (path && (!choices.length || hasTransparentChild)) {
    const parentPath = path.slice(0, path.lastIndexOf("/"));
    const parent = valueAt(data, parentPath);
    const parentSchema = schemaAt(assistant, data, parentPath);
    if (Array.isArray(parent) && !parentSchema?.readOnly && (parentSchema?.maxItems === undefined || parent.length < parentSchema.maxItems)) {
      for (const option of nodeOptions(assistant, parentSchema?.items)) {
        const type = option.properties.type.const;
        choices.push({ type, label: option.title ?? typeLabels[type] ?? type, path: parentPath, index: Number(path.slice(path.lastIndexOf("/") + 1)) + 1, nodeSchema: option });
      }
    }
  }
  return choices.map(choice => choices.filter(other => other.label === choice.label).length > 1
    ? { ...choice, label: `${choice.label} (${pointerParts(choice.path).at(-1)})` } : choice);
}

export function ensureSchemaPath(data, assistant, path) {
  let value = data;
  let currentPath = "";
  for (const key of pointerParts(path)) {
    currentPath += `/${pointerKey(key)}`;
    value[key] ??= createSchemaObject(assistant, schemaAt(assistant, data, currentPath));
    value = value[key];
  }
  return value;
}

export function isCountedType(type) {
  return countedTypes.has(type);
}