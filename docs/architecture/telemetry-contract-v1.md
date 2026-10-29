# ORBIT telemetry contract v1

Contract ID: `orbit.telemetry/1.0.0`. Normative for ORB-20–26; not a description of instrumentation already installed. Additive optional fields require a minor version; removals, changed meanings/types or metric units require a major version and receiver migration. Unknown fields are dropped before export. SDK semantic-convention version and package versions must be pinned together by ORB-20; ORBIT's application fields below remain stable.

## Resources and identifiers

Required on every signal: `service.name` (enum `orbit-web|orbit-worker`; synthetic tests use `orbit-receiver-spike`), `service.namespace=orbit`, `service.version` (deployed ORBIT full Git SHA, or `unknown` only in development), `deployment.environment.name` (`development|test|production`), `orbit.telemetry.version=1.0.0`. Release must never come from a connected repository's SHA. No hostnames, user names, instance UUIDs or runtime environment dumps in resources. Code links use a fixed ORBIT repository origin plus validated release, never a supplied URL.

All domain IDs below are **strings**, even PostgreSQL/GitHub bigint IDs. Numeric IDs: positive decimal, <=20 digits. UUIDs: server-generated UUIDv4. Empty/missing fields are omitted, not `null`, zero or `unknown` IDs. IDs are high-cardinality log/span attributes, **never metric attributes or Loki stream labels**. Only service/environment and optionally bounded severity become log labels; IDs remain JSON/structured metadata.

| Pino JSON field | Span attribute / OTLP mapping | Meaning and presence |
| -- | -- | -- |
| `timestamp` | OTLP timeUnixNano | Required UTC RFC3339 milliseconds; ingestion time is separate |
| `severity` | severityText/Number | Required `TRACE|DEBUG|INFO|WARN|ERROR|FATAL`; map Pino numeric level once at collection |
| `service.name`, `service.version`, `deployment.environment.name`, `service.namespace`, `orbit.telemetry.version` | Resource attributes | Required as above, dotted JSON keys literal |
| `event_name` | Event name / `orbit.event.name` | Required, registered static operation/event, <=64 ASCII characters |
| `message` | OTLP body | Required static reviewed template <=256 bytes; no string interpolation of untrusted data |
| `trace_id` | Native traceId, `orbit.trace.id` only if needed for JSON indexing | Active context when present: nonzero 32 lowercase hex |
| `span_id` | Native spanId | Active span when present: nonzero 16 lowercase hex; both trace/span present together |
| `request_id` | `orbit.request.id` | Server UUID for every inbound request; returned as x-request-id; never trust external value |
| `operation_id` | `orbit.operation.id` | Server UUID for logical manual/schedule/push build operation; survives retries and proven callbacks; independent of trace |
| `error_id` | `orbit.error.id` | Server UUID per unexpected failure incident; required for operational ERROR/FATAL; public API spelling `errorId` |
| `error_code` | `error.type` | Stable enum below; public spelling `errorCode`; never exception.message |
| `error_type` | `orbit.error.type` | Enum `Error|IntegrationError|ValidationError|DatabaseError|TimeoutError|UnknownError`; no dynamic constructor names |
| `code_file`, `code_function`, `code_line` | `code.file.path`, `code.function.name`, `code.line.number` | Optional sanitized ORBIT code position; line integer 1..1,000,000 |
| `repository_id`, `build_run_id`, `job_id`, `github_run_id` | `orbit.repository.id`, `orbit.build_run.id`, `orbit.job.id`, `orbit.github.run.id` | Validated IDs when known; repository required for repository-scoped diagnostics |
| `installation_id`, `workflow_id`, `check_run_id`, `artifact_id`, `evidence_id` | `orbit.installation.id`, `orbit.workflow.id`, `orbit.check_run.id`, `orbit.artifact.id`, `orbit.evidence.id` | Optional validated domain IDs |
| `delivery_id` | `orbit.delivery.id` | Signed and validated GitHub delivery ID <=100 ASCII alphanumeric/hyphen; absent before authentication |
| `trigger_key` | `orbit.trigger.key` | Existing validated manual/push/schedule key, <=128 ASCII bytes; not a replacement for operation_id |
| `repository_commit_sha` | `orbit.repository.commit.sha` | Optional lowercase 40/64 hex built-repository SHA, distinct from service.version |
| `artifact_digest` | `orbit.artifact.digest` | Optional normalized `sha256:` + 64 lowercase hex |
| `attempt`, `github_run_attempt` | `orbit.job.attempt`, `orbit.github.run.attempt` | Positive integer (job 1..3 currently); optional where applicable |
| `outcome` | `orbit.outcome` | Required registered enum: `success|failure|retry_scheduled|exhausted|rollback|accepted|duplicate|conflict|rejected|ignored|quarantined|passed|failed|blocked|pending|running|stale|not_configured|denied|canceled|unchanged` |
| `correlation_status` | `orbit.correlation.status` | `exact|ambiguous|missing|legacy`; required at callback/async association |
| `confidence_stage` | `orbit.confidence.stage` | Optional `L1|L2|L3` |
| `duration_ms`, `count` | `orbit.duration_ms`, `orbit.count` | Optional finite nonnegative number / integer; summaries only |

Additional safe standard span fields: `http.request.method` enum GET/POST/PATCH/DELETE/OTHER, `http.route` registered route template, `http.response.status_code` integer 100..599, `server.address` enum `api.github.com|postgres|telemetry`, `db.system.name=postgresql`, `db.operation.name` enum SELECT/INSERT/UPDATE/DELETE/TRANSACTION/OTHER. No SQL text or query parameters. Integration diagnostic fields: `orbit.integration` (`github|database|storage|ai`), `orbit.failure.category` (`timeout|rate_limit|permission|unavailable|invalid|unknown`), boolean `orbit.rate_limited`; optional `orbit.rate_limit.remaining` and `orbit.rate_limit.reset_seconds` bounded nonnegative integers. Do not copy response headers wholesale. AI metadata allows only configured provider alias and a reviewed finite model alias, no prompts/responses/citations/embeddings/tool arguments. Every extension needs catalog review first.

## Span lifecycle and propagation

Names are registered constants: `build.enqueue`, `build.dispatch`, `build.sync`, `job.process`, `webhook.receive`, `webhook.process`, `artifact.register`, `evidence.validate`, `evidence.ingest`, `evidence.quarantine`, `static_analysis.result`, `component_test.result`, `system_test.result`, `confidence.recalculate`, `merge_gate.refresh`, `merge_gate.evaluate`, `merge_gate.publish`, `assistant.retrieve`, `risk.calculate`, `provider.complete`, `citation.validate`. HTTP SERVER span name is method + route template; database CLIENT spans use operation only. Enqueue uses PRODUCER, job PROCESS uses CONSUMER, external HTTP uses CLIENT, other domain spans INTERNAL. Always end in finally. An operational failure sets ERROR plus safe error fields; failed tests, blocked confidence and correctly denied gates are domain outcomes with UNSET/OK status, not ORBIT exceptions.

W3C propagation is `traceparent` only by default. Reject invalid/all-zero contexts; cap at 55 bytes for v00, accept only reviewed W3C parser behavior. No baggage or arbitrary tracestate export. Public inbound headers never authorize identity or link repository state: default to a fresh server trace; only explicitly authenticated internal callers may continue validated context. Do not propagate auth/cookies or ORBIT context to arbitrary external hosts. GitHub Actions instrumentation is optional and separate.

Queue metadata lives **outside payload**, nullable `telemetry_traceparent` (varchar(55)), `telemetry_operation_id` (uuid), `telemetry_version` (smallint). ORB-22 adds the next unused migration after 017, not edits to old migrations. Persist valid injected enqueue context at insert in the same transaction. Legacy NULL/invalid/unsupported version creates a fresh attempt trace with `legacy`/`missing` status; never reject an otherwise valid job for telemetry. Each attempt is a fresh root trace with one span link to trusted enqueue context and the same operation_id; distinct attempts 1/2/3, no multi-day parent span or open span while waiting for GitHub. Rollback does not roll back exported diagnostics. Log the attempt incident once at the worker boundary; span events can describe the same incident without duplicate error logs. Distinguish processing success from COMMIT success.

Persist minimal build correlation references (operation UUID, originating trace/span IDs) on build runs, and delivery/attempt references where needed in ORB-22; no span bodies/full logs in DB. Trace links use only context recorded by ORBIT. Retries retain enqueue identity; child jobs inherit operation_id. Scheduled ticks generate one operation per trigger key; push uses the verified delivery producer. API request_id ends at the request and is not reused as a worker request ID.

GitHub webhook normally starts **another trace**. Validate HMAC, installation/repository and run identity first. Join exact stored `(installation, repository, github_run_id)`; include workflow/ref/SHA/run attempt when available. Current oldest-queued workflow/SHA fallback is not proof of exact identity. Count candidate builds before presenting diagnostics: multiple candidates => `ambiguous`, no candidates => `missing`, no speculative trace link or inherited operation_id; show candidate references only to an authorized operator. Domain behavior stays unchanged in this package. A single fallback candidate remains unproven unless independently verified; display `missing` exact correlation with its candidate. Never link by SHA alone. Previously persisted exact association can be displayed with its provenance; telemetry must not upgrade a heuristic association to certainty. Follow artifact/evidence using exact build/artifact IDs and digest, and gate checks by repository/head SHA/check ID; a gate may consume several evidence operations, so link (max 8) and record its own operation rather than assigning one guessed build owner.

## Error diagnostics and protection

Stable codes: `ORBIT_INTERNAL`, `DB_UNAVAILABLE`, `GITHUB_TIMEOUT`, `GITHUB_RATE_LIMIT`, `GITHUB_UNAVAILABLE`, `EVIDENCE_INVALID`, `CONFIDENCE_FAILED`, `MERGE_GATE_PUBLISH_FAILED`, `JOB_RETRIES_EXHAUSTED`, `AI_UNAVAILABLE`, `TELEMETRY_DROPPED`. Additive codes require contract review. Validation/auth/expected conflict outcomes retain safe existing HTTP semantics and do not automatically create ERROR incidents. Exhaustion can reference the third attempt's error_id rather than logging it twice.

Public error response preserves existing `error` and status, adds safe `errorCode`/`errorId`, and x-request-id. No stack or infrastructure details. User copies errorId → authorized repository-filtered Loki lookup → trace_id → Tempo if retained/sampled → failing operation → code_file/code_line at **service.version**. If trace absent, label `not recorded or expired`; logs must remain searchable without it. For asynchronous builds, present the related attempt error reference through protected build diagnostics. Request ID alone is not an incident or authorization capability.

Code locations: at most five ORBIT-owned frames, relative paths from a build-generated manifest limited to `src/`, reviewed function identifiers <=80 ASCII chars, numeric line, no source snippets, absolute paths, locals, SQL, module paths or error.message/cause. Resolve production source maps server-side only; keep them private, tied to ORBIT release. If mapping unavailable, omit frame and say location unavailable. Never infer a line number from another release.

Allowlist construction precedes Pino serialization and all SDK export. Keep existing redaction as defense in depth. Deny raw exceptions, nested causes, request/report bodies, unfiltered webhook payload/projection, SQL/parameters, URL paths containing repository names, query strings, authorization headers, cookies, sessions, tokens, OAuth secrets/private keys, DB credentials, API keys, arbitrary environment variables, source code, test names/report text and all AI content. Disable automatic instrumentation fields that violate this policy before export (including exception events and DB statements). Hashing secrets is not redaction. Never truncate a secret into an allowed string.

Limits: 32 attributes/span, 16 events/span, 8 links/span, 48 fields/log; <=256 UTF-8 bytes/string unless tighter above; <=8 KiB/log and <=16 KiB/span including events; <=256 KiB/export batch. Drop unknown keys and invalid values; drop oversized records after emitting a bounded aggregate drop reason, never log the rejected record. Required static fields plus an error reference take priority over optional IDs. Dynamic spans/labels/message templates are prohibited. Production minimum INFO, no debug bodies/verbose SDK dumps; ERROR must use reviewed static text. Rate-limit repeated identical error categories after 60 records/min/process; aggregate further incidents and show drops. Audit is separate and must not be sampled by telemetry.

## Metrics catalog

OTel instrument names below; counters monotonic, histograms record independently of sampled spans. Units `s`, `By`, `{request}`, `{job}`, `{event}`, `{failure}`, `{attempt}`, `{item}`, `{drop}` use OTel units. No ID, SHA, digest, ref, error text, URL, account/repository/model name or arbitrary status as a dimension. Resources are only the approved bounded service/environment/release fields (release rollover counts toward series budget). Prometheus translations may add unit/total suffixes; dashboards must verify actual exported names.

| Instrument | Type / unit | Allowed attributes (only) |
| -- | -- | -- |
| `orbit.api.requests` | Counter / {request} | route, method, outcome, status_class |
| `orbit.api.duration` | Histogram / s | route, method, outcome |
| `orbit.worker.executions` | Counter / {attempt} | job_type, outcome |
| `orbit.worker.duration` | Histogram / s | job_type, outcome |
| `orbit.queue.depth` | ObservableGauge / {job} | job_type, state |
| `orbit.queue.oldest_due_age` | ObservableGauge / s | job_type |
| `orbit.job.retries` | Counter / {attempt} | job_type |
| `orbit.job.exhausted` | Counter / {job} | job_type |
| `orbit.webhook.received` | Counter / {event} | event, outcome |
| `orbit.webhook.duration` | Histogram / s | event, outcome |
| `orbit.github.requests` | Counter / {request} | operation, outcome, status_class |
| `orbit.github.duration` | Histogram / s | operation, outcome |
| `orbit.github.rate_limited` | Counter / {request} | operation |
| `orbit.evidence.failures` | Counter / {failure} | stage, category |
| `orbit.evidence.quarantined` | Counter / {item} | stage, category |
| `orbit.confidence.failures` | Counter / {failure} | stage |
| `orbit.merge_gate.refresh` | Counter / {attempt} | outcome |
| `orbit.merge_gate.publish_failures` | Counter / {failure} | category |
| `orbit.merge_gate.evidence_to_check` | Histogram / s | outcome |
| `orbit.merge_gate.overdue_repositories` | ObservableGauge / {item} | none |
| `orbit.merge_gate.oldest_refresh_age` | ObservableGauge / s | none |
| `orbit.worker.heartbeat_age` | ObservableGauge / s | none |
| `orbit.ai.calls` | Counter / {request} | provider, outcome |
| `orbit.ai.duration` | Histogram / s | provider, outcome |
| `orbit.telemetry.dropped` | Counter / {drop} | signal, reason |
| `orbit.telemetry.exported_bytes` | Counter / By | signal |

Bounded metric values: route = explicit API route/operation template registry capped at 40 plus `other` (never raw route parameter); method GET/POST/PATCH/DELETE/OTHER; status_class 2xx/3xx/4xx/5xx/other; outcome instrument-specific subset of success/failure/rejected/accepted/duplicate/conflict/ignored/retry_scheduled/exhausted/rollback/unchanged/fallback; job_type `build.trigger|github.webhook|other`; state queued/running/failed; event installation/installation_repositories/push/workflow_run/ping/other; stage L1/L2/L3/unknown; category invalid/timeout/rate_limit/permission/unavailable/unknown; operation validate/dispatch/artifacts/checks/token/repositories/pulls/other; provider demo/configured/other; signal traces/logs/metrics; reason queue_full/oversize/invalid/quota/timeout. Use only instrument-relevant subsets. No cross-product preallocation. SDK Views impose <=100 attribute sets per instrument and <=1,000 active series overall including histogram buckets/resources; overflow collapses to reviewed `other` or drops with count. Latency boundaries in seconds: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10. Budget includes resulting bucket series; reduce views/buckets before reaching limit.

Observe heartbeat outside worker from last durable successful iteration timestamp; do not let a dead process leave a frozen zero-age gauge. A protected independent observer reads queue/last-refresh timestamps and counts overdue repositories, with repository details only in protected logs/DB views. Unknown/unavailable observer data is missing data, never zero. Measure refresh success even when no new check is needed. Stale green checks require operator merge freeze; telemetry cannot revoke them automatically.

## Sampling, retention, region and access

Local isolated acceptance: 100% traces, metrics and safe error logs. Production initial head sample 10% using ParentBased/TraceIdRatioBased for trusted context only; public caller sampling bits are ignored. No tail-sampling promise: head-dropped errors cannot regain full traces. Error logs/counters are independent, subject only to explicit bounded loss policies. Successful info logs at most one per operation boundary; no polling idle logs. Decrease sampling against measured budget, never silently change it.

Local receiver: Codespace/host region selected by the owner; synthetic data only until its region is confirmed acceptable. Delete spike storage after validation; regular local reference retention max 24h logs/traces/metrics, no backups, max 2 GiB. Pino rotated files max 24h, 2 x 10 MiB/process. Future production selects EU Sweden AWS `eu-north-1` and requires EU processing/storage verification for all signals before any private metadata leaves ORBIT. Selected Free policy is 14 days all signals, no telemetry backups/long-term archives. It is a retention ceiling, not an availability guarantee. Do not export production data until provider region/retention match these decisions.

Deletion: operator stops ingestion for the affected repository, revokes/rotates compromised write tokens, removes local files/volumes and exports, and requests provider deletion using available tenant procedures; record completion or pending expiry without copying sensitive content into audit. Selective immediate trace deletion is **not verified**; if required before 14 days, disable remote production use until supported deletion or full-tenant purge is verified. Logs, metrics and traces each need confirmation; backups/support copies require provider confirmation. Grant revocation removes diagnostic access immediately regardless of retention.

Access model: one production owner, admin **and live repository grant** for detailed diagnostics; both checked on every query and export, resolving resource ownership server-side. An ID never grants access. Global infrastructure diagnostics restricted to the owner; unscoped incidents unavailable to repository users. Receiver APIs stay private; read and ingest credentials are distinct, ingest scoped only to writing required signals, held server-side. Local Grafana anonymous mode is synthetic-only, bound to loopback and accessed through a private tunnel. Never publish Codespaces ports 3000 (receiver UI), 4317/4318 or backend query ports.

Grafana Free is not assumed to enforce ORBIT repository grants. Production owner may have direct stack access only while authorized for every stored repository; if any grant revoked, remove direct stack credentials/access immediately and route future queries through a repository-filtering server proxy (or stop remote diagnostics). Future multi-user views must use such a proxy with all result rows/trace spans checked; backend deep links/direct unrestricted APIs are forbidden without equivalent enforcement. Do not mix repositories in a trace returned to a user without grants to all of them; deny or safely filter on the server. Export additionally requires admin+grant and explicit export action, <=1,000 sanitized records/1 MiB/24h query window, audit actor/time/repository/count, restricted local file, deleted within 24h. No automatic AI export or RAG indexing.

Destination allowlist: local loopback/private Compose `collector` and `lgtm` only; production exact EU OTLP ingest and Grafana query origins from reviewed configuration, HTTPS:443, no redirects, no wildcard `*.grafana.net`, no user-provided destination or credentials. Fail closed on invalid export config while business operations continue with telemetry disabled. No NEXT_PUBLIC secrets. Diagnostics URL parameters encoded and validated; receiver read credentials never sent to browser.

## Testable policy and examples

ORB-21/26 must plant unique markers in auth headers, nested exception message/cause, cookies, query, raw SQL parameters, webhook/report bodies, environment, private-source text and AI prompt/response: `ORB19_SECRET_TOKEN_7f31`, `ORB19_SECRET_SQL_7f31`, `ORB19_SECRET_BODY_7f31`, `ORB19_SECRET_AI_7f31`. Scan **received** log/trace/metric data and stdout/files for markers and forbidden keys; assert zero occurrences. A negative control must prove each marker entered the test input. Assert unknown keys rejected, payload caps, absence of ID metric attributes/log labels, finite enums, maximum series and source path sanitation. Fixture-only success cannot prove application redaction.

Shared example resources: orbit-worker, ORBIT release `046ddb7ae172bae6dc96dd685ff25a2170b7b317`, test environment, namespace orbit, contract 1.0.0. See [machine-readable examples](../examples/otel/events.json) and [policy test vectors](../examples/otel/policy-vectors.json). IDs are fictitious. Log-to-span mapping uses the table above. These five cases are mandatory contract tests:

| Case | Span / context | Required diagnostic example |
| -- | -- | -- |
| Manual build | web SERVER → build.enqueue PRODUCER; operation O, enqueue context A | request R, operation O, trigger_key, repository; no build_run_id until created |
| Retry | worker job.process CONSUMER, new trace B links A | same O/job; attempt 2, retry_scheduled; DB error incident E with safe source position |
| Webhook | new web trace C → queued worker trace D | signed delivery/run; exact status links to O only with proven mapping; ambiguous/missing has no guessed O/link |
| Confidence | confidence.recalculate INTERNAL under ingestion | exact build/artifact/evidence, stage L2; outcome blocked is not exception |
| Merge gate | merge_gate.publish CLIENT/domain boundary | repository/check/build where known, new error E2 if publishing fails; safe errorCode; denied gate itself not failure |
