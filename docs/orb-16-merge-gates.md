# ORB-16: confidence merge gates

## Setup

1. Apply migration `017_merge_gates.sql` with `npm run db:migrate`.
2. Give the ORBIT GitHub App **Checks: write** and **Pull requests: read** repository permissions and approve the installation update. Existing Contents/Actions permissions remain necessary. No new webhook subscriptions are needed: the worker discovers open PRs through the authenticated GitHub API.
3. Sign in as an ORBIT admin with a grant for an onboarded repository. Open `/merge-gates`, enter its GitHub repository ID, and save enabled branch patterns and required levels. Example: `develop` requires L2; `main` and `release/*` require L3. `*` matches any characters including `/`. All patterns are anchored; overlapping patterns use the highest level.
4. Enter an **exact target branch**, load policies, and copy its required check name. The stable name is `ORBIT confidence / <sha256 of exact branch name>`. Each branch has its own check to prevent same-commit cross-branch policy confusion. Wildcard ORBIT policies still require a separate GitHub rule/check mapping for each exact target branch.
5. Open a PR to that branch and run the ORBIT worker. Once the check appears, configure a GitHub ruleset or branch protection rule for that branch requiring that exact check, selecting the ORBIT App as its expected source. Enforce the rule, prevent bypass as appropriate, and require the branch to be up to date. ORBIT does not modify protection rules or merge anything.

GitHub references: [Checks API](https://docs.github.com/en/rest/checks/runs) and [required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging).

## Evaluation and audit

The worker refreshes each active, opted-in repository approximately every 30 seconds. It uses the PR's base branch and head SHA, re-evaluates deterministic confidence from source data, and updates the same GitHub check when the decision changes. It selects the latest build for that repository/SHA; that build must have succeeded and every associated immutable artifact must satisfy the requirement. Missing builds/artifacts, fork heads without local repository lineage, missing/unconfigured/failed/pending/running/stale levels, future-dated observations, and mismatched or missing passing source evidence block success. Confidence freshness uses existing repository requirement `maxAgeMinutes` settings.

The check details show the required level, exact SHA, build, artifact digest, and L1/L2/L3 states. `merge_gate_decisions` retains the decision snapshot with artifact/build/evidence references and check ID. Policy changes appear in `github_audit` with actor and before/after values. Authorized viewers can inspect policies and the latest 100 decisions at `GET /api/merge-gates?repositoryId=123&branch=main`. Policy writes use the same-origin, session, admin-role, and repository-grant checks as other configuration endpoints. There is no success override or AI decision input.

Repositories refresh independently; an installation failure cannot roll back another repository's refresh. Network failures retry on the next refresh. Database advisory locking serializes worker refreshes and policy writes. GitHub writes are external side effects: a crash after publication but before database commit may leave a duplicate check; a subsequent refresh creates the authoritative tracked result.

## Manual smoke test

- Save L2 for `develop` and L3 for `main`. Open PRs with the same head SHA targeting each branch. Verify different check names and requirements.
- With no build/evidence, verify a failing check and blocked merge after configuring GitHub's required check.
- Run a successful exact-SHA build with fresh required L1/L2 evidence. Verify automatic L2 success; verify main still fails without L3.
- Complete required L3 evidence for the same immutable artifact; verify main turns green without a manual gate override.
- Add a commit; verify the old SHA's green check does not satisfy the new commit. Build/test the new SHA.
- Configure short evidence freshness, let evidence expire, and verify the worker changes a previously passing check to failure. Submit missing/failed/mismatched evidence and confirm no success.
- Disable one repository's policies and verify other repositories continue refreshing. Remove the disabled repository's required checks from GitHub as part of opting out. ORBIT retains old check results and audit history.
- Verify a viewer cannot save a policy, an admin without a repository grant cannot read/write it, and an authenticated cross-origin policy write is rejected.

## Operational boundaries

GitHub stores check conclusions; they do not expire automatically. Evidence expiry or policy edits take effect on the next successful worker refresh, not atomically with GitHub merge actions. A worker/GitHub outage can leave a previously successful check visible. Monitor worker health and restrict merges operationally during an outage; ORBIT cannot revoke a GitHub result while GitHub is unreachable. This is an asynchronous required-check integration, not a synchronous GitHub pre-merge authorization hook.

Disabling a policy stops new evaluations for it; it does not delete GitHub protection or rewrite historic results. Remove required checks from GitHub when opting out. Fork PRs intentionally fail closed; use a trusted head branch in the onboarded repository for gated builds; automatic fork build dispatch and merge queues are outside this implementation.
