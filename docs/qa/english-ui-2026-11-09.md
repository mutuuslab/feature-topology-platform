---
id: TC-ENGLISH-UI-20261109
type: reference
title: English UI rollout and remaining catalogue
status: in-review
version: 0.2.0
owner: feature-architect
cycle: 1
last_updated: 2026-11-09
---

# English UI rollout

The language button now has a reactive UI-copy lookup rather than changing navigation language alone. This checkpoint is partial: **2,590 of 8,821 Korean copy leaves have English entries** across 79 source modules. The complete list of missing paths is [english-copy-coverage.json](english-copy-coverage.json); source expressions and hashes are in [english-copy-inventory.json](english-copy-inventory.json). Neither source coverage nor a language-button state is a claim of full English support.

`localizedCopy` wraps only declared UI copy objects and arrays. English overrides use the exact source export/property path, and functions retain their arguments. There is no global string replacement, DOM translation or translation of server records. User names, written drafts, IDs, enum values, permissions, canonical work-product keys and approval decisions remain unchanged. Untranslated copy falls back to the Korean source and its accessed path is recorded. An unsuccessful lazy load keeps the current language and can be retried; an older request cannot overwrite a newer selection.

English catalogues load only when requested, and only catalogues containing actual translations are in the loader. The existing AppShell language subscribers receive a copy revision, so API screens and permissions consumers rerender without remounting forms or changing query keys. Stored English preference is applied after loading. Loading and failure messages are visible. Static module-level labels and views without a language subscription still need individual render review.

Static route captions, department selectors and demo/SSO role captions now use declared English display metadata. Route paths, RACI, account names, role values and the permission parser remain unchanged. Registration copy and guides, department workspace copy, workflow screen copy, six ADS copy modules, P10 and experiment-analysis copy have English entries. PRD outlines added after a language change use the active language, while an existing outline or draft is preserved. A heading-only outline remains invalid after switching language. Precise and compact quantities, KST timestamps, remaining-time units and cost captions respect the UI language; amount arithmetic, FX conversion and backend UTC values are unchanged.

The inventory follows local constants and shorthand properties, including seven ADS change-path captions and an incident-date formatter that were previously omitted. It counts already localized child exports once. `node tools/ui-locale.ts --scaffold --check` rejects unknown or duplicate translation keys and incompatible function parameters. The current catalogue has none of these errors. This validates copy contracts, not business approval or completeness of dynamic metadata.

To retain the initial bundle limit, master-data and P11 domain copy no longer hangs off the global `ko` object. Its consumers import the same domain objects in their own screen modules. The Feature-summary event listener stays available immediately, while its read-only body, API queries and domain copy load when opened. Copy-factory calls are pure when unused: their only creation side effect is an internal cache. No budget, permission or test-skip limit was raised.

Current validation:

- Frontend types pass after rebuilding this worktree’s own contracts.
- Locale tests cover body and interpolated-copy updates, preserved input identity and draft content, lazy-load failure/retry, cancelled-request races and recorded untranslated paths.
- Latest frontend impact run: **10 files, 133 tests pass**, covering locale, formatting and unchanged business values, Feature summary, registration, PLE, policy, departments, Home and canonical menu behavior. The Home fixture uses the real autofill response shape and leaves unknown application scope blocked. Earlier subsets overlap and are not additive.
- Existing copy, token, spacing and test-hygiene policies pass.
- Latest app-only production build `9551`: initial **287.2/297 KiB**, largest ordinary screen chunk **32.7/40 KiB**. This local budget artifact uses the existing static-data boundary; it is not a new deployment.
- Production Chromium checks at **1366, 768 and 390 px** verify the English reference gate and picker, original Feature DB data, KO/EN changes preserving the same input element and manual draft, and no horizontal overflow. JavaScript errors and request failures are zero. The preview reads the existing 9479 static dataset; it does not write to company APIs or JIRA/codeBeamer. Evidence: `C:/project/2026-09-23_FF_IMP/out/english-wave2-20261109/browser-review.json` and six screenshots. Visual inspection confirms the registered-data language boundary and also shows untranslated shared approval captions still present.

Remaining work includes **6,231 source-copy paths**, dynamic workflow metadata and normative guidance, cached display labels, and API-generated explanatory errors. Shared `ko` copy alone has 1,254 missing paths, including visible definition-approval captions. Static metadata may use an existing English name only for display. Workflow editing stores content by numeric index, so an English view must preserve source array order, lengths, IDs and stored field keys; the raw canonical model and records remain unchanged. New supplier copy from the later P13 integration needs an incremental inventory pass. Final English/Korean multi-role and stakeholder reviews remain required before Publish; the three-width registration review is one bounded checkpoint.
