import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { configItemNames, pickerItemNames, TargetDraft } from "../packages/editor/target-model.js";
import { createTargetPicker } from "../packages/editor/target-view.js";

test("reads the config-items fixture and removes blank or duplicate suggestions", async () => {
  assert.equal(typeof createTargetPicker, "function");
  const response = JSON.parse(await readFile(new URL("../mock-data/USER/config-items.json", import.meta.url), "utf8"));
  assert.deepEqual(configItemNames(response), ["Test1.Process", "Test2.Operation"]);
  assert.deepEqual(configItemNames({ configItems: ["A", " A ", "", "B"] }), ["A", "B"]);
  assert.throws(() => configItemNames({}), /configItems/);
  assert.throws(() => configItemNames({ configItems: [null] }), /configItems/);
});

test("loads existing comma-separated targets and preserves names containing spaces", () => {
  const draft = new TargetDraft("First.Process, Second Operation,First.Process,,");
  assert.deepEqual(draft.items, ["First.Process", "Second Operation"]);
  assert.equal(draft.value, "First.Process,Second Operation");
});

test("matches while typing without selecting existing entries or changing the typed text", () => {
  const names = ["CHARM-A19.Process", "CHARM-ADT.Operation", "Other.Process"];
  const draft = new TargetDraft("CHARM-ADT.Operation");
  assert.deepEqual(draft.matches("char", names), ["CHARM-A19.Process"]);
  assert.deepEqual(draft.matches("PROCESS", names), ["CHARM-A19.Process", "Other.Process"]);
  assert.deepEqual(draft.matches("missing", names), []);
  draft.add("char");
  assert.equal(draft.value, "CHARM-ADT.Operation,char");
});

test("adds free text and config selections, prevents duplicates, removes entries and serializes targets", () => {
  const draft = new TargetDraft();
  assert.equal(draft.add("Typed.Process"), true);
  assert.equal(draft.add("Typed.Process"), false);
  draft.add("Test1.Process");
  draft.add(" Test2.Operation ");
  draft.remove(1);
  assert.deepEqual(draft.items, ["Typed.Process", "Test2.Operation"]);
  assert.equal(draft.value, "Typed.Process,Test2.Operation");
  draft.remove(-1);
  draft.remove(99);
  assert.equal(draft.value, "Typed.Process,Test2.Operation");
});

test("the shared picker loads transforms, matches class names and preserves removable transform entries", async () => {
  const response = JSON.parse(await readFile(new URL("../mock-data/USER/transforms.json", import.meta.url), "utf8"));
  const names = pickerItemNames(response, "transforms");
  assert.ok(names.includes("Ens.SSH.InteractiveAuth.DTL"));
  const draft = new TargetDraft("Existing.Transform");
  assert.ok(draft.matches("interactiveauth", names).includes("Ens.SSH.InteractiveAuth.DTL"));
  draft.add("Ens.SSH.InteractiveAuth.DTL");
  assert.ok(!draft.matches("interactiveauth", names).includes("Ens.SSH.InteractiveAuth.DTL"));
  draft.add("Typed.Transform");
  draft.remove(0);
  assert.equal(draft.value, "Ens.SSH.InteractiveAuth.DTL,Typed.Transform");
  assert.deepEqual(pickerItemNames({ transforms: [" A.Transform ", "A.Transform", ""] }, "transforms"), ["A.Transform"]);
  assert.throws(() => pickerItemNames({ configItems: [] }, "transforms"), /transforms/);
});