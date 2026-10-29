# OTel receiver runbook and implementation handoff

Architecture: [ADR-010](architecture/adr-010-opentelemetry.md). Normative [contract](architecture/telemetry-contract-v1.md). This is an ORB-19 design and receiver spike, not the ORB-20 runtime setup.

## Reproduce the synthetic receiver check

Requires Docker and Python 3 only; no GitHub/AI credentials, application database or paid calls. Use a dedicated disposable container, private loopback ports, no production data. The image is pinned to the tested digest; this development image requires a security/version review before reuse.

```sh
docker run -d --name orbit-orb19-receiver --memory=2g --cpus=2 -p 127.0.0.1:14318:4318 -p 127.0.0.1:13000:3000 grafana/otel-lgtm@sha256:0d4e0cbb87b38112ba4b8e411f81925ab0f78cce3c5b219c327e8b06c1b67c23
python3 docs/examples/otel/receiver-probe.py
docker stats --no-stream orbit-orb19-receiver
docker stop orbit-orb19-receiver
docker rm orbit-orb19-receiver
```

Wait until Grafana `/api/health` and its datasources are ready before the probe. Retry the probe if startup is incomplete; it polls search for up to 45 seconds. The probe validates the five JSON examples, emits synthetic OTLP/HTTP spans/logs/metrics, then verifies Loki error_id and trace_id lookup, Tempo error attribute and trace-ID lookup, and a metric sample. It does **not** run ORBIT, test actual redaction/SDK/Pino transport or change existing application behavior. No volume is mounted; removing this dedicated container deletes its spike storage. Do not use these cleanup commands on other containers or shared data.

Manual diagnosis in private Grafana Explore: Loki `{service_name="orbit-receiver-spike"} | json | error_id="<errorId>"`, then JSON `trace_id`; Tempo `{ span.orbit.error.id = "<errorId>" }` or direct trace ID lookup. Use the receiver's time range containing the failure. Search all related operation/build/delivery IDs when a webhook trace is separate. No trace found is not proof of no error. Confirm release and sanitized source location before opening the fixed ORBIT source link. UI/API public `errorId`/`traceId` map to storage `error_id`/`trace_id`; aliases are not duplicate telemetry fields.

## ORB-20: SDK and local transport

Change `package.json`/lock, `src/instrumentation.ts` (new), `src/lib/telemetry.ts`, `src/lib/config.ts`, worker bootstrap/`src/worker/index.ts`, `src/app/api/telemetry/route.ts`, `.env.example`, Compose optional profile and `scripts/dev-all.mjs`. Add mutually compatible pinned releases of `@opentelemetry/sdk-node`, `sdk-trace-base`, `sdk-metrics`, `resources`, `context-async-hooks`, `core`, OTLP HTTP trace/metric exporters, pg and Undici instrumentations. Pino log conversion may use `sdk-logs` plus OTLP HTTP log exporter in a bounded destination; do not replace the Pino safe serializer. Validate actual versions rather than copying current API examples blindly.

Next bootstrap is Node-only and idempotent; worker bootstrap precedes domain/pg imports, including tests. Verify HTTP/Undici and pg coverage in the production Next build, avoid overlapping auto-instrumentation. Preserve startup without telemetry. Summary endpoint must report configured / initialized / last export attempt separately; exporter success is not searchable backend confirmation. Keep health/readiness independent. No raw exporter errors or endpoints/headers in public status.

Local profile must include Collector-contrib `filelog` receiver reading only `.orbit-telemetry/web.jsonl` and `worker.jsonl`, parsed as JSON, selected into OTLP fields according to contract, with offsets and bounded rotation handling. Mount directory read-only; exclude from Git and chmod directory 0700/files 0600. Required pipelines: traces OTLP → limiter/batch → LGTM; metrics same; logs filelog → JSON/allowlist/map → limiter/batch → LGTM. Use memory limiter before batching, bounded sending queue and retries. Bind host OTLP/UI to loopback, no public Codespaces forwarding. Pin image digests and validate Collector configuration with its own `validate` command. Configure storage retention max 24h and disk cap; the unmodified ephemeral spike is not that retained reference profile.

Required future environment catalog (server-only):

| Variable | Decision |
| -- | -- |
| `ORBIT_TELEMETRY_ENABLED` | default false, explicit opt-in |
| `ORBIT_SERVICE_NAME` | orbit-web or orbit-worker, set per launcher |
| `ORBIT_ENV` | existing development/test/production → deployment.environment.name |
| `ORBIT_RELEASE` | deployed ORBIT SHA, mandatory production |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | reviewed base URL; local http://127.0.0.1:4318, container http://collector:4318; production exact EU HTTPS endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | http/protobuf (probe uses supported JSON wire encoding) |
| `OTEL_EXPORTER_OTLP_HEADERS` | server-only write credential; never in summary/client/logs |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | parentbased_traceidratio / 0.1 production; always_on test |
| `ORBIT_TELEMETRY_ALLOWED_ORIGINS` | exact reviewed origins for ingest; no wildcards/redirects |
| `ORBIT_DIAGNOSTICS_ORIGIN` | separate allowlisted HTTPS query origin, no credentials in links |
| `ORBIT_LOG_PATH` | restricted per-process local JSON file in development only |
| `LOG_LEVEL` | existing INFO production minimum; no raw SDK debug output |

Production direct log destination is conditional; ensure stdout + bounded OTLP destination does not double-ingest. Each bounded serverless invocation must flush under <=3s and its remaining platform deadline; verify delivery before ORB-27 adoption. No background interval assumed to survive a function return. Validate empty/invalid config, exports from both processes, duplicates, SIGTERM, Collector outage, queue bounds and recovery.

## ORB-21: safe errors and logs

Change `lib/logger.ts`, `lib/github/http.ts`, all API route catch boundaries including auth/health, Next server-render boundaries and relevant UI fetch handlers. Inventory handlers that bypass `errorResponse`. Introduce allowlisted event factory, active context extraction, error ownership and safe frame mapping. Preserve HTTP status and legacy `error`. Central API boundary owns unexpected request errors, worker owns job errors, repository gate boundary owns caught partial errors. Capture safe category before GitHub IntegrationError mapping. Test concurrency, nested secrets/causes/query/body, one incident log, sampled-out traces, deployed-release location resolution and unchanged auth/error semantics. Minimal authenticated bounded browser error reporting only if needed; no browser OTel/session replay.

## ORB-22: durable asynchronous correlation

Change `builds.ts:queueManualBuild/enqueueDueSchedules/queuePushBuild/processBuildTrigger/syncWorkflowRun`, `github/webhooks.ts:receiveWebhook/processWebhook`, worker queue claim/retry, and a **new next numbered migration** after current 017. Nullable traceparent/operation/version columns on job_queue; nullable minimal originating context/operation on build_runs; bounded delivery correlation references as needed. Validate constraints and legacy NULL handling, no payload/idempotency/fingerprint changes. Add index only for demonstrated diagnostic lookup; no full telemetry tables. Persist proven domain associations only; expose ambiguity independently of current matching heuristic. Keep operation context outside rollback-sensitive transient state and export incidents outside DB transactions. Test real two-process manual/schedule/push, two retries/exhaustion, rollback, same-SHA concurrency, duplicates/conflicts and migration apply/replay.

## ORB-23: domain coverage

Change `lib/builds.ts`, `github/{webhooks,client}.ts`, `evidence.ts`, `static-analysis.ts`, `component-tests.ts`, `system-tests.ts`, `confidence.ts`, `merge-gates.ts`, `ai-assistant.ts`, `ai-provider.ts`, `risk.ts`. Cover webhook's private initialConfidence/ingestWorkflowArtifacts path as well as public ingestion/calculation functions. Implement registered spans and safe external categories; attach exact IDs when known. Test caught per-repository failures despite outer success, spans ending on throw/rollback, failed tests/denied gates as domain outcomes, no double spans and identical domain/audit output with telemetry disabled/enabled. Stub AI; paid calls forbidden for acceptance.

## ORB-24: metrics and alerts

Implement catalog in telemetry module, worker and API/domain boundaries, independent observer for durable heartbeat/queue/refresh timestamps and receiver health. New heartbeat/refresh timestamp persistence may need a separately numbered migration, scoped to observability, without queue redesign. Catch-level failure counters are required. Dashboards go from aggregate timeframe to protected logs/trace. Test worker stop, GitHub outage, caught gate-refresh failure, receiver outage/recovery, ID-free bounded dimensions and both alarm firing/recovery. Initial local alarm targets: heartbeat missing >60s, oldest due job >120s, any exhausted retry, receiver loss >60s, gate refresh >15min; tune against measured baseline before production, where observer cadence must accommodate ORB-27 best-effort scheduling. Name operator/notification receiver before production; no external notifications sent by this work.

Runbook for stale green check: verify observer freshness, inspect refresh/publication failure and last success, pause merges manually under existing repository procedure, restore GitHub/worker, refresh checks and verify exact head before lifting freeze. Telemetry never automatically withdraws a green check or repairs publication/commit gaps. If receiver alone fails, keep core processing running, inspect bounded local safe errors and drop counters, restore destination, verify a new marker reaches search; gaps are unrecoverable unless explicitly buffered.

## ORB-25: diagnostics UI and access

Change existing builds/dashboard/merge-gates views and fetch error handling (`src/app` components), `auth/rbac.ts` integrations and a protected query adapter. Resolve repository from build/artifact/job server-side; require admin plus live grant for details and exports. Return safe minimal diagnostics, never receiver read token. If a trace crosses repositories deny unless every grant is present. Direct receiver URLs only when equivalent enforcement exists; Free account access alone is insufficient. Test revoked grants/nonadmin/tampered IDs, query bounds, encoded origins, expired/sampled-out/ambiguous states and accessible copy-reference controls. Do not build an APM database/UI.

## ORB-26 and ORB-15/27 release gate

Use isolated app+worker+DB+Collector+receiver, synthetic external services and controlled live GitHub separately. Verify received signals, all policy markers, concurrency, legacy/migration replay, retries/rollback, full buffer, redaction, sampling, RBAC and >=3 timed error-reference drills. Run full existing security/type/lint/build/integration checks on the integration commit. Measure ADR budgets, quota, retention expiry/deletion, region, owner-only backend access, export denial and revoke behavior. Use dev → test → bounded production only after ORB-15 acceptance; stop export by flag without domain schema loss. ORB-27 owns actual host selection, free terms verification, authenticated bounded worker/scheduler and deployment approval; no current hosting or cron capability is assumed.
