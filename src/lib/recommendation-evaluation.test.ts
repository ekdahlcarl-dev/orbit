import assert from "node:assert/strict";
import {test} from "node:test";
import {compareCandidate,evaluate,type BenchmarkCase} from "./recommendation-evaluation";
const baseline:BenchmarkCase[]=[{id:"auth-l2",question:"Where should authentication testing increase?",expected:[{componentKey:"Authentication",targetLevel:2}],evidenceIds:[7],
 response:{recommendations:[{componentKey:"Authentication",targetLevel:2,citations:[{id:7}]}]}}];
test("offline benchmark scores matching grounded recommendations without an API key",()=>{
 const result=evaluate(baseline);
 assert.equal(result.precision,1);assert.equal(result.recall,1);assert.equal(result.groundedCaseRate,1);
});
test("candidate comparison detects degraded relevance and fabricated evidence IDs",()=>{
 const candidate:BenchmarkCase[]=JSON.parse(JSON.stringify(baseline));
 candidate[0].response.recommendations[0].componentKey="Unrelated";
 candidate[0].response.recommendations[0].citations=[{id:999}];
 const comparison=compareCandidate(baseline,candidate);
 assert.equal(comparison.precisionDelta,-1);assert.equal(comparison.recallDelta,-1);
 assert.equal(comparison.groundingRegressed,true);
});
