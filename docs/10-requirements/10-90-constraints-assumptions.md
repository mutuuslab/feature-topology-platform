---
id: REQ-CONSTRAINTS
type: requirement
title: "제약 & 전제 / Constraints & Assumptions"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 6
last_updated: 2026-06-05
---

# 제약 & 전제 / Constraints & Assumptions

## 제약 (Constraints)
| C | 내용 | 근거 |
|---|---|---|
| C-1 | ALM/PLM/FF/OTA를 **대체하지 않고 연동**한다 | [[00-10-scope-and-non-goals]] |
| C-2 | BOM은 원천 데이터를 **복제하지 않고 ID·링크만** 보유 | PPT S10 설계원칙 |
| C-3 | Released 상태에서만 **Production ON** | PPT S26 |
| C-4 | Runtime Control Feature는 **Safe Default + Rollback Plan 필수** | RULE-R04/R05 |
| C-5 | Feature Flag 도구(Unleash)는 **ASIL 미인증 → QM 도메인 한정** | standards-register |
| C-6 | 개발 서버 포트 **9001**, **8000 사용 금지** | 전역 개발 규칙 |
| C-7 | 안전(ASIL)/보안 영향 Feature는 **추가 승인 게이트** 통과 | RULE-R08/R09, ISO 26262/21434 |

## 전제 (Assumptions)
| A | 내용 | 위험/검증 |
|---|---|---|
| A-1 | Feature ID가 전 조직 공통 Key로 합의된다 | 미합의 시 통합 효과 저하 — 거버넌스 선결 |
| A-2 | Codebeamer/PLM/Unleash/OTA가 REST/Webhook/ReqIF 제공 | 연동 가능성 사이클 47에서 확인 |
| A-3 | 정량 기대효과(95%↓ 등)는 **가설** | PoC/Baseline 실측 필요(PPT S34) |
| A-4 | RxSWIN·SUMS 증적 요건이 배포 Gate에 반영되어야 함 | UNECE R156 — 사이클 33 |

## 미해결 (Open Questions) — 후속 결정
1. 멀티 테넌시/조직 분리 수준?
2. 안전(ASIL) Feature의 승인자 체인 구체 정의(SCR-A20)?
3. 그래프 저장소 1차(Apache AGE) → 대안 B(Neo4j) 전환 임계점?

---
출처/근거: PPT S10,S26,S34,S38 · 사용자 확정 · 표준 register.
