---
id: SCR-A01
type: screen
title: "분석·감사 & 관리자 & 공통 패턴 / Insights, Admin & Patterns (G9, G10)"
status: draft
version: 0.1.0
owner: governance
cycle: 43
traces:
  satisfies: [FR-24, NFR-2, NFR-7]
  implemented_by: []
  realized_in_screen: [SCR-910]
  verified_by: [TC-024]
last_updated: 2026-06-05
---

# 분석·감사 & 관리자 & 공통 패턴

## G9 분석·감사
### SCR-900 · Reports / Analytics (P, S27/S34)
- 정량효과 대시보드: Before/After(영향도·검증누락·배포·중복·Binary OTA), 추세. 목표치 표기(가설).
### SCR-910 · Audit Log Explorer (P, S17)
- 불변 감사 추적: actor·time·action·target·before/after·reason. 필터·Export. R156 증적.
### SCR-920 · Glossary (P, S30)
- 검색형 용어집([[glossary]] 렌더).

## G10 관리자
### SCR-A00 · Users & Roles / SCR-A01 · Permissions Matrix (N)
```
┌ 관리자 ▸ Permissions Matrix ──────────────────────────────────[Save][Audit]┐
│ Role\Verb │view│create│edit│approve│run-eng│deploy│kill│rollback│admin│      │
│ 기획 P1    │ ✅ │  ✅  │ ✅ │  −   │  ✅  │  −  │ − │   −   │  − │      │
│ SW P3      │ ✅ │  ✅  │ ✅ │  −   │  ✅  │ ✅* │ − │  ✅   │  − │      │
│ OTA P5     │ ✅ │  −   │ ✅ │  −   │  ✅  │ ✅  │✅ │  ✅   │  − │      │
│ 운영 P7    │ ✅ │  −   │ − │  −   │  ✅  │  −  │✅ │  ✅   │  − │      │
│ Admin      │ ✅ │  ✅  │ ✅ │ ✅   │  ✅  │ ✅  │✅ │  ✅   │ ✅ │      │
│ *domain-scoped · 검증 P4 approve=Verification Gate only                     │
└─────────────────────────────────────────────────────────────────────────────┘
```
### SCR-A10 Org&Domains · SCR-A20 Approval Workflow(ASIL escalation) · SCR-A30 Settings · SCR-A40 Notifications · SCR-A50 Global Search/Command Palette(⌘K)

## 공통 패턴 (PAT-*) — 전 화면 적용
| PAT | 정의 |
|---|---|
| PAT-EMPTY | first-use/no-results/no-data CTA |
| PAT-LOAD | skeleton·engine-running progress(traversal/step) |
| PAT-ERROR | 4xx/5xx·engine/sync 실패 retry |
| PAT-NOPERM | verb 부재 시 버튼 비활성+툴팁("권한 필요: <verb>") |
| PAT-RPANEL | 우측 슬라이드오버(미리보기/quick-edit, ESC/pin) |
| PAT-QA | Quick Actions: Run Impact·Derive Verification·Deployment Decision·Create CR (Feature ID 컨텍스트, verb gated) |

## 크로스스크린 규약
- 상태/색 어휘 통일(Lifecycle 6·Gate 3·Deploy 5·Health n/6·Severity). 딥링크 by Feature ID. 저장뷰·대량작업(verb+확인).
- 접근성 WCAG AA(NFR-7): 대비·키보드·ARIA·포커스.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S17,S27,S30,S34) |
