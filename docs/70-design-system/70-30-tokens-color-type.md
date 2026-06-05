---
id: DS-TOKENS
type: design-system
title: "디자인 토큰 — 컬러·타이포·스페이싱"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 49
standards: [WCAG-2.1-AA]
traces:
  satisfies: [NFR-6, NFR-7]
last_updated: 2026-06-05
---

# 디자인 토큰

## 1. 상태 시맨틱 컬러
```yaml
gate:      { PASS: "#1F9D55", PENDING: "#D9822B", FAIL: "#D64545" }
lifecycle: { Proposed:"#8895A7", Approved:"#3B82F6", Developing:"#6366F1",
             Verified:"#0EA5E9", Released:"#1F9D55", Retired:"#6B7280" }
deploy:    { Binary:"#7C3AED", "Policy-only":"#0EA5E9", Calibration:"#D9822B", Manual:"#D64545", TBD:"#9CA3AF" }
severity:  { high:"#D64545", med:"#D9822B", info:"#3B82F6" }
health:    { ok:"#1F9D55(6/6)", warn:"#D9822B(4-5)", bad:"#D64545(<4)" }
brand:     { primary:"#0B5FFF", surface:"#FFFFFF", surface-2:"#F4F6F9", ink:"#1A1F2B" }
```
모든 텍스트/배경 대비 ≥ 4.5:1 (WCAG AA, NFR-7). 다크 테마는 동일 토큰의 dark 변형.

## 2. 타이포
- 한글 본문: Pretendard / Noto Sans KR. 영문·숫자·ID: Inter + monospace(IBM Plex Mono)로 ID 강조.
- 스케일(px): 12·14(본문)·16·20·24·32. 행간 1.5(본문)/1.3(헤딩).

## 3. 스페이싱·radius
- spacing scale: 4·8·12·16·24·32. radius: 6(컨트롤)/10(카드). elevation 3단.

## 4. 아이콘
- 라인 아이콘 세트. 엣지 타입별 글리프(─⇢⊘⤴↩↓⇄≈). 상태 배지 아이콘(✅🟠🔴).
