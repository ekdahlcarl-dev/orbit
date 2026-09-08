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

The confidence engine supports:

- `not-configured` — no enabled mandatory requirement exists for that level.
- `pending` — required evidence is missing or pending.
- `running` — required evaluation is running and no required evidence has failed.
- `failed` — required evidence failed.
- `blocked` — the preceding confidence level has not passed.
- `stale` — passing evidence exceeded its configured maximum age.
- `passed` — all mandatory requirements for that level are fresh and passed.

Missing, stale, pending, running, failed or blocked evidence prevents promotion.

### Recalculation and audit

`recalculateConfidence` rebuilds the assessment from stored repository requirements and stored normalized evidence. The resulting snapshot records artifact/build/repository/commit identity and the requirement/evidence inputs used for Levels 1–3.

Every state or level transition is appended to `confidence_transitions`; `confidence_current` holds only the latest deterministic assessment. Both tables constrain their writer/source marker to `deterministic-engine`.

No confidence API accepts an arbitrary confidence level or state. Inputs may configure evidence requirements or record normalized Level 2/3 evidence state; the official confidence is always recalculated by the engine.

## Level 1 — static analysis

Level 1 is deterministic. An LLM or recommendation layer must never set the official Level 1 state.

### Level 1 states

- `not-configured` — no enabled mandatory static-analysis provider is configured for the repository.
- `pending` — at least one mandatory provider has no result yet or reports a pending gate.
- `running` — no mandatory gate has failed and at least one mandatory provider is actively running.
- `failed` — at least one mandatory quality gate failed.
- `passed` — every enabled mandatory provider passed.

Failure has precedence over running/pending; running has precedence over pending. Optional providers never block Level 1.

### StaticAnalysisResult

A static-analysis result is bound to the exact BuildRun ID, repository ID, commit SHA, provider, source evidence row/digest, normalized gate state, findings metadata and trend/provenance metadata.

The source evidence must have `evidence_type = static_analysis` and belong to the same BuildRun.

### Adapter boundary

Provider-specific payloads implement `StaticAnalysisAdapter` in `src/lib/static-analysis.ts`. ORB-6 ships the first adapter for SonarQube/SonarCloud. Future SARIF or GitHub code-scanning adapters normalize into the same `StaticAnalysisResult` contract.

## Level 2 — component/module tests

Level 2 component evidence is normalized per exact artifact. A suite configuration maps `(repository, componentKey, suiteKey)` to a deterministic Level 2 confidence requirement key: `component:<componentKey>:suite:<suiteKey>`.

Each ingested suite result stores:

- exact artifact, BuildRun, repository and commit lineage,
- source `evidence` row with `evidence_type = test`,
- component and suite identity,
- normalized pending/running/passed/failed/unstable state,
- per-suite test totals,
- coverage metrics and deltas when provided,
- arbitrary trend metadata,
- explicit flaky-test identities and count,
- observation timestamp used by freshness evaluation.

Component evidence must reference the exact artifact, not only its BuildRun. An `unstable` suite is preserved as such in the component-test result but is submitted to the deterministic confidence engine as `failed`; flaky tests therefore remain visible without silently allowing Level 2 promotion.

### Component-test API

- `POST /api/component-tests/configure` — configure a required/optional component suite and mirror it into the Level 2 confidence requirements.
- `POST /api/component-tests/ingest` — normalize one component/module suite, persist coverage/trend/flaky metadata, and immediately recalculate confidence.
- `GET /api/component-tests/results?artifactId=<id>` — inspect normalized component/module evidence for an artifact.

## Confidence API

- `POST /api/confidence/configure` — configure a mandatory/optional Level 2 or 3 evidence requirement, optionally with maximum evidence age.
- `POST /api/confidence/evidence` — record normalized artifact evidence state and immediately recalculate confidence.
- `POST /api/confidence/recalculate` — explicitly recalculate one artifact from persisted evidence/configuration.
- `GET /api/confidence/status?artifactId=<id>` — recalculate and return current deterministic confidence.
- `GET /api/confidence/history?artifactId=<id>` — return the immutable transition audit trail.

Level 1 endpoints remain under `/api/static-analysis/*`.
