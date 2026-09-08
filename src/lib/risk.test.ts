import test from "node:test";
import assert from "node:assert/strict";
import { calculateRisk, RISK_WEIGHTS } from "./risk";

test("risk scoring is deterministic and exposes contributions",()=>{
  const signals={churn:100,coverageGap:50,repeatedFailures:25,flakiness:10,defectHistory:20,criticality:75,evidenceAge:40};
  const first=calculateRisk(signals); const second=calculateRisk(signals);
  assert.deepEqual(first,second);
  assert.deepEqual(first.weights,RISK_WEIGHTS);
  assert.equal(first.contributions.churn,18);
  assert.equal(first.contributions.coverageGap,10);
  assert.equal(first.score,Object.values(first.contributions).reduce((a,b)=>a+b,0));
});

test("risk signals are clamped to 0-100",()=>{
  const result=calculateRisk({churn:200,coverageGap:-1,repeatedFailures:0,flakiness:0,defectHistory:0,criticality:0,evidenceAge:0});
  assert.equal(result.contributions.churn,18);
  assert.equal(result.contributions.coverageGap,0);
});
