---
id: SCR-IA
type: screen
title: "정보구조 & 네비게이션 셸 / IA & Nav Shell"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 34
traces:
  satisfies: [FR-27, NFR-2, NFR-6]
  realized_in_screen: [SCR-010, SCR-A50]
last_updated: 2026-06-05
---

# 정보구조 & 네비게이션 셸 / IA & Nav Shell

## 1. 셸 레이아웃
```
┌──────────────────────────────────────────────────────────────────┐
│ [로고 FT] [Global Search ⌘K ▭▭▭▭]      [🔔 알림][? Help][역할▾][User▾]│ ← 상단바
├────────────────┬───────────────────────────────────────────────────┤
│ 좌측 그룹       │  Breadcrumb: G1 ▸ Catalog ▸ FEAT-BDC-001          │
│ 사이드바 (G0~10)│ ┌──────────────────────────────┬─────────────────┐ │
│ (접이식 그룹)   │ │ 메인 컨텐츠                    │ 컨텍스트 우측패널 │ │
│                │ │                              │ (PAT-RPANEL)    │ │
│                │ │                              │ Quick Actions   │ │
│                │ └──────────────────────────────┴─────────────────┘ │
└────────────────┴───────────────────────────────────────────────────┘
```

## 2. 좌측 사이드바 메뉴 트리 (G0~G10)
```
⌂ G0 홈           내 대시보드 · 내 작업 · 핀/최근
▸ G1 기준정보     Catalog · Feature Definition · Taxonomy · BOM Editor · Artifact/Control Point Catalog · Requirements
▸ G2 관계         Topology Graph · Edge Editor · Metamodel Viewer · Consistency Rule Console
▸ G3 의사결정     Impact · Verification Scope · Deployment Decision · Supplier Scope · Decision Center · DecisionReport
▸ G4 변경관리     CR List/Detail/Wizard · ChangeSet · Baseline Diff · Version Timeline
▸ G5 검증         Test Evidence Manager · Evidence Detail · Release Readiness Center
▸ G6 배포·운영    OTA Campaign · Policy Lifecycle · Ops Dashboard · Telemetry Explorer · Incident · Kill Switch
▸ G7 협력사       Supplier Portal · API Release Package · Supplier Functions
▸ G8 연동         Connector Hub · Connector Detail · Sync Logs
▸ G9 분석·감사    Reports/Analytics · Audit Log · Traceability Matrix · Glossary
⚙ G10 관리자      Users&Roles · Permissions Matrix · Org&Domains · Approval Workflow · Settings · Notifications
─ Footer ─       Glossary · Help · (pre-login) Auth & Onboarding
```

## 3. 하이브리드 역할 적용
- **공통:** 모든 사용자 동일 트리, RBAC로 항목 가시성/읽기전용/편집 제어.
- **프리셋:** 역할별 기본 랜딩·핀 항목 조정([[00-40-personas-and-roles]]).

## 4. 딥링크·검색
- URL에 Feature ID·탭·필터 상태 인코딩: `/feature/FEAT-BDC-001/topology`, `/catalog?domain=Body`.
- ⌘K Command Palette: `feat:FEAT-BDC-001` 점프, "Run Impact" 등 액션(SCR-A50).
- Breadcrumb은 그룹▸항목▸엔티티▸탭 반영.

## 5. 라벨 정책 (NFR-6)
한글 라벨 + 영문 기술용어 병기. ID/코드 영문 고정. 디자인 토큰은 [[70-30-tokens-color-type]].

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (사용자 확정: 좌측 그룹 사이드바·하이브리드·KO+EN) |
