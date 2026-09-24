"use client";
import Link from "next/link";
import {FormEvent,useState} from "react";
type Decision={id:number;actor:string;decision:string;rationale:string;created_at:string};
type Action={id:number;description:string;outcome:string|null;defects_found:number|null};
type Item={id:number;source:"demo"|"ai";component_key:string;target_level:number;action:string;rationale:string;citations:{sourceRef?:string;excerpt?:string}[];status:string;decisions:Decision[];actions:Action[]};
export default function RecommendationsPage(){
 const [username,setUsername]=useState(""),[password,setPassword]=useState(""),[repositoryId,setRepositoryId]=useState("");
 const [items,setItems]=useState<Item[]>([]),[metrics,setMetrics]=useState<Record<string,number>|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const auth=()=> "Basic "+btoa(String.fromCharCode(...new TextEncoder().encode(username+":"+password)));
 async function load(event?:FormEvent){event?.preventDefault();setBusy(true);setError("");
  try{const response=await fetch("/api/recommendations?repositoryId="+encodeURIComponent(repositoryId),{headers:{Authorization:auth()}});
   const body=await response.json();if(!response.ok)throw Error(body.error||"Unable to load recommendations");setItems(body.items);setMetrics(body.metrics);
  }catch(e){setError(e instanceof Error?e.message:"Request failed");}finally{setBusy(false);}
 }
 async function send(payload:Record<string,unknown>){setBusy(true);setError("");
  try{const response=await fetch("/api/recommendations",{method:"POST",headers:{Authorization:auth(),"Content-Type":"application/json"},body:JSON.stringify({repositoryId:Number(repositoryId),...payload})});
   const body=await response.json();if(!response.ok)throw Error(body.error||"Update failed");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Update failed");}finally{setBusy(false);}
 }
 return <main style={{maxWidth:1050,margin:"32px auto",padding:24}}>
  <Link href="/">← ORBIT</Link><h1>Recommendation inbox</h1>
  <p>Human-controlled decisions and test outcomes. Demo items are synthetic, not evidence-backed AI advice. This page never calls a paid AI provider or changes confidence levels.</p>
  <form onSubmit={load} style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"end"}}>
   <label>Operator username<br/><input required value={username} onChange={e=>setUsername(e.target.value)}/></label>
   <label>Operator password<br/><input required type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <label>Repository ID<br/><input required type="number" min="1" value={repositoryId} onChange={e=>setRepositoryId(e.target.value)}/></label>
   <button disabled={busy}>Load inbox</button>
  </form>
  <p><button disabled={busy||!repositoryId||!username||!password} onClick={()=>send({type:"seed"})}>Create demo recommendations (no API cost)</button></p>
  {error&&<p role="alert">{error}</p>}
  {metrics&&<p role="status">Recommendations: {metrics.total} · Accepted: {metrics.accepted} · Rejected: {metrics.rejected} · Deferred: {metrics.deferred} · Pending: {metrics.pending} · Recorded test outcomes: {metrics.recorded_outcomes} · Defects found: {metrics.defects_found}</p>}
  {items.map(item=><article key={item.id} style={{border:"1px solid #65718c",borderRadius:8,padding:16,marginBottom:16}}>
   <h2>{item.component_key} · L{item.target_level} <small>{item.source==="demo"?"DEMO / SYNTHETIC":"AI / REVIEW EVIDENCE"}</small></h2>
   <p><strong>Recommendation:</strong> {item.action}</p><p>{item.rationale}</p><p><strong>Status:</strong> {item.status}</p>
   {item.source==="ai"&&<details><summary>Evidence citations</summary><ul>{item.citations.map((c,i)=><li key={i}>{c.sourceRef||"Evidence"}: {c.excerpt||""}</li>)}</ul></details>}
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    {(["accepted","rejected","deferred"] as const).map(decision=><button key={decision} disabled={busy} onClick={()=>{
     const rationale=window.prompt("Optional decision rationale (max 2000 characters):","");if(rationale===null)return;
     send({type:"decide",id:item.id,decision,rationale});
    }}>{decision==="accepted"?"Accept":decision==="rejected"?"Reject":"Defer"}</button>)}
   </div>
   {item.status==="accepted"&&<p><button disabled={busy} onClick={()=>{const description=window.prompt("Planned test action:");if(description?.trim())send({type:"action",id:item.id,description});}}>Add planned test action</button></p>}
   {item.actions.map(action=><div key={action.id} style={{padding:8,marginTop:8,border:"1px solid #65718c"}}>
    <strong>Test action #{action.id}:</strong> {action.description}<p>Outcome: {action.outcome||"Not recorded"} · Defects found: {action.defects_found??"—"}</p>
    <button disabled={busy} onClick={()=>{const outcome=window.prompt("Observed outcome:",action.outcome||"");if(!outcome?.trim())return;
     const count=window.prompt("Number of defects found:",String(action.defects_found??0));if(count===null||!/^(0|[1-9]\d*)$/.test(count))return;
     send({type:"outcome",actionId:action.id,outcome,defectsFound:Number(count)});
    }}>Record outcome</button>
   </div>)}
   <details><summary>Decision audit history ({item.decisions.length})</summary><ul>{item.decisions.map(d=><li key={d.id}>{new Date(d.created_at).toLocaleString()} · {d.actor} · {d.decision} · {d.rationale||"No rationale"}</li>)}</ul></details>
  </article>)}
 </main>;
}
