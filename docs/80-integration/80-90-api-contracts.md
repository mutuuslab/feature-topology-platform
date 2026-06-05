---
id: INT-API-CONTRACTS
type: integration
title: "Registry REST/Webhook API 계약"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 48
standards: [OpenAPI-3.2.0]
traces:
  satisfies: [FR-25]
  realized_in_screen: [SCR-801]
  verified_by: [TC-025]
last_updated: 2026-06-05
---

# Registry REST/Webhook API 계약 (요약)

OpenAPI 3.2.0 스펙은 구현 단계에서 생성. 핵심 리소스:

```yaml
paths:
  /features:                 { get: list+filter, post: create }
  /features/{id}:            { get, patch }
  /features/{id}/bom:        { get, put(→ChangeSet) }
  /features/{id}/topology:   { get(graph) }
  /edges:                    { post(EQ1~EQ4 검증) }
  /impact:                   { post(change_target,change_type → ENG-IMPACT) }
  /verification-scope:       { post → ENG-VERIFY }
  /deploy-decision:          { post → ENG-DEPLOY }
  /supplier-scope:           { post → ENG-SUPPLIER }
  /readiness/{feature}:      { get(9 Gate) }
  /changesets:               { get, post }
  /webhooks/ingress:         { post(Codebeamer/Unleash/OTA 이벤트) }
  /audit:                    { get(filter) }
auth: { type: oauth2, scopes: [view, edit, approve, deploy, kill, rollback, admin] }
```

## Webhook (inbound)
ALM Requirement 변경·Unleash flag 변경·OTA campaign 상태 → outbox 처리·Sync Log(SCR-810).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 |
