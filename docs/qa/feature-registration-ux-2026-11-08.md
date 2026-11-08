---
id: TC-FEATURE-REGISTRATION-UX-20261108
type: reference
title: Feature 등록 UX 요구·설계와 검증
status: in-review
version: 0.1.0
owner: feature-architect
cycle: 1
last_updated: 2026-11-08
---

# Feature 등록 UX — 요구·설계 판단 (2026-11-08)

사용자 요구: ‘고르기·대표로·포함 추가’의 의미와 등록 절차/작성 항목을 이해하기 쉽게 전면 검토한다. 격리 원천은 `work/harness-uiux-20261108`, 기준 e47f8c09다. 이 기록은 실행 완료 판정과 구분한다.

| 현재 조작 | 실제 저장/기본값 영향 | 새 UI가 설명할 내용 |
| --- | --- | --- |
| 검색 결과의 대표로 | PRIMARY 1개를 지정. 기존 PRIMARY는 연결에서 제거 | 작성 기준 1개. 이름·설명·ASIL·태그·규제 및 자동채움의 기준 |
| 포함 추가 | featureRefs에 INCLUDED 추가 | 같은 Feature의 관련 기준 연결. 별도 Feature 생성/기본값 병합 아님 |
| 포함 행을 대표로 바꾸기 | 선택 행을 PRIMARY로, 기존 PRIMARY는 INCLUDED로 보존 | 교체 후 기존 기준도 관련 연결로 남음 |
| 다음 | 작성 기준으로 폼 채움. 사용자가 이전에 직접 수정한 칸 유지 | 선택 시 저장되지 않으며 기본값을 확인·수정할 수 있음 |
| 등록 | POST /api/features, PROPOSED 0.1.0 생성 | 승인/차량 배포가 아닌 초안 등록 |

근거: frontend propose/prefill.ts choosePicked·makePrimaryPicked·prefillOf, ProposeScreen.tsx toStep2·submit; contracts schemas/api.ts CreateFeatureBody와 schemas/refdb.ts FeatureRefLinkInputs; backend registry/feature-refs.ts resolve·asilDeviationFor 및 registry.service.ts create. 설계 원문은 docs/30-data-model/30-95-feature-reference-db.md §5.3·6이다.

계약: PRIMARY 정확히1개, INCLUDED0개 이상, 중복 ID 금지. 이름·설명·국가·차종·트림·담당·ASIL·기준 연결은 등록 필수다. ASIL 변경은 기존 사유/G2 검토 규칙을 유지한다. 요구사항 연결은 정의 승인 전 필요하며 규제·표준과 별개다. 국가/차종/트림의 미리 채운 값도 저장 전에 검토한다. 역할·원본ID·백엔드·안전 기준은 변경하지 않는다.

선택 전에 역할과 저장 영향을 설명하고 선택 요약을 제공한다. 기준 교체의 제거/보존 차이는 반영 전에 보여준다. 폼을 기능 설명·담당/적용 대상·안전/연결·추가 구성으로 묶고, 저장 전 실제 payload에 해당하는 내용 검토를 제공한다. 취소/뒤로는 입력을 유지하고 POST하지 않는다. 자동 채움 출처표가 필수 입력보다 먼저 길게 나오지 않게 재배치한다.

기존 SUIT/JetBrains와 토큰(--paper #f5f4ef, --surface #fdfcf9, --ink #15171b, --muted #5f5b50, --accent #2747d4)을 유지한다. 왼쪽 정렬의 실제 작성 순서, 넓은 화면 본문+요약, 390px 한 열을 사용한다. 동일한 장식 카드의 반복을 피하고 번호는 실제 단계/작성 순서에만 둔다. 기존 사용자 화면에 맞춰 새 팔레트나 글꼴을 추가하지 않는다.

의미 검증: 선택→폼 기본값→직접 수정→실제 전송 본문, 기준 교체 취소/확인, 저장 전 검토 취소, 필수 범위·ASIL 사유, 중복409 확인. 1366/390 렌더·초점·가로 넘침과 초기297KiB 예산을 별도 확인한다. 문자열만 복제한 시험은 완료 근거로 삼지 않는다. 배포 RC/기존 서버는 건드리지 않는다.

## 사용자 2차 피드백과 검증

사용자가 ‘작성 기준으로 선택’과 ‘관련 기능 추가’의 차이를 이해하기 어렵다고 다시 지적했다. 행동의 결과를 명시해 두 버튼을 ‘기본 정보 가져오기’와 ‘참고로 연결’로 바꾸고, 열 제목은 ‘사용 방법’으로 변경했다. 각 버튼 곁에 ‘이름·설명·ASIL·태그 미리 채움’과 ‘참고 연결만 추가 · 입력값 유지’를 표시한다. 계약의 PRIMARY/INCLUDED, 기능 분해/권한/승인 규칙은 유지한다.

이 개선은 용어 선호를 추정한 결정이 아니라 실제 사용자 피드백에 대한 보정이다. 이전 문구에서의 이해도 개선을 새 문구에서 입증했다고 주장하지 않는다. 향후 사용자 검토는 회귀 시험과 구분한다.

통합 RC에서는 등록·기존 홈/PLE/기준정보와 계정·소유자 후속을 포함한 관련 7파일 80시험 및 frontend/tools 타입·문구 검사가 통과했다. 9475의 1366/390 렌더는 첫 개선안의 증거로 보존하고, 두 번째 문구와 인접 설명은 별도 9479 산출물에서 다시 검토한다. 이 문서의 검증 상태는 실차 적용·원격 계정 제어·기능안전 승인과 구분한다.
