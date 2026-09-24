"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";

type Citation = { id: number; sourceType: string; sourceRef: string; excerpt: string };
type Recommendation = { componentKey: string; targetLevel: number; action: string; rationale: string; uncertainty: string; citations: Citation[] };
type Result = { answer: string; recommendations: Recommendation[]; evidence: unknown[]; risks: unknown[] };

export default function AssistantPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [question, setQuestion] = useState("Which components need additional testing and at which confidence level?");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function ask(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setResult(null);
    try {
      const authorization = "Basic " + btoa(String.fromCharCode(...new TextEncoder().encode(username + ":" + password)));
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: authorization },
        body: JSON.stringify({ repositoryId: Number(repositoryId), question }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Assistant request failed");
      setResult(body as Result);
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 960, margin: "40px auto", padding: 24 }}>
    <Link href="/">← ORBIT</Link><h1>Testing recommendation assistant</h1>
    <p>Read-only AI interpretation of repository evidence and derived risk analytics. Recommendations do not change confidence levels.</p>
    <form onSubmit={ask} style={{ display: "grid", gap: 12, maxWidth: 680 }}>
      <label>Operator username<br/><input required value={username} onChange={e=>setUsername(e.target.value)}/></label>
      <label>Operator password<br/><input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label>Repository ID (from the dashboard repository selector)<br/><input required type="number" min="1" value={repositoryId} onChange={e=>setRepositoryId(e.target.value)}/></label>
      <label>Quality or testing question<br/><textarea required rows={4} maxLength={2000} value={question} onChange={e=>setQuestion(e.target.value)}/></label>
      <button disabled={busy}>{busy ? "Analyzing…" : "Ask ORBIT"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <section aria-live="polite"><h2>AI interpretation</h2><p>{result.answer}</p>
      <h2>Testing recommendations</h2>
      {!result.recommendations.length && <p>No evidence-backed recommendations available for this query.</p>}
      {result.recommendations.map((r,i)=><article key={i} style={{ border: "1px solid #65718c", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3>{r.componentKey} · Target L{r.targetLevel}</h3><p><strong>Action:</strong> {r.action}</p>
        <p><strong>AI rationale:</strong> {r.rationale} · Uncertainty: {r.uncertainty}</p>
        <h4>Measured evidence cited</h4><ul>{r.citations.map(c=><li key={c.id}>
          {/^https:\/\//.test(c.sourceRef) ? <a href={c.sourceRef} target="_blank" rel="noreferrer">{c.sourceType} · {c.sourceRef}</a> : <span>{c.sourceType} · {c.sourceRef}</span>}
          <p>{c.excerpt}</p>
        </li>)}</ul>
      </article>)}
    </section>}
  </main>;
}
