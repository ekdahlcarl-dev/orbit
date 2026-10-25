# ORB-16 verification report — PR #26

## Authorized defect-fix follow-up

The owner subsequently authorized fixing D1/D2, adding regression tests, and pushing the fixes and this report to PR #26. That authorization does not include merging, remote smoke-test provisioning, or GitHub permission/protection changes.

Both defects are addressed in this follow-up:

- L1 source selection now uses the same latest-per-provider ordering as the confidence assessment, restricted to enabled, required providers. Source lineage is validated after selecting the newest result so invalid retries cannot fall back to older passing evidence. The audit records those selected source rows.
- L2/L3 source validation now joins observations to enabled, required confidence requirements. Optional, disabled, and removed keys cannot veto the gate; required keys retain build/repository/artifact/source-status/future-time checks.
- Two PostgreSQL regression tests cover failed L1 history followed by a passing retry (including timestamp ties), optional/disabled L1 providers, invalid latest required source, wrong latest SHA, optional/disabled/removed L2/L3 observations, re-enabled requirements, missing required evidence, mismatched artifact evidence, and future-dated required evidence. GitHub remains mocked and database fixtures are rolled back.

Local verification: typecheck, lint, and production build PASS. The test suite registers 83 tests: 76 PASS, zero FAIL, seven PostgreSQL-dependent tests SKIPPED. The new database regressions have not run locally because database access remains blocked. Current-head CI validation is pending publication of this follow-up; no old CI result is being attributed to the fix.

**Current recommendation: VERIFICATION INCOMPLETE.** D1/D2 code fixes await current-head PostgreSQL CI evidence; the live App/check/branch-protection tests remain blocked as documented below. PR #26 must remain open and unmerged.

## Original verification baseline

The remainder of this report records the original findings and evidence at `fbe10e7`, before the authorized follow-up. Statements below about unmodified source, uncommitted report, unfixed defects, or absent push authorization describe that baseline, not the follow-up state.

## Executive summary

Verified on 2026-10-25 against `fbe10e75aacccd3b095db534bd989d5377506f82` on `feat/orb-16-merge-gating`.

**Recommendation: NOT READY TO MERGE.** Two reproducible false-failure defects prevent valid confidence from automatically passing the gate. Live GitHub enforcement, App installation approval, and the requested complete smoke sequence remain unverified. Successful CI is not evidence of live branch-protection enforcement.

[PR #26](https://github.com/ekdahlcarl-dev/orbit/pull/26) was open and unmerged when inspected. No source changes, commits, pushes, remote repository/branch/PR creation, protection changes, App permission changes, Linear status updates, deployments, or merges were performed during this verification. This report is a local, uncommitted deliverable.

Critical verification blockers:

- Local PostgreSQL connections fail with `EPERM`; Docker socket access is denied. The database's actual identity, migration state, and suitability for writes cannot be confirmed.
- The development server cannot bind `127.0.0.1:3106` (`listen EPERM`), so browser/HTTP verification is blocked.
- The actual ORBIT App credential probe fails with `EAI_AGAIN` resolving GitHub. Connector access to GitHub is working, but it is a separate identity and does not establish ORBIT App permissions.
- Two dedicated, approved test repositories and their disposable branches/PRs have not been provisioned. Approval was requested; no approval was assumed.
- Two unresolved P2 PR review findings were independently reproduced in an isolated SQL fixture. No fix was applied.

## Environment

| Item | Actual result |
| --- | --- |
| Repository | `ekdahlcarl-dev/orbit`, repository ID `1349364553` |
| Initial branch and tree | `feat/orb-16-merge-gating`; clean working tree |
| Local and PR head | Both `fbe10e75aacccd3b095db534bd989d5377506f82` |
| PR base | `main`, `5d7fbb56efbb22fc30bb6fbcf6903bccc242bc8f` at inspection |
| Runtime configuration | `.env.local` exists; `ORBIT_ENV=development`; DB endpoint `localhost:5433`, database path `/orbit` |
| Credentials | App ID/private key, installation allowlist, webhook secret, OAuth credentials, auth secret, and public URL are present. Values were not printed or included here. Presence is not validity. |
| Database | Read-only connection probe failed `EPERM`; IPv4 retry also failed `EPERM`. No database writes or migration command executed. |
| Docker | Installed; socket access denied. No reset, container removal, or volume changes attempted. No local PostgreSQL client/server binary was found at the inspected standard paths. |
| Migration 017 locally | SQL inspected; application to this development database is BLOCKED, not asserted successful. |
| Migration 017 in CI | Applied and migration replay passed in historical run 105 for this exact PR head. |
| Application | `npm run dev -- -H 127.0.0.1 -p 3106` attempted; server failed to bind. A zero process exit code did not override the explicit startup error. |
| Health | Direct invocation of the real health route returned HTTP response object status 503 and `{"status":"unhealthy","service":"orbit","database":false}`. This was not an HTTP request to a running server. |
| Worker | Not started against the configured database: DB safety/state cannot be verified and it can publish remote checks or process existing shared jobs. Actual startup and 30-second refresh timing are BLOCKED. |
| GitHub App | Signed, read-only `/app` and approved-installation metadata probe attempted; DNS failed before permission/installation responses. No permission result inferred from connector permissions. |
| Test repositories | None designated or changed. Connector can list `lab`, `fyllefisken`, and `orbit`; none was assumed disposable. |
| Linear | Live ORB-16 issue and acceptance criteria retrieved. Shared agent-context lookup was unavailable (`Tool get_agent_context not found`); this did not prevent issue retrieval. |

The local settings suggest development, but a settings label and loopback hostname do not prove which database a forwarded endpoint serves. Consequently `npm run db:migrate` was deliberately not executed against an unverified target. Safe recovery attempts did not overcome the host's access restrictions.

### Reviewed migration objects

`db/migrations/017_merge_gates.sql` defines:

- `github_repositories.merge_gate_refresh_at`.
- `merge_gate_policies`, primary key `(repository_id, branch_pattern)`; required level constrained to 1–3.
- `merge_gate_checks`, primary key `(repository_id, target_branch, commit_sha)`.
- `merge_gate_decisions`, with `merge_gate_history(repository_id, commit_sha, created_at)` index.
- `merge_gate_decisions_immutable`, rejecting UPDATE/DELETE/TRUNCATE through the earlier `reject_audit_mutation()` function.

Primary keys imply their PostgreSQL indexes; catalog existence on the local database was not verified. CI migration execution and the database integration test provide separate automated evidence, not local catalog inspection.

## Evidence register and automated checks

| ID | Evidence | Result and scope |
| --- | --- | --- |
| E01 | `git status --short`, `git branch --show-current`, local HEAD and live PR metadata | Initial tree clean; expected branch and exact PR SHA; PR open/unmerged. |
| E02 | `npm test`, current verification run | 81 registered tests: 76 PASS, 0 FAIL, 5 SKIPPED because `DATABASE_URL` was intentionally not supplied to tests against the unreachable/unverified development DB. Log: `/tmp/orb16-verification-tests.log`. |
| E03 | `npm run typecheck`; `npm run lint`; `npm run build` | All PASS in this verification. Build log: `/tmp/orb16-verification/build.log`. These do not prove a working application process. |
| E04 | [CI run 105](https://github.com/ekdahlcarl-dev/orbit/actions/runs/40200899237), quality job `121191672084` | Exact PR head: migration 017 and replay PASS; all 81 tests PASS, 0 skipped; typecheck/lint/build PASS. Security and devcontainer jobs also PASS. Historical CI evidence, not a newly triggered run. |
| E05 | Real `GET`/`POST` merge-gate handlers with isolated session/role/grant database fixtures | Seven response assertions PASS; no configuration writes. Actual session, RBAC, same-origin, and route functions run; only database responses are simulated. No real OAuth/browser/session database used. Harness/log: `/tmp/orb16-verification/security.cjs`, `security.log`. |
| E06 | Unmodified lineage SELECT extracted from `src/lib/merge-gates.ts`, executed with SQLite in-memory fixtures | Valid baseline accepted; historical L1 failure, optional observation, and disabled observation falsely rejected. Mismatched L1 SHA, mismatched L2 source artifact, future L2 timestamp, and missing source rejected. This tests predicate behavior, not PostgreSQL execution or live check publication. Harness/log: `/tmp/orb16-verification/lineage.py`, `lineage.log`. |
| E07 | Actual `evaluateConfiguredLevel()` invocation with a valid required observation and optional source-less observation | Returns `passed`; contrasts with E06's gate rejection. Existing confidence tests also verify cumulative levels and freshness. |
| E08 | Development DB/App/server probes and direct health-handler invocation | DB `EPERM` twice; Docker permission denied; App DNS `EAI_AGAIN`; server `listen EPERM`; direct health 503. No credentials exposed in captured output. |
| E09 | Live PR reviews, threads, and issue comments | Two unresolved P2 findings at the current head; no approving human review observed. Review summary reports findings, not approval. |
| E10 | Actual `mergeGateCheckName()` calls | Stable, different exact-target names below. Computed locally, not published live. |

### Existing coverage and gaps

Reviewed implementation: `src/lib/merge-gates.ts`, `src/lib/confidence.ts`, `src/lib/static-analysis.ts`, GitHub client/security code, `src/worker/index.ts`, merge-gate API/UI, auth/session/RBAC guards, logger, migration 017, integration/unit tests, startup scripts, and `docs/orb-16-merge-gates.md`.

Existing unit tests cover strongest matching branch requirement, disabled policy filtering, exact-target check names, non-passing confidence states, strict configuration input, mocked check creation/update, missing-build failure, deduplication, and independence after one repository API failure.

The PostgreSQL merge-gate test uses one repository, one branch, and mocked GitHub. It covers a successful L3 snapshot, stale L3, absent source evidence, recovery, a newer queued build, policy opt-out, and immutable decision history. It directly inserts normalized data and even reuses one static-analysis evidence record for confidence observations; it does not generate real L2 component or L3 system-test reports through provider adapters. Existing broader security tests validate RBAC/OAuth paths but do not specifically exercise all merge-gate routes with real PostgreSQL sessions. E05 adds local handler coverage without editing repository tests.

Missing coverage includes failed-L1-then-successful-retry, optional/disabled observation exclusion, two repositories with PostgreSQL-backed opt-out and continuing B updates, two branch policies on one live SHA, genuine build→artifact→L1/L2/L3 ingestion→worker→GitHub flow, elapsed worker freshness refresh, policy/worker concurrency, database failure after successful publication, duplicate-check reconciliation, fork and merge-queue integration, and live ruleset enforcement including bypass settings.

## Test results

Overall results below apply to the requested complete tests; automated subsets are explicitly identified.

| Test | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Branch policies | BLOCKED live; PASS local subset | E02, E10 | Pattern precedence, disabled entries, strict input and different exact-branch names verified. No live policy writes or same-SHA test PRs created. |
| Missing evidence | BLOCKED live; PASS automated subset | E02, E04 | Mock worker publishes `failure` for a missing build. Actual required-check merge blocking not exercised. |
| L2 promotion | FAIL for identified valid-input edge cases; BLOCKED live | E06–E07, E09 | Historical L1 failures or irrelevant observations can veto valid L2. No genuine build/evidence/live develop promotion executed. |
| L3 promotion | FAIL for the same gate-wide edge cases; BLOCKED live | E04, E06–E07 | CI proves synthetic normalized L3 promotion with mocked GitHub. Real system-test adapter and live main update not exercised. |
| SHA integrity | BLOCKED live; PASS predicate/client subset | E02, E06 | Exact head SHA in mocked check creation and rejection of mismatched L1 SHA verified. No new remote feature commit or GitHub enforcement test. |
| Evidence freshness | BLOCKED elapsed/live; PASS automated subset | E02, E04, E06 | CI detects stale L3 and newer queued build. Predicates reject mismatched artifact, future timestamp and missing source. No measured worker polling interval. |
| Repository isolation | BLOCKED live; PASS mock subset | E02, E04 | Repository failure isolation mocked; one-repository opt-out covered in CI. No actual two-repository opt-out sequence. |
| Security | BLOCKED live; PASS handler subset | E02, E04, E05 | Viewer/ungranted-admin/cross-origin/anonymous denial verified with actual handlers and isolated DB responses. Logger redaction test passes; no exhaustive live credential/log audit claimed. |

### Computed check names

These are actual output from the implementation, not observed GitHub check runs:

```text
main:
ORBIT confidence / 0d6e4079e36703ebd37c00722f5891d28b0e2811dc114b129215123adcce3605

develop:
ORBIT confidence / 947726dd6318753268f3bfbe5e87ae2afe220db399c26e119c181a59227b0c60
```

### Authorization observations

E05 returned:

| Request | Actual status |
| --- | --- |
| Viewer policy POST | 403 |
| Admin without repository grant, GET | 403 |
| Admin without repository grant, POST | 403 |
| Authenticated cross-origin POST | 403 |
| Anonymous GET | 401 |
| Anonymous same-origin valid-body POST | 401 |
| Authorized viewer GET | 200 |

The harness observed zero unexpected/configuration-write database operations. Response bodies did not contain its synthetic session value or `token_hash`. The existing logger test verifies removal of test bearer fields and error details; the direct health probe logged only a safe error category/code. Actual App token responses and production logs were not retrieved.

## Linear acceptance criteria

Source: live [ORB-16](https://linear.app/labcalle76se/issue/ORB-16/wp16-github-merge-gating-using-orbit-confidence-levels). No issue status changed.

| Criterion | Result | Actual evidence and remaining work |
| --- | --- | --- |
| 1. Repository/branch-specific chosen policies | BLOCKED | E02 proves selection logic; E04 proves one database policy. Full multi-repository/two-branch configuration not executed live. |
| 2. GitHub check tied to exact SHA | BLOCKED | E02 mocks POST with exact SHA; actual ORBIT App publication not executed. |
| 3. Ruleset/branch protection enforces check | BLOCKED | No authorized dedicated test rule or live denied-merge evidence. Documentation is not an enforcement test. |
| 4. Below required confidence does not pass | BLOCKED | E02/E04/E06 verify automated failures; no actual GitHub merge-gate run observed. |
| 5. Reaching required level automatically passes | FAIL | E06/E07 reproduce two valid-input vetoes consistent with unresolved PR review findings. E04 covers only the simpler happy path. |
| 6. Stale/mismatched evidence cannot satisfy gate | BLOCKED | E04 verifies stale L3; E06 exercises mismatch/future/source predicates. Live worker revocation and GitHub result remain unverified. |
| 7. Different repositories/branches isolated | BLOCKED | E02 verifies policy matching and mock repository failure isolation. Full two-repository/two-branch flow outstanding. |
| 8. Opt-out affects only chosen repository | BLOCKED | E04 covers one-repository opt-out; continued live repository-B checks not executed. |
| 9. Auditable decisions and evidence lineage | BLOCKED | E04 verifies decision snapshot IDs and immutable history. Real GitHub check→build→artifact→provider-evidence trace not observed; duplicate-publication window remains. |
| 10. Deterministic enforcement without AI override | PASS — automated/static scope | E02 rejects override fields and enforces contiguous passed levels; reviewed refresh path calls deterministic recomputation and has no AI decision input. AI code is read-only advisory. No live adversarial AI test claimed. |

## Defects

### D1 — Historical failed L1 evidence vetoes a successful retry

**Severity:** Medium/P2; functional merge blocker. Location: `src/lib/merge-gates.ts:70–71`. Corresponding [unresolved review comment](https://github.com/ekdahlcarl-dev/orbit/pull/26#discussion_r4371122424).

Reproduction:

1. Use a successful build and immutable artifact with valid required evidence.
2. For a required static-analysis provider, retain an older failed result whose source evidence has status `failed`.
3. Add a later passed result for that provider with valid passed source evidence.
4. `getLevel1Assessment()` selects the latest provider result and returns `passed`.
5. Execute the gate lineage SELECT: its unrestricted historical scan still returns the older failed source, making the artifact fail.

E06 actual output: `latestRequiredL1="passed"`, `requiredL2States=[["passed"]]`, `gateRejectsLineage=true`. Baseline without the historical failure returns false. SQLite executed the unmodified SELECT; a new PostgreSQL regression is still required before accepting a fix.

**Root cause:** Gate validation scans every static-analysis result for the build, whereas confidence uses the latest result of each enabled, required provider. Disabled/optional provider history can also veto confidence.

**Proposed fix (not implemented):** Reuse or explicitly select the exact latest required-provider source rows used by the L1 assessment. Audit those selected rows. Add regressions for fail→pass retries, optional providers, disabled providers, and invalid latest required evidence. Preserve strict SHA/build lineage checks.

### D2 — Optional or disabled observations veto valid required confidence

**Severity:** Medium/P2; functional merge blocker. Location: `src/lib/merge-gates.ts:66–69`. Corresponding [unresolved review comment](https://github.com/ekdahlcarl-dev/orbit/pull/26#discussion_r4371122426).

Reproduction:

1. Configure a valid required L2 key and record matching passed source evidence.
2. Retain a passed observation for another key with NULL `evidence_id`; make that key optional or disabled.
3. The confidence evaluator ignores that key and returns `passed` (E07).
4. The gate scans all passed observations at/below the requirement and rejects NULL source evidence from the irrelevant key (E06).

Both optional and disabled variants reproduced. No database or GitHub state was changed.

**Root cause:** Lineage validation does not join observations to enabled, required confidence requirements.

**Proposed fix (not implemented):** Restrict validation to enabled, required keys contributing to the current decision. Test optional, disabled and removed keys, while proving a missing/mismatched source for a required key still blocks. Apply the same selection discipline to snapshots used for audit.

Approval is required before changing application source or pushing either fix. Neither finding demonstrates unauthorized success; both prevent legitimate automatic promotion and should be fixed before merge.

## Operational risks

| Risk | Assessment and recommendation |
| --- | --- |
| Asynchronous refresh | SQL schedules next refresh 30 seconds after transaction `now()` and worker polls every 2 seconds by default. API latency, repository count, locks and worker iteration time prevent a strict 30-second guarantee. Actual elapsed timing NOT TESTED. UI's “within 30 seconds” is stronger than the documented approximation. |
| Previously successful result during outage | High enforcement limitation: a stale successful GitHub result cannot be revoked while worker/GitHub is unavailable. Explicit risk acceptance and operational merge freeze/health monitoring are needed; this run does not establish acceptance. |
| GitHub API failures | Per-repository savepoint/catch schedules retry. E02 verifies failure isolation with mocks. A prior green result may remain; API fault behavior and recovery not tested live. |
| Database transaction failure | HTTP publication occurs before the tracking/audit commit. A later rollback can leave GitHub changed while DB audit/check tracking is absent. No atomic transaction spans both systems. Live fault injection NOT TESTED; recommend durable publication intent/outbox and reconciliation design. |
| Duplicate publication | Crash/retry can create multiple same-name checks because creation is not reconciled by remote external identity. The documentation's authoritative-result claim needs an actual duplicate-check enforcement test; do not assume GitHub resolves duplicates in the intended way. |
| Fork PRs | Code intentionally declines evidence lookup when the head repository differs. No trusted fork-promotion path is implemented. Remote fork-check creation may fail when the commit is unavailable in the base repository. No live test. |
| Wildcard policies | Matching uses anchored `*` patterns and strongest level. GitHub still needs the exact target-specific hashed check in its rule; one wildcard rule cannot simply substitute an arbitrary branch's check name. Operational mapping remains manual. |
| Ruleset bypass | Require the expected ORBIT App source, correct target branch and no inappropriate bypass. Administrative bypass and actual rules not inspected or changed for any test repository. No enforcement PASS possible. |
| Merge queue | Worker only lists open PR head SHAs; it does not evaluate merge-group SHAs. Merge-queue support is absent, as documented. Do not claim this integration supports queues. |
| Audit immutability | Trigger and CI test protect normal DML; database owner/DDL privileges remain a separate trusted boundary. Runtime grants on new tables need review in the deployment environment. |
| Test completeness | Current green CI misses D1/D2 and uses synthetic evidence plus mocked GitHub. Green CI alone is insufficient to authorize merge. |

GitHub references checked during review: [Checks API](https://docs.github.com/en/rest/checks/runs) for exact-SHA creation and required Checks write permission; [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) for required checks and bypass behavior. No live enforcement result is inferred from those documents.

## Required approvals and continuation plan

### Test resources — proposed, not executed

An approval request was presented for dedicated disposable repositories:

| Resource | Proposed changes |
| --- | --- |
| `ekdahlcarl-dev/orbit-gate-smoke-a` | Create dedicated repository; branches `main`, `develop`, `feature/orb-16-smoke-test`; feature→main and feature→develop PRs sharing exactly one head SHA. |
| `ekdahlcarl-dev/orbit-gate-smoke-b` | Same isolated setup for repository independence and opt-out. |
| Runtime fixtures | On verified non-production DB only: onboard authorized test repositories, dedicated role/grant/session fixtures, policies develop=L2/main=L3, then real exact-SHA build/artifact/evidence ingestion. Preserve existing data. |

No test repository IDs, PR numbers or head SHAs are recorded because those resources do not yet exist. The only recorded live repository/PR is ORBIT/26, which is the implementation under review, not a smoke-test fixture. Existing repositories can be substituted only after the owner identifies them as disposable test targets.

Once named resources and App identity are confirmed, prepare an exact protection payload for separate approval: exact-target required hashed check; expected ORBIT App ID; required up-to-date branch/PR; explicitly reviewed bypass list. No rule on `ekdahlcarl-dev/orbit` is proposed.

### App permissions — inspect before proposing any change

Actual installation approval status is BLOCKED. The required configuration is Checks=write, Pull requests=read, Contents=read, Actions=write (plus metadata read), matching client token requests. If any permission or installation repository selection is missing, present its exact before/after change for owner approval; do not change permissions speculatively.

### Environment and startup

Run from a host that can connect to PostgreSQL, bind a development port and reach GitHub. Verify database identity and development ownership first. Then use actual repository commands:

```bash
set -a
source .env.local
set +a
npm run db:migrate
npm run dev -- -p 3001
```

In a separate terminal, after reviewing the development database's onboarded repositories and queued jobs to prevent unapproved remote writes:

```bash
set -a
source .env.local
set +a
npm run worker
```

Alternatively `npm run dev:all` starts Docker PostgreSQL, applies migrations, and launches both services on the configured/default port 3001. It was not used here because Docker is inaccessible and automatically starting the shared worker before reviewing DB state would be unsafe. Environment loading must not echo secrets.

After approvals and access are available, execute all eight requested live tests, record repository IDs/PR numbers/exact SHAs/check IDs and timestamps, capture required-check merge blocking without merging, test genuine component/system evidence ingestion, measure expiry/retry cadence, and restore freshness configuration. Record opt-out's required-check removal separately and obtain approval before any such protection change. No freshness settings were changed in this run, so nothing required restoration.

## Final recommendation

**NOT READY TO MERGE.** Fix and regression-test D1/D2 with approval, then complete the blocked live App/check/protection verification. Resolve the documented stale-green and duplicate-publication risks explicitly before treating this as enforceable merge gating. Do not merge PR #26 or enable auto-merge. This report does not authorize source fixes, remote test provisioning, pushes, permission changes, or merging.
