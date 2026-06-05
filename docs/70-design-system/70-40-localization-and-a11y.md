---
id: DS-L10N-A11Y
type: design-system
title: "현지화 & 접근성 / Localization & Accessibility"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 49
standards: [WCAG-2.1-AA]
traces:
  satisfies: [NFR-6, NFR-7]
last_updated: 2026-06-05
---

# 현지화 & 접근성

## 1. 라벨 정책 (NFR-6)
- 한글 라벨 우선, 기술용어 영문 병기: "영향도 분석 / Impact Analysis".
- ID·코드(FEAT-, API-, GATE-)는 영문 고정·monospace.
- 후속 i18n 키 구조: `screen.SCR-100.title.ko/en`.

## 2. 접근성 (NFR-7, WCAG 2.1 AA)
- 대비 ≥ 4.5:1(본문)/3:1(대형). 상태는 색+아이콘+텍스트 3중(색맹 대응).
- 키보드 전체 조작·포커스 가시·ESC로 패널 닫기·⌘K 팔레트.
- ARIA: 그래프 캔버스 대체 텍스트(노드/엣지 목록), 표 헤더 scope, live region(엔진 진행).
- 파괴적 액션은 키보드만으로 실행 불가(명시 확인 필요).
