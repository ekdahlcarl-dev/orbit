"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import "./dashboard.css";

type Repository = { repository_id: string; full_name: string; default_ref: string; enabled: boolean; access_status: string };
type Build = { id: string; repository_id: string; full_name: string; trigger_type: string; ref: string; commit_sha: string; github_run_id: string | null; github_url: string | null; status: string; requested_at: string; artifact_count: number };
type BlockingStage = { level: number; state: string } | null;
type Artifact = { id: string; name: string; digest_algorithm: string; digest: string; build_run_id: string; repository_id: string; commit_sha: string; full_name: string; ref: string; build_status: string; github_url: string | null; confidence_level: number | null; level_1_state: string | null; level_2_state: string | null; level_3_state: string | null; calculated_at: string | null; created_at: string; storage_ref: string | null; blocking_stage: BlockingStage };
type Trend = { id: string; artifact_id: string; name: string; digest: string; full_name: string; from_level: number | null; to_level: number; to_states: Record<string,string>; created_at: string };
type Evidence = { id: string; evidence_type: string; format: string; source: string; status: string; summary: unknown; raw_storage_ref: string; ingested_at: string };
type Detail = { artifact: Artifact; evidence: Evidence[]; componentTests: Array<Record<string,unknown>>; systemTests: Array<Record<string,unknown>>; transitions: Array<Record<string,unknown>> } | null;
type Data = { repositories: Repository[]; builds: Build[]; artifacts: Artifact[]; trends: Trend[]; detail: Detail };

const states = ["passed","failed","stale","pending","running","blocked","not-configured","missing"];

export default function DashboardPage() {
  const [username,setUsername]=useState(""); const [password,setPassword]=useState(""); const [auth,setAuth]=useState("");
  const [data,setData]=useState<Data|null>(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const [repositoryId,setRepositoryId]=useState(""); const [branch,setBranch]=useState(""); const [binary,setBinary]=useState(""); const [windowDays,setWindowDays]=useState("30");
  const [artifactId,setArtifactId]=useState("");

  async function fetchDashboard(authorization=auth, nextArtifactId=artifactId) {
    const search = new URLSearchParams();
    if (repositoryId) search.set("repositoryId",repositoryId);
    if (branch) search.set("branch",branch);
    if (binary) search.set("binary",binary);
    if (windowDays) search.set("from",new Date(Date.now()-Number(windowDays)*86400000).toISOString());
    if (nextArtifactId) search.set("artifactId",nextArtifactId);
    const response=await fetch(`/api/dashboard?${search}`,{cache:"no-store",headers:{Authorization:authorization}});
    const body=await response.json(); if(!response.ok) throw new Error(body.error??"Dashboard request failed"); setData(body);
  }
  async function run(work:()=>Promise<void>){setBusy(true);setError("");try{await work();}catch(e){setError(e instanceof Error?e.message:"Request failed");}finally{setBusy(false);}}
  async function login(e:FormEvent){e.preventDefault();await run(async()=>{const raw=new TextEncoder().encode(`${username}:${password}`);const authorization=`Basic ${btoa(Array.from(raw,b=>String.fromCharCode(b)).join(""))}`;setAuth(authorization);setPassword("");await fetchDashboard(authorization,"");});}
  async function applyFilters(e:FormEvent){e.preventDefault();setArtifactId("");await run(()=>fetchDashboard(auth,""));}
  async function selectArtifact(id:string){setArtifactId(id);await run(()=>fetchDashboard(auth,id));}

  const summary=useMemo(()=>({
    repositories:data?.repositories.filter(r=>r.enabled&&r.access_status==="active").length??0,
    activeBuilds:data?.builds.filter(b=>["queued","running"].includes(b.status)).length??0,
    binaries:data?.artifacts.length??0,
    level3:data?.artifacts.filter(a=>Number(a.confidence_level)===3).length??0,
  }),[data]);

  return <main className="dash"><header className="top"><div><Link href="/">ORBIT</Link><span>/ QUALITY CONTROL</span></div><Link href="/builds">Build control →</Link></header>
    <section className="hero"><div><p className="eyebrow">BUILD · BINARY · CONFIDENCE</p><h1>Delivery confidence dashboard</h1><p>Trace every release candidate from GitHub build to immutable binary and the evidence that currently permits—or blocks—promotion.</p></div></section>
    {error&&<p className="notice error">{error}</p>}
    {!auth?<section className="card access"><h2>Operator access</h2><p>Use your ORBIT operator credentials to view delivery evidence.</p><form onSubmit={login}><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button disabled={busy}>Open dashboard</button></form></section>:data&&<>
      <section className="metrics"><Metric label="Active repositories" value={summary.repositories}/><Metric label="Queued / running builds" value={summary.activeBuilds}/><Metric label="Binaries in view" value={summary.binaries}/><Metric label="Level 3 binaries" value={summary.level3}/></section>
      <form className="filters card" onSubmit={applyFilters}><label>Repository<select value={repositoryId} onChange={e=>setRepositoryId(e.target.value)}><option value="">All repositories</option>{data.repositories.map(r=><option value={r.repository_id} key={r.repository_id}>{r.full_name}</option>)}</select></label><label>Branch / ref<input value={branch} placeholder="main" onChange={e=>setBranch(e.target.value)}/></label><label>Binary / digest<input value={binary} placeholder="name or digest" onChange={e=>setBinary(e.target.value)}/></label><label>Time window<select value={windowDays} onChange={e=>setWindowDays(e.target.value)}><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="">All time</option></select></label><button disabled={busy}>Apply</button></form>

      <section className="grid"><div className="card span2"><div className="section-title"><div><p className="eyebrow">LIVE DELIVERY</p><h2>Recent builds</h2></div><button className="ghost" disabled={busy} onClick={()=>void run(()=>fetchDashboard())}>Refresh</button></div>{!data.builds.length?<Empty text="No builds match these filters."/>:<div className="table"><div className="tr head"><span>Repository</span><span>Status</span><span>Ref / commit</span><span>Artifacts</span><span>Requested</span></div>{data.builds.map(b=><div className="tr" key={b.id}><span><strong>{b.full_name}</strong><small>{b.trigger_type}</small></span><span><Status value={b.status}/></span><span>{b.ref}<small>{b.commit_sha.slice(0,12)}</small></span><span>{b.artifact_count}</span><span>{formatDate(b.requested_at)}{b.github_url&&<a href={b.github_url} target="_blank" rel="noreferrer">GitHub run ↗</a>}</span></div>)}</div>}</div>

        <div className="card span2"><div className="section-title"><div><p className="eyebrow">IMMUTABLE OUTPUTS</p><h2>Binaries & confidence</h2></div><span>{data.artifacts.length} shown</span></div>{!data.artifacts.length?<Empty text="No binaries match these filters."/>:<div className="binary-list">{data.artifacts.map(a=><button className={`binary ${artifactId===a.id?"selected":""}`} key={a.id} onClick={()=>void selectArtifact(a.id)}><div><strong>{a.name}</strong><small>{a.full_name} · {a.ref} · {a.digest_algorithm}:{a.digest.slice(0,14)}…</small></div><Confidence level={a.confidence_level}/><StageStrip artifact={a}/><div className="blocker">{a.blocking_stage?<>Blocked at L{a.blocking_stage.level} · <Status value={a.blocking_stage.state}/></>:<span className="good">All configured levels passed</span>}</div></button>)}</div>}</div>

        <div className="card"><p className="eyebrow">TREND</p><h2>Confidence transitions</h2>{!data.trends.length?<Empty text="No confidence transitions in this window."/>:<ol className="timeline">{data.trends.slice(0,12).map(t=><li key={t.id}><div><strong>{t.name}</strong><small>{t.full_name}</small></div><span>L{t.from_level??0} → L{t.to_level}</span><time>{formatDate(t.created_at)}</time></li>)}</ol>}</div>
        <div className="card"><p className="eyebrow">STATE LEGEND</p><h2>Evidence semantics</h2><div className="legend">{states.map(s=><Status key={s} value={s}/>)}</div><p className="muted">Only deterministic passing evidence promotes confidence. Missing, stale, failed, running and pending stages remain visibly distinct.</p></div>
      </section>

      {data.detail&&<DetailPanel detail={data.detail}/>} 
    </>}
  </main>;
}

function Metric({label,value}:{label:string;value:number}){return <article className="metric"><span>{label}</span><strong>{value}</strong></article>}
function Empty({text}:{text:string}){return <p className="empty">{text}</p>}
function Confidence({level}:{level:number|null}){return <span className="confidence">L{level??0}</span>}
function Status({value}:{value:string|null}){const normalized=value??"missing";return <span className={`status s-${normalized}`}>{normalized}</span>}
function StageStrip({artifact}:{artifact:Artifact}){return <div className="stages"><span>L1 <Status value={artifact.level_1_state}/></span><span>L2 <Status value={artifact.level_2_state}/></span><span>L3 <Status value={artifact.level_3_state}/></span></div>}
function formatDate(value:string){return new Date(value).toLocaleString()}
function EvidenceLink({refValue}:{refValue:string}){const href=/^https?:\/\//.test(refValue)?refValue:null;return href?<a href={href} target="_blank" rel="noreferrer">Evidence ↗</a>:<code>{refValue}</code>}

function DetailPanel({detail}:{detail:NonNullable<Detail>}){const a=detail.artifact;return <section className="detail card"><div className="section-title"><div><p className="eyebrow">BINARY DRILL-DOWN</p><h2>{a.name}</h2><p className="muted">{a.digest_algorithm}:{a.digest}</p></div><Confidence level={a.confidence_level}/></div><div className="detail-meta"><span>Repository<strong>{a.full_name}</strong></span><span>Ref<strong>{a.ref}</strong></span><span>Commit<strong>{a.commit_sha.slice(0,12)}</strong></span><span>Build<strong><Status value={a.build_status}/></strong></span>{a.github_url&&<a href={a.github_url} target="_blank" rel="noreferrer">Open GitHub run ↗</a>}</div><StageStrip artifact={a}/>
  <div className="evidence-grid"><section><h3>Level 1 / raw evidence</h3>{detail.evidence.length?detail.evidence.map(e=><article className="evidence" key={e.id}><div><Status value={e.status}/><strong>{e.source}</strong><small>{e.evidence_type} · {e.format} · {formatDate(e.ingested_at)}</small></div><EvidenceLink refValue={e.raw_storage_ref}/></article>):<Empty text="No evidence recorded."/>}</section>
  <section><h3>Level 2 / component tests</h3>{detail.componentTests.length?detail.componentTests.map((row,i)=><article className="evidence" key={i}><div><Status value={String(row.state)}/><strong>{String(row.component_key)} / {String(row.suite_key)}</strong><small>{formatDate(String(row.observed_at))}</small></div><span>{Array.isArray(row.flaky_tests)?`${row.flaky_tests.length} flaky`:""}</span></article>):<Empty text="No component evidence recorded."/>}</section>
  <section><h3>Level 3 / system tests</h3>{detail.systemTests.length?detail.systemTests.map((row,i)=><article className="evidence" key={i}><div><Status value={String(row.state)}/><strong>{String(row.provider_key)} / {String(row.environment_key)} / {String(row.suite_key)}</strong><small>{String(row.environment_type)} · attempt {String(row.attempt)} · {formatDate(String(row.observed_at))}</small></div></article>):<Empty text="No system evidence recorded."/>}</section></div>
  <section><h3>Confidence history</h3>{detail.transitions.length?<div className="history">{detail.transitions.map((row,i)=><span key={i}>L{String(row.from_level??0)} → L{String(row.to_level)} · {formatDate(String(row.created_at))}</span>)}</div>:<Empty text="No transitions recorded."/>}</section></section>}
