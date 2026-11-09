---
id: SCR-300
type: screen
title: "의사결정 화면군 / Decision Screens (G3)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 38
traces:
  satisfies: [FR-17, FR-18, FR-19, FR-20, FR-29]
  implemented_by: [ENG-IMPACT, ENG-VERIFY, ENG-DEPLOY, ENG-SUPPLIER]
  realized_in_screen: [SCR-410]
  verified_by: [TC-017, TC-019]
last_updated: 2026-06-05
---

# 의사결정 화면군 / Decision Screens (G3)

## SCR-300 · Impact Analysis Center (P, S19/S31)
```
┌ 의사결정 ▸ Impact ──────────────────────────────────[Export ⤓][Create CR]┐
│ Change Target: [API-BDC-POLICY-CONTROL▾]  Type: [v1.4→v1.5 Optional add▾]  │
│ [▶ Run Impact]                                       Confidence: ████░ High │
├───────────────────────────────┬────────────────────────────────────────────┤
│ Traversal Graph (path 강조)    │ Impact Summary                              │
│ API──uses_api→FEAT-BDC-001     │ Features 2 · SWCs 1 · ECUs 1 · Suppliers 1 │
│   ├implemented_by→SWC-ADAPTER  │ Tests 3 · Variants 4                        │
│   ├realized_by→SUP-BDC-A       │ Deployment: Policy-only 가능                │
│   └verified_by→3 tests         │ Safety/Security: QM / Sec Medium 재검토     │
└───────────────────────────────┴────────────────────────────────────────────┘
결론: Optional field 추가 → 구조변경 아님 → Policy-only. 3 Test 재실행 + Supplier 호환성.
```
- 컴포넌트: change-target/type picker·Run(`run-engine`)·traversal graph·summary 표·scope filter·confidence·Export·"Create CR from impact"→SCR-410. 상태: pre-run empty·running(progress)·error·partial.

## SCR-310 · Verification Scope (P, S16/S18)
- 입력 Feature 조건 → Mandatory Tests·Missing Evidence·Coverage Gap·Gate Result. "Send to Readiness"(G5).

## SCR-320 · Deployment Decision (P, S16/S20)
- 변경유형 체크 → Binary/Policy-only/Calibration/Manual + Confidence + Required Gates + Rollback Test. Policy-only 근거 4체크 표시.

## SCR-330 · Supplier Scope (P, S18/S32)
- Feature→Supplier Function→SWC/API 경로 → Supplier Scope·Acceptance·Contract Gap·Evidence Status.

## SCR-340 · Decision Center (N, S18)
```
┌ 의사결정 ▸ Decision Center ─ FEAT-BDC-001 / CR-2026-0142 ──────────────┐
│ Pipeline: Change→Lookup→①Impact→②Verify→③Deploy→④Supplier→Report       │
│ [Run ①][Run ②][Run ③][Run ④][Run All ▶]                                │
└──────────────────────────────────────────────────────────────────────┘
```

## SCR-341 · DecisionReport Viewer (N)
- 4 엔진 통합 리포트(①~④ 요약)·[Attach to CR][Export PDF][Submit for Approval].

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S18,S19,S31,S32) |

## ADS file:// 업무 시연 엔진 (2026-11-09)

담당 `taxonomy_static_followup`. ODD 승인, 구성 조합 제안·독립 승인, 보안 최소 버전 제안·독립 승인, 사건 보고 대상 확정, 독립 검토 발견사항, 변경 승인 경로 종결, 적용 장소 요청·승인, 복구 결정, Feature ADS 분류 입력·확정, 시장 기준선, 지원 종료 연습의 15개 쓰기 경로를 실제 브라우저 오버레이 트랜잭션에 연결한다. 기존 native 요청 스키마·역할과 순수 도메인 규칙을 재사용한다. 읽기는 변경된 기록·개정·요약·현재 하한·승격 보류를 다시 계산하며, 성공 모양만 반환하는 경로를 사용하지 않는다. 각 로컬 쓰기는 `LOCAL_SIMULATION` 출처·감사 해시 체인·이벤트·기존 IndexedDB CAS를 사용한다.

캡처된 상태·서명·관측 시각은 불변이다. 원문 전체 차량 형상·복구 후보·현재 HSM epoch가 공개 캡처에 없으므로 새 구성의 차량 부합을 추정하지 않는다. 이전 버전 복구 요청은 차단 사유와 `REVIEW_REQUIRED` 업무 기록으로 보관하며 재활성화 후보가 되지 않는다. Safe State·서비스 등 업무 결정은 저장하되 `vehicleApplicationPerformed:false`를 명시한다. 실제 차량 적용·외부 전송은 이 시연의 실행 대상이 아니다. 지원 종료 연습도 캡처/로컬 검증 회신에 따른 순수 규칙 계산이며 차량을 실행하지 않는다.

시험: ADS 15경로를 포함한 12개 의미 회귀와 P5 화면·ADS 커버리지·Supplier/Gate 영향을 합쳐 47건 통과. 분류 canonical hash·값 변경 후 재확정·시장별 귀속, 보안 하한 상승·재검사·분리 승인, 원문 미캡처 복구 보류, 사건 개정 추가·목록/정기 보고 재평가, 독립 발견사항의 승격 차단, 경로 담당 권한·중복 종결, 지원 연습의 실패 근거 저장, 동시 개정 및 원천 누락 거부를 확인한다. 정기 보고는 원본 월별 시간·거리 노출량을 그대로 두고 확정된 사건 수·비율만 다시 계산한다.

실제 file 브라우저 검증: `1653d2bb`→`a002e0d0`→`b9d6fcc0`의 독립 r3 앱(기준 자료 `251fcf67`, 도구 `1f414eb0`, 원문 SHA `4f6fc1c39049beba005a46474dd5ed6f7237cd0ceb3dee4dcf2ea6d910873be0`)에서 8단계를 통과했다. 분류 입력→독립 확정, 지원 종료 연습, 빈 시장의 첫 기준선, 보안 최소 버전 제안→다른 계정 승인, 구성 조합 제안→다른 계정 승인, 재열기 후 실제 IndexedDB 원장·감사 보존을 확인했다. 분류 확정 hash는 보관 원장에서 꺼낸 값으로 별도 Python canonical JSON/SHA 계산까지 일치했다. 신규 조합의 미캡처 차량 형상은 미확인으로 유지했다. 1366/390 가로 넘침 0, HTTP 요청·JS 오류·file 실패·누락 0. 증거는 키트 `out/ads-functional-browser-20261109-r3/results.json`·PNG, 하네스 `out/verify-ads-functional-file.py`. 사건 정기 보고 후속은 단위 회귀 근거이며 최종 통합 HTML/ZIP의 포괄 브라우저 확인은 통합 담당이 별도로 수행한다.

실제 파일 검증에서 확인한 두 공백도 함께 수정했다. 시장 기준선 전체 GET가 캡처되지 않은 경우 각 native `ClassificationView.baselines`에 담긴 원문 사실을 재사용한다(누락을 빈 목록으로 바꾸지 않음). 법규 담당자는 기존 시장 기준선이 없어도 첫 시장을 입력할 수 있다. 새 로컬 Feature의 빈 분류는 실제 등록 원장의 생성 메타·created 목록이 있는 경우에만 초기화한다.
