import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ConstraintDraft, constraintOptions, messageClassSections } from "../packages/editor/constraint-model.js";
import { createConstraintEditor } from "../packages/editor/constraint-view.js";

const sample = async name => JSON.parse(await readFile(new URL(`../mock-data/USER/${name}.json`, import.meta.url), "utf8"));

test("reads message class sections and classes from the supplied nested response", async () => {
  assert.equal(typeof createConstraintEditor, "function");
  const sections = messageClassSections(await sample("bpl/message-classes"));
  assert.deepEqual(sections.map(section => section.name), [
    "request.persistentVDocs", "request.messages", "request.persistentClasses",
    "response.persistentVDocs", "response.messages", "response.persistentClasses"
  ]);
  assert.ok(sections[0].classes.includes("EnsLib.HL7.Message"));
  assert.ok(sections.find(section => section.name === "request.messages").classes.includes("Ens.Request"));
  assert.ok(sections.find(section => section.name === "response.messages").classes.includes("Ens.Response"));
  assert.throws(() => messageClassSections({}), /sections/);
});

test("constraint controls and option sources come from the supplied metadata", async () => {
  const options = constraintOptions(await sample("rules/types/EnsLib.HL7.MsgRouter.RuleAssist/constraint-options/EnsLib.HL7.Message"));
  assert.deepEqual(options.map(option => [option.name, option.control]), [
    ["source", "select"], ["docCategory", "select"], ["docName", "select multiple"]
  ]);
  assert.equal(options[0].configItem, 1);
  assert.ok(options[1].options.includes("2.3.1"));
  assert.ok(options[2].options.includes("ADT_A01"));
  assert.throws(() => constraintOptions({}), /constraintOptions/);
});

test("updates single and multiple constraints while preserving other records and metadata", () => {
  const original = [
    { type: "constraint", name: "docCategory", value: "2.3.1", custom: "keep" },
    { type: "constraint", name: "unknown", value: "preserved" }
  ];
  const draft = new ConstraintDraft(original);
  draft.set("msgClass", "EnsLib.HL7.Message");
  draft.set("source", "Test1.Process");
  draft.set("docCategory", "2.5");
  draft.set("docName", ["ADT_A01", "ADT_A02", "ADT_A01"]);
  assert.equal(draft.messageClass, "EnsLib.HL7.Message");
  assert.equal(draft.value[0].name, "msgClass");
  assert.equal(draft.get("docName"), "ADT_A01,ADT_A02");
  assert.equal(draft.value.find(item => item.name === "docCategory").custom, "keep");
  assert.equal(draft.get("unknown"), "preserved");
  assert.equal(original[0].value, "2.3.1");
  draft.set("docName", []);
  assert.equal(draft.get("docName"), "");
  draft.set("source", "");
  assert.equal(draft.get("source"), "");
});