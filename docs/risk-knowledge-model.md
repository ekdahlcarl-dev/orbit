# ORBIT risk and knowledge model

ORB-11 uses PostgreSQL as a logical property graph for the MVP. Components are nodes; hierarchy, dependencies, commit/change mappings, tests and features are explicit relation tables. IDs and relationship semantics are deliberately graph-engine neutral so these tables can later be projected into a dedicated graph database without changing ORBIT's domain contract.

## Risk model v1

Risk is deterministic and advisory. It does not alter the official confidence level.

Each signal is normalized to 0–100 and its weighted contribution is returned and persisted:

- churn 18%
- coverage gap 20%
- repeated failures 18%
- flakiness 12%
- defect history 10%
- criticality 12%
- evidence age 10%

The score is the sum of the visible contributions. `component_risk_snapshots.signals` stores the raw normalized signals, weights and contributions, and `model_version` makes historical results reproducible.

## Impact traversal

A commit maps to directly changed components. Reverse dependency traversal then finds components that depend on those changed nodes. Test mappings on the resulting component set provide the affected test/capability set. Recursive SQL uses a visited path and depth bound to remain cycle-safe.

## Extension points

Requirement/feature mappings are optional and can be populated when a source system provides them. Additional risk features can be introduced under a new model version. A future graph engine should consume the same component keys, typed relationships and source identifiers rather than becoming the source of truth for confidence.
