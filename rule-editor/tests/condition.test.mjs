import assert from "node:assert/strict";
import test from "node:test";
import { conditionValueText, parseCondition } from "../packages/basic-builder/condition.js";

test("parses the sample HL7 condition into nested OR and AND branches", () => {
  const source = '((HL7.{PV1:PatientClass}="O")&&Exists("test",HL7.{MSH:MessageType.TriggerEvent}))||1';
  assert.deepEqual(parseCondition(source), { valid: true, tree: {
    type: "operator", operator: "OR", operands: [
      { type: "operator", operator: "AND", operands: [
        { type: "value", value: 'HL7.{PV1:PatientClass}="O"' },
        { type: "value", value: 'Exists("test",HL7.{MSH:MessageType.TriggerEvent})' }
      ] },
      { type: "value", value: "1" }
    ]
  } });
});

test("respects explicit boolean groups and preserves function arguments and negated leaves", () => {
  assert.deepEqual(parseCondition("a||b&&c").tree.operands[1], {
    type: "operator", operator: "AND", operands: [{ type: "value", value: "b" }, { type: "value", value: "c" }]
  });
  assert.equal(parseCondition("(a||b)&&c").tree.operands[0].operator, "OR");
  assert.equal(parseCondition('Exists("a&&b",(x||y))&&!(z||w)').tree.operands[0].value, 'Exists("a&&b",(x||y))');
  assert.equal(parseCondition('Exists("a&&b",(x||y))&&!(z||w)').tree.operands[1].value, "!(z||w)");
});

test("does not split quoted operators, ObjectScript escaped quotes, HL7 paths or array subscripts", () => {
  for (const source of ['value="a""&&""b"', 'HL7.{OBX:ObservationValue(1).SubValue}="A||B"', 'value[array&&index]="test"']) {
    assert.deepEqual(parseCondition(source), { valid: true, tree: { type: "value", value: source } });
  }
});

test("falls back to the untouched source for malformed or incomplete conditions", () => {
  for (const source of ['a&&', '||b', '(a||b', 'a&&"unterminated', 'a&&()', 'a)', 'a{b']) {
    const parsed = parseCondition(source);
    assert.equal(parsed.valid, false, source);
    assert.equal(parsed.tree.value, source);
  }
  assert.deepEqual(parseCondition(""), { valid: true, tree: { type: "value", value: "" } });
});

test("boolean captions are display-only and do not change quoted strings", () => {
  assert.equal(conditionValueText("1"), "true");
  assert.equal(conditionValueText("0"), "false");
  assert.equal(conditionValueText('"1"'), '"1"');
  assert.equal(parseCondition("1").tree.value, "1");
});