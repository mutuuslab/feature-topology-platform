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
- Fresh-snapshot `simBusiness` 10 + `simExtMock` 9 + `screensPolicy` 13: **32/32 PASS** after correcting two historical dataset assumptions (multiple conflicts per connector; FFE-15 now maps to a different actual Feature/version). This preserves failed transition audit assertions and exact remaining conflict counts. ExceptionPanel now rejects malformed generic mock/API response shape instead of reading undefined `.length`.
- Unrelated follow-up diagnostics: FleetMap suite fails before tests with shared-junction maplibre worker `?url` Denied; RefdbStatic has old label/button expectations after Feature DB-first registration changes. These are owned by root, not suppressed here.

## Time and publication boundary

Captured native source timestamps are actual native observation time. Browser local execution time is current wall clock. They are never silently aligned or extended. At `validUntil`, key expiry, withdrawal, or a changed Feature/source revision, deployment fails closed. ADS vehicle reports are re-evaluated at current time and may expire sooner. An old public static bundle can therefore stop allowing new deployments after capture expiry; fresh native capture with original signed facts is required. Local Gate re-judgment does not renew native source facts. A new browser-created Feature without captured technical facts also remains blocked; it is not granted fabricated native approval.

No company attachment bytes, private keys, real GitHub token or real company connector were captured. This checkpoint does not change native Gate outcomes, requirements/297 audit budget, or final publication state.

## Integration hunks

- Preserve root `snapshotAc`, `snapshotW` (after vehicles), and `snapshotP11a` (after kills); GX import/call is only next to `snapshotTx` and immediately after `const policies = await save('listPolicies')`.
- Preserve root native `kills.activeForFeature` deployment guard before GX. This branch implements the same actual remaining VIN/category/dependency-scope check in static `gxActiveKills`; root may replace its equivalent local calculation with the newly merged pure helper.
- Source route/controller/service/module, Gate read field, ADS/compliance read getters, contracts schema export, GX modules, engine expiry registration, registry local signing and policy-ops deployment/stage hooks are the explicit scope.
