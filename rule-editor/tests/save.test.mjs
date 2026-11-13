import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { RuleEditorState } from "../packages/editor/model.js";
import { createNewRuleDefinition, createRuleExport, joinRuleName, splitRuleName } from "../packages/editor/save.js";
import { createRuleSaveDialog } from "../packages/editor/save-view.js";
import { createNewRuleDialog } from "../packages/editor/new-view.js";

const name = "RouterRule.TestRouterRules.TestRouterRulesSub";
const sample = async path => JSON.parse(await readFile(new URL(`../mock-data/USER/${path}.json`, import.meta.url), "utf8"));
const definition = await sample(`rules/${name}`);
const assistant = await sample("rules/types/EnsLib.HL7.MsgRouter.RuleAssist");

test("Save generates the supplied PUT capture's rule data without duplicating its empty-key artifact", async () => {
  const state = new RuleEditorState(definition, assistant);
  state.select("/ruleSets/0");
  state.add(state.addChoices.find(choice => choice.type === "comment"));
  state.setValue("hello");
  const before = structuredClone(state.definition);
  const expected = JSON.parse(await readFile(new URL(`./fixtures/USER/rules/${name}.put.json`, import.meta.url), "utf8"));
  delete expected.ruleSets[0][""];
  const exported = createRuleExport(state.definition, { name });
  assert.deepEqual(exported.payload, expected);
  assert.deepEqual(JSON.parse(exported.json), expected);
  assert.equal(exported.method, "PUT");
  assert.equal(exported.name, name);
  assert.equal(exported.filename, `${name}.json`);
  assert.deepEqual(state.definition, before);
  assert.equal(definition.ruleSets[0].actions.length, 1);
  assert.ok(!Object.hasOwn(exported.payload, "_sourceControl"));
});

test("Save As changes only the export destination and proposed method, not rule content or editor state", () => {
  const before = structuredClone(definition);
  const saved = createRuleExport(definition, { name });
  const copy = createRuleExport(definition, { name: `${name}Copy`, mode: "saveAs", sourceName: name });
  assert.equal(copy.method, "POST");
  assert.equal(copy.filename, `${name}Copy.json`);
  delete saved.payload.Timestamp;
  assert.deepEqual(copy.payload, saved.payload);
  assert.equal(copy.payload.ruleSets[0].name, "subRule");
  assert.equal(copy.payload.Timestamp, undefined);
  assert.deepEqual(definition, before);
});

test("exports retain nested expressions, false values, variables and unknown metadata", () => {
  const source = structuredClone(definition);
  source.variables = [{ name: "flag", value: false }];
  source.custom = { futureMetadata: true };
  source.ruleSets[0].actions.push({ type: "rule", disabled: false, conditions: [{
    type: "condition", if: { value: 'HL7.{PV1:PatientClass}="O"||1' }, then: { type: "then", actions: [{ type: "return" }] }
  }] });
  const result = createRuleExport(source, { name });
  const parsed = JSON.parse(result.json);
  assert.deepEqual(parsed.variables, source.variables);
  assert.deepEqual(parsed.custom, source.custom);
  assert.deepEqual(parsed.ruleSets, source.ruleSets);
  assert.equal(parsed.ruleSets[0].actions[0].transform, "");
});

test("rejects invalid names and malformed data without generating an output", () => {
  for (const invalid of ["", "not dotted", "../rule", "Rule.", "A/B.C"]) {
    assert.throws(() => createRuleExport(definition, { name: invalid }), /class name/);
  }
  assert.throws(() => createRuleExport(definition, { name, mode: "saveAs", sourceName: name }), /different/);
  assert.throws(() => createRuleExport({}, { name }), /ruleDefinition/);
  const malformed = structuredClone(definition);
  malformed.ruleSets[0][""] = { actions: [] };
  assert.throws(() => createRuleExport(malformed, { name }), /empty-key/);
});

function saveDialogHarness() {
  const nodes = [];
  const downloads = [];
  const blobs = [];
  const revoked = [];
  const document = {
    defaultView: {
      Blob,
      URL: { createObjectURL(blob) { blobs.push(blob); return "blob:rule-export"; }, revokeObjectURL(url) { revoked.push(url); } },
      setTimeout(callback) { callback(); }
    },
    createElement(tagName) {
      const attributes = new Map();
      const node = {
        tagName, children: [], events: new Map(),
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute(key, value) { attributes.set(key, value); },
        getAttribute(key) { return attributes.get(key); },
        setCustomValidity(value) { this.validationMessage = value; },
        addEventListener(event, callback) { this.events.set(event, callback); },
        focus() {}, select() {}, remove() {},
        showModal() { this.open = true; }, close() { this.open = false; },
        click() { if (tagName === "a") downloads.push({ href: this.href, name: this.download }); this.events.get("click")?.(); }
      };
      nodes.push(node);
      return node;
    }
  };
  document.body = document.createElement("body");
  const button = (label, _icon, action) => {
    const element = document.createElement("button");
    element.setAttribute("aria-label", label);
    element.addEventListener("click", action);
    return element;
  };
  const find = label => nodes.find(node => node.getAttribute("aria-label") === label);
  return { document, button, find, nodes, downloads, blobs, revoked };
}

test("Save opens inspectable JSON and downloads exactly that payload without a network transport", async () => {
  const harness = saveDialogHarness();
  const popup = createRuleSaveDialog(harness.document, { name, getDefinition: () => definition, button: harness.button });
  popup.open();
  const output = harness.find("Rule JSON");
  assert.equal(output.readOnly, true);
  assert.deepEqual(JSON.parse(output.value), createRuleExport(definition, { name }).payload);
  assert.equal(harness.find("Export destination").textContent, `PUT ${name}`);
  harness.find("Download JSON").click();
  assert.deepEqual(harness.downloads, [{ href: "blob:rule-export", name: `${name}.json` }]);
  assert.equal(harness.blobs[0].type, "application/json");
  assert.equal(await harness.blobs[0].text(), output.value);
  assert.deepEqual(harness.revoked, ["blob:rule-export"]);
  popup.destroy();
});

test("Save As validates names and exports a snapshot without changing the open rule", () => {
  const harness = saveDialogHarness();
  const source = structuredClone(definition);
  const popup = createRuleSaveDialog(harness.document, { name, getDefinition: () => source, button: harness.button });
  popup.open("saveAs");
  const input = harness.find("Save As name");
  const packageInput = harness.find("Save As package");
  assert.equal(input.value, "TestRouterRulesSubCopy");
  assert.equal(packageInput.value, "RouterRule.TestRouterRules");
  input.value = "TestRouterRulesSub";
  input.events.get("input")();
  assert.equal(harness.find("Download JSON").disabled, true);
  assert.equal(harness.find("Rule JSON").value, "");
  input.value = "ExportedCopy";
  source.description = "changed after opening";
  input.events.get("input")();
  assert.equal(harness.find("Download JSON").disabled, false);
  assert.equal(harness.find("Export destination").textContent, "POST RouterRule.TestRouterRules.ExportedCopy");
  assert.equal(JSON.parse(harness.find("Rule JSON").value).description, definition.description);
  assert.equal(source.ruleSets[0].name, "subRule");
  harness.find("Close JSON output").click();
  assert.equal(popup.element.open, false);
  popup.destroy();
});

test("package/name fields and RuleAssist metadata create a new rule without copying server identity", () => {
  assert.deepEqual(splitRuleName(name), { packageName: "RouterRule.TestRouterRules", name: "TestRouterRulesSub" });
  assert.equal(joinRuleName(" RouterRule.TestRouterRules ", " Created "), "RouterRule.TestRouterRules.Created");
  assert.throws(() => joinRuleName("RouterRule", "Nested.Name"), /single class/);
  const created = createNewRuleDefinition(assistant, {
    description: "New rule description", ruleType: { name: "EnsLib.HL7.MsgRouter.RuleAssist", description: "HL7 Message Routing Rule" },
    contextClass: "EnsLib.HL7.MsgRouter.RoutingEngine"
  });
  assert.equal(created.description, "New rule description");
  assert.equal(created.context, "EnsLib.HL7.MsgRouter.RoutingEngine");
  assert.equal(created.assistClass, "EnsLib.HL7.MsgRouter.RuleAssist");
  assert.equal(created.ruleType, "HL7 Message Routing Rule");
  assert.equal(created.ruleSets[0].type, "ruleSet");
  assert.deepEqual(created.ruleSets[0].actions, []);
  assert.equal(createRuleExport(created, { name: "Rules.Created", mode: "new" }).method, "POST");
});

test("Save submits PUT output and keeps the dialog and source intact after failure", async () => {
  const harness = saveDialogHarness();
  const before = structuredClone(definition);
  let shouldFail = true;
  const calls = [];
  const saved = [];
  const popup = createRuleSaveDialog(harness.document, {
    name, getDefinition: () => definition, button: harness.button,
    onSave: async (output, signal) => { calls.push({ output, signal }); if (shouldFail) throw new Error("Server rejected save"); return { persisted: true }; },
    onSaved: result => saved.push(result)
  });
  popup.open();
  await harness.find("Save rule").events.get("click")();
  assert.equal(popup.element.open, true);
  assert.equal(saved.length, 0);
  assert.equal(calls[0].output.method, "PUT");
  shouldFail = false;
  await harness.find("Save rule").events.get("click")();
  assert.equal(popup.element.open, false);
  assert.deepEqual(saved, [{ persisted: true }]);
  assert.deepEqual(definition, before);
  popup.destroy();
});

test("New captures package, name, description, Rule Type and context and keeps the draft after failure", async () => {
  const harness = saveDialogHarness();
  const types = [
    { name: "First.Assist", description: "First Rule Type", contextClass: "First.Context" },
    { name: "Other.Assist", description: "Other Rule Type", contextClass: "Other.Context" }
  ];
  const calls = [];
  const created = [];
  let shouldFail = true;
  const popup = createNewRuleDialog(harness.document, {
    getRuleTypes: () => types, getSourceName: () => name, button: harness.button,
    onCreate: async details => { calls.push(details); if (shouldFail) throw new Error("Name already exists"); return { saved: true }; },
    onCreated: (result, output) => created.push({ result, output })
  });
  popup.open();
  harness.find("New name").value = "CreatedRule";
  harness.find("New description").value = "Description";
  harness.find("Rule Type").value = "Other.Assist";
  harness.find("Rule Type").events.get("change")();
  assert.equal(harness.find("Context class").value, "Other.Context");
  await harness.find("Create business rule").events.get("click")();
  assert.equal(popup.element.open, true);
  assert.equal(harness.find("New name").value, "CreatedRule");
  assert.equal(created.length, 0);
  shouldFail = false;
  await harness.find("Create business rule").events.get("click")();
  assert.deepEqual(calls[1], { name: "RouterRule.TestRouterRules.CreatedRule", description: "Description", ruleType: types[1], contextClass: "Other.Context" });
  assert.equal(popup.element.open, false);
  assert.equal(created[0].output.name, "RouterRule.TestRouterRules.CreatedRule");
  popup.destroy();
});

test("New package input searches API class-packages while retaining editable package names", async () => {
  const harness = saveDialogHarness();
  const calls = [];
  const created = [];
  const popup = createNewRuleDialog(harness.document, {
    getRuleTypes: () => [{ name: "Rules.Assist", contextClass: "Rules.Context" }],
    getSourceName: () => name, button: harness.button,
    loadClassPackages: async signal => { calls.push(signal); return { classPackages: ["RouterRule", "RouterRule.TestRouterRules", " RouterRule ", ""] }; },
    onCreate: async details => { created.push(details); return {}; }
  });
  await popup.open();
  const input = harness.find("New package");
  const list = harness.nodes.find(node => node.tagName === "datalist");
  assert.equal(input.getAttribute("list"), list.id);
  assert.deepEqual(list.children.map(option => option.value), ["RouterRule", "RouterRule.TestRouterRules"]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof AbortSignal);
  input.value = "Custom.Package";
  harness.find("New name").value = "Created";
  await harness.find("Create business rule").events.get("click")();
  assert.equal(created[0].name, "Custom.Package.Created");
  popup.destroy();
});

test("New package suggestions refresh on reopen and ignore late responses after closing", async () => {
  const harness = saveDialogHarness();
  const requests = [];
  const popup = createNewRuleDialog(harness.document, {
    getRuleTypes: () => [{ name: "Rules.Assist", contextClass: "Rules.Context" }], button: harness.button,
    loadClassPackages: signal => new Promise(resolve => requests.push({ signal, resolve })),
    onCreate: async () => ({})
  });
  const first = popup.open();
  const second = popup.open();
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve({ classPackages: ["Current.Package"] });
  await second;
  requests[0].resolve({ classPackages: ["Old.Package"] });
  await first;
  const list = harness.nodes.find(node => node.tagName === "datalist");
  assert.deepEqual(list.children.map(option => option.value), ["Current.Package"]);
  popup.destroy();
  assert.equal(requests[1].signal.aborted, true);
});