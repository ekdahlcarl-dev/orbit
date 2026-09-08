# ORBIT domain contract

## Deterministic confidence model

ORBIT confidence is authoritative, deterministic and calculated per immutable artifact/binary. AI and recommendation layers are consumers of confidence state and may never set or override it.

The authoritative chain is:

`ConfidenceAssessment -> normalized evidence -> artifact -> BuildRun -> repository/commit`.

### Confidence levels

- **Level 0** — the artifact has not satisfied Level 1.
- **Level 1** — every enabled mandatory static-analysis gate for the artifact's exact BuildRun passed.
- **Level 2** — Level 1 passed and every enabled mandatory Level 2 requirement has fresh passing evidence for the artifact.
- **Level 3** — Levels 1 and 2 passed and every enabled mandatory Level 3 requirement has fresh passing evidence for the artifact.

Promotion is cumulative. A higher level can never compensate for an invalid lower level.

### States

The confidence engine supports `not-configured`, `pending`, `running`, `passed`, `failed`, `blocked` and `stale`. Missing, stale, pending, running, failed or blocked evidence prevents promotion.

### Recalculation and audit

`recalculateConfidence` rebuilds the assessment from stored repository requirements and stored normalized evidence. Every state or level transition is appended to `confidence_transitions`; `confidence_current` holds only the latest deterministic assessment. No confidence API accepts an arbitrary official confidence level.

## Level 1 — static analysis

Level 1 is deterministic. Static-analysis results are bound to the exact BuildRun/repository/commit and provider source evidence. Provider-specific payloads are normalized behind adapter contracts.

## Level 2 — component/module tests

Level 2 evidence is normalized per exact artifact. A suite maps `(repository, componentKey, suiteKey)` to `component:<componentKey>:suite:<suiteKey>`. Results retain source evidence, totals, coverage/trends, flaky identities and observation time. `unstable` is retained diagnostically but feeds confidence as `failed`.

## Level 3 — system tests

System testing uses provider and environment registrations rather than embedding provider-specific payloads into the confidence engine. Providers expose an `adapterKey`; adapters implement the `SystemTestAdapter` trigger/observe boundary. Environments retain stable identity, configuration metadata, and `virtual` or `hardware` type.

A configured Level 3 suite maps `(repository, providerKey, environmentKey, suiteKey)` to `system:<providerKey>:environment:<environmentKey>:suite:<suiteKey>`. Each run is bound to the exact artifact ID and digest plus its BuildRun/repository/commit lineage, provider run ID and retry attempt. Source evidence, when supplied, must be `evidence_type=test` and reference that exact artifact.

Normalized run states are `queued`, `running`, `passed`, `failed`, `timed_out`, `canceled`, and `incomplete`. Only `passed` becomes passing Level 3 evidence; queued/running remain non-passing and all failed/timeout/canceled/incomplete terminal states become failed confidence evidence. Freshness is enforced by the deterministic confidence requirement's `maxAgeMinutes`, so stale passing runs cannot produce Level 3.

### System-test API

- `POST /api/system-tests/providers` — register/update a repository system-test provider and adapter identity.
- `POST /api/system-tests/environments` — register/update virtual or hardware-backed environments and configuration metadata.
- `POST /api/system-tests/configure` — configure required/optional Level 3 provider/environment/suite evidence and freshness.
- `POST /api/system-tests/runs` — record/observe a normalized provider run, including retries and terminal semantics, and recalculate confidence.
- `GET /api/system-tests/runs?artifactId=<id>` — inspect system-test run history and environment identity for an artifact.

## Confidence API

- `POST /api/confidence/configure` — configure a mandatory/optional Level 2 or 3 evidence requirement.
- `POST /api/confidence/evidence` — record normalized artifact evidence state and recalculate confidence.
- `POST /api/confidence/recalculate` — explicitly recalculate one artifact.
- `GET /api/confidence/status?artifactId=<id>` — return deterministic confidence.
- `GET /api/confidence/history?artifactId=<id>` — return the transition audit trail.
