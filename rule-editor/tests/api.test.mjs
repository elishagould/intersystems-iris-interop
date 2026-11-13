import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiConfig } from "../packages/api/config.js";
import { createInteropApi, loadRuleResources } from "../packages/api/client.js";
import { startPreview } from "../preview.mjs";
import { readFile } from "node:fs/promises";
import { createNewRuleDefinition, createRuleExport } from "../packages/editor/save.js";

test("API configuration uses the central base and URL namespace/rule parameters", () => {
  assert.deepEqual(resolveApiConfig({ apiBase: "/api/interop-editors/v8", defaultNamespace: "USER" },
    "https://example.test/editor/?$NAMESPACE=TEST&rule=Rules.Example"), {
    apiBase: "https://example.test/api/interop-editors/v8", namespace: "TEST", rule: "Rules.Example"
  });
  assert.equal(resolveApiConfig({ apiBase: "/api/interop-editors/v8", defaultNamespace: "USER" }, "https://example.test/editor/").namespace, "USER");
  assert.equal(resolveApiConfig({ apiBase: "/api" }, "https://example.test/?%24NAMESPACE=ENCODED").namespace, "ENCODED");
  assert.equal(resolveApiConfig({ apiBase: "/api" }, "https://example.test/?NAMESPACE=OLD&$NAMESPACE=CORRECT").namespace, "CORRECT");
  assert.throws(() => resolveApiConfig({ apiBase: "/api" }, "https://example.test/?NAMESPACE=OLD"), /\$NAMESPACE/);
  assert.throws(() => resolveApiConfig({ apiBase: "javascript:alert(1)" }, "https://example.test/"), /apiBase/);
  assert.throws(() => resolveApiConfig({ apiBase: "/api" }, "https://example.test/"), /NAMESPACE/);
});

test("all API endpoint paths and constraint POST are defined centrally", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const api = createInteropApi({ apiBase: "https://example.test/api/interop-editors/v8", namespace: "USER" }, {
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({}) }; }
  });
  await api.listRules(signal);
  await api.rule("Rules.Example", signal);
  await api.ruleTypes(signal);
  await api.context("Context.Class", signal);
  await api.assistant("Assist.Class", signal);
  await api.constraintOptions("Assist.Class", "EnsLib.HL7.Message", signal);
  await api.messageClasses(signal);
  await api.configItems(signal);
  await api.classPackages(signal);
  await api.transforms(signal);
  assert.deepEqual(calls.map(call => call.url.replace("https://example.test/api/interop-editors/v8/USER/", "")), [
    "rules", "rules/Rules.Example", "rules/types", "rules/context/Context.Class", "rules/types/Assist.Class",
    "rules/types/Assist.Class/constraint-options", "bpl/message-classes", "config-items", "class-packages", "transforms"
  ]);
  assert.equal(calls[5].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[5].options.body), { messageClass: "EnsLib.HL7.Message" });
  assert.ok(calls.every(call => call.options.signal === signal && call.options.credentials === "same-origin"));
});

test("the API client encodes path segments and propagates errors", async () => {
  let url;
  const api = createInteropApi({ apiBase: "https://example.test/api", namespace: "%SYS" }, {
    fetchImpl: async value => { url = value; return { ok: false, status: 404 }; }
  });
  await assert.rejects(api.rule("Rules/Example"), /404/);
  assert.equal(url, "https://example.test/api/%25SYS/rules/Rules%2FExample");
});

test("rule resources follow returned assistClass/context rather than a hard-coded class", async () => {
  const calls = [];
  const api = {
    rule: async () => ({ type: "ruleDefinition", assistClass: "Other.Assist", context: "Other.Context", ruleSets: [] }),
    assistant: async name => { calls.push(name); return { definitions: {} }; },
    context: async name => { calls.push(name); return { inputSpecs: [] }; }
  };
  const loaded = await loadRuleResources(api, "Rules.Example", []);
  assert.deepEqual(calls, ["Other.Assist", "Other.Context"]);
  assert.equal(loaded.assistClass, "Other.Assist");
  api.rule = async () => ({ type: "ruleDefinition", context: "Other.Context", ruleSets: [] });
  assert.equal((await loadRuleResources(api, "Rules.Example", [{ name: "Other.Assist", contextClass: "Other.Context" }])).assistClass, "Other.Assist");
});

test("the preview exposes every real API path through namespaced mock endpoints", async context => {
  const server = await startPreview({ port: 0 });
  context.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = resolveApiConfig({ apiBase: "/api/interop-editors/v8" }, `${origin}/?$NAMESPACE=USER&rule=RouterRule.TestRouterRules.TestRouterRulesSub`);
  const api = createInteropApi(config);
  const names = await api.listRules();
  assert.ok(names.includes(config.rule));
  const types = await api.ruleTypes();
  assert.ok(types[0].name);
  assert.ok(types[0].contextClass);
  const loaded = await loadRuleResources(api, config.rule, types);
  assert.equal(loaded.definition.type, "ruleDefinition");
  assert.ok(loaded.assistant.definitions.ruleSet);
  assert.ok(Array.isArray(loaded.context.inputSpecs));
  assert.ok(Array.isArray((await api.messageClasses()).request.persistentVDocs));
  assert.ok(Array.isArray((await api.configItems()).configItems));
  assert.ok(Array.isArray((await api.transforms()).transforms));
  const expectedPackages = JSON.parse(await readFile(new URL("../mock-data/USER/class-packages.json", import.meta.url), "utf8"));
  assert.deepEqual(await api.classPackages(), expectedPackages);
  const options = await api.constraintOptions(loaded.assistClass, "EnsLib.HL7.Message");
  assert.ok(options.constraintOptions.find(option => option.name === "docCategory").options.includes("2.3.1"));
  for (const type of types) {
    assert.ok((await api.assistant(type.name)).definitions.ruleSet);
    assert.ok(Array.isArray((await api.constraintOptions(type.name, "EnsLib.HL7.Message")).constraintOptions));
  }
  const endpoint = `${config.apiBase}/USER/rules/types/${loaded.assistClass}/constraint-options`;
  assert.equal((await fetch(endpoint)).status, 405);
  assert.equal((await fetch(endpoint, { method: "POST", body: "{" })).status, 400);
  assert.equal((await fetch(endpoint, { method: "POST", body: "{}" })).status, 400);
  assert.equal((await fetch(`${config.apiBase}/USER/rules/Unknown.Rule`)).status, 404);
  assert.equal((await fetch(`${config.apiBase}/USER/rules/${config.rule}`, { method: "PUT", body: "{}" })).status, 400);
  assert.equal((await fetch(`${config.apiBase}/UNKNOWN/rules`)).status, 404);
  assert.equal((await fetch(`${config.apiBase}/USER%2F..%2F/rules`)).status, 400);
});

test("mock API routes can be disabled for live deployment testing", async context => {
  const server = await startPreview({ port: 0, mockApi: false });
  context.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/interop-editors/v8/TEST/rules`);
  assert.equal(response.status, 404);
});

test("the browser entry point uses configured APIs rather than direct sample URLs or fixed assistant classes", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /getSample|sample\/GET|EnsLib\.HL7\.MsgRouter\.RuleAssist|constraint-options-EnsLib/);
  assert.match(app, /loadRuleResources\(api, name, ruleTypes, signal\)/);
  assert.match(app, /apiConfig\.rule/);
  assert.match(app, /api\.constraintOptions\(ruleMetadata\.assistClass, messageClass, signal\)/);
  assert.match(app, /loadClassPackages: signal => api\.classPackages\(signal\)/);
});

test("PUT and POST save rules in namespace-isolated mock storage and reject collisions and stale updates", async context => {
  const server = await startPreview({ port: 0 });
  context.after(() => new Promise(resolve => server.close(resolve)));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/interop-editors/v8`;
  const api = createInteropApi({ apiBase, namespace: "USER" });
  const other = createInteropApi({ apiBase, namespace: "OTHER" });
  const name = "RouterRule.TestRouterRules.TestRouterRulesSub";
  const original = await api.rule(name);
  const modified = structuredClone(original);
  modified.description = "Saved via PUT";
  const saved = await api.updateRule(name, modified);
  assert.equal(saved.description, "Saved via PUT");
  assert.equal((await api.rule(name)).description, "Saved via PUT");
  assert.notEqual(saved.Timestamp, original.Timestamp);
  await assert.rejects(other.rule(name), /404/);
  await assert.rejects(api.updateRule(name, modified), /409/);
  const next = await api.updateRule(name, { ...saved, description: "Saved again" });
  assert.notEqual(next.Timestamp, saved.Timestamp);
  const copy = { ...saved, description: "Saved via POST" };
  delete copy.Timestamp;
  await api.createRule(`${name}Copy`, copy);
  assert.ok((await api.listRules()).includes(`${name}Copy`));
  assert.equal((await api.rule(`${name}Copy`)).description, "Saved via POST");
  await assert.rejects(api.createRule(`${name}Copy`, copy), /already exists/);
  await assert.rejects(other.rule(`${name}Copy`), /404/);
  const [type] = await api.ruleTypes();
  const assistant = await api.assistant(type.name);
  const created = createRuleExport(createNewRuleDefinition(assistant, {
    description: "New metadata-driven rule", ruleType: type, contextClass: type.contextClass
  }), { name: "Rules.CreatedFromMetadata", mode: "new" });
  await api.createRule(created.name, created.payload);
  const loaded = await loadRuleResources(api, created.name, [type]);
  assert.equal(loaded.definition.description, "New metadata-driven rule");
  assert.equal(loaded.assistClass, type.name);
  assert.equal(loaded.contextClass, type.contextClass);
  assert.deepEqual(loaded.definition.ruleSets[0].actions, []);
});

test("the API write client accepts empty successful responses", async () => {
  const calls = [];
  const api = createInteropApi({ apiBase: "https://example.test/api", namespace: "TEST" }, {
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 204 }; }
  });
  await api.updateRule("Rules.Example", { type: "ruleDefinition" });
  await api.createRule("Rules.Copy", { type: "ruleDefinition" });
  assert.deepEqual(calls.map(call => call.options.method), ["PUT", "POST"]);
  assert.ok(calls.every(call => call.options.headers["Content-Type"] === "application/json"));
});