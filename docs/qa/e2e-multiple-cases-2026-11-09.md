# 여러 케이스별 실제 데이터 검증

통합 저장소: `work/release-20261108-p10`, branch `release/web-20261108-p10`.
이 문서는 이번 실행 결과를 기록한다. 이전 완료 기록이나 단위시험을 전체 E2E 통과로 합산하지 않는다.

## 최신 결과 — 동일 SHA 9fe68f3a

**38/38 E2E PASS (1.7분)**. 운영 프론트9543과 실제 API9542가 모두 `9fe68f3a9f9a8ca43fca3aabeffd09c813912047`인지 확인했다. 실행 전 상품46/Feature370/차량960을 실제 API에서 선검증했다. API는 기존서비스와 분리된 메모리 DB이며 E2E가 실제 산출물·기준 변경·정책·상품을 생성하므로 실행 후 개수는 증가한다.

- 정상: Feature DB 선택·자동 채움·작성·등록·상세, 기준 추가/수정/발행, 분리 검토, 정책 8종 검증·승인·배포·활성화, 외부 JIRA 연계·거부 되돌림, 가상검증·TMS, 서명 긴급 차단·차량 회신·다른2인 복원, 산출물 인계·UI 파일 다운로드.
- 예외: 같은 기준·범위 중복, 폐기 기준 선택 차단, 자기 요청 검토 차단, 역할별 벤치마크 금액 접근, F2 A/B 거부·Shadow 허용, CN 국외 이전 보류, 자기 산출물 검토/수신 거부, 필수 근거 누락, 미등록 계정 차단.
- 경합/재시도: 같은 version 동시 작성은201/412 한 번씩, 같은 요청 키 인계는 한 번만 기록. 실제 byte/SHA-256 및 다운로드 바이트가 일치한다.
- 최신 실행 전 두 개선: 60대 우선 Fleet 행렬에 VIN·이름·범위 검색을 추가했다(전체 KPI·안전 우선 정렬·페이지 제한 유지). 정책 양성 E2E는 10개 합성 시험 본문을 실제 협력사 API로 등록·해시 검증·별도 검수한 뒤 G6를 판정한다. 시험 본문은 E2E synthetic임을 명시하며 실제 협력사 인증/실차 시험을 주장하지 않는다.
- 기본 Flow·상품기획 단일열 메뉴·실험 가이드의 실제 브라우저 확인도 PASS, JS 오류0. `integrated-9543-browser`의 이미지를 직접 검토했다.

이것은 이 38개 케이스와 해당 빌드의 결과이며 전체 기능·전체 이해관계자 리뷰·Figma·영문 완성·최종 게시 완료를 뜻하지 않는다. 현재 RC는 이후 EN3차 `c69825d9`를 추가 통합 중이므로 이 실측을 새 RC 전체 검증으로 대체하지 않는다.

## 실행 경계

- 첫 실행: 9535 운영 프론트 `458b639a` + 격리 실제 API 9534. 35건 중 25 PASS / 10 FAIL.
- 두 번째: 9537 운영 프론트 `dc2fb0f5` + 하네스가 자동 기동한 **기본 데이터** API 9538. 24건 중 22 PASS / 2 FAIL. 2배 데이터 통과 근거가 아니다.
- 2차의 남은 실패: 역할 전환 뒤 내 업무를 보려면 `view=flow`를 명시해야 하는 시험 경로 1건, 신규 기준 행에 UPG-VC가 없는 시험 준비 1건. 기존 G3 조건을 유지하고 실제 UPG-VC를 입력하도록 수정했다. 최신38-case 실행에서 두 건 모두 PASS.
- 새 `playwright.live.config.ts`는 서버를 자동 기동하지 않는다. 프론트/API SHA, health, 2배 상품·Feature·차량 수를 선검증하고 조건이 다르면 시험을 시작하지 않는다.

## 케이스와 결과

| 흐름 | 정상·예외 케이스 | 현재 실제 확인 |
|---|---|---|
| Feature DB 등록 | 대표/포함 선택, 자동 채움, 사용자 수정, 사유, 저장·상세 추적 | 최신38-case에서 등록·기준 변경 발행·접근성 PASS |
| 업무 Flow | 기본 전체업무흐름, 개별 활동, 텍스트 보기, 담당자·해상도·역할 전환 | 최신38-case에서 Flow 10개 모두 PASS |
| 수명주기 | Gate, 다른 사람의 해당 없음 승인, 반려·재작업, 즉시 폐기, 변경 이력 | 2차 4 PASS. 원천 판정·서명 조건 유지 |
| 업무 산출물 | 실제 파일 byte/hash, 별도 검토자, 인계, 수신자 확인, UI 다운로드 | 실제 API+운영 UI에서 PASS |
| 중복 요청 | 같은 인계 요청 키 재전송 | 인계·이력 중복 생성 없음, PASS |
| 동시 수정 | 서로 다른 두 사람이 같은 version 수정 | 201/412 한 건씩, 산출물·이력 한 번만 저장, PASS |
| 권한·누락 | 자기 검토, 발신자 자기 수신, 미등록 계정, 필수 산출물 누락 | 403/422, 상태·산출물 비진행 확인, PASS |
| Shadow 정상 | 실제 차량별 후보/배포 정책 재계산 | 정적 5개 중 정상 케이스 PASS, 서버 기존 정상 흐름 PASS |
| Shadow 부족·실패 | 기준 정책 없음, 차량 없음, 일부 잘못된 차량, 원천 네트워크 실패 | 정적 5 PASS. 서버 누락 2개 포함 영향 14 PASS. 일치율 성공 표시·ADOPT 차단 |
| Shadow 공용 규칙 | 불일치, 표본 부족, 부분 비교, 옛 응답, NaN/Infinity·범위 밖 비율 | 규칙 파일 총 32 PASS(새 근거 케이스 13개 포함) |
| 영어 표시 | 실제 가이드·숫자·비교 누락, 언어 복귀, 원문 ID 보존 | 실험 관련 FE 4파일 18 PASS. 전체 EN 완료를 뜻하지 않음 |
| 협력사 검수 | 10항목·SHA 본문·현재 기준·검수 분리, 미검수 차단 | 신규 시연 선행조건+기존 패키지 2파일 6 PASS. 전체 시연 생성 16 PASS |
| 2배 데이터 | 원본 ID·내용 보존, FK·논리 참조, 표·API 집계 | B 분기 검증 완료. 최신 P13 통합의 시연 생성 선행조건 보완·기본 시연 16 PASS; 최신 동일SHA 2배 API38-case 모두 PASS |
| 정적 배포 패키지 | 논리 URL 유지, GET/HEAD byte/hash, 인증·경로 차단, 파일 제한 | B 검증 62,975개 원문 × GET/HEAD = 125,950회 불일치 0. 최종 19,071/20,000 파일. 통합 커밋 대기 |

## 증거

- 키트 `out/resume-20261107/live-e2e-9543-wave4.log` — 최종38/38
- 키트 `out/resume-20261107/integrated-9543-browser.log` / `integrated-9543-browser/`
- 키트 `out/resume-20261107/live-e2e-9541-wave3.log` — 직전36/38
- 키트 `out/resume-20261107/live-policy-9541-r2.log` — 협력사 보완 뒤 정책1/1
- 키트 `out/resume-20261107/backend-contract-binding-impact.log` — 실제 계약 결합 후7파일54/54
- 키트 `out/resume-20261107/live-e2e-9535-wave1.log`
- 키트 `out/resume-20261107/live-workflow-9535-r3.log`
- 키트 `out/resume-20261107/live-e2e-9537-wave2.log`
- 키트 `out/resume-20261107/showcase-p13-integration.log`
- 원천 `FF/e2e/tests/workflow-cases.spec.ts`, `procedure-flow.spec.ts`, `refdb.spec.ts`, `lifecycle-p10.spec.ts`
- 원천 `FF/backend/test/ext/shadow-evidence.spec.ts`, `FF/backend/test/kernel/showcase-supplier.spec.ts`
- 원천 `FF/frontend/src/__tests__/shadowStaticEvidence.test.ts`, `experimentAnalysis.test.tsx`, `experimentLocale.test.tsx`

새 구현을 통합하면 해당 영향 및 전체 흐름을 다시 검증한다. 팀별 리뷰와 전체 이해관계자 리뷰·잔여 구현·최종 Publish는 아직 진행 중이다.
