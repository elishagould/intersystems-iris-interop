import assert from "node:assert/strict";
import test from "node:test";
import { access, readdir, readFile } from "node:fs/promises";

const root = new URL("../mock-data/", import.meta.url);
test("mock data uses namespace-first API paths and every fixture is valid JSON", async () => {
  assert.deepEqual(await readdir(root), ["USER"]);
  async function check(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) await check(path);
      else { assert.ok(entry.name.endsWith(".json"), entry.name); JSON.parse(await readFile(path, "utf8")); }
    }
  }
  await check(root);
  await assert.rejects(access(new URL("../sample/", import.meta.url)), { code: "ENOENT" });
  const names = JSON.parse(await readFile(new URL("USER/rules/index.json", root), "utf8"));
  for (const name of names) {
    const definition = JSON.parse(await readFile(new URL(`USER/rules/${name}.json`, root), "utf8"));
    assert.equal(definition.type, "ruleDefinition");
  }
});