import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { objectAt, projectEditorTree, RuleEditorState } from "../packages/editor/model.js";
import { flattenRuleTree } from "../packages/basic-builder/model.js";
import { assistantBlockFields, createSchemaObject, describeFields, projectAssistantTree, schemaAddChoices, schemaAt } from "../packages/editor/rule-assist.js";

const sample = new URL("../mock-data/USER/rules/", import.meta.url);
const schema = JSON.parse(await readFile(new URL("types/EnsLib.HL7.MsgRouter.RuleAssist.json", sample), "utf8"));
const definition = JSON.parse(await readFile(new URL("RouterRule.TestRouterRules.TestRouterRules.json", sample), "utf8"));
const root = "/ruleSets/0";
const rule = `${root}/actions/0`;
const when = `${rule}/conditions/0`;

test("edits selected values, preserves metadata and source fixtures, and supports undo/redo", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(`${root}/actions/1`, "value");
  const original = state.selectedValue.text;
  assert.equal(state.setValue('"changed"'), true);
  assert.equal(state.selectedValue.text, '"changed"');
  assert.equal(state.definition.Timestamp, definition.Timestamp);
  assert.equal(definition.ruleSets[0].actions[1].value, original);
  assert.equal(state.undo(), true);
  assert.equal(state.selectedValue.text, original);
  assert.equal(state.redo(), true);
  assert.equal(state.selectedValue.text, '"changed"');
  state.undo();
  state.setValue('"new branch"');
  assert.equal(state.redo(), false);
});

test("text-only action selection exposes its primary value and expression edits clear stale ASTs", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(when);
  assert.equal(state.selectedValue.text, "1");
  objectAt(state.definition, when).if.valueObject = { value: "stale" };
  objectAt(state.definition, when).if.conditionObject = { value: "stale" };
  state.setValue("message.Type = ADT\n&& true");
  assert.deepEqual(objectAt(state.definition, when).if, { value: "message.Type = ADT\n&& true" });
  state.select(`${root}/actions/8`);
  assert.equal(state.selectedValue.editable, false);
  state.select(rule, "disabled");
  assert.throws(() => state.setValue("maybe"), /true or false/);
  state.setValue("true");
  assert.equal(state.selectedObject.disabled, true);
  state.select(rule, "constraint");
  assert.equal(state.selectedValue.editable, false);
});

test("moves a complete rule subtree, follows its selection, and respects sibling boundaries", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(rule);
  const before = structuredClone(state.selectedObject);
  assert.equal(state.canMove(-1), false);
  assert.equal(state.move(1), true);
  assert.equal(state.selection.path, `${root}/actions/1`);
  assert.deepEqual(state.selectedObject, before);
  state.undo();
  assert.equal(state.selection.path, rule);
  assert.deepEqual(state.selectedObject, before);
});

test("moves action node types within their sibling array", () => {
  const state = new RuleEditorState(definition, schema);
  const actionTypes = ["assign", "comment", "debug", "rule", "trace", "delegate", "delete", "send", "foreach"];
  state.definition.ruleSets[0].actions = actionTypes.map(type => ({ type }));
  const original = structuredClone(state.definition.ruleSets[0].actions);
  for (const [index, type] of actionTypes.entries()) {
    state.select(`${root}/actions/${index}`);
    assert.equal(state.canMove(-1), index > 0, `${type} can move up`);
    assert.equal(state.canMove(1), index < actionTypes.length - 1, `${type} can move down`);
    assert.equal(state.canMove(0), false, `${type} rejects invalid directions`);
    if (index < actionTypes.length - 1) {
      assert.equal(state.move(1), true, `${type} moves down`);
      assert.equal(state.selectedObject.type, type);
      assert.equal(state.selection.path, `${root}/actions/${index + 1}`);
      assert.equal(state.undo(), true);
      assert.deepEqual(state.definition.ruleSets[0].actions, original);
    }
  }
});

test("moves condition siblings and keeps object-valued branches in place", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(when);
  assert.equal(state.canMove(-1), false);
  assert.equal(state.canMove(1), true);
  const condition = structuredClone(state.selectedObject);
  state.move(1);
  assert.equal(state.selection.path, `${rule}/conditions/1`);
  assert.deepEqual(state.selectedObject, condition);
  assert.equal(state.canMove(1), definition.ruleSets[0].actions[0].conditions.length > 2);
  assert.equal(state.canMove(-1), true);
  state.undo();
  assert.equal(state.selection.path, when);
  state.select(`${rule}/else`);
  assert.equal(state.canMove(1), false);
});

test("removes selected objects with all descendants and can restore them", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(rule);
  state.remove();
  assert.equal(state.definition.ruleSets[0].actions.length, definition.ruleSets[0].actions.length - 1);
  assert.equal(state.selectedObject.type, "trace");
  state.undo();
  assert.deepEqual(state.selectedObject, definition.ruleSets[0].actions[0]);
  state.select(`${rule}/else`);
  assert.equal(state.canMove(1), false);
  state.remove();
  assert.equal(objectAt(state.definition, rule).else, undefined);
});

test("uses schema-allowed additions at the selected context", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(root);
  assert.deepEqual(state.addChoices.map(choice => choice.type), ["assign", "comment", "debug", "return", "rule", "trace", "delegate", "delete", "send"]);
  state.add(state.addChoices.find(choice => choice.type === "trace"));
  assert.equal(state.selectedObject.type, "trace");
  assert.equal(state.selectedValue.text, "");
  state.setValue('"added trace"');
  assert.equal(state.selectedObject.value, '"added trace"');
  state.select(rule);
  assert.deepEqual(state.addChoices.map(choice => choice.label), ["when", "comment"]);
  state.add(state.addChoices.find(choice => choice.type === "condition"));
  assert.equal(state.selectedObject.type, "condition");
  assert.ok(state.addChoices.some(choice => choice.type === "foreach"));
  assert.ok(state.addChoices.some(choice => choice.label === "when"));
});

test("adds otherwise only when valid and inserts action siblings after the selection", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(`${rule}/else`);
  state.remove();
  state.select(rule);
  state.add(state.addChoices.find(choice => choice.type === "else"));
  assert.equal(state.selection.path, `${rule}/else`);
  assert.deepEqual(state.selectedObject, { type: "else", actions: [] });
  state.select(`${root}/actions/1`);
  state.add(state.addChoices.find(choice => choice.type === "send"));
  assert.equal(state.selection.path, `${root}/actions/2`);
  assert.equal(state.selectedObject.type, "send");
});

test("can start a new ruleSet after removing all roots", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(root);
  state.remove();
  assert.equal(state.selection, null);
  assert.deepEqual(state.definition.ruleSets, []);
  state.add(state.addChoices[0]);
  assert.equal(state.selection.path, root);
  assert.deepEqual(state.selectedObject, createSchemaObject(schema, schema.definitions.ruleSet));
});

test("new send objects immediately expose editable transform and target blocks, even when empty", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(root);
  state.add(state.addChoices.find(choice => choice.type === "send"));
  const path = state.selection.path;
  const fields = () => projectEditorTree(state.definition, schema)[0].children.at(-1).fields;
  assert.deepEqual(state.selectedObject, { type: "send", target: "", transform: "" });
  assert.deepEqual(fields(), [{ name: "transform", values: [""] }, { name: "target", values: [""] }]);
  state.select(path, "transform");
  assert.equal(state.selectedValue.editable, true);
  state.setValue("Transform.Example");
  state.select(path, "target");
  state.setValue("Outbound");
  assert.deepEqual(fields(), [{ name: "transform", values: ["Transform.Example"] }, { name: "target", values: ["Outbound"] }]);
  state.setValue("");
  assert.deepEqual(fields()[1], { name: "target", values: [""] });
  state.undo();
  assert.equal(state.selectedObject.target, "Outbound");
  assert.equal(state.selectedObject.transform, "Transform.Example");
});

test("groups typing into one undo step and returns from empty actions to the visible condition", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(`${root}/actions/1`, "value");
  const original = state.selectedValue.text;
  state.setValue("a");
  state.setValue("ab", { merge: true });
  state.setValue("abc", { merge: true });
  assert.equal(state.past.length, 1);
  state.undo();
  assert.equal(state.selectedValue.text, original);
  const lastWhen = `${rule}/conditions/${definition.ruleSets[0].actions[0].conditions.length - 1}`;
  state.select(`${lastWhen}/then/actions/0`);
  state.remove();
  assert.equal(state.selection.path, lastWhen);
  assert.ok(state.addChoices.some(choice => choice.type === "send"));
});

test("new rules expose name and constraint blocks while preserving disabled state and existing constraints", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(root);
  state.add(state.addChoices.find(choice => choice.type === "rule"));
  const path = state.selection.path;
  const before = structuredClone(state.definition);
  const fields = () => projectEditorTree(state.definition, schema)[0].children.at(-1).fields;
  assert.deepEqual(fields(), [
    { name: "name", values: [""] }, { name: "disabled", values: ["false"] }, { name: "constraint", values: [""] }
  ]);
  assert.deepEqual(state.definition, before);
  state.select(path, "name");
  state.setValue("New rule");
  assert.deepEqual(fields()[0], { name: "name", values: ["New rule"] });
  state.setValue("");
  assert.deepEqual(fields()[0], { name: "name", values: [""] });
  state.select(path, "constraint");
  assert.equal(state.selectedValue.editable, false);
  assert.equal(state.setValue("not a constraint array"), false);
  assert.equal(state.selectedObject.constraint, undefined);
  assert.deepEqual(projectEditorTree(state.definition, schema)[0].children[0].fields, [
    { name: "name", values: ["rule1"] }, { name: "disabled", values: ["false"] },
    { name: "constraint", values: ["docCategory = 2.3.1"] }
  ]);
});

const actionFields = {
  assign: ["property", "value"], comment: ["text"], debug: ["value"], return: [],
  rule: ["name", "disabled", "constraint"], trace: ["value"], delegate: ["ruleName"],
  delete: [], send: ["transform", "target"]
};

for (const [type, names] of Object.entries(actionFields)) {
  test(`new ${type} exposes all property blocks and keeps them after values are cleared`, () => {
    const state = new RuleEditorState(definition, schema);
    state.select(root);
    state.add(state.addChoices.find(choice => choice.type === type));
    const path = state.selection.path;
    const fields = () => flattenRuleTree(projectEditorTree(state.definition, schema)).find(node => node.id === path).fields;
    const before = structuredClone(state.definition);
    assert.deepEqual(fields().map(field => field.name), names);
    assert.deepEqual(state.definition, before);
    for (const name of names.filter(name => !["disabled", "constraint"].includes(name))) {
      state.select(path, name);
      assert.equal(state.selectedValue.editable, true);
      state.setValue("first\nsecond");
      assert.deepEqual(fields().find(field => field.name === name).values, ["first", "second"]);
      state.setValue("");
      assert.deepEqual(fields().find(field => field.name === name).values, [""]);
    }
  });
}

test("ruleSet, when and foreach expose their empty scalar blocks without structural or AST blocks", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(when, "condition");
  state.setValue("");
  state.add(state.addChoices.find(choice => choice.type === "foreach"));
  const foreachPath = state.selection.path;
  const rows = flattenRuleTree(projectEditorTree(state.definition, schema));
  assert.deepEqual(rows.find(node => node.id === root).fields.map(field => field.name), ["name", "effectiveBegin", "effectiveEnd"]);
  assert.deepEqual(rows.find(node => node.id === root).fields.at(-1), { name: "effectiveEnd", values: [""] });
  assert.deepEqual(rows.find(node => node.id === when).fields, [{ name: "condition", values: [""], format: "condition" }]);
  assert.deepEqual(rows.find(node => node.id === foreachPath).fields, [{ name: "propertypath", values: [""] }]);
  assert.ok(rows.every(node => !node.fields.some(field => ["actions", "conditions", "then", "else", "comments", "valueObject", "conditionObject"].includes(field.name))));
  for (const [path, name] of [[root, "effectiveEnd"], [foreachPath, "propertypath"]]) {
    state.select(path, name);
    state.setValue("value");
    assert.equal(state.selectedValue.text, "value");
    state.setValue("");
    const node = flattenRuleTree(projectEditorTree(state.definition, schema)).find(node => node.id === path);
    assert.deepEqual(node.fields.find(field => field.name === name).values, [""]);
  }
});

test("every schema-defined scalar block is present, including on minimal objects", () => {
  const types = Object.values(schema.definitions)
    .filter(entry => entry.properties?.type?.const)
    .map(entry => entry.properties.type.const);
  for (const type of new Set(types)) {
    const fields = assistantBlockFields(schema, schema.definitions[type], { type });
    for (const [name, property] of Object.entries(schema.definitions[type].properties)) {
      if (name !== "type" && ["string", "boolean"].includes(property.type)) {
        assert.ok(fields.some(field => field.name === name), `${type}.${name}`);
      }
    }
  }
});

test("RuleAssist alone defines new block properties, order, defaults and additions", () => {
  const assistant = structuredClone(schema);
  assistant.definitions.custom = {
    type: "object", properties: {
      type: { const: "custom" }, destination: { type: "string", default: "Initial" },
      enabled: { type: "boolean", default: true }, notes: { type: "string", readOnly: true }
    }
  };
  assistant.definitions.ruleSet.properties.actions.items.oneOf.push({ $ref: "#/definitions/custom" });
  const created = createSchemaObject(assistant, { $ref: "#/definitions/custom" });
  assert.deepEqual(created, { type: "custom", destination: "Initial", enabled: true, notes: "" });
  const source = { type: "ruleDefinition", ruleSets: [{ type: "ruleSet", actions: [created] }] };
  assert.deepEqual(projectAssistantTree(source, assistant)[0].children[0].fields, [
    { name: "destination", values: ["Initial"] }, { name: "enabled", values: ["true"] }, { name: "notes", values: [""] }
  ]);
  assert.ok(schemaAddChoices(assistant, source, root).some(choice => choice.type === "custom"));
  assert.equal(describeFields(assistant, assistant.definitions.custom, created).at(-1).readOnly, true);
});

test("RuleAssist reference resolution keeps foreach condition action restrictions", () => {
  const source = { type: "ruleDefinition", ruleSets: [{ type: "ruleSet", actions: [{ type: "rule", conditions: [{
    type: "condition", then: { type: "then", actions: [{ type: "foreach", conditions: [{ type: "condition", then: { type: "then", actions: [] } }] }] }
  }] }] }] };
  const foreachWhen = `${when}/then/actions/0/conditions/0`;
  assert.equal(schemaAt(schema, source, foreachWhen), schema.definitions.foreachCondition);
  assert.ok(schemaAddChoices(schema, source, when).some(choice => choice.type === "foreach"));
  assert.ok(!schemaAddChoices(schema, source, foreachWhen).some(choice => choice.type === "foreach"));
});

test("the editor adds and edits a schema-only block without a type factory or primary-field table", () => {
  const assistant = structuredClone(schema);
  assistant.definitions.custom = {
    type: "object", properties: {
      type: { const: "custom" }, destination: { type: "string", default: "Initial" },
      enabled: { type: "boolean", default: true }, notes: { type: "string", readOnly: true },
      attempts: { type: "integer", default: 3 }
    }
  };
  assistant.definitions.ruleSet.properties.actions.items.oneOf.push({ $ref: "#/definitions/custom" });
  const before = structuredClone(assistant);
  const state = new RuleEditorState(definition, assistant);
  state.select(root);
  state.add(state.addChoices.find(choice => choice.type === "custom"));
  assert.deepEqual(state.selectedObject, { type: "custom", destination: "Initial", enabled: true, notes: "", attempts: 3 });
  assert.equal(state.selectedValue.text, "Initial");
  state.setValue("Changed");
  state.select(state.selection.path, "enabled");
  state.setValue("false");
  assert.equal(state.selectedObject.enabled, false);
  state.select(state.selection.path, "notes");
  assert.equal(state.setValue("not allowed"), false);
  state.select(state.selection.path, "attempts");
  assert.throws(() => state.setValue("1.5"), /integer/);
  state.setValue("4");
  assert.equal(state.selectedObject.attempts, 4);
  const row = projectEditorTree(state.definition, assistant)[0].children.at(-1);
  assert.deepEqual(row.fields.map(field => field.name), ["destination", "enabled", "notes", "attempts"]);
  state.undo();
  assert.equal(state.selectedObject.attempts, 3);
  assert.deepEqual(assistant, before);
});

test("property changes, contextual references and conditional child eligibility follow RuleAssist", () => {
  const assistant = structuredClone(schema);
  assistant.definitions.trace.properties = { type: { const: "trace" }, added: { type: "string", default: "from schema" } };
  const state = new RuleEditorState(definition, assistant);
  state.select(root);
  state.add(state.addChoices.find(choice => choice.type === "trace"));
  assert.deepEqual(state.selectedObject, { type: "trace", added: "from schema" });
  assert.equal(state.selectedValue.field, "added");
  const fields = projectEditorTree(state.definition, assistant)[0].children.at(-1).fields;
  assert.deepEqual(fields, [{ name: "added", values: ["from schema"] }]);
  state.select(root);
  state.add(state.addChoices.find(choice => choice.type === "rule"));
  assert.deepEqual(state.selectedObject.conditions, []);
  assert.ok(!state.addChoices.some(choice => choice.type === "else"));
  state.add(state.addChoices.find(choice => choice.type === "condition"));
  assert.equal(state.selectedValue.text, "");
  const parentRule = state.selection.path.slice(0, -"/conditions/0".length);
  state.select(parentRule);
  assert.ok(state.addChoices.some(choice => choice.type === "else"));
  state.add(state.addChoices.find(choice => choice.type === "else"));
  state.select(`${parentRule}/conditions/0`);
  state.remove();
  assert.equal(objectAt(state.definition, parentRule).else, undefined);
});

test("the expression popup can commit constraint collections with undo while respecting RuleAssist readOnly", () => {
  const state = new RuleEditorState(definition, schema);
  state.select(rule, "constraint");
  const original = structuredClone(state.selectedObject.constraints);
  assert.equal(state.selectedValue.editable, false);
  assert.equal(state.selectedValue.collectionEditable, true);
  const constraints = [{ type: "constraint", name: "docCategory", value: "2.5", extra: "preserved" }];
  assert.equal(state.setCollection(constraints), true);
  assert.deepEqual(state.selectedObject.constraints, constraints);
  state.undo();
  assert.deepEqual(state.selectedObject.constraints, original);
  const assistant = structuredClone(schema);
  assistant.definitions.rule.properties.constraints.readOnly = true;
  const protectedState = new RuleEditorState(definition, assistant);
  protectedState.select(rule, "constraint");
  assert.equal(protectedState.setCollection(constraints), false);
  state.select(when, "condition");
  assert.equal(state.selectedValue.format, "condition");
});