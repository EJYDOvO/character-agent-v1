# Memory formation v1 — evaluation only

Base: Character main 0b6d70b, QQTK main 425f28d; target DSH 0.2.2-rc.1.
No runtime, Persona, schema, authorization or persistence changes.

## Frozen experiment

16 bilingual cases, 8 development and 8 held, paired distributions: preference,
negation, temporary facts, quoted third-party statements, correction, withdrawal,
relationship and self. Each case contains dated events from separate Sessions,
atomic semantic judgments and lifecycle checks. Both splits are hash-pinned in
tests. Held cases are public reproducibility fixtures, not secret blind samples;
a future quality campaign should commission a fresh externally held corpus.
Never tune on held results or edit expectations to make a strategy pass.

`prepare.mjs` emits model inputs without answer rubrics and loads the current
runtime extraction/consolidation prompts, rather than maintaining a competing
prompt. It performs no network requests and does not execute a model. A model
driver must use an isolated Home, feed events through a trusted fixture ingress,
and obtain consolidation inputs/IDs from the real store. Do not use dataset JSON
as production identity evidence. Freeze model version, settings, policy digest,
clock, seeds (or record unsupported), budget and trial count before collecting
responses; record all dev/held failures and all revisions. Compare variants on
the same cases and settings, including unchanged, regressed and refused cases.

## Commands

```sh
node evaluation/memory-v1/prepare.mjs dev > /tmp/memory-input-dev.json
node evaluation/memory-v1/prepare.mjs held > /tmp/memory-input-held.json
node evaluation/memory-v1/score.mjs
node evaluation/memory-v1/score.mjs /absolute/path/to/reviewed-run.json
node --test tests/formation-evaluation.test.mjs
```

On Windows choose an absolute writable scratch path instead of `/tmp`.
No credentials are read by these commands. Run artifacts stay outside Git.

Run schema: `{datasetDigest,targetHost,kind,split,results}`. `kind` is
`recorded-model` or `deterministic-fixture`. Each result is
`{id,predictions,review,usage?}`. Predictions contain `{factId|null,
meaningPreserved:boolean,unsupported:boolean,sources:[{eventId,quote}]}`.
Review contains `{independent:true,conflictDetected:boolean}`. A separate,
preferably blinded reviewer aligns paraphrases with rubric facts and judges
negation/time, attribution, overgeneralization and unsupported inference. These
are external annotations, not exact-string semantic rules or model self-grading.
An `independent` field is an assertion by the experiment owner, not attestation.
Archive raw responses, Host trace hashes and reviewer decisions for audit.

Precision counts unique correct aligned facts; duplicates count as extra false
positives. Recall divides by expected facts. Unsupported inference and duplicates
divide by all predictions. Source correctness checks event identity plus literal
quote, not semantic entailment. Conflict recall covers correction/withdrawal
cases. Empty denominators are null. Missing/duplicate cases, wrong dataset or
self-reviewed entries refuse scoring. Provider `{inputTokens,outputTokens,
provenance:'provider'}` is required for complete token totals; absent or estimated
usage is null, never zero. Include extraction, consolidation, retries and failed
calls in that aggregate. Do not compare costs of different workloads/coverage.

The scorer always leaves `realModelQualityValidated:false`: parsed provenance
labels cannot certify a real provider invocation or trustworthy judgment. A
separate report must establish that evidence before making quality claims.

## What was actually tested

Five new deterministic tests cover score arithmetic and counterexamples, incomplete
runs, rubric leakage, and actual Memory core replay on both splits. The replay
uses literal synthetic candidate responses, not a model; verifies inference stays
uncertain, original sources trace across Sessions, forged handles/CAS fail and
forgotten records disappear. It does not claim extraction accuracy. Existing
tests retain consolidation support counts, expiry/conflict, personality lanes,
mode/Agent ACL, retirement and restart guarantees.

Audit: current extraction requires literal quotes; consolidation requires 2–8
distinct grounded events, checks policy/evidence fingerprints around generation,
uses savepoints, preserves inference and invalidates forgotten evidence. These
checks do not establish semantic truth, correct temporal interpretation or
synonym identity. No dedicated evaluation provider credentials were configured;
real precision/recall/inference/duplicate/conflict rates and token cost remain
unmeasured. There is no evidence of a general quality gain from changing the
current strategy, so no extraction/consolidation/filter change is proposed.
