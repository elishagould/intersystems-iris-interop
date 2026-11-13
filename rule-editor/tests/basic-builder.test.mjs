import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { availableBlockTypes, blockFields, flattenRuleTree, projectRuleDefinition } from "../packages/basic-builder/model.js";
import { branchTogglePosition, createBlock, createConditionBlock, createNodeRow, createTreeLine, isCollapsibleNode, renderRuleTree, ruleOutlineBounds, treeLineBounds } from "../packages/basic-builder/index.js";

const samples = new URL("../mock-data/USER/", import.meta.url);
const fixture = async path => JSON.parse(await readFile(new URL(`${path}.json`, samples), "utf8"));
const schema = await fixture("rules/types/EnsLib.HL7.MsgRouter.RuleAssist");

test("projects nested GET fixtures without changing the source", async () => {
  const source = await fixture("rules/RouterRule.TestRouterRules.TestRouterRules");
  const before = structuredClone(source);
  const roots = projectRuleDefinition(source, schema);
  const rows = flattenRuleTree(roots);
  assert.deepEqual(source, before);
  assert.equal(roots[0].type, "ruleSet");
  assert.equal(roots[0].children[0].text, "rule");
  assert.deepEqual(roots[0].children[0].children.map(node => node.text), [
    ...source.ruleSets[0].actions[0].conditions.map(() => "when"), "otherwise"
  ]);
  const when = roots[0].children[0].children[0];
  assert.equal(when.children[0].parentId, when.id);
  assert.equal(when.children[0].id, "/ruleSets/0/actions/0/conditions/0/then/actions/0");
  assert.ok(rows.every(row => Number.isInteger(row.depth)));
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(!rows.some(row => row.type === "then"));
});

test("orders fields and preserves false, quoted expressions and multiline values", () => {
  assert.deepEqual(blockFields({ type: "send", target: "outbound", transform: "Transform.Name" }), [
    { name: "transform", values: ["Transform.Name"] }, { name: "target", values: ["outbound"] }
  ]);
  assert.deepEqual(blockFields({ type: "rule", disabled: false, constraints: [{ name: "docCategory", value: "2.3.1" }] }), [
    { name: "disabled", values: ["false"] }, { name: "constraint", values: ["docCategory = 2.3.1"] }
  ]);
  assert.deepEqual(blockFields({ type: "trace", value: '"first"\r\n"second"' }), [
    { name: "value", values: ['"first"', '"second"'] }
  ]);
});

test("does not add empty terminal cells or erase useful zero values", async () => {
  assert.deepEqual(blockFields({ type: "return", value: "" }), []);
  assert.deepEqual(blockFields({ type: "delete" }), []);
  assert.deepEqual(blockFields({ type: "condition", if: { value: "0" } }), [{ name: "condition", values: ["0"], format: "condition" }]);
  const source = await fixture("rules/RouterRule.TestRouterRules.TestRouterRulesSub");
  assert.deepEqual(projectRuleDefinition(source, schema)[0].children[0].fields, [
    { name: "target", values: ["OperationOutbound"] }
  ]);
});

test("counts rules and conditions locally, not all actions or descendants", () => {
  const roots = projectRuleDefinition({ type: "ruleDefinition", ruleSets: [{ type: "ruleSet", actions: [
    { type: "trace", value: "start" },
    { type: "rule", conditions: [{ type: "condition", then: { actions: [{ type: "rule" }] } }, { type: "condition" }] },
    { type: "rule" }
  ] }] });
  assert.deepEqual(roots[0].children.map(node => node.count), [undefined, 1, 2]);
  assert.deepEqual(roots[0].children[1].children.map(node => node.count), [1, 2]);
  assert.equal(roots[0].children[1].children[0].children[0].count, 1);
});

test("keeps attached comments and comment actions at their owning level", () => {
  const roots = projectRuleDefinition({ type: "ruleDefinition", ruleSets: [{ type: "ruleSet", actions: [{
    type: "rule", comments: [{ type: "comment", text: "rule note" }], conditions: [{
      type: "condition", comments: [{ type: "comment", text: "condition note" }],
      then: { actions: [{ type: "trace" }, { type: "comment", text: "action note" }] }
    }]
  }] }] });
  const rule = roots[0].children[0];
  const when = rule.children[1];
  assert.equal(rule.children[0].parentId, rule.id);
  assert.deepEqual(when.children.map(node => node.type), ["comment", "trace", "comment"]);
  assert.ok(when.children.every(node => node.parentId === when.id));
  assert.ok(when.children[0].id.endsWith("/comments/0"));
  assert.ok(when.children[2].id.endsWith("/then/actions/1"));
});

test("reads block types from RuleAssist without treating expression objects as nodes", () => {
  const types = availableBlockTypes(schema).map(entry => entry.type);
  assert.ok(types.includes("ruleSet"));
  assert.ok(types.includes("foreach"));
  assert.ok(types.includes("condition"));
  assert.ok(!types.includes("valueObject"));
  assert.deepEqual(blockFields({ type: "custom", label: "<script>", active: false }), [
    { name: "label", values: ["<script>"] }, { name: "active", values: ["false"] }
  ]);
  assert.throws(() => projectRuleDefinition({}), /ruleDefinition/);
});

const mockDocument = {
  createElement(tagName) {
    const classes = new Set();
    const attributes = new Map();
    return {
      tagName, children: [], dataset: {}, style: {}, events: new Map(),
      classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); } },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      addEventListener(name, listener) { this.events.set(name, listener); }
    };
  }
};

test("renders independent text, counted and multirow value elements using safe text", () => {
  const text = createBlock(mockDocument, { text: "trace", kind: "trace" });
  assert.equal(text.children.length, 1);
  assert.equal(text.children[0].textContent, "trace");
  const counted = createBlock(mockDocument, { text: "rule", count: 4, kind: "rule" });
  assert.equal(counted.children[0].className, "re-count");
  assert.equal(counted.children[0].textContent, "4");
  const value = createBlock(mockDocument, { text: "condition", values: ["true", "<script>alert(1)</script>"] });
  assert.equal(value.children[1].children.length, 2);
  assert.equal(value.children[1].children[1].textContent, "<script>alert(1)</script>");
  const row = createNodeRow(mockDocument, { id: "/test", text: "send", type: "send", fields: [{ name: "target", values: ["Outbound"] }] });
  assert.equal(row.dataset.nodeId, "/test");
  assert.equal(row.children.length, 2);
});

test("anchors HTML tree lines to the type block rather than multiline property height", () => {
  const bounds = treeLineBounds({ left: 10, top: 5, width: 70, height: 30 }, { left: 56, top: 105, width: 100, height: 30 });
  assert.deepEqual(bounds, { left: 24, top: 20, width: 32, height: 100 });
  const line = createTreeLine(mockDocument, bounds);
  assert.equal(line.className, "re-tree-line");
  assert.deepEqual(line.style, { left: "24px", top: "20px", width: "32px", height: "100px" });
});

test("wraps the complete rule subtree without including following sibling actions", () => {
  const document = {
    createElement(tagName) {
      return { ...mockDocument.createElement(tagName), setAttribute() {}, remove() {} };
    },
    defaultView: { requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} }
  };
  const container = { ownerDocument: document, replaceChildren(element) { this.diagram = element; } };
  const roots = projectRuleDefinition({ type: "ruleDefinition", ruleSets: [{ type: "ruleSet", actions: [
    { type: "rule", conditions: [{ type: "condition", then: { actions: [{ type: "trace", value: "inside" }, { type: "rule" }] } }] },
    { type: "return" }
  ] }] });
  const mounted = renderRuleTree(container, roots);
  const ruleSet = container.diagram.children[1].children[0];
  assert.notEqual(ruleSet.className, "re-rule-group");
  const [rule, sibling] = ruleSet.children[1].children;
  assert.equal(rule.className, "re-rule-group");
  assert.notEqual(sibling.className, "re-rule-group");
  const when = rule.children[1].children[0];
  const [trace, nestedRule] = when.children[1].children;
  assert.notEqual(trace.className, "re-rule-group");
  assert.equal(nestedRule.className, "re-rule-group");
  mounted.destroy();
});

test("starts rule outlines at the header midpoint and its descendant tree trunk", () => {
  const header = { left: 20, top: 40, width: 70, height: 32 };
  const content = { right: 300, bottom: 240 };
  assert.deepEqual(ruleOutlineBounds(header, content), { left: 34, top: 56, width: 266, height: 184 });
  assert.equal(ruleOutlineBounds(header, content).left, treeLineBounds(header, header).left);
  assert.deepEqual(ruleOutlineBounds({ ...header, left: 56, top: 80, height: 48 }, content), {
    left: 70, top: 104, width: 230, height: 136
  });
  assert.equal(treeLineBounds(header, header, 20).left, 40);
  assert.deepEqual(ruleOutlineBounds(header, content, 20), { left: 40, top: 56, width: 260, height: 184 });
});

test("branch controls hide descendants, preserve nested collapse state and never mutate nodes", () => {
  const document = {
    createElement(tagName) { return { ...mockDocument.createElement(tagName), remove() {} }; },
    defaultView: { requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} }
  };
  const container = { ownerDocument: document, replaceChildren(element) { this.diagram = element; } };
  const roots = projectRuleDefinition({ type: "ruleDefinition", ruleSets: [{ type: "ruleSet", actions: [
    { type: "rule", conditions: [{ type: "condition", then: { actions: [{ type: "trace", value: "inside" }] } }] },
    { type: "return" }
  ] }] });
  const before = structuredClone(roots);
  const collapsed = new Set([roots[0].id]);
  const events = [];
  const mounted = renderRuleTree(container, roots, { collapsed, onToggle(node, hidden) { events.push([node.id, hidden]); } });
  const root = container.diagram.children[1].children[0];
  const rule = root.children[1].children[0];
  const when = rule.children[1].children[0];
  assert.equal(isCollapsibleNode(roots[0]), false);
  assert.equal(isCollapsibleNode(roots[0].children[0]), true);
  assert.ok(root.children[0].children.every(child => child.className !== "re-branch-toggle"));
  assert.equal(root.children[1].hidden, false);
  assert.equal(collapsed.has(roots[0].id), false);
  const ruleToggle = rule.children[0].children.at(-1);
  const whenToggle = when.children[0].children.at(-1);
  assert.equal(when.children[1].children[0].children[0].children.at(-1).className, "re-block");
  whenToggle.events.get("click")({ stopPropagation() {} });
  assert.equal(when.children[1].hidden, true);
  ruleToggle.events.get("click")({ stopPropagation() {} });
  assert.equal(rule.children[1].hidden, true);
  assert.equal(ruleToggle.getAttribute("aria-expanded"), "false");
  assert.equal(ruleToggle.textContent, "+");
  ruleToggle.events.get("click")({ stopPropagation() {} });
  assert.equal(rule.children[1].hidden, false);
  assert.equal(when.children[1].hidden, true);
  assert.equal(ruleToggle.getAttribute("aria-expanded"), "true");
  assert.equal(ruleToggle.textContent, "-");
  assert.deepEqual(roots, before);
  assert.deepEqual(events.map(event => event[1]), [true, true, false]);
  mounted.destroy();
  const next = renderRuleTree(container, roots, { collapsed });
  const restoredWhen = container.diagram.children[1].children[0].children[1].children[0].children[1].children[0];
  assert.equal(restoredWhen.children[1].hidden, true);
  next.destroy();
});

test("circular branch controls align with the tree junction and scale with the configured anchor", () => {
  const parent = { left: 10, top: 5, width: 70, height: 30 };
  const header = { left: 56, top: 105, width: 100, height: 30 };
  assert.deepEqual(branchTogglePosition(header, parent, 14, 18), { left: -32, top: 15 });
  assert.deepEqual(branchTogglePosition(parent, null, 14, 18), { left: 14, top: 39 });
  assert.deepEqual(branchTogglePosition(header, parent, 20, 24), { left: -26, top: 15 });
});

test("click selection highlights text only, or all value rows, but never counts or property labels", () => {
  const text = createBlock(mockDocument, { text: "rule", count: 4, kind: "rule" });
  const value = createBlock(mockDocument, { text: "condition", values: ["true", "second row"] });
  assert.equal(text.tabIndex, 0);
  assert.equal(text.getAttribute("role"), "button");
  assert.equal(text.getAttribute("aria-pressed"), "false");
  text.events.get("click")();
  assert.equal(text.children[0].classList.contains("re-selected"), false);
  assert.equal(text.children[1].classList.contains("re-selected"), true);
  assert.equal(text.getAttribute("aria-pressed"), "true");
  value.events.get("click")();
  assert.equal(text.children[1].classList.contains("re-selected"), false);
  assert.equal(text.getAttribute("aria-pressed"), "false");
  assert.equal(value.children[0].classList.contains("re-selected"), false);
  assert.equal(value.children[1].classList.contains("re-selected"), true);
  assert.equal(value.getAttribute("aria-pressed"), "true");
  value.events.get("click")();
  assert.equal(value.children[1].classList.contains("re-selected"), true);
});

test("Enter and Space select blocks without scrolling; other keys do not select", () => {
  for (const key of ["Enter", " ", "ArrowDown"]) {
    const block = createBlock(mockDocument, { text: "trace" });
    let prevented = false;
    block.events.get("keydown")({ key, preventDefault() { prevented = true; } });
    assert.equal(prevented, key !== "ArrowDown");
    assert.equal(block.children[0].classList.contains("re-selected"), key !== "ArrowDown");
  }
});

test("condition blocks format logical branches and select the whole raw value", () => {
  const source = 'HL7.{PV1:PatientClass}="O"&&Exists("test",HL7.{MSH:MessageType.TriggerEvent})||1';
  const block = createConditionBlock(mockDocument, { text: "condition", value: source });
  const section = block.children[1];
  assert.equal(section.dataset.rawValue, source);
  assert.equal(section.dataset.invalid, "false");
  const branch = section.children[0];
  assert.equal(branch.className, "re-condition-branch");
  assert.equal(branch.children[0].textContent, "OR");
  assert.equal(branch.children[1].children[0].children[0].children[0].textContent, "AND");
  assert.equal(branch.children[1].children[1].children[0].textContent, "true");
  block.events.get("click")();
  assert.equal(section.classList.contains("re-selected"), true);
  assert.equal(block.children[0].classList.contains("re-selected"), false);
  const row = createNodeRow(mockDocument, { id: "/condition", type: "condition", text: "when", fields: [
    { name: "condition", values: [source], format: "condition" }
  ] });
  assert.equal(row.children[1].classList.contains("re-condition-block"), true);
});

test("invalid condition blocks display the original text without interpreting HTML", () => {
  const source = '<img src=x onerror=alert(1)> && "unfinished';
  const block = createConditionBlock(mockDocument, { value: source });
  assert.equal(block.children[1].dataset.invalid, "true");
  assert.equal(block.children[1].children[0].textContent, source);
});