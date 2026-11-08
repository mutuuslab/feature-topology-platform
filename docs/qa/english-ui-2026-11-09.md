---
id: TC-ENGLISH-UI-20261109
type: reference
title: English UI rollout and remaining catalogue
status: in-review
version: 0.1.0
owner: feature-architect
cycle: 1
last_updated: 2026-11-09
---

# English UI rollout

The language button now has a reactive UI-copy lookup rather than changing navigation language alone. This checkpoint is partial: **386 of 8,801 Korean copy leaves have English entries** across 78 source modules. The complete list of missing paths is [english-copy-coverage.json](english-copy-coverage.json); source expressions and hashes are in [english-copy-inventory.json](english-copy-inventory.json). Neither source coverage nor a language-button state is a claim of full English support.

`localizedCopy` wraps only declared UI copy objects and arrays. English overrides use the exact source export/property path, and functions retain their arguments. There is no global string replacement, DOM translation or translation of server records. User names, written drafts, IDs, enum values, permissions, canonical work-product keys and approval decisions remain unchanged. Untranslated copy falls back to the Korean source and its accessed path is recorded. An unsuccessful lazy load keeps the current language and can be retried; an older request cannot overwrite a newer selection.

English catalogues load only when requested, and only catalogues containing actual translations are in the loader. The existing AppShell language subscribers receive a copy revision, so API screens and permissions consumers rerender without remounting forms or changing query keys. Stored English preference is applied after loading. Loading and failure messages are visible. Static module-level labels and views without a language subscription still need individual render review.

To retain the initial bundle limit, master-data and P11 domain copy no longer hangs off the global `ko` object. Its consumers import the same domain objects in their own screen modules. The Feature-summary event listener stays available immediately, while its read-only body, API queries and domain copy load when opened. Copy-factory calls are pure when unused: their only creation side effect is an internal cache. No budget, permission or test-skip limit was raised.

Current validation:

- Frontend types pass after rebuilding this worktree’s own contracts.
- Locale tests cover body and interpolated-copy updates, preserved input identity and draft content, lazy-load failure/retry, cancelled-request races and recorded untranslated paths.
- Final frontend impact run: **8 files, 118 tests pass**, covering locale, Feature summary, registration, PLE, policy, departments, Home and canonical menu behavior. The Home fixture uses the real autofill response shape and leaves unknown application scope blocked. Earlier subsets overlap and are not additive.
- Existing copy, token, spacing and test-hygiene policies pass.
- Final app-only production build `9544`: initial **286.7/297 KiB**, largest ordinary screen chunk **32.7/40 KiB**. This local budget artifact uses the existing static-data boundary; it is not a new deployment.

Remaining work includes all ledger paths, static department/workflow metadata and normative guidance, cached display labels, and API-generated explanatory errors. Static metadata may use an existing English name only for display. Work-product content strings also serve as canonical editing keys, so the raw model and stored keys must not be translated. New supplier copy from the later P13 integration needs an incremental inventory pass. Final English/Korean multi-role, mobile, draft-preservation and stakeholder reviews are still required before Publish.
