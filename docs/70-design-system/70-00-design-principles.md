---
id: DS-PRINCIPLES
type: design-system
title: "디자인 원칙 & 네비셸 / Principles & Nav Shell"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 49
standards: [WCAG-2.1-AA]
traces:
  satisfies: [NFR-6, NFR-7, FR-27]
  realized_in_screen: [SCR-IA]
last_updated: 2026-06-05
---

# 디자인 원칙 & 네비게이션 셸

## 1. 원칙
1. **데이터 밀도 우선** — 엔지니어링 레지스트리: 표·그래프·상태를 한 화면에 효율 배치.
2. **상태 일관성** — Lifecycle/Gate/Deploy/Health/Severity 색·아이콘 전역 통일.
3. **Feature ID 중심** — 모든 화면 딥링크·breadcrumb·검색이 Feature ID 기준.
4. **판단 보조** — Quick Actions·Confidence·근거(Evidence) 항상 가까이.
5. **안전한 파괴적 액션** — Kill/Rollback은 type-to-confirm + verb gate.
6. **KO-primary + EN term** — 한글 라벨, 기술용어/ID 영문.

## 2. 네비셸 규격
- 좌측 사이드바 폭 260px(접이 64px) · 상단바 56px · 우측 컨텍스트 패널 360px(슬라이드).
- 그리드 12-col, gutter 16px, 컨텐츠 max 1440px.

## 관련
토큰 [[70-30-tokens-color-type]] · 컴포넌트 [[70-20-components]] · 라벨 [[70-40-localization-labels]] · 접근성 [[70-50-accessibility-states]].
