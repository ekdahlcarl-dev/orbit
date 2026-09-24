/** ORB-13 offline benchmark: no API calls, no confidence-state mutations. */
export type BenchmarkCase={
 id:string;question:string;expected:{componentKey:string;targetLevel:1|2|3}[];
 response:{recommendations:{componentKey:string;targetLevel:number;citations:{id:number}[]}[]};
 evidenceIds:number[];
};
export function evaluate(cases:BenchmarkCase[]){
 let truePositive=0,predicted=0,expected=0,grounded=0;
 const perCase=cases.map(test=>{
  const wanted=new Set(test.expected.map(x=>x.componentKey+"|"+x.targetLevel));
  const observed=new Set(test.response.recommendations.map(x=>x.componentKey+"|"+x.targetLevel));
  const correct=[...observed].filter(x=>wanted.has(x)).length;
  const citationsValid=test.response.recommendations.every(r=>r.citations.length>0&&r.citations.every(c=>test.evidenceIds.includes(c.id)));
  truePositive+=correct;predicted+=observed.size;expected+=wanted.size;if(citationsValid)grounded++;
  return {id:test.id,correct,predicted:observed.size,expected:wanted.size,citationsValid};
 });
 return {cases:cases.length,precision:predicted?truePositive/predicted:null,recall:expected?truePositive/expected:null,groundedCaseRate:cases.length?grounded/cases.length:null,perCase};
}
export function compareCandidate(baseline:BenchmarkCase[],candidate:BenchmarkCase[]){
 const previous=evaluate(baseline),next=evaluate(candidate);
 return {baseline:previous,candidate:next,
  precisionDelta:previous.precision===null||next.precision===null?null:next.precision-previous.precision,
  recallDelta:previous.recall===null||next.recall===null?null:next.recall-previous.recall,
  groundingRegressed:previous.groundedCaseRate!==null&&next.groundedCaseRate!==null&&next.groundedCaseRate<previous.groundedCaseRate};
}
