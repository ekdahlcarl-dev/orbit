# ORB-19 verification report

Date: 2026-10-29. Isolated worktree: `/tmp/orbit-orb-19`. Branch: `feature/orb-19`. Initial inspection baseline: `046ddb7ae172bae6dc96dd685ff25a2170b7b317`. The ORB-19 commit was subsequently rebased onto `main` at `2967e69c84a8bcd20cd72fec569b80c3536cb5b8` for publication, excluding the unrelated smoke-test commits. No deployment or Linear mutation was performed. This report concerns architecture and a standalone synthetic storage probe, not parent ORB-18 implementation acceptance.

## Authoritative requirements and evidence

Retrieved ORB-19, ORB-18, ORB-20–26, ORB-15 and ORB-27 from Linear and ORB-1's architecture baseline containing ADR-001–010. ORB-19's actual criteria are translated below; no criteria were inferred from its title. `get_agent_context` returned `Tool not found`; no shared notes were available. Repository code takes precedence over parent issue's older static assessment. Read-only inspection covered API/auth/RBAC, queue/migrations, build synchronization, worker retries/savepoints, webhook HMAC/fingerprints, GitHub fetch transport, evidence/confidence paths, merge publication, logging/configuration, CI and devcontainer/Compose. Inventory and limitations are in [ADR-010](architecture/adr-010-opentelemetry.md).

| ORB-19 acceptance criterion | Evidence | Verification method | Result |
| -- | -- | -- | -- |
| ADR and field catalog contain manual build, retry, webhook, confidence and merge-gate examples | ADR links [v1 catalog](architecture/telemetry-contract-v1.md), five explicit lifecycle examples and [JSON events](examples/otel/events.json) | Read against current API/worker/domain code; JSON parse and fixture field/size assertions; five synthetic events ingested | PASS |
| Security and cardinality rules can be automatically verified with test markers | Contract defines input allowlists, ID-free metrics, finite enums/caps, safe frames, four unique marker families and negative controls; [machine-readable vectors](examples/otel/policy-vectors.json) specify received-signal assertions | JSON parse; reviewed vectors against the explicit denied inputs and types; probe validates example keys and sizes. Application marker injection/enforcement intentionally belongs to ORB-21/26 | PASS for testable contract; runtime enforcement NOT VERIFIED |
| Cost/performance budget has measurement method and decided limit before production rollout | ADR cost/CPU/RSS/p95/bytes/series/buffer limits and three-run enabled/disabled experiment; runbook assigns ORB-26/15 release checks | Review for numeric bounds, representative workload, failure/recovery and quota controls; local receiver snapshot below | PASS for decision/method; application overhead NOT VERIFIED |
| Chosen storage has working errorId/traceId search and documented access model | Local Loki error_id/trace_id lookup; Tempo direct ID and orbit.error.id search; contract owner/admin+live-grant query/export model | Real local LGTM storage probe, not mocked exporter; response contents asserted. Cloud enforcement/account not provisioned | PASS for selected local storage/search and documented model; production access NOT VERIFIED |
| No purchases or paid AI calls required for local acceptance | Docker OSS receiver and Python stdlib synthetic data; no external AI/GitHub credentials, billing account or app mutation | Inspected reproducible commands/probe imports/endpoints; all probe traffic loopback | PASS |

ORB-19 architecture deliverables are complete. Production readiness remains explicitly conditional on ORB-15/27 and implementation validation under ORB-20–26. A written security rule is not evidence that the current application enforces it.

## Receiver experiment

Image: `grafana/otel-lgtm:0.11.0`, digest `sha256:0d4e0cbb87b38112ba4b8e411f81925ab0f78cce3c5b219c327e8b06c1b67c23`. Disposable container `orbit-orb19-receiver`, memory limit 2 GiB, CPU limit 2, ports `127.0.0.1:14318 → 4318` and `127.0.0.1:13000 → 3000`, no mounted volumes. Only synthetic IDs and static messages were sent. Startup logs reported all receiver components ready in 11 seconds.

Executed `python3 docs/examples/otel/receiver-probe.py`. Final result PASS, five events. Error ID `33333333-3333-4333-8333-333333333333` resolved to log and trace `000000000000000018e31695a01be307` in the final run. Assertions confirmed all three OTLP signals accepted without partial rejection, Loki lookup by both IDs, Tempo lookup by direct ID and error attribute, and Prometheus sample value 5 (`orbit_receiver_probe_total`). The first probe exposed Tempo search returning trace IDs without leading zeroes; the harness now compares IDs numerically and the final rerun passed. This normalization is a receiver API representation issue, not a change to ORBIT's fixed-width trace contract.

Container resource snapshot during the spike: 858.5 MiB / 2 GiB memory, 1.50% CPU at observation, 72 processes. This is a single idle/synthetic snapshot, not a load test or measured application overhead. The image is deliberately a development fixture, not an endorsed production build. No retention-expiry, deletion SLA, Pino file collection, application SDK instrumentation or backend repository RBAC was tested by this experiment. The container is stopped and removed after the experiment; the image cache may remain for reproducibility.

## Checks and scope protection

| Check | Method/evidence | Result |
| -- | -- | -- |
| Preserve existing work | Initial original worktree had modified `src/lib/merge-gates.ts`, `src/lib/merge-gates.integration.test.ts`, untracked ORB-16 report and session transcript. Created isolated branch/worktree from committed HEAD; original working tree left intact | PASS |
| Match current implementation | Direct source inspection and inventory table, including private webhook confidence/ingestion path, heuristic run matching, caught gate failures and endpoint-only telemetry summary | PASS |
| Consistency with ADRs | Retrieved ORB-1 baseline; preserve OTel choice, modular monolith, PG metadata, object storage, deterministic confidence, advisory AI and authorization-before-retrieval | PASS |
| Example configuration syntax | JSON parse of events/policy vectors, Python AST parse, bash `-n` of shell examples; actual Docker launch and OTLP request parsing | PASS |
| Documentation checks | Local Markdown link existence, balanced code fences, shell syntax, `git diff --check`; no repository-specific documentation checker configured | PASS |
| Mermaid | No new Mermaid diagrams; existing solution overview unchanged; `mmdc` unavailable | NOT VERIFIED rendering; not applicable to new prose/tables |
| Existing tests | `env -u DATABASE_URL npm test`, dependencies reused through a temporary node_modules symlink from original worktree (removed after checks) | PASS after rebase: 83 total, 76 passed, 7 DB-dependent tests skipped, 0 failed (initial baseline: 81 total, 76 passed, 5 skipped) |
| PostgreSQL integration/migration replay | No new schema; DB-backed tests require isolated DATABASE_URL and were skipped; did not use shared development DB | NOT VERIFIED |
| Typecheck/lint | `npm run typecheck`, `npm run lint` in isolated worktree | PASS |
| Production build/security/devcontainer CI | No application/dependency/config change; not rerun for this documentation-only branch | NOT VERIFIED |
| No runtime change | Changed paths limited to Markdown and standalone docs/examples; no src, migration, lockfile, Compose, secret or application config change | PASS |
| Zero-cost compatibility | Official Free pricing/OTLP/region documentation checked; selects EU Sweden direct OTLP without permanent Collector; conservative budget and disabled/degraded fallback; no service provisioned | PASS for architecture compatibility; actual ORB-27 hosting/lifecycle/quota NOT VERIFIED |

## Remaining risks and handoff

- ORB-20 must prove both real processes export spans/metrics and Pino logs through bounded collection; the synthetic probe does not satisfy its criteria.
- ORB-21/26 must execute the marker vectors against received data, including auto-instrumentation and nested errors. Current Pino redaction alone does not enforce the future allowlist.
- ORB-22 must preserve nullable legacy queue behavior and show uncertainty around existing same-SHA run association; this package does not fix matching or queue semantics.
- ORB-24/26 must prove external heartbeat, stale-green alarms, receiver loss/recovery, series bounds and measured overhead; production alarm ownership remains to be named.
- Grafana Free is not assumed to enforce per-repository grants. No direct access for users who lack any stored repository grant; production query proxy/revoke tests are required. Immediate selective deletion, EU account/signal availability, residency and serverless flush remain gates.
- ORB-27 must verify current free terms and feasibility; no claim that its tentative hosting stack supports a permanent Collector or 5–15-minute cron. If any requirement fails, disable remote export and withhold full production telemetry acceptance.
- Publication review rebased only ORB-19 onto current main (`2967e69`) and inspected its newer merge-gate source-selection/lineage fixes. These do not change the telemetry boundaries or remaining caught-failure/stale-check risks. The original dirty worktree remains untouched; the PR contains only documentation and the standalone receiver examples.

Next action is ORB-20, using the [file/dependency/environment/test handoff](otel-runbook.md). No additional GitHub App permissions, paid resources or secrets are needed for local work. Production account provisioning and deployment are separate actions requiring owner authorization; none occurred here.
