# Identity & Access / role Presets — experimental foundation

Current main remains single-Owner QQ. These modules are not added to Core, deployed Profiles or the QQ Gateway. Do not open platform admission based on this branch.

## Implemented contracts

QQTK `dsh-identity-access` owns Principal resolution through trusted Host verifiers, immutable local Owner binding, contact grants/expiry, independent bans, revocable Session leases, CAS-like policy epochs and atomic policy/audit snapshots. Expiry is checked at authorization. Persistence failure revokes all leases and makes the instance unavailable until reviewed recovery. No Memory/QQ SDK dependency or second Session manager.

The platform-neutral Role command spec uses the existing Agent I/O command router; Host supplies the actor lease and target references must already identify a verified Principal. No nickname, text role, or raw browser/model identity grants permission. It is not automatically registered in QQ.

Character `rolePresets({owner, publicPersona, legacyOwner})` builds `character`, `character-contact`, `character-guest`. Public Persona must be supplied explicitly. Owner derives the reviewed Creator composition; two minimal Presets only mount Persona plus native Preset-local tool scope. Native `tools.restrict({allow:[]})` and a tool execution guard include inherited and late tools, while ordinary chat remains available. No Worker/Memory/Skills/management plugins are added to minimal Presets. Owner composition and historical definitions are not mutated.

`legacyOwner:true` only emits the old Owner definition for a future audited migration; it is not an authorization alias and must never be offered through unrestricted preset selection.

## Remaining integration — NOT complete

- Gate 2 must run before command dispatch, HITL button/text responses, ordinary input, native Session create/resume and every outbound part.
- Manager must select current authorized Preset and replace/revoke stale-role Sessions; model/preset switching, cold resume and HMR must not bypass it.
- Character Identity currently wraps one manager with a fixed Owner/Preset. Its Memory evidence, historical reminder binding and Outbox authorization cannot be reused for guests. A multi-user integration must preserve the Owner-only view and deny guest Memory explicitly.
- `qq-character` historical Session references need an Owner-only migration/compatibility path. No persisted ID has been changed on this branch.
- Role mutation/expiry cancellation must reach active tools, native HITL, Workers and queued output. An AbortSignal from this service alone does not prove those consumers observe it.

These are project integration tasks, not a proven rc.3 SDK impossibility. No production migration, stranger admission or full multi-user acceptance is claimed.

## Verification

`npm test` includes role builder regression. `tests/role-presets-host.mjs` is a native rc.3 Host probe requiring an isolated Profile containing builder output; it uses a synthetic LLM and synthetic inherited tools. Owner retains native global tool visibility; contact/guest chat completes with no exposed tools, late global tools stay hidden and model-submitted tool calls do not execute. This is not a full Owner Memory/Schedule/Outbox migration or QQ integration test.

QQTK `maintenance/identity-access.test.mjs` covers provider forgery, account separation, stable Principals, grants/revoke/block, expiry, CAS conflict, write failure, capabilities after restart/disposal and Role command authority. Native cold recovery and HMR of the eventual combined integration still require acceptance.
