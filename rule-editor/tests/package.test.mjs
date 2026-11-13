import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { packageIris } from "../package.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("IRIS archive contains a versioned IPM module and standalone installer, without preview data", async context => {
  const outputDirectory = await mkdtemp(resolve(root, "artifacts-test-"));
  context.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const result = await packageIris({ outputDirectory, version: "1.2.3" });
  const files = unzipSync(await readFile(result.archive));
  const prefix = "iris-interop-tools-1.2.3/";
  for (const name of ["module.xml", "README.md", "src/InteropTools/Installer.cls", "web/index.html", "web/app.js", "web/packages/editor/index.js", "web/node_modules/@intersystems/iris-auth/index.js", "web/node_modules/lucide/dist/umd/lucide.min.js", "web/node_modules/chevrotain/lib/chevrotain.js"]) {
    assert.ok(files[`${prefix}${name}`], name);
  }
  const manifest = strFromU8(files[`${prefix}module.xml`]);
  assert.match(manifest, /<Version>1\.2\.3<\/Version>/);
  assert.match(manifest, /SourcePath="\/web"/);
  assert.match(manifest, /Url="\/ui\/interop\/rule-editor"/);
  assert.match(manifest, /PasswordAuthEnabled="1" UnauthenticatedEnabled="0"/);
  const config = JSON.parse(strFromU8(files[`${prefix}web/config.json`]));
  assert.equal(config.apiBase, "/api/interop-editors/v8");
  assert.equal(config.auth.enabled, true);
  assert.equal(Object.hasOwn(config, "defaultNamespace"), false);
  for (const name of Object.keys(files)) {
    assert.doesNotMatch(name, /mock-data|mock-api|mock-auth|preview\.mjs|\/tests\//);
    assert.ok(name.startsWith(prefix));
    assert.ok(!name.includes("\\"));
  }
  const source = JSON.parse(await readFile(resolve(root, "config.json"), "utf8"));
  assert.equal(source.defaultNamespace, "USER");
});

test("IRIS packaging rejects unsafe versions and output locations before building", async () => {
  for (const version of ["../escape", "v1.2.3", "1.2", "1.2.3<xml>"]) {
    await assert.rejects(packageIris({ version }), /semantic version/);
  }
  for (const outputDirectory of [root, resolve(root, ".."), resolve(root, "packages"), resolve(root, "iris")]) {
    await assert.rejects(packageIris({ outputDirectory }), /separate output directory/);
  }
});

test("VS Code tasks and launchers target the renamed editor and real scripts", async () => {
  const tasks = JSON.parse(await readFile(resolve(root, "../.vscode/tasks.json"), "utf8"));
  const launch = JSON.parse(await readFile(resolve(root, "../.vscode/launch.json"), "utf8"));
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(tasks.version, "2.0.0");
  for (const task of tasks.tasks.filter(task => task.type === "npm")) {
    assert.equal(task.path, "rule-editor");
    assert.ok(pkg.scripts[task.script], task.script);
  }
  const previews = launch.configurations.filter(configuration => configuration.serverReadyAction);
  assert.equal(previews.length, 2);
  for (const preview of previews) {
    const url = "http://127.0.0.1:5181/?%24NAMESPACE=USER";
    assert.equal(new RegExp(preview.serverReadyAction.pattern).exec(`Rule Editor V2: ${url}`)[1], url);
    assert.equal(preview.program, "${workspaceFolder}/rule-editor/preview.mjs");
  }
});