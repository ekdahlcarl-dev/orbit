# ORBIT artifact and evidence ingestion

ORB-5 establishes the immutable identity and provenance boundary used by later confidence levels.

## Artifact identity

Register artifacts with `POST /api/evidence/artifacts`. Identity is `sha256:<digest>`. ORBIT resolves the referenced `BuildRun` and copies its exact repository ID and commit SHA into the artifact lineage. Re-registering the same digest is idempotent only when lineage is identical; a digest presented with different lineage is rejected.

Example body:

```json
{"buildRunId":42,"digestAlgorithm":"sha256","digest":"<64 lowercase hex>","name":"service.tar","mediaType":"application/x-tar","sizeBytes":1234,"storageRef":"s3://orbit-artifacts/..."}
```

The relational database stores metadata and object references, not binary payloads.

## Evidence contract

Ingest with `POST /api/evidence/ingest`. Evidence may reference an artifact digest. When supplied, that artifact must belong to the same `BuildRun`, preventing evidence from being attached to an ambiguous binary.

Supported formats:

- `junit`: JUnit XML test cases normalize to passed/failed/error/skipped results.
- `orbit-json`: versioned JSON with `schemaVersion: "1"` and a non-empty `results` array.

Each normalized evidence record stores source type, SHA-256 digest of the raw report, raw object-storage reference, summary, normalized result metadata and provenance. Re-ingestion of the same source digest/build/artifact is deduplicated.

Invalid JUnit, unknown artifact digests, mismatched artifact/build lineage and other ambiguous evidence are rejected and recorded in `evidence_quarantine` with the reason and raw storage reference when available. Raw reports remain outside relational storage.

## ORBIT JSON v1

```json
{
  "schemaVersion": "1",
  "results": [
    {"name":"lint","status":"passed","durationMs":120},
    {"name":"unit:example","status":"failed","message":"assertion failed"}
  ]
}
```

Allowed result states are `passed`, `failed`, `error`, and `skipped`.

## Verification

Run migrations, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. Migration `004_artifact_evidence.sql` is included in the PostgreSQL integration fixture.