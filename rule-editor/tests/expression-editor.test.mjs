import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ExpressionDraft, expressionChoices } from "../packages/editor/expression-model.js";
import { expressionPopupKind } from "../packages/editor/expression-view.js";

const schema = JSON.parse(await readFile(new URL("../mock-data/USER/rules/types/EnsLib.HL7.MsgRouter.RuleAssist.json", import.meta.url), "utf8"));
const source = '((HL7.{PV1:PatientClass}="O")&&Exists("test",HL7.{MSH:MessageType.TriggerEvent}))||1';

test("the expression draft matches the reference operator/function tree without rewriting its source", () => {
  const draft = new ExpressionDraft(source, schema);
  assert.equal(draft.tree.value, "||");
  assert.equal(draft.node([0]).value, "&&");
  assert.equal(draft.node([0, 0]).value, "=");
  assert.equal(draft.node([0, 0, 0]).value, "HL7.{PV1:PatientClass}");
  assert.equal(draft.node([0, 1]).kind, "function");
  assert.equal(draft.node([0, 1]).value, "Exists");
  assert.deepEqual(draft.node([0, 1]).children.map(child => child.value), ['"test"', "HL7.{MSH:MessageType.TriggerEvent}"]);
  assert.equal(draft.text, source);
  assert.equal(draft.error, "");
});

test("dropdown choices and function parameter descriptions come only from RuleAssist", () => {
  const assistant = structuredClone(schema);
  const list = assistant.definitions.valueObject.oneOf[0].properties.operator.enum;
  list.push({ type: "function", value: "SchemaFunction", parameters: [{ name: "input", optional: 0 }] });
  const draft = new ExpressionDraft(source, assistant);
  draft.select([0, 1]);
  assert.ok(draft.options.some(choice => choice.value === "SchemaFunction"));
  assert.deepEqual(draft.metadata.parameters.map(parameter => parameter.name), ["table", "value"]);
  assert.equal(expressionChoices(assistant).filter(choice => choice.value === "&&").length, 1);
});

test("moving, adding, removing and changing draft nodes never mutates the source", () => {
  const draft = new ExpressionDraft(source, schema);
  draft.select([0, 1]);
  draft.move(-1);
  assert.equal(draft.node([0, 0]).value, "Exists");
  draft.select([1]);
  draft.setValue("0");
  assert.ok(draft.text.endsWith("||0"));
  draft.select([]);
  draft.setToken("&&");
  assert.equal(draft.tree.value, "&&");
  draft.add();
  draft.setValue("1");
  assert.equal(draft.tree.children.length, 3);
  draft.remove();
  assert.equal(draft.tree.children.length, 2);
  assert.equal(draft.error, "");
  assert.equal(source, '((HL7.{PV1:PatientClass}="O")&&Exists("test",HL7.{MSH:MessageType.TriggerEvent}))||1');
});

test("operator and function buttons wrap a value and validate incomplete operands", () => {
  const draft = new ExpressionDraft("1", schema);
  draft.wrap("operator");
  assert.equal(draft.tree.value, "&&");
  assert.ok(draft.error);
  draft.select([1]);
  draft.setValue("0");
  assert.equal(draft.error, "");
  draft.wrap("function");
  assert.equal(draft.selected.kind, "function");
  assert.equal(draft.selected.children[0].value, "0");
  draft.setKind("value");
  assert.ok(draft.selected.value.includes("(0)"));
});

test("the expression button and double-click share schema-based popup cases", () => {
  assert.equal(expressionPopupKind({ format: "condition", editable: true }), "condition");
  assert.equal(expressionPopupKind({ path: "/constraints", collectionEditable: true }), "constraint");
  for (const key of ["target", "transform", "ruleName", "value"]) {
    assert.equal(expressionPopupKind({ path: `/${key}`, editable: true }), key);
    assert.equal(expressionPopupKind({ path: `/${key}`, editable: false }), null);
  }
  assert.equal(expressionPopupKind({ path: "/name", editable: true }), null);
});

test("edited compound operands retain grouping and incomplete input cannot be applied", () => {
  const draft = new ExpressionDraft("left&&right", schema);
  draft.select([0]);
  draft.setValue("a||b");
  assert.equal(draft.text, "(a||b)&&right");
  assert.equal(draft.error, "");
  draft.setValue("a&&");
  assert.ok(draft.error);
  assert.equal(new ExpressionDraft("-1", schema).error, "");
});