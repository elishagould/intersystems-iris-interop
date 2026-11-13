import { createSchemaObject } from "./rule-assist.js";

const classPattern = /^[%A-Za-z_][\w%]*(?:\.[%A-Za-z_][\w%]*)+$/;

export function splitRuleName(value) {
  const index = value.lastIndexOf(".");
  return { packageName: index >= 0 ? value.slice(0, index) : "", name: value.slice(index + 1) };
}

export function joinRuleName(packageName, name) {
  const qualified = `${packageName.trim()}.${name.trim()}`;
  if (!classPattern.test(qualified) || name.trim().includes(".")) throw new TypeError("Enter a valid package and a single class name.");
  return qualified;
}

export function createNewRuleDefinition(assistant, { description = "", ruleType, contextClass }) {
  if (!ruleType?.name || !classPattern.test(contextClass.trim())) throw new TypeError("Select a Rule Type and enter a valid context class.");
  const definition = createSchemaObject(assistant, assistant);
  if (definition?.type !== "ruleDefinition" || !Array.isArray(definition.ruleSets)) throw new TypeError("RuleAssist must define a ruleDefinition with ruleSets.");
  definition.description = description;
  definition.context = contextClass.trim();
  definition.assistClass = ruleType.name;
  definition.ruleType = ruleType.description ?? ruleType.name;
  definition.ReadOnly = 0;
  if (!definition.ruleSets.length) definition.ruleSets.push(createSchemaObject(assistant, assistant.properties.ruleSets.items));
  return definition;
}

export function createRuleExport(definition, { name, mode = "save", sourceName = name } = {}) {
  if (!definition || definition.type !== "ruleDefinition" || !Array.isArray(definition.ruleSets)) {
    throw new TypeError("Expected a ruleDefinition with a ruleSets array.");
  }
  if (!["save", "saveAs", "new"].includes(mode)) throw new TypeError("Unknown save mode.");
  const ruleName = String(name ?? "").trim();
  if (!classPattern.test(ruleName)) {
    throw new TypeError("Enter a valid dotted business rule class name.");
  }
  if (mode === "saveAs" && ruleName.toLowerCase() === String(sourceName).trim().toLowerCase()) {
    throw new TypeError("Save As requires a different business rule name.");
  }
  const payload = structuredClone(definition);
  delete payload._sourceControl;
  if (mode !== "save") delete payload.Timestamp;
  payload.variables ??= [];
  if (!Array.isArray(payload.variables)) throw new TypeError("Rule variables must be an array.");
  for (const ruleSet of payload.ruleSets) {
    if (Object.hasOwn(ruleSet, "")) throw new TypeError("Unexpected empty-key data in a ruleSet.");
  }
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  return {
    name: ruleName,
    method: mode === "save" ? "PUT" : "POST",
    filename: `${ruleName}.json`,
    payload,
    json
  };
}