"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";

type Policy = { branch_pattern: string; required_level: number; enabled: boolean };
type GateData = { policies: Policy[]; decisions: Array<{ id: number; commit_sha: string; target_branch: string; created_at: string; snapshot: { passed: boolean; requiredLevel: number } }>; checkName: string | null };
export default function MergeGatesPage() {
  const [repositoryId, setRepositoryId] = useState("");
  const [branch, setBranch] = useState("main");
  const [pattern, setPattern] = useState("main");
  const [level, setLevel] = useState(3);
  const [enabled, setEnabled] = useState(true);
  const [data, setData] = useState<GateData | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch(`/api/merge-gates?repositoryId=${encodeURIComponent(repositoryId)}&branch=${encodeURIComponent(branch)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Unable to load merge gates");
    setData(result);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/merge-gates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryId: Number(repositoryId), branchPattern: pattern, requiredLevel: level, enabled }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save policy");
      await load(); setMessage("Policy saved. Open pull requests refresh within 30 seconds while the worker runs.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 980, margin: "3rem auto", padding: "1rem" }}>
    <Link href="/repositories">Repositories</Link>
    <h1>Confidence merge gates</h1>
    <p>Configure deterministic confidence requirements for an onboarded repository. Repository administrators can save policies; viewers can inspect decisions.</p>
    <form onSubmit={submit} style={{ display: "grid", gap: "1rem", maxWidth: 560 }}>
      <label>GitHub repository ID <input required type="number" min="1" value={repositoryId} onChange={e => { setRepositoryId(e.target.value); setData(null); }} /></label>
      <label>Branch pattern <input required value={pattern} onChange={e => setPattern(e.target.value)} /></label>
      <p>Use * for wildcard matches, such as release/*. If patterns overlap, the highest required level applies.</p>
      <label>Required confidence <select value={level} onChange={e => setLevel(Number(e.target.value))}><option value={1}>L1</option><option value={2}>L2</option><option value={3}>L3</option></select></label>
      <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable this policy</label>
      <button disabled={busy} type="submit">Save policy</button>
      <label>Exact target branch for GitHub rules <input required value={branch} onChange={e => { setBranch(e.target.value); setData(null); }} /></label>
      <button disabled={busy || !repositoryId} type="button" onClick={async () => { setBusy(true); setMessage(""); try { await load(); } catch (e) { setMessage(e instanceof Error ? e.message : "Request failed"); } finally { setBusy(false); } }}>Load policies and decisions</button>
    </form>
    <p role="status">{message}</p>
    <p>In GitHub branch protection or rulesets, require the check below and select the ORBIT GitHub App as its source. Apply the rule to the exact target branch. ORBIT does not change your GitHub rules.</p>
    <p>When disabling gating, also remove its required check from GitHub. Existing GitHub results remain visible.</p>
    {data && <><h2>Required check name</h2><code style={{ overflowWrap: "anywhere" }}>{data.checkName}</code>
      <h2>Policies</h2><ul>{data.policies.map(p => <li key={p.branch_pattern}>{p.branch_pattern}: L{p.required_level} ({p.enabled ? "enabled" : "disabled"}) <button onClick={() => { setPattern(p.branch_pattern); setLevel(p.required_level); setEnabled(p.enabled); }}>Edit</button></li>)}</ul>
      <h2>Recent decisions</h2><ul>{data.decisions.map(d => <li key={d.id}>{d.target_branch} · {d.commit_sha} · required L{d.snapshot.requiredLevel} · {d.snapshot.passed ? "Passed" : "Blocked"} · {d.created_at}</li>)}</ul></>}
  </main>;
}
