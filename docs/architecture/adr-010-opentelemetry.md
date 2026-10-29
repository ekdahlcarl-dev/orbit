# ADR-010 — OpenTelemetry architecture and receiver

Status: accepted architecture; application implementation and production acceptance pending ORB-20–26/ORB-15. Contract: **orbit.telemetry/1.0.0**. Date: 2026-10-29.

## Authority and scope

This refines, without replacing, the accepted ADR-010 in the [ORB-1 baseline](https://linear.app/labcalle76se/document/orbit-architecture-baseline-orb-1-8a47a6eacfbf): “Vendor-neutral observability across API, background work and integrations.” No ADR file existed in this checkout. Other baseline decisions remain intact: PostgreSQL is the domain system of record, object storage holds raw evidence, confidence is deterministic, AI is advisory, and authorization precedes retrieval.

Requirements reviewed: ORB-19, parent ORB-18, ORB-20–26, ORB-15, ORB-27, and the repository's ORB-14 security runbook. Linear acceptance criteria are reproduced in the [verification report](../orb-19-verification-report.md). Shared Linear agent notes were unavailable (`Tool not found`); issues and baseline document were retrieved successfully. This work adds documentation and synthetic receiver examples only, not SDK bootstrap, application instrumentation, migrations, UI or cloud resources.

## Problem and observed architecture

Baseline inspected: `046ddb7ae172bae6dc96dd685ff25a2170b7b317`. The original `feature/orb-16-test` worktree has unrelated uncommitted merge-gate changes; they are excluded from this isolated branch. Before publication, the ORB-19 commit was rebased onto main at `2967e69c84a8bcd20cd72fec569b80c3536cb5b8` and its newer merge-gate selection/lineage checks were reviewed. The inventory below remains valid; no application changes are included.

| Boundary and source | Current capability | Missing diagnostics |
| -- | -- | -- |
| `src/app/api/**/route.ts`, `lib/github/http.ts` | Node API handlers, generic error responses; OAuth/session, same-origin and role/grant guards | No common request/error reference, active context or latency instrumentation |
| `lib/telemetry.ts`, `lib/config.ts`, `package.json` | OTel API tracer, endpoint-presence summary, Pino; Node >=20, Next 15 | No NodeSDK/exporter/bootstrap; endpoint configured does not mean received |
| `lib/logger.ts` | JSON Pino; secret redaction; error type/safe code only | Existing camelCase job/repository fields are inconsistent; no release/trace/error context; redaction is not a general allowlist |
| `lib/builds.ts`, migrations 001/003 | Manual/schedule/push producers, triggerKey idempotency, PostgreSQL job queue, BuildRun and GitHub run IDs | No durable operation/trace metadata; dispatch returns no run ID |
| `worker/index.ts` | Row lock + SKIP LOCKED; transaction, job savepoint; 30-second retry, third failure exhausted; polling 2s; gate refresh advisory lock/savepoint | No attempt spans, independent heartbeat, queue age/depth or bounded telemetry shutdown |
| `lib/github/webhooks.ts`, migration 015 | HMAC, installation/repository checks, signed-payload fingerprint, delivery deduplication, minimal processing projection, async queue | Incoming trace context is untrusted; duplicate/conflict/reject outcomes lack signal coverage |
| `lib/builds.ts:syncWorkflowRun` | Prefer existing run ID; otherwise claims oldest queued candidate matching installation/repository/workflow/SHA | Fallback can be ambiguous with concurrent same-SHA builds; telemetry must disclose uncertainty, not certify exactness |
| `lib/github/client.ts` | Fetch with 10s timeout, redirect rejection, safe integration errors, rate-limit detection | Preserve safe HTTP category before error mapping; no token/URL/body capture |
| `lib/evidence.ts`, `github/webhooks.ts` | Artifact digest validation, quarantine, ingestion; webhook-specific artifact ingestion and initial confidence calculation | Instrument both direct ingestion and webhook path, including the separate `initialConfidence` implementation |
| `lib/confidence.ts`, static/component/system-tests modules | Deterministic calculation, evidence lineage, transitions | No calculation spans or operational failure counters; failed tests are domain results |
| `lib/merge-gates.ts` | Refresh/evaluate/publish; catches errors per repository; durable check/decision IDs | Outer iteration success hides partial failures; stale green checks remain possible; observability does not repair publication/DB transaction gap |
| `lib/auth/{guard,rbac,audit,session}.ts`, migrations 012–017 | Individual GitHub sessions, roles, repository grants, audit | No telemetry authorization proxy; existing `/api/telemetry` is admin-only configuration status, not a search service |
| Compose, `.devcontainer`, `scripts/dev-all.mjs` | PostgreSQL/pgvector only; Node 22 devcontainer; host web/worker processes | No receiver, log transport or retention. Only application port is currently forwarded; never forward telemetry ports publicly |

## Decision

Use separate `orbit-web` and `orbit-worker` resources with the same ORBIT release, W3C Trace Context, OTLP/HTTP traces and metrics, and Pino JSON logs mapped to OTLP logs. Follow the [v1 contract](telemetry-contract-v1.md) and [runbook/handoff](../otel-runbook.md).

NodeSDK initializes once per process before dependency imports. Next.js uses Node-only `src/instrumentation.ts:register`; worker uses a separate bootstrap followed by dynamic import of its implementation. Use AsyncLocalStorage context and OTel inject/extract; test Next production build and tsx/ESM instrumentation. Enable pg and actual fetch/Undici coverage with sensitive statement/header capture disabled. Choose one owner for inbound HTTP spans so Next and automatic instrumentation do not duplicate them. Never use raw `recordException(error)`.

Local reference: optional, isolated Collector-contrib + Grafana LGTM (Tempo traces, Loki logs, Prometheus metrics and Grafana search). LGTM is development/test storage, not the production deployment. Collector receives SDK OTLP plus bounded, allowlisted Pino JSON files through `filelog`, then exports all three signals to LGTM. Web/worker running outside Docker write separate restricted local JSON files mounted read-only into Collector; rotate before 10 MiB, keep two files per process, and exclude files from Git. Stdout remains available. ORB-20 must implement and verify this log path; redirecting stdout alone is not receiver collection. A synthetic OTLP receiver spike verifies storage separately from Pino transport.

Production choice: **direct OTLP/HTTP to a Grafana Cloud Free stack in EU Sweden (AWS `eu-north-1`)**, conditional on the ORB-27 feasibility gate and owner approval to create a free account. No permanent Collector is assumed. Retain Pino stdout; a bounded server-side Pino destination maps the already-sanitized fields to OTLP log records. SDKs batch traces/metrics; a bounded invocation flush uses the selected platform's supported lifecycle. No browser credentials or public ingestion endpoint controlled by ORBIT. If quotas, EU residency, account access or lifecycle flushing cannot be verified, keep remote telemetry disabled and use restricted platform JSON diagnostics plus explicit “telemetry unavailable” status; this degraded fallback does not satisfy ORB-18 production acceptance. No paid upgrade or billing-enabled service is authorized.

## Alternatives and trade-offs

| Option | Complexity/resources and cost | Search/correlation/retention/security | Runtime fit |
| -- | -- | -- | -- |
| Collector alone + debug/file export | Low; local CPU/disk; no hosting purchase | No indexed search/UI; sensitive output risk; bounded files useful for synthetic debugging only | Node/Next/workers; cannot assume always-on process in serverless |
| Console/Pino JSON only | Lowest; bounded stdout/files | Manual ID search; no distributed trace store or metric history; platform retention varies | Works everywhere but insufficient as complete receiver |
| Collector + LGTM (selected local) | Moderate configuration; reserve 2 GiB RAM/2 CPU/2 GiB ephemeral disk initially; measure actual use | Tempo/Loki searchable IDs and metric queries; private localhost; 24h configured maximum; ephemeral spike data | Good Codespaces optional profile; unsuitable for assumed free serverless hosting |
| Jaeger alone | Lower trace-only footprint | Trace search, but requires additional log and metrics storage; more integration to satisfy all signals | Local/worker fine; persistent hosting still needed |
| Grafana Cloud Free direct OTLP (selected future) | Low operating burden, library flush complexity; €0 only within free terms/quotas | Managed three-signal search; documented Free retention currently 14 days; owner-only stack, restricted tokens, EU stack required | Node/Next/workers and bounded invocations; actual shutdown delivery must be measured |
| Self-host production LGTM/Collector | Highest operational burden, disk/backup/security ownership | Full control but recurring compute not established at €0 | Reject as ORB-27 assumption |

Direct export loses Collector-side buffering/redaction/tail sampling. Therefore sanitize before every exporter, use bounded queues, expose drops and preserve error logs independently of trace sampling. Do not add full telemetry storage to ORBIT PostgreSQL. Vendor-neutral contracts/OTLP allow replacing the backend. The single-user free backend is not a substitute for repository-aware authorization in a future multi-user deployment.

## Cost, performance and release gates

Decided limits before production: **€0 recurring, no card/billing/automatic upgrades**; <=1 GiB/month logs, <=1 GiB/month traces, <=1,000 active metric series; no more than 50% of any verified provider free allowance. Alert at 50% of ORBIT's budget; at 80% reduce successful trace sampling/info logs; at 100% disable remote export, keep bounded local error logs and surface loss. Error storms may drop logs after the bounded cap; never claim guaranteed delivery. Receiver quota checks must be independent of the app exporter.

Per process: span queue <=2,048, log queue <=1,024, <=256 records/batch, export timeout <=2s, at most one retry per batch, total flush <=3s (or lower remaining invocation time), metrics interval 60s. Export payload <=256 KiB uncompressed; split before send. Cap telemetry incremental RSS at 64 MiB/process, CPU overhead <=5%, API p95 increase <=5% AND <=10ms, worker iteration p95 increase <=5% AND <=50ms. Local receiver stack limit 2 GiB RSS and 2 GiB disk; stop the optional profile if exceeded. No synchronous network export on a request/job path.

ORB-26 measures enabled/disabled with identical isolated DB seed, stubbed GitHub/AI, warm production builds: three 10-minute runs each, 10 concurrent API clients, 1,000 jobs with retries and an error storm; compare p95, CPU time, RSS, exported bytes, series, drops and domain/audit snapshots. Include receiver outage/full queue/recovery and short-lived invocation shutdown. Document hardware, sample sizes and variance; reduce scope/sampling if any bound fails. These are decided acceptance limits, not measured claims. ORB-15 owns production acceptance; ORB-27 must recheck provider terms, quota, region and scheduler lifecycle at deployment time.

## Security, unknowns and references

Data policy, access/deletion, cardinality and error-to-code mapping are normative in the contract. Telemetry grants no confidence level and never replaces audit. No GitHub App permissions change. Availability of the selected Free stack and all three signals in EU Sweden at account creation, provider deletion capabilities, exact free quotas, per-repository enforcement and platform flush support remain release gates, not verified deployment facts. ORB-27's preferred hosts and 5–15-minute refresh are conditional; this design needs no continuously running collector or new cron assumption and does not solve worker leasing/reconciliation.

Official sources checked 2026-10-29 (capabilities verified from documentation, deployment not provisioned):

- [LGTM development backend](https://grafana.com/docs/opentelemetry/docker-lgtm/) provides Collector, Grafana and three storage signals for development/test.
- [Collector configuration/validation](https://opentelemetry.io/docs/collector/configuration/) describes pipelines and `validate`; configuration must enable every component explicitly.
- [Grafana Cloud OTLP](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/) documents three signal endpoints and signal-specific URL rules.
- [Direct log export when a collector cannot run](https://grafana.com/docs/learning-hub/intro-to-send-data/02-send-logs/10-otlp-logs/) supports the bounded-hosting approach; production normally recommends Alloy.
- [Free pricing](https://grafana.com/pricing/) currently advertises $0, usage limits, 14-day retention and 50 GB/month trace ingestion. This is not a contractual guarantee of future terms.
- [TraceQL search](https://grafana.com/docs/tempo/latest/traceql/construct-traceql-queries/) supports attribute and trace-ID queries. Actual local search evidence is in the verification report.

- [Regional availability](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/account-management/regional-availability/) lists EU Sweden AWS `eu-north-1` for direct Grafana provisioning; actual Free account/signal availability and residency must still be confirmed.
- [Cloud service limits overview](https://grafana.com/docs/grafana/latest/introduction/grafana-cloud/) advertises 10k metrics, 50 GB logs and 50 GB traces on Free. ORBIT limits remain substantially lower.
