# Worker delegation v1 — evaluation only

Base: Character main 0b6d70b, QQTK main 425f28d; DSH 0.2.2-rc.1.
No runtime policy, lifecycle, Persona, tools, identity or approvals are changed.

12 bilingual tasks, 6 development and 6 held, cover simple, single-analysis,
multiple-specialty, tool/partial failure, missing evidence and cold/resource-bound
recovery. Each contains actual synthetic materials, criteria and a reference
plan. Equivalent distributions use different languages/tasks across splits. The
frozen hash prevents silent corpus edits. Public held fixtures are not a secret
blind benchmark; future real tuning needs fresh independently held tasks.

Three paired conditions: direct Root without delegating; current Root policy
choosing freely; evaluator-specified control plan. A direct answer may legitimately
be correct on analytical tasks; worker rate is not a success metric. The control
plan is one reviewed comparator, not an oracle proving the optimal schedule.
Only control inputs receive it. No mode receives semantic answer rubrics.

```sh
node evaluation/worker-v1/prepare.mjs dev direct
node evaluation/worker-v1/prepare.mjs dev policy
node evaluation/worker-v1/prepare.mjs dev control
node evaluation/worker-v1/prepare.mjs held policy
node evaluation/worker-v1/score.mjs
node evaluation/worker-v1/score.mjs /absolute/path/to/reviewed-run.json
node --test tests/delegation-evaluation.test.mjs
```

Prepare snapshots the real Root policy and built-in Worker personas (including
the optional review specialist), and never connects to a model or executes tools.
Actual experiments must enforce modes using the native Spawn contract in an
isolated Home. Do not bypass native depth, allowlists, scope or approval rules.
No production execution driver is installed by this PR.

## Trace/score contract

Top level `{datasetDigest,targetHost,kind,split,model,settingsDigest,results}`.
Each result `{id,mode,model,settingsDigest,inputDigest,budget,permissions,workers,
tools,verifications,elapsedMs,status,review,usage?,peakRssBytes?}`.
`model` must pin the same model/version across Root and every child; archive
provider route, settings, prompt hashes, seeds/unsupported seed, concurrency and
trial order separately. Run all three conditions for every task; randomize order
and repeat with predeclared seeds. Include cold starts and failed calls. The
same total token/time/tool budget applies to Root plus all children, not per
Worker. Enforce it while executing, not just after receiving output.

`workers` contains actual preset IDs. `tools` records `{id,status:'ok'|'error',
reviewedEffective:boolean}` from native receipts, not prose claims.
`verifications` records `{workerIndex,evidenceRefs}` tied to supplied material or
tool receipt IDs, as externally reviewed evidence of Root checks. Mere presence
does not prove a check was semantically sound. Review is external annotation
`{independent:true,correct:boolean,failureReported:boolean}` against task criteria;
archive raw Host events and reviewer notes. None of these fields supplies Host
authorization, verifies cryptographic provenance or certifies real model use.

The scorer rejects incomplete paired data, input/model/settings/budget/permission
drift, out-of-budget traces, unsupported references and malformed conditions.
Refused runs must be reported, never silently dropped and replaced by successes.
It reports outcome correctness (including correct partial/blocked/needs_input),
unnecessary delegation on simple/missing tasks, rubric-compatible selection,
tool effectiveness, Root verification coverage, failure reporting on non-ok
tasks paired with false failure reports on ok tasks, tokens, p50 wall time and peak RSS. Provider total tokens must include
Root/children/retries. Missing usage/RSS is null. No-cost/no-tool denominators
are null. An `independent` label is not attestation; the scorer always leaves
`realModelQualityValidated:false`.

## Audit and conclusion

Current policy already avoids mandatory Planner use, defines specialist roles,
requires sources and Root verification, treats Worker results as low trust and
reports blocked/needs_input. Native Spawn enforces reviewed preset IDs/depth;
parent communication, late global tool scope, identity and cold recovery already
have native regression coverage. Root verifying semantic claims is primarily a
model behavior; policy text alone does not prove it occurs.

Five new deterministic tests validate split freeze, score arithmetic, deliberate
bad success/verification/tool traces, blanket failure reporting, fairness refusals and reference-plan leakage.
Synthetic perfect traces are scorer unit fixtures, not measured delegation
success rates. No dedicated model credentials were configured; direct/policy/
control success, token cost and latency have not been measured on a real model.
No general defect or superior delegation strategy has been demonstrated. Keep
the current Root/Worker policy; defer quality changes rather than tune the
policy to this small corpus. Existing native two-process Worker tests remain
the engineering lifecycle gate, not semantic-quality certification.
