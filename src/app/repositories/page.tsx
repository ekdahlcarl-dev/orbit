"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import type { Installation, Repository, Workflow } from "@/lib/github/client";
import "./repositories.css";

type Options = { defaultRef: string; refs: string[]; workflows: Workflow[] };
type Saved = { repository_id: string; full_name: string; default_ref: string; workflow_id: string; workflow_path: string; enabled: boolean; access_status: string };
type Audit = { id: string; actor: string; action: string; created_at: string; repository_id: string | null };

export default function RepositoriesPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authorization, setAuthorization] = useState("");
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationId, setInstallationId] = useState("");
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [options, setOptions] = useState<Options | null>(null);
  const [ref, setRef] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function api<T>(path: string, body?: unknown, auth = authorization): Promise<T> {
    const response = await fetch(`/api/github/${path}`, {
      method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }

  async function run(work: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { setBusy(false); }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const bytes = new TextEncoder().encode(`${username}:${password}`);
      const auth = `Basic ${btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""))}`;
      const list = await api<Installation[]>("installations", undefined, auth);
      setInstallations(list); setAuthorization(auth); setPassword("");
    });
  }

  async function loadInstallation(id: string) {
    setInstallationId(id); setRepositoryId(""); setRepositories([]); setOptions(null); setSaved([]); setAudit([]);
    if (!id) return;
    await run(async () => {
      const [repos, configurations, history] = await Promise.all([
        api<Repository[]>(`repositories?installationId=${id}`),
        api<Saved[]>(`configurations?installationId=${id}`),
        api<Audit[]>(`audit?installationId=${id}`),
      ]);
      setRepositories(repos); setSaved(configurations); setAudit(history);
    });
  }

  async function loadRepository(id: string) {
    setRepositoryId(id); setOptions(null);
    if (!id) return;
    await run(async () => {
      const choices = await api<Options>(`options?installationId=${installationId}&repositoryId=${id}`);
      const existing = saved.find(item => item.repository_id === id);
      setOptions(choices);
      setRef(existing?.default_ref ?? choices.defaultRef);
      setWorkflowId(existing?.workflow_id ?? "");
      setEnabled(existing?.enabled ?? false);
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const item = await api<Saved>("configurations", { installationId: Number(installationId), repositoryId: Number(repositoryId), ref, workflowId: Number(workflowId), enabled });
      setSaved(current => [...current.filter(row => row.repository_id !== item.repository_id), item]);
      setMessage("Repository configuration saved. Build scheduling is added in ORB-4.");
      setAudit(await api<Audit[]>(`audit?installationId=${installationId}`));
    });
  }

  return <main className="repositories">
    <header><Link href="/">← ORBIT</Link><span>INTEGRATIONS / GITHUB</span></header>
    <h1>Connect your repositories</h1>
    <p className="intro">Choose an approved GitHub repository, its source ref and build workflow. Every configuration change is recorded.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="success" role="status">{message}</p>}
    {busy && <p role="status">Connecting to GitHub…</p>}
    {!authorization ? <section className="panel">
      <h2>Operator access</h2><p>Use your ORBIT operator credentials, not your GitHub password or token. Access stays in memory until you leave this page.</p>
      <form onSubmit={login}><fieldset disabled={busy}>
        <label>Username<input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></label>
        <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button type="submit">Connect to GitHub</button>
      </fieldset></form>
      <p className="muted">The server must have a GitHub App and an approved installation allowlist configured. Individual user roles arrive in ORB-14.</p>
    </section> : <>
      <button className="secondary" disabled={busy} onClick={() => { setAuthorization(""); setInstallations([]); setInstallationId(""); setRepositoryId(""); setRepositories([]); setSaved([]); setAudit([]); setOptions(null); setMessage(""); setError(""); }}>Disconnect</button>
      <section className="panel"><h2>Repository configuration</h2>
        {!installations.length && <p>No approved active installations found. Check the server allowlist and GitHub App installation.</p>}
        <form onSubmit={save}><fieldset disabled={busy}>
          <label>GitHub installation<select value={installationId} onChange={e => void loadInstallation(e.target.value)}><option value="">Select installation</option>{installations.map(item => <option key={item.id} value={item.id}>{item.account.login} · {item.id}</option>)}</select></label>
          {installationId && <label>Repository<select value={repositoryId} onChange={e => void loadRepository(e.target.value)}><option value="">Select repository</option>{repositories.map(repo => <option disabled={repo.archived} key={repo.id} value={repo.id}>{repo.full_name}{repo.archived ? " (archived)" : ""}</option>)}</select></label>}
          {installationId && !busy && !repositories.length && <p>No repositories are available to this installation.</p>}
          {options && <>
            <label>Branch or tag<select required value={ref} onChange={e => setRef(e.target.value)}><option value="">Select ref</option>{options.refs.map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Build workflow<select required value={workflowId} onChange={e => setWorkflowId(e.target.value)}><option value="">Select workflow</option>{options.workflows.map(w => <option value={w.id} key={w.id}>{w.name} · {w.path}</option>)}</select></label>
            {!options.workflows.length && <p>No active workflows found. Add a GitHub Actions workflow to the repository first.</p>}
            <label className="checkbox"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable configuration for future build orchestration</label>
            <button disabled={!workflowId || !options.refs.includes(ref)} type="submit">Save configuration</button>
          </>}
        </fieldset></form>
      </section>
      {installationId && <section className="panel"><h2>Onboarded repositories</h2>{!saved.length ? <p>No repositories configured yet.</p> : <div className="table-wrap"><table><thead><tr><th>Repository</th><th>Ref / workflow</th><th>Status</th></tr></thead><tbody>{saved.map(item => <tr key={item.repository_id}><td>{item.full_name}</td><td>{item.default_ref}<br /><small>{item.workflow_path}</small></td><td>{item.access_status === "revoked" ? "Access revoked" : item.enabled ? "Enabled" : "Disabled"}</td></tr>)}</tbody></table></div>}</section>}
      {installationId && <section className="panel"><h2>Recent audit history</h2>{!audit.length ? <p>No recorded changes.</p> : <ul>{audit.map(item => <li key={item.id}><strong>{item.action}</strong> · {item.actor}<br /><small>{new Date(item.created_at).toLocaleString()}</small></li>)}</ul>}</section>}
    </>}
  </main>;
}
