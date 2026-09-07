"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import type { Installation } from "@/lib/github/client";
import "./builds.css";

type Config = { repository_id: string; full_name: string; enabled: boolean; event_builds: boolean; schedule_interval_minutes: number | null; default_ref: string; workflow_path: string };
type Run = { id: string; repository_id: string; trigger_type: string; ref: string; commit_sha: string; github_run_id: string | null; status: string; requested_at: string };

export default function BuildsPage() {
  const [username,setUsername]=useState(""); const [password,setPassword]=useState(""); const [auth,setAuth]=useState("");
  const [installations,setInstallations]=useState<Installation[]>([]); const [installationId,setInstallationId]=useState("");
  const [configs,setConfigs]=useState<Config[]>([]); const [runs,setRuns]=useState<Run[]>([]); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(""); const [error,setError]=useState("");

  async function api<T>(path:string, body?:unknown, authorization=auth):Promise<T>{
    const response=await fetch(path,{method:body?"POST":"GET",cache:"no-store",credentials:"same-origin",headers:{Authorization:authorization,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
    const data=await response.json(); if(!response.ok) throw new Error(data.error??"Request failed"); return data;
  }
  async function run(work:()=>Promise<void>){setBusy(true);setError("");setMessage("");try{await work();}catch(e){setError(e instanceof Error?e.message:"Request failed");}finally{setBusy(false);}}
  async function login(e:FormEvent){e.preventDefault();await run(async()=>{const raw=new TextEncoder().encode(`${username}:${password}`);const authorization=`Basic ${btoa(Array.from(raw,b=>String.fromCharCode(b)).join(""))}`;setInstallations(await api<Installation[]>("/api/github/installations",undefined,authorization));setAuth(authorization);setPassword("");});}
  async function load(id:string){setInstallationId(id);setConfigs([]);setRuns([]);if(!id)return;await run(async()=>{const [c,r]=await Promise.all([api<Config[]>(`/api/github/configurations?installationId=${id}`),api<Run[]>(`/api/builds/runs?installationId=${id}`)]);setConfigs(c);setRuns(r);});}
  async function refresh(){if(!installationId)return;setRuns(await api<Run[]>(`/api/builds/runs?installationId=${installationId}`));}
  async function saveSettings(item:Config, enabled:boolean,eventBuilds:boolean,schedule:number|null){await run(async()=>{const updated=await api<Config>("/api/builds/settings",{installationId:Number(installationId),repositoryId:Number(item.repository_id),enabled,eventBuilds,scheduleIntervalMinutes:schedule});setConfigs(current=>current.map(row=>row.repository_id===item.repository_id?updated:row));setMessage("Build settings saved.");});}
  async function manual(item:Config){await run(async()=>{await api("/api/builds/manual",{installationId:Number(installationId),repositoryId:Number(item.repository_id)});setMessage("Manual build queued.");await refresh();});}

  return <main className="builds"><header><Link href="/">← ORBIT</Link><span>BUILD CONTROL</span></header><h1>Build orchestration</h1><p className="intro">Enable builds, choose an automatic frequency, trigger a build now, and follow run state back to the exact ref and commit.</p>
    {error&&<p className="error">{error}</p>}{message&&<p className="success">{message}</p>}
    {!auth?<section className="panel"><h2>Operator access</h2><form onSubmit={login}><label>Username<input value={username} required onChange={e=>setUsername(e.target.value)}/></label><label>Password<input type="password" value={password} required onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>Connect</button></form></section>:<>
      <section className="panel"><label>GitHub installation<select value={installationId} onChange={e=>void load(e.target.value)}><option value="">Select installation</option>{installations.map(i=><option key={i.id} value={i.id}>{i.account.login} · {i.id}</option>)}</select></label></section>
      {installationId&&<section className="panel"><h2>Repositories</h2>{!configs.length?<p>No onboarded repositories. Configure one under GitHub repositories first.</p>:configs.map(item=><RepositoryControls key={item.repository_id} item={item} busy={busy} onSave={saveSettings} onManual={manual}/>)}</section>}
      {installationId&&<section className="panel"><div className="row"><h2>Build history</h2><button className="secondary" disabled={busy} onClick={()=>void run(refresh)}>Refresh</button></div>{!runs.length?<p>No build runs recorded yet.</p>:<div className="table-wrap"><table><thead><tr><th>Repository</th><th>Trigger</th><th>Status</th><th>Ref / commit</th><th>Requested</th></tr></thead><tbody>{runs.map(r=><tr key={r.id}><td>{configs.find(c=>c.repository_id===r.repository_id)?.full_name??r.repository_id}</td><td>{r.trigger_type}</td><td>{r.status}</td><td>{r.ref}<br/><small>{r.commit_sha.slice(0,12)}</small></td><td>{new Date(r.requested_at).toLocaleString()}</td></tr>)}</tbody></table></div>}</section>}
    </>}
  </main>;
}

function RepositoryControls({item,busy,onSave,onManual}:{item:Config;busy:boolean;onSave:(i:Config,e:boolean,p:boolean,s:number|null)=>Promise<void>;onManual:(i:Config)=>Promise<void>}){
  const [enabled,setEnabled]=useState(item.enabled); const [eventBuilds,setEventBuilds]=useState(item.event_builds); const [schedule,setSchedule]=useState(item.schedule_interval_minutes?.toString()??"");
  return <article className="repo"><div><strong>{item.full_name}</strong><small>{item.default_ref} · {item.workflow_path}</small></div><label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Enabled</label><label><input type="checkbox" checked={eventBuilds} onChange={e=>setEventBuilds(e.target.checked)}/> Build on push</label><label>Frequency<select value={schedule} onChange={e=>setSchedule(e.target.value)}><option value="">Manual/push only</option><option value="15">Every 15 min</option><option value="30">Every 30 min</option><option value="60">Hourly</option><option value="360">Every 6 hours</option><option value="1440">Daily</option><option value="10080">Weekly</option></select></label><button disabled={busy} onClick={()=>void onSave(item,enabled,eventBuilds,schedule?Number(schedule):null)}>Save</button><button className="secondary" disabled={busy||!enabled} onClick={()=>void onManual(item)}>Build now</button></article>;
}
