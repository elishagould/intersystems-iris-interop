const propertyOrder = {
  ruleSet: ["name", "effectiveBegin", "effectiveEnd"],
  rule: ["name", "disabled", "constraints"],
  condition: [],
  foreach: ["propertypath"],
  send: ["transform", "target"],
  assign: ["property", "value"],
  trace: ["value"],
  debug: ["value"],
  comment: ["text"],
  delegate: ["ruleName"],
  return: ["value"],
  delete: [],
  else: [],
  then: []
};

const structuralProperties = new Set([
  "type", "actions", "conditions", "then", "else", "comments", "if",
  "valueObject", "conditionObject"
]);

function valueLines(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(valueLines);
  if (typeof value === "object") {
    if ("name" in value && "value" in value) return [`${value.name} = ${value.value}`];
    return [JSON.stringify(value)];
  }
  return String(value).split(/\r?\n/);
}

export function blockFields(node, schema) {
  if (node.type === "condition") {
    const values = valueLines(node.if?.value);
    return values.length ? [{ name: "condition", values, format: "condition" }] : [];
  }
  const names = propertyOrder[node.type] ?? Object.keys(schema?.definitions?.[node.type]?.properties ?? node)
    .filter(name => !structuralProperties.has(name));
  return names.flatMap(name => {
    const values = valueLines(node[name]);
    return values.length ? [{ name: name === "constraints" ? "constraint" : name, values }] : [];
  });
}

export function projectRuleDefinition(definition, schema) {
  if (!definition || definition.type !== "ruleDefinition" || !Array.isArray(definition.ruleSets)) {
    throw new TypeError("Expected a ruleDefinition with a ruleSets array.");
  }

  function projectList(items, path, parentId, countedType = "rule") {
    let count = 0;
    return (items ?? []).map((item, index) => projectNode(item, `${path}/${index}`, parentId,
      item.type === countedType ? ++count : undefined));
  }

  function projectNode(source, id, parentId, count) {
    const node = {
      id,
      parentId,
      type: source.type,
      text: source.type === "condition" ? "when" : source.type === "else" ? "otherwise" : source.type,
      count,
      fields: blockFields(source, schema),
      children: []
    };
    node.children.push(...projectList(source.comments, `${id}/comments`, id));
    if (source.type === "rule" || source.type === "foreach") {
      node.children.push(...projectList(source.conditions, `${id}/conditions`, id, "condition"));
      if (source.else) node.children.push(projectNode(source.else, `${id}/else`, id));
    } else if (source.type === "condition") {
      node.children.push(...projectList(source.then?.actions, `${id}/then/actions`, id));
    } else {
      node.children.push(...projectList(source.actions, `${id}/actions`, id));
    }
    return node;
  }

  return definition.ruleSets.map((ruleSet, index) => projectNode(ruleSet, `/ruleSets/${index}`, null));
}

export function flattenRuleTree(roots, depth = 0) {
  return roots.flatMap(node => [{ ...node, depth }, ...flattenRuleTree(node.children, depth + 1)]);
}

export function availableBlockTypes(schema) {
  return Object.entries(schema.definitions ?? {})
    .filter(([, definition]) => definition.properties?.type?.const)
    .map(([name, definition]) => ({ name, type: definition.properties.type.const, definition }));
}