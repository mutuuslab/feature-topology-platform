---
id: SCR-010
type: screen
title: "홈 화면군 / Home Screens (G0)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 35
traces:
  satisfies: [FR-27, NFR-2]
  implemented_by: [ENT-FEATURE]
  realized_in_screen: [SCR-100]
  verified_by: [TC-027]
last_updated: 2026-06-05
---

# 홈 화면군 / Home Screens (G0)

## SCR-000 · 로그인 / Login·SSO (N)
- 현대 IdP SSO + MFA, 테넌트 선택. 페르소나: 전체. 상태: error(인증 실패)/loading.
```
┌──────────────── Feature Topology ────────────────┐
│            [Hyundai SSO 로그인]                    │
│            [MFA 코드 입력 ____]                     │
│            테넌트: [▾]                              │
└───────────────────────────────────────────────────┘
```

## SCR-001 · 온보딩 / Onboarding (N)
- 최초 로그인: 역할 확인 → 프리셋 선택 → 3-step 투어. → SCR-010.

## SCR-010 · 역할별 홈 / Role Home (P, S19/S43)
페르소나별 기본 대시보드. 공통 위젯 + 역할 프리셋.
```
┌ 홈 ▸ 내 대시보드 (운영/P7) ──────────────────────────────────[커스터마이즈 ⚙]┐
│ [Active Features 6][Policy 8/12][Kill Switch 0][Telemetry 98.7%]            │ ← KPI 타일
├───────────────────────────────┬───────────────────────────────────────────┤
│ 내 작업 (My Work)              │ 경고/알림                                   │
│ • CR-2026-0142 승인 대기        │ ⚠ FEAT-CONN-001 Missing Traceability       │
│ • FEAT-SEAT-001 Gate 미통과     │ ❗ 실패율 임계 근접 (FEAT-BDC-001)          │
├───────────────────────────────┴───────────────────────────────────────────┤
│ 핀/최근: FEAT-BDC-001 · Impact Center · Release Readiness                    │
└─────────────────────────────────────────────────────────────────────────────┘
```
- **역할별 프리셋:** 기획→Catalog KPI·Reports / 시스템→Topology 진입 / SW→Decision/ChangeSet / 검증→Readiness·미완 증적 / OTA→Campaign·Policy / 협력사→패키지 상태 / 운영→위 예시.
- 컴포넌트: KPI 타일·My Work 리스트·Alert 피드·핀/최근. 상태: empty(작업 없음)·loading(skeleton)·partial(telemetry stale).
- 텔레메트리: `home_view`(persona), `kpi_tile_click`, `mywork_open`.

## SCR-011 · 홈 커스터마이즈 (N)
- 위젯 드래그·레이아웃 저장(사용자별). `edit` 권한.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S19,S43) |
