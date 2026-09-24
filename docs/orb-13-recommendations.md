# ORB-13: Recommendation workflow and no-cost Demo Mode

## Setup
Merge ORB-12 before ORB-13. Run `npm run db:migrate` with DATABASE_URL configured, then `npm run dev`. Open `/recommendations`, enter the ORBIT operator credentials and an enabled ORBIT repository ID, and click **Create demo recommendations**. The demo button is idempotent per repository and does not call OpenAI. Demo recommendations are synthetic and clearly labeled; they must never be interpreted as measured evidence.

## Product-owner workflow
Load the inbox, accept/reject/defer a recommendation and optionally provide a rationale. Each decision is appended to an immutable audit history; the current status is updated separately. Accepted recommendations can be linked to planned test actions. Record outcomes and nonnegative defect counts on those actions. Only human actions update these workflow tables; no recommendation changes ORBIT confidence levels or deterministic test evidence.

Previously generated ORB-12 recommendations are imported from `ai_recommendation_runs` on inbox load, with idempotent deduplication. Demo Mode works even when the API key is absent or the OpenAI credit balance is zero. The existing `/assistant` live generation endpoint remains separate and may incur API charges.

## Offline evaluation and change governance
`src/lib/recommendation-evaluation.ts` provides deterministic precision, recall and evidence-citation grounding metrics on a versioned benchmark set. Run `npm test` to execute the fixture regression tests without an API key. These tests exercise the scorer, not the quality of an actual LLM. A useful production benchmark must be curated from reviewed historical evidence with approved expected targets and evidence IDs, without leaking future outcomes into inputs.

Before changing a prompt, model or retrieval algorithm:
1. Freeze and version a benchmark dataset with repository/time context and expected component, level and citation IDs.
2. Capture baseline outputs and candidate outputs on the same dataset. Store model name, prompt version, retrieval version, dataset version and evaluation results with the review record.
3. Compare precision, recall and citation-grounding; inspect disagreements and any subgroup regressions. Never treat aggregate metrics as proof that a recommendation is correct.
4. Obtain human approval before rollout. Keep a rollback reference. AI advice remains advisory; do not automatically trigger tests or alter confidence states.

Live model-vs-model comparison requires access to a model provider or previously captured outputs. Demo Mode and deterministic fixtures incur no OpenAI API costs.
