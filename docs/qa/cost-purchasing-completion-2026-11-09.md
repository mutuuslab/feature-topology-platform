---
id: TC-COST-PURCHASING-20261109
type: reference
title: Feature DB 기반 개발비·구매 검토 구현 및 로컬 HTML 검증
status: in-review
version: 1.0.0
owner: verification-safety
cycle: 1
last_updated: 2026-11-09
---

# Feature DB 기반 개발비·구매 검토

비용 산정과 구매 6명 Needs 05/12/13/15/21/23을 기존 D07 산정 과제 안의 구매 검토 기능으로 연결했다. 회사 계약 체결·지급, 실제 외부 서비스와 실차 SW 적용은 이번 실행 범위가 아니다. 품질 3명·개발 8명 원문과 개별 회사의 계약·견적 본문을 시연 패키지에 자동 복제하지 않는다. 사용자 명시 workbook의 기준 정보와 별도 표시한 공개 합성 예시만 사용했다.

기존 [초기 검토](cost-db-first-review-2026-11-09.md)의 별도 보류·브라우저 미완 기록을 대체하는 후속 증거다. 실제 실행 원천을 구분하며 전체 플랫폼의 미구현 항목이 모두 없어졌다는 판정은 하지 않는다.

## 구현

기준 행 검색 → 발행·출처·포함/제외 확인 → 실제 등록 Feature 선택 연결 → 과제명·대상 자동 채움 → 산정 순서다. 미등록 기준 행도 가짜 Feature 없이 사용한다. 선택 원천은 KEK 봉인 개정으로 보존하고, 기준 변경은 실제 영향 과제 링크에서 원천 갱신·재산정으로 연결한다. 선택 수량과 일부만 작성된 별도 비용의 결측을 0으로 계산하지 않는다. 완전히 비어 있는 미선택 별도 비용 행은 계산 대상으로 삼지 않는다.

| Needs | 검토 유형 | 실제 기능·차단 |
|---|---|---|
| 05 | SCOPE | 공급사·지역 독립 기록, 요구·작업·시험/규격/사양/표본의 동등 범위 비교. 인증 수·보고서명만으로 동등성을 인정하지 않음 |
| 12 | TUNING | 실제 작업·기준 유형 구분, 공수/단가 단위와 환산 원천. 신규 로직에 파라미터 기준 적용 차단 |
| 13 | CHANGE | 변경 전 승인·변경 요구·작업·수행·청구·계약 포함 여부·인정 제안. 중복 청구/기존 계약 중복 인정/통화·세금 혼합 거부 |
| 15 | QUOTE | 요구↔작업 다대다 연결과 작업 1회 합산, 누락 시험/명시 면제, 별도비·라이선스 과금/차종/파생/유지보수/재사용 Terms |
| 21 | PRICE | 원계약 가격 모델·고정비·대당가·귀속/회수/물량/기간, 인상 요인·잔차·물량별 총액. 협상 단가에서 고정비 역산 없음 |
| 23 | MCU | 같은 ECU 전체 배정, 부품/로열티/이식/검증/착수, 공통비 1회 합산, 물량별 총액/손익분기/비재무 제약. 누락 ECU·공통비 충돌은 미확정 |

구매 검토는 DRAFT → SUBMITTED → APPROVED이며 실제 입력에 참여한 모든 사람을 작성자로 취급한다. 다른 기술 검토자의 의견과 필요한 Terms 근거 확인을 거쳐 별도 COST_APPROVER가 승인한다. Terms 확인은 회사의 법무·계약 승인을 대신하지 않는다. 산정 원천 변경·동시 수정·원문 SHA 불일치·미확정 입력을 거부한다. 승인 개정은 보존하고 개정 후 다시 검토한다. 인계 상태는 PREPARED / NO_EXTERNAL_PAYMENT이며 승인 원문 지문을 포함한 실제 JSON 파일을 다운로드한다.

같은 규칙을 native SQLite/SecretVault와 file 브라우저 IndexedDB/CAS에서 사용한다. native는 개정별 KEK 봉인과 AAD/문서 SHA를 검증한다. 브라우저 자료는 로컬 시연이며 회사의 인증 저장소로 표시하지 않는다. 업로드 원문은 실제 바이트/SHA를 저장·재검증한다. 자동 입력은 실제 선택된 Feature DB·연결 요구·원천과 계산 가능한 항목으로 제한하고 공급사 숫자를 임의로 확정하지 않는다.

## 원천 대조·보완 데이터

지정 workbook과 저장소 원본 SHA-256: `7d22d08a1f5406f18eb44b9acc9a4605e0eb1d3cb232a821c8629f9e9fe0d244`. 원본 저장·수정·재계산 없음. `tools/cost/audit-source.ts` 대조 결과 비용 기준 26영역 및 기준 행 1,052개의 직접비 필드 4개(benchmarkEur/kearneyNote/makeBuyVolume/makeBuyPremium) 차이 0이다.

source251 원본 캡처에는 신규 비용 기준 API가 없어 `tools/cost/offline-references.mjs`로 같은 workbook의 v1.3 비용 기준과 캡처 v1.4 공개 행 정보를 결합한 별도 JSON 1,052개를 만들었다. 파생 자료를 회사 승인 단가나 공급사 견적으로 표시하지 않는다. 원본 raw 파일·서명 수정 0이며 보완 자료의 records/원천 SHA/전체 트리 SHA를 별도 manifest로 검증한다. 일반 raw와 같은 데이터라고 혼합 표기하지 않는다.

보완 r2 생성 원천 `30581e71`, sourceDirty=false. 트리 SHA `83ad505e7c1d8fd80f6ec37e399bca2390f5607e5b66740b7f9442f1d6082937`. 입력 디렉터리는 키트 `out/cost-completion-reference-supplement-r2`, 계보 파일은 `out/cost-completion-reference-supplement-r2.manifest.json`이다. 원본 aggregate `4f6fc1c39049beba005a46474dd5ed6f7237cd0ceb3dee4dcf2ea6d910873be0`는 보존됐다.

## 실제 검증

- contracts 구매 규칙·기존 engine·Excel golden: 3파일 53/53 PASS. 마지막 1건은 지원 소수 정밀도를 넘는 가격/물량 곱을 미확정으로 두고 완료를 차단하는 경계이며, 10개 실제 브라우저 실행 뒤 추가한 최소 규칙 보완이다. 기존 지원 범위 계산은 불변이다.
- native 실제 SQLite/KEK/Audit 및 Feature DB→과제→독립 승인→기준 변경→입력 보존 재산정→재승인: 2파일 7/7 PASS. HTTP/TCP 서버 기동 없음. 봉인·AAD·키 교체·과거 개정 불변·자기 승인 거부 포함.
- frontend 산정/구매/Feature DB 회귀: 5파일 59/59 PASS. 프런트·백엔드 타입 PASS. 원시 색·간격/반경·신규 UI 하드코딩 문구 0. 기존 cost lead를 70자 안으로 정정했다.
- 업무 모델: FPW.15-A08, WP-COST-PURCHASING, BP8 및 Feature DB 우선 A01/A03을 실제 ROUTES에 연결. 모델 오류0/경고0, IAM 오프라인 차이0, 생성 문서59, pytest7 PASS. IAM은 기존 HTTP 캡처 메타를 보존하면서 실제 IamService와 같은 contracts.permissions에서 파생한 `offlineDerivation`을 구분했다. 새 서버 조회로 보고하지 않는다. 영어 workflow metadata 1842개 누락0, 출처 지문 MATCH.

실제 file 패키지는 **frontend 280fee4b / dirty=false**, 원본 application capture 251fcf67, capture tool 1f414eb0이다. 키트 `out/cost-completion-file-r2/FeaturePlatform/index.html`을 일반 Playwright Chromium으로 직접 열고 context.offline=true로 실행했다. 특별한 file 접근 플래그·서버·포트 없음.

`out/cost-completion-browser-r4/results.json`: 9/9 PASS. Feature DB 먼저 선택/자동 과제명/실제 Feature 선택 연결, 여섯 검토의 실제 화면 작성·저장·다른 실제 계정 기술 의견(PRICE는 Terms)·독립 비용 승인·PREPARED 실제 파일 다운로드를 실행했다. Python에서 승인 content SHA와 첨부 바이트 SHA를 독립 계산했고, 각 승인 기록은 새로고침 뒤에도 보존됐다. KO→EN→KO 입력·유형 보존과 1366/390 화면을 확인했다. JS0/HTTP0/실제 file 실패0이며 하네스가 시작한 화면 이동의 취소 1건은 별도 기록했다.

`out/cost-completion-boundary-r1/results.json`: 추가 1/1 PASS. 같은 실제 브라우저 과제의 수량을 비워 계산 불가임을 확인한 뒤 2로 변경했다. 오래된 기준의 인계를 거부하고 개정·기준 재확인·독립 기술 의견·별도 재승인·새 인계까지 실행했다. 입력 보존, 새 기준/승인 지문, 과거 승인 문서 불변을 실제 파일로 대조했다. 전체 검토 화면 1366/390 넘침0, JS0/HTTP0/file 실패0이다. 원문·개인정보 없이 합성 자료만 사용했다.

스크린샷은 위 두 증거 디렉터리의 `cost-project-created.png`, 각 `<KIND>-approved.png`, `review-1366.png`, `review-390.png`다. 브라우저 사용자 입력·프로필·실행 산출물은 소스 커밋/배포 ZIP에 일괄 포함하지 않는다. 최종 root 통합본의 추가 변경·ZIP checksum·최종 공개/전달 판정은 root의 별도 검증 대상이다.
