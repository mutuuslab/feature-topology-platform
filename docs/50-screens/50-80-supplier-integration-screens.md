---
id: SCR-710
type: screen
title: "협력사 & 연동 화면군 / Supplier & Integration (G7, G8)"
status: draft
version: 0.1.0
owner: supplier-liaison
cycle: 42
traces:
  satisfies: [FR-26, FR-20, FR-25]
  implemented_by: [INT-SUPPLIER-PKG, INT-CODEBEAMER, INT-UNLEASH, ENT-SUPPLIERFUNCTION]
  realized_in_screen: [SCR-330, SCR-510]
  verified_by: [TC-026, TC-025]
last_updated: 2026-06-05
---

# 협력사 & 연동 화면군 / Supplier & Integration

## SCR-700 · Supplier Portal (N)
- 협력사 전용 워크스페이스(RBAC 외부 스코프): 담당 Feature·패키지 상태·요청. Supplier SSO.

## SCR-710 · API Release Package Intake (P, S32)
```
┌ 협력사 ▸ API Release Package ─ SUP-BDC-A / BDC_FUNC_032 ──────────[+ Upload]┐
│ 10-Item Checklist                        Mapped: FEAT-BDC-001              │
│ 1 API Contract ✅  2 Human Doc ✅  3 Feature Mapping ✅  4 Capability ✅     │
│ 5 Variant Compat 🟠  6 Diagnostics ✅  7 Safety/Sec ✅  8 SDK/Mock ✅        │
│ 9 Test Evidence 🟠(cov 78%)  10 Release Note ✅                            │
├────────────────────────────────────────────────────────────────────────────┤
│ Supplier Gate(⑥): 🟠 2 incomplete → 불통과  [Validate][Run Supplier Engine] │
└────────────────────────────────────────────────────────────────────────────┘
```
- 10항목 검증(OpenAPI 3.2)·매핑(Supplier↔OEM)·Supplier Gate(G6) 연동.

## SCR-711 · Package Detail (N)
- 단일 패키지: 10항목 상세·gate 상태·매핑 경로(Feature→Function→SWC→ECU→API→Test→Acceptance).

## SCR-800 · Connector Hub (P, S38)
- 커넥터 카드: Codebeamer·PLM·Unleash·OTA·MQTT — 상태(연결/오류)·last sync.

## SCR-801 · Connector Detail (N)
- REST/Webhook 설정·필드 매핑·인증·동기화 주기·충돌 해소 정책.

## SCR-810 · Sync Logs (N)
- 양방향 sync 이력·conflict·재시도(outbox). Audit 연계.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S32,S38) |
