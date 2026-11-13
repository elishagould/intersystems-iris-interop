import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildStatic } from "../build.mjs";

test("static builds include runtime configuration and libraries but exclude mocks, samples and tests", async context => {
  const temporary = await mkdtemp(join(tmpdir(), "rule-editor-build-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const output = await buildStatic(join(temporary, "dist"));
  for (const file of ["index.html", "app.js", "packages/api/client.js", "packages/editor/index.js", "packages/basic-builder/index.css", "node_modules/lucide/dist/umd/lucide.min.js", "node_modules/chevrotain/lib/chevrotain.js", "node_modules/@intersystems/iris-auth/index.js", "node_modules/@intersystems/iris-auth/login.js", "node_modules/@intersystems/iris-auth/index.css"]) {
    await access(join(output, file));
  }
  const config = JSON.parse(await readFile(join(output, "config.json"), "utf8"));
  assert.equal(config.apiBase, "/api/interop-editors/v8");
  const condition = await readFile(join(output, "packages/basic-builder/condition.js"), "utf8");
  assert.match(condition, /chevrotain\/lib\/chevrotain\.js/);
  assert.doesNotMatch(condition, /chevrotain\.mjs/);
  await assert.rejects(access(join(output, "node_modules/chevrotain/lib/chevrotain.mjs")), { code: "ENOENT" });
  for (const excluded of ["mock-api.mjs", "mock-auth.mjs", "preview.mjs", "mock-data", "tests"]) {
    await assert.rejects(access(join(output, excluded)), { code: "ENOENT" });
  }
});