# dsh-memory-semantic

Optional semantic recall for the layered Memory Core. Off unless a Profile declares it; with `mode: off` it attaches nothing.

- `index.mjs` — plugin entry (`attach` is usable without a Host)
- `ranker.mjs` — query-vector cache, ranking, shadow statistics, circuit breaker
- `vector-index.mjs` — rebuildable sidecar index bound to `memoryId / revision / contentHash / modelVersion`
- `provider.mjs`, `worker.mjs` — embedding in a separate process, or a loopback HTTP endpoint
- `models.mjs` — pinned model, file hashes and its similarity floor
- `provision.mjs` — operator tool that installs the runtime and downloads/verifies the model

Architecture, configuration, test results and remaining risks: `docs/SEMANTIC-RECALL.md`.
