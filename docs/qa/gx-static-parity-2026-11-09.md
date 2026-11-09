---
id: TC-GX-STATIC-PARITY-2026-11-09
type: reference
title: "GX static parity release checkpoint — 2026-11-09"
status: in-review
version: 0.1.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
---

# GX static parity release checkpoint — 2026-11-09

Base: independent `work/gx-static-20261109`, `feat/gx-static-20261109`, root `339ce7d0`. Later root AC/W/P11a changes must be preserved at integration. This is a source checkpoint; final integrated Publish is owned by root.

## Implemented

- Connected the existing GX lazy handler and snapshot helper. Exception creation, independent two-person approval, bounded activation, revocation, per-policy applications, expiry rollback/stop and trusted Gate completion now operate in the browser overlay. Source absence is an error, not an empty-success fallback.
- `GET /api/policies/:id/exception-sources` (`policyExceptionSources`) provides only public technical read facts with exact policy revision/content hash, Feature/version facts, observation time, source digest and a 24-hour validity limit. Existing native deployment/approval predicates remain unchanged. Existing Gate GET gains `decisionRecord`; existing `pkiKeys` is reused.
- Signed bytes include `schema: ff-gx-deploy-sources/1`; actual Gate approval uses `ffp-gate-decision/1`. Real browser WebCrypto verifies canonical payload, Ed25519 signature, key fingerprint/purpose/status/expiry, target/revision/digest and freshness. A signed facts envelope cannot replace a Gate approval. A `SIGNED` label without bytes is insufficient.
- New local Gate decisions use real Ed25519 and a separate `SIM-GATE-*` namespace bound to this overlay version, with `LOCAL_SIMULATION` source. They cannot shadow native key IDs or satisfy another purpose. Private local keys stay in this browser overlay. Other pre-existing demo publication signatures were not upgraded or presented as HSM signatures.
- Static deployment re-evaluates COMPLIANCE_RULE, FLAG_CODE and ADS_PUBLISH facts using shared rules, then release Gate/unsigned evidence, applies only valid two-person exceptions and the minimum cap. Partial restore/dependency Feature scope and commercial kill categories are distinguished. Missing kill source is never empty scope. Stop at 0% remains available without GX evidence.
- Explicit expiry preflights are restricted to named GX/policy/runtime/software routes. Normal GET readers stay pure; nested reads do not recursively run preflights; the existing serial queue, binary dispatch and CAS store are retained. Clean expiry checks do not persist or invalidate queries, avoiding refetch loops.
- Reproduced native multi-exception defect: completing one Gate exception set all `exceptionScope` to null, discarding a still-active stricter BYPASS. Native and static now remove only the completed ID, retain the minimum remaining cap and leave other application records intact for later revoke/expiry rollback.

## Executed validation

- Native: `exception-policy`, `exception-gate-trust`, new `exception-multiple-cap`: **28/28 PASS**. The new native regression first failed with `exceptionScope:null`, then passed after the targeted fix; it also verifies remaining BYPASS revocation stops the policy at 0%.
- Native real HTTP: new `exception-read-sources`: **1/1 PASS**, verifies source/Gate signatures with the returned actual public keys, schema substitution fails, native policy unchanged, unknown policy 404.
- Frontend: GX actual WebCrypto 21 cases plus explicit expiry/serial/reload 2, existing policy operations/engine/registry/software: **78/78 PASS**. After the no-op preflight optimization, its 2 focused cases passed again. Tests cover all three check types: clean facts, refusal, limited waiver, duplicate approver refusal and unwaivable corrupted Gate signature; missing/revoked/expired/wrong-purpose keys, altered signature/schema/Feature/revision/digest, stale/latest Gate record, browser key namespace/version, missing source, cap/stop and multi-exception expiry.
- Existing policy-ops fixture was explicitly upgraded **in test-only code** with real signatures and known-empty exception/compliance/code/ADS facts; production has no such fallback. Existing SW tests explicitly supply their known-empty exception list.
- Own contracts build, frontend typecheck, native `tsconfig.build.json`, static Vite production build passed. Full backend tsconfig includes pre-existing unrelated test/config errors (ModuleRef abstract type and `import.meta` in vitest config); production source build passed.
- Real Chromium two-tab IndexedDB CAS **PASS**: another tab commits first; stale expiry transaction is refused; after refresh the external entity remains and the new expiry transaction commits at revision 2. Source modules were served by own Vite dev server 9611; this is actual browser storage, separate from the production bundle check. Unit environment has no IndexedDB; a proposed CAS unit assertion was removed after it demonstrated only memory fallback.
- Actual native snapshot capture completed (base 7,902 responses plus F2/F3/hero additions; local-PC leak scan 0). Production static bundle r2 on own preview 9612: ff login, GX exception list with current/expired/pending/rejected records, **page errors 0**. `out/gx-browser-20261109/results.json` and screenshot hold the evidence. Integrated final Publish remains root's gate.
- Extended production browser flow **PASS**: create real local EXC-00005 against captured synthetic Feature 3.3.0; quality first approval; same-approver button disabled; independent opslead second approval reaches ACTIVE; browser clock advances six minutes beyond the explicitly shortened approval expiry; reload preserves EXPIRED history in IndexedDB. Desktop and mobile 390 screenshot inspected; mobile page overflow 0, page errors 0. Creation verifies the captured raw native Gate signatures in real WebCrypto. Browser automation initially used a nonexistent `fsm` persona and was corrected to actual `quality`; only the final successful run is counted.
- Visual review uncovered an actual existing UI defect: an ACTIVE exception required a revoke reason but displayed no input (the input existed only in the pending approval panel). Added the existing translated reason field to the active revoke panel. Seven exception UI tests pass, including a new real POST assertion with English-switch draft preservation. This UI-only repair uses existing copy; native/static separation and reason guards remain.
- Final production bundle r3 on own preview 9613 includes the repair: the actual ACTIVE captured synthetic EXC-00002 was opened, the reason entered, and the real browser-local revoke POST reached REVOKED with history/rollback message; **page errors 0**. It also repeated the full create/two-approval/expiry/CAS/mobile sequence successfully. No native company state was changed.
- Fresh-snapshot `simBusiness` 10 + `simExtMock` 9 + `screensPolicy` 13: **32/32 PASS** after correcting two historical dataset assumptions (multiple conflicts per connector; FFE-15 now maps to a different actual Feature/version). This preserves failed transition audit assertions and exact remaining conflict counts. ExceptionPanel now rejects malformed generic mock/API response shape instead of reading undefined `.length`.
- Unrelated follow-up diagnostics: FleetMap suite fails before tests with shared-junction maplibre worker `?url` Denied; RefdbStatic has old label/button expectations after Feature DB-first registration changes. These are owned by root, not suppressed here.

## Time and publication boundary

Captured native source timestamps are actual native observation time. Browser local execution time is current wall clock. They are never silently aligned or extended. At `validUntil`, captured key expiry/withdrawal, or a changed Feature/source revision, deployment fails closed. A fully offline capture cannot learn future native key withdrawals until the source is refreshed; it does not claim live PKI revocation awareness. ADS vehicle reports are re-evaluated at current time and may expire sooner. An old public static bundle can therefore stop allowing new deployments after capture expiry; fresh native capture with original signed facts is required. Local Gate re-judgment does not renew native source facts. A new browser-created Feature without captured technical facts also remains blocked; it is not granted fabricated native approval.

No company attachment bytes, private keys, real GitHub token or real company connector were captured. This checkpoint does not change native Gate outcomes, requirements/297 audit budget, or final publication state.

## Integration hunks

- Preserve root `snapshotAc`, `snapshotW` (after vehicles), and `snapshotP11a` (after kills); GX import/call is only next to `snapshotTx` and immediately after `const policies = await save('listPolicies')`.
- Preserve root native `kills.activeForFeature` deployment guard before GX. This branch implements the same actual remaining VIN/category/dependency-scope check in static `gxActiveKills`; root may replace its equivalent local calculation with the newly merged pure helper.
- Source route/controller/service/module, Gate read field, ADS/compliance read getters, contracts schema export, GX modules, engine expiry registration, registry local signing and policy-ops deployment/stage hooks are the explicit scope.

# Workflow geometry release gate — 2026-11-09

The unchanged total-crossings quality ratchet (`<=250`) failed at 281 after the expanded workflow/GX model. The release candidate now measures **245**, with all 18 `layoutProblems` arrays empty. FPW.7 fell from 105 to 76. No edge/node was hidden or removed and the assertion threshold remains 250.

The canonical changes are limited to **FPW.3/FPW.4 input display order** and **FPW.7 activity/input display order** in `docs/65-workflows/model/processes/*.yaml`. Each original activity object, input/output set, RACI, action, screen, next dependency and work product is preserved. The first activity is preserved. The unowned diagram end marker can change its visual lane when the final listed independent branch changes; no activity's responsible lane changes. FPW.7 retains 49 raw nodes and 62 raw edges (55 rendered plus the same seven pre-existing hidden dependency edges).

The existing deterministic layout optimizer now also tests lane insertion and document positions in existing process columns, nearest first, for dense diagrams. Search is bounded to two passes and accepts only strictly fewer actual routed crossings with `layoutProblems(candidate).length===0`. Input/output lanes stay pinned. Dependencies, RACI, visible edge membership and shape count are unchanged. Unproductive three-lane rotations and extra passes were removed; the smaller final implementation still measures 245.

The YAML was regenerated through the actual source pipeline: `python scripts/build_json.py`, then `node --experimental-strip-types FF/tools/workflow-sync.ts`. The generated JSON/TS is included; it is not edited independently. Regeneration also updates derived department/navigation/assignment display ordering, so integration must preserve root's newer common/reference/English sources and regenerate from the merged YAML.

Executed evidence:

- `python -I scripts/wf_model.py`: **OK — 18 processes, 127 activities, warnings 0**.
- `workflow-sync.ts --check`: **PASS**.
- Frontend production typecheck: **PASS**.
- `procedureFlowLayout.test.ts`: **184/184 PASS** after canonical generation; final smaller search measured the same 245 and all geometry invariants empty, followed by the same regression gate.
- Source semantic comparison normalizes only activity display order and input/output list order. All other YAML fields compare equal. Graph comparison preserves all original node/edge IDs and fields except the non-activity end marker's placement lane.
- Exact final per-process crossing counts: `13,8,4,6,8,2,76,37,3,9,16,28,8,7,8,5,7,0` for FPW.1–18.

Probe/order experiments are isolated in kit `out/gx-*` and are not source dependencies or committed runtime artifacts. Failed intermediate candidates were not reported as passing or included in the final result.

## Ordinary read command barrier — 2026-11-10

`simCall` previously awaited the entire ordinary GET inside the command queue. A pending source fetch therefore prevented a later command from committing. It also selected the overlay before entering that queue, so a reset queued ahead of the GET could leave that GET reading the old overlay.

The barrier now selects the current overlay, runs only the existing explicitly registered expiry transactions, and takes one `structuredClone`. The ordinary reader and every nested `ctx.read` then compute from that same request-local copy outside the queue. Writes, binary download receipts, scheduled tasks, CAS storage revisions, actor/body checks, signatures and approval rules retain their original serialized transactions. Aborted ordinary reads are rejected before admission, at the barrier and before returning; their signals never cancel the shared source-fetch cache.

Purity review found that workflow snapshot hydration caches captured cases/history in its supplied read context. This cache now stays in the request copy; the existing command wrapper independently hydrates before writing, preserving original artifacts/history and optimistic versions. The copied state consists of browser overlay records, audit/events and metadata/JWKs. The 80k captured source files and separate IndexedDB binary bytes are not copied. Each concurrent read owns its overlay copy until completion, so large browser overlays still incur proportional allocation and synchronous copy cost; this change does not make synchronous JavaScript computations parallel.

Executed evidence on isolated branch based on `70bbccd08e4156d7431406c1b739d73baaf90e23`:

- New engine regressions: **7/7 PASS**. These cover a command committing while a GET waits, stable nested reads across that write, waiting for a preceding commit, reset selecting the new overlay, expiry committing once, cancellation admission/barrier checks, shared source fetch survival, and binary download serialization.
- The unchanged pre-fix engine was restored in the isolated worktree (`git diff --exit-code` confirmed HEAD source) and the two new queue/reset cases actually **failed 2/2**. The fixed engine was restored byte-for-byte afterward. Valid baseline evidence is `out/sim-read-snapshot-baseline-r2.log`; the earlier r1 comparison did not switch source because of a local write permission error and is not baseline evidence.
- Full engine plus GX preflight/trust and workflow snapshot/transfer/execution suites: **6 files / 60 PASS**. Workflow captured-source reads, original artifact revisions, role separation and stale-version refusal remain covered.
- Own contracts build and frontend production typecheck: **PASS**.
- The first binary regression fixture lacked the mandatory exception source and correctly failed closed. Its final fixture explicitly declares a captured empty exception list and retains the real expiry preflight; no source guard was bypassed.

The existing UI five-second acceptance limits and test skips were not changed. Final two-worker business/policy browser verification and the exact integrated release CI remain integration work; these unit results do not claim that those browser gates already pass.

