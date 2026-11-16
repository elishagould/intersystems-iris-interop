import assert from "node:assert/strict";
import test from "node:test";
import { startPreview } from "../preview.mjs";
import { resolveBusinessRuleName } from "../packages/editor/rule-selection.js";

test("serves the standalone page, modules and mock fixtures without IRIS", async context => {
  const server = await startPreview({ port: 0 });
  context.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const markup = await page.text();
  assert.match(markup, /Rule Editor V2/);
  assert.match(markup, /Environment/);
  assert.match(markup, /Namespace/);
  assert.match(markup, /Current environment and rule/);
  assert.match(markup, /id="current-rule-name"/);
  assert.match(markup, /id="open-business-rule"/);
  assert.match(markup, /id="save-actions"/);
  assert.doesNotMatch(markup, /name="view"|>Blocks<|>Rule Tree</);
  assert.match(markup, /role="combobox"[^>]+aria-controls="business-rule-options"/);
  assert.match(markup, /id="business-rule-options"[^>]+role="listbox"/);
  assert.doesNotMatch(markup, /<datalist|business-rule-names/);
  assert.doesNotMatch(markup, /Rule fixture|fixture-control/);
  const app = await (await fetch(`${base}/app.js`)).text();
  assert.doesNotMatch(app, /showBlocks|renderRuleTree|availableBlockTypes|name="view"/);
  assert.match(app, /mountRuleEditor\(preview, editorState/);
  const module = await fetch(`${base}/packages/basic-builder/index.js`);
  assert.match(module.headers.get("content-type"), /text\/javascript/);
  const editor = await fetch(`${base}/packages/editor/index.js`);
  assert.match(await editor.text(), /saveContainer\.append\(saveCommands\)/);
  const fixture = await fetch(`${base}/mock-data/USER/rules/RouterRule.TestRouterRules.TestRouterRules.json`);
  assert.match(fixture.headers.get("content-type"), /application\/json/);
  assert.equal((await fixture.json()).type, "ruleDefinition");
  const configItems = await fetch(`${base}/mock-data/USER/config-items.json`);
  assert.match(configItems.headers.get("content-type"), /application\/json/);
  assert.ok(Array.isArray((await configItems.json()).configItems));
  const transforms = await fetch(`${base}/mock-data/USER/transforms.json`);
  assert.match(transforms.headers.get("content-type"), /application\/json/);
  assert.ok(Array.isArray((await transforms.json()).transforms));
  const messageClasses = await fetch(`${base}/mock-data/USER/bpl/message-classes.json`);
  assert.match(messageClasses.headers.get("content-type"), /application\/json/);
  assert.ok(Array.isArray((await messageClasses.json()).request.persistentVDocs));
  const constraintOptions = await fetch(`${base}/mock-data/USER/rules/types/EnsLib.HL7.MsgRouter.RuleAssist/constraint-options/EnsLib.HL7.Message.json`);
  assert.match(constraintOptions.headers.get("content-type"), /application\/json/);
  assert.ok(Array.isArray((await constraintOptions.json()).constraintOptions));
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/api/interop-editors/v8/USER/rules`, { method: "PUT", body: "{}" })).status, 405);
  const head = await fetch(base, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("browser entry point imports resolve to served JavaScript modules without an import map", async context => {
  const server = await startPreview({ port: 0 });
  context.after(() => new Promise(resolve => server.close(resolve)));
  const entryUrl = `http://127.0.0.1:${server.address().port}/app.js`;
  const source = await (await fetch(entryUrl)).text();
  const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)];
  assert.ok(imports.length > 0);
  for (const [, specifier] of imports) {
    assert.ok(specifier.startsWith("./"), `Browser import must be a relative URL: ${specifier}`);
    const response = await fetch(new URL(specifier, entryUrl));
    assert.equal(response.status, 200, specifier);
    assert.match(response.headers.get("content-type"), /text\/javascript/, specifier);
  }
});

test("uses the next free port when the requested preview port is occupied", async context => {
  const first = await startPreview({ port: 0 });
  context.after(() => new Promise(resolve => first.close(resolve)));
  const second = await startPreview({ port: first.address().port });
  context.after(() => new Promise(resolve => second.close(resolve)));
  assert.ok(second.address().port > first.address().port);
});

test("only exact known business rule names can be resolved for opening", () => {
  const names = ["RouterRule.TestRouterRules.TestRouterRules", "RouterRule.TestRouterRules.TestRouterRulesSub"];
  assert.equal(resolveBusinessRuleName(names[0], names), names[0]);
  assert.equal(resolveBusinessRuleName(`  ${names[1].toLowerCase()}  `, names), names[1]);
  for (const invalid of ["", "RouterRule", "TestRouterRules", `${names[0]}Unknown`, "../other", null]) {
    assert.equal(resolveBusinessRuleName(invalid, names), null);
  }
  assert.equal(resolveBusinessRuleName(names[0], []), null);
});