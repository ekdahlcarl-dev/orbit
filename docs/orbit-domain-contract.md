# ORBIT domain contract

## Level 1 — static analysis

Level 1 is deterministic. An LLM or recommendation layer must never set the official Level 1 state.

### States

- `not-configured` — no enabled mandatory static-analysis provider is configured for the repository.
- `pending` — at least one mandatory provider has no result yet or reports a pending gate.
- `running` — no mandatory gate has failed and at least one mandatory provider is actively running.
- `failed` — at least one mandatory quality gate failed.
- `passed` — every enabled mandatory provider passed.

Failure has precedence over running/pending; running has precedence over pending. Optional providers never block Level 1.

### StaticAnalysisResult

A static-analysis result is bound to:

- exact `BuildRun` ID,
- exact repository ID,
- exact commit SHA,
- provider name,
- source `evidence` row,
- source evidence digest,
- normalized gate state,
- findings metadata,
- trend/provenance metadata.

The source evidence must have `evidence_type = static_analysis` and belong to the same BuildRun. This preserves the chain:

`Level 1 assessment -> normalized static result -> raw evidence reference -> BuildRun -> commit/repository`.

### Adapter boundary

Provider-specific payloads implement `StaticAnalysisAdapter` in `src/lib/static-analysis.ts`. ORB-6 ships the first adapter for SonarQube/SonarCloud. Future SARIF or GitHub code-scanning adapters must normalize into the same `StaticAnalysisResult` contract rather than altering Level 1 calculation.

### API

- `POST /api/static-analysis/configure` — configure a provider as required/optional and enabled/disabled for a repository.
- `POST /api/static-analysis/sonar` — ingest a Sonar quality-gate result referencing already-ingested static-analysis evidence.
- `GET /api/static-analysis/level-1?buildRunId=<id>` — return deterministic Level 1 status and mandatory-provider states.
