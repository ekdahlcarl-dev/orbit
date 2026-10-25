import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvidence, normalizeJUnit, orbitJsonSchema } from "./evidence";

test("normalizes JUnit XML", () => {
  const results = normalizeJUnit(`<testsuite><testcase name="passes" time="0.01"/><testcase name="fails"><failure message="boom"/></testcase><testcase name="skip"><skipped/></testcase></testsuite>`);
  assert.deepEqual(results.map(r => r.status), ["passed","failed","skipped"]);
  assert.equal(results[0].durationMs, 10);
  assert.equal(results[1].message, "boom");
});

test("rejects ambiguous or malformed JUnit", () => {
  assert.throws(() => normalizeJUnit("<testsuite></testsuite>"), /no testcases/);
  assert.throws(() => normalizeJUnit("<testcase/>"), /name is required/);
});

test("normalizes ORBIT JSON v1 and rejects unknown schema", () => {
  const content = JSON.stringify({ schemaVersion: "1", results: [{ name: "lint", status: "passed", durationMs: 4 }] });
  assert.equal(normalizeEvidence("orbit-json", content)[0].name, "lint");
  assert.equal(orbitJsonSchema.safeParse({ schemaVersion: "2", results: [] }).success, false);
});
test("malicious and malformed JUnit cannot fabricate passing evidence", () => {
  for (const content of [
    '<testsuite><!-- <testcase name="fake"/> --><testcase name="real"><failure',
    '<testsuite><testcase name="x"><failure/></testsuite>',
    '<!DOCTYPE testsuite [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><testsuite><testcase name="&xxe;"/></testsuite>',
    '<testsuite><testcase name="&unknown;"/></testsuite>',
    '<testsuite><testcase name="x" name="y"/></testsuite>',
    '<testsuite><testcase name="x"><testcase name="nested"/></testcase></testsuite>',
    '<testsuite><testcase name="x" time="1e309"/></testsuite>',
    '<testcase name="x"/>' + '<testcase name="y"/>',
    '<testsuite>' + '<suite>'.repeat(65) + '</suite>'.repeat(65) + '</testsuite>',
  ]) assert.throws(() => normalizeJUnit(content));
  const results = normalizeJUnit('<testsuite><!-- <testcase name="fake"/> --><testcase name="real"><failure message="&lt;script&gt;"/></testcase></testsuite>');
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "failed");
  assert.equal(results[0].message, "<script>"); // Text only; React escapes rendering.
});
