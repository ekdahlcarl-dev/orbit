import Link from "next/link";

const cards = [
  ["Build orchestration", "Connect repositories now. Build scheduling arrives in ORB-4."],
  ["Confidence engine", "Levels 0–3 are implemented in ORB-6/7/8/9."],
  ["Quality intelligence", "Risk analytics and AI recommendations arrive in ORB-11/12/13."],
];

export default function Home() {
  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "72px 24px" }}>
      <p style={{ letterSpacing: 3, opacity: 0.7 }}>ORBIT / FOUNDATION</p>
      <h1 style={{ fontSize: 64, margin: "12px 0" }}>Software quality intelligence</h1>
      <p style={{ maxWidth: 720, fontSize: 20, lineHeight: 1.6, opacity: 0.82 }}>
        ORBIT connects builds, immutable binaries, test evidence and confidence levels into one auditable control plane.
      </p>
      <Link href="/repositories" style={{ color: "#afc9ff", display: "inline-block", marginTop: 16 }}>Configure GitHub repositories →</Link>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16, marginTop: 48 }}>
        {cards.map(([title, text]) => (
          <article key={title} style={{ border: "1px solid #2b355a", borderRadius: 16, padding: 24, background: "#111831" }}>
            <h2>{title}</h2><p style={{ opacity: 0.75, lineHeight: 1.5 }}>{text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
