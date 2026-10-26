# Third-party notices

`packages/character-memory-core/tokenize.mjs` is adapted from `src/tokenize.ts` in
[tr1v3r/dsh-ltm](https://github.com/tr1v3r/dsh-ltm/blob/bdc5de489d1f60811232548a5aa3cfd11f20ae49/src/tokenize.ts),
commit `bdc5de489d1f60811232548a5aa3cfd11f20ae49`.
TypeScript annotations were removed for the existing JavaScript package.
The original MIT license is retained in [licenses/dsh-ltm-MIT.txt](licenses/dsh-ltm-MIT.txt).
No other referenced Agent runtime is vendored. DSH and QQ dependencies retain their own licenses.

Worker V2 role names/responsibilities were reviewed against the actual source of
[hu568/dsh-plugin-cluster-preset](https://github.com/hu568/dsh-plugin-cluster-preset/blob/ccc58dc59f39e081c5d7a6ea8e0fb93c38486ff4/cluster.patch.yml),
commit `ccc58dc59f39e081c5d7a6ea8e0fb93c38486ff4` (MIT).
No code or prompt text is copied. Its orchestrator, Team Policy, lifecycle plugin
and older toolFilter/delegation-persona interfaces are not installed or reused.
This project uses short independently written Personas and the installed DSH native APIs.
