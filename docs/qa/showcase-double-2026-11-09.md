# 공개 시연 데이터 확장 검증 — 2026-11-09

기준 `634b2542`, 데이터 구현 `b6cb8565`, 단일 VIN 최적화 `e78210b7`, 첫 조회 권한 보정 `d3a83072`. 추가 데이터는 가상 시연으로 표시한다. 실제 외부 승인·실차 근거를 생성하지 않으며 기존 Lifecycle·Gate·직무 분리·RACI 규칙을 유지한다.

## 기준과 실측

기존 공개 설정 `FF_SHOWCASE=1 FF_SHOWCASE_VEHICLES=480 FF_SYNTHETIC=24000`을 먼저 측정했다. 공개 workflow에 `FF_SHOWCASE_SCALE=2`를 추가했다. 명시적 scale이 없으면 기존 1배이며 운영·빈 고객 DB·ops5y에는 적용하지 않는다. 등록 차량 상한 1,200대도 유지한다.

| 대상 | 기존 공개 기준 | 실제 확장 후 |
|---|---:|---:|
| 상품 Version / 서로 다른 ID | 23 / 19 | 46 / 42 |
| Feature Version / 서로 다른 ID | 185 / 170 | 370 / 355 |
| 정책 | 47 | 94 |
| 등록 차량 / 합성 체험 모집단 | 480 / 24,000 | 960 / 48,000 |
| 권리 | 24,514 | 49,034 |
| 주문 / 부서 협의 | 12 / 81 | 24 / 219 |
| A/B·Shadow 실험 | 2 | 4 |
| 합성 평가 fixture + 모의 OFREP 요청 집계 | 2,305,215 | 4,610,430 |
| 장애·VOC / 품질 피드백 | 7 / 2 | 14 / 4 |
| 업무 건 / 산출물 초안 | 0 / 0 | 36 / 236 |

18절차에 업무 건을 두 건씩 만들었다. 업무 역할 자동 배정, 초안 검토 수락·서명·인계 승인은 모두 **0건**이다. 구매·법무·DPO 수행 데모 계정이 없는 네 산출물(`WP-ORIGIN-RECORD`, `WP-OSS-PROGRAM`, `WP-CONTEXT-REVIEW`, `WP-DATA-TRANSFER`)은 임의 권한 배정으로 채우지 않고 marker의 `unavailable`에 남긴다.

모든 물리 테이블을 복제한 결과가 아니다. 고정 권한·법규·규칙·기준정보와 실제 외부 승인·실차 근거는 확장하지 않는다. 개발비·공장 연계·기술 원장의 별도 기존 시드는 이 계수의 대상이 아니다. 전체 207테이블의 실제 건수는 증거 JSON에 보존했다.

## 원본 보존과 정합

기존 전시와 fill을 먼저 완료하고 추가 cohort를 만든다. 기존 정책·상품 ID가 추가 데이터에 재사용되지 않는다. 추가 직전과 직후, 비동기 부팅 완료 후 다음 **1,154행**의 PK·전체 행 canonical SHA-256을 대조했다.

| 원천 | 검사 행 |
|---|---:|
| Feature / 상품 / 정책 / 정책 개정 | 185 / 23 / 47 / 47 |
| 안전 분류 / Gate / 개인 signoff | 185 / 656 / 2 |
| 승인 키 / PKI / HSM | 4 / 4 / 1 |

변경 **0**, 삭제 **0**. 서명·참조도 전체 행 해시에 포함한다. 개인 키 원문은 산출물에 쓰지 않고 해시만 보존한다. DB 외래키 오류 **0**, 정책→Feature·권리→상품/성향·주문→차량/동일 VIN 권리·업무 대상 Feature 등 여섯 논리 참조 검사도 모두 **0**이다.

고정 Clock `2026-11-09T00:00:00.000Z`로 독립 부팅을 반복해 Feature·상품·정책·주문·실험·업무 초안 의미 SHA-256이 **6/6 일치**했다. 의미 비교에서는 부팅별 업무 UUID를 제외한다. 암호 키/서명은 부팅별로 생성되므로 같은 부팅 내 원본 불변은 별도의 전체 행 검사로 확인한다. 같은 DB의 재실행은 데이터·감사·marker를 늘리지 않는다.

## 서버·정적 조회

실제 Node의 상품·Feature·정책·차량·실험·주문·장애·업무 건 8개 API가 모두 200이며 표의 건수와 일치했다. 주문 구간 합계도 전체 24건과 일치한다.

업무 목록·상세·원천 조회를 실제 서버에서 캡처한다. 정적 시연은 캡처한 산출물/이력을 초기 수화하고 현재 요청자의 역할로 필터링한다. 관리자 roleIds·역할 배정을 사용자에게 복사하지 않는다. 로컬 개정, 기존 revision 및 412 충돌도 보존한다.

실제 production 브라우저에서 최초 성공 GET이 reader를 우회해 관리자 목록을 반환하는 결함을 발견해 수정했다. 업무 건의 정확한 여섯 읽기만 첫 진입부터 reader로 보낸다. 기존 업무 문서·절차 조회는 그 목록에 포함하지 않는다.

## 검증

- 확장 및 기존 1배 seed: backend 3파일 9시험 PASS.
- VIN·지도·Shadow: backend 3파일 15시험 PASS.
- 정적 초안·최초 client GET/역할 전환·기존 모델: frontend 3파일 9시험 PASS.
- snapshot export·환경 격리·packet·게이트·coverage: tools **41시험 PASS**, skip 0.
- backend 타입·frontend production build PASS. 최종 번들 **296.3/297KiB**, 화면 최대 **32.7/40KiB**.

단일 VIN은 전체와 동일한 차단·꾸러미·미수신·Shadow·오프라인·권리·위치 공유 동의·unknown VIN 경계를 유지한다. 960대 실측은 전체 계산 **1,273.9ms**, 단일 계산 **6.6/7.5ms**, 지도 상세 최초 성향 캐시 포함 **170.3ms**·후속 **9.0ms**다. 시간은 이 로컬 실행의 관측값이다.

## 최종 패킷·브라우저

스냅샷은 한 번만 생성했다. 원문 중복 사본을 만들지 않고 그 한 벌을 최종 dist로 이동한 뒤 변환했다. 로컬 PC 흔적 0건이다.

- 물리 파일 **79,769 → 19,071/20,000**. 가장 큰 파일 **8,670,516bytes**, 25MiB 한도 이내.
- 기존 VIN 두 조회 축 48,000개와 추가 차량/Feature 조회 14,975개를 합쳐 원문 **62,975개**를 패킷에 보존했다. 독립 파일로 남은 조회와 모델·문서는 유지한다.
- 추가 차량 조회는 runtime·requests·status·feature-state·verdicts·customer-state·openfeature·installs의 정확한 8개다. Feature 조회는 ID별 7개와 각 실제 Version별 13개의 명시 목록이다. canonical ID·Version·조회 축 전체를 검증하며, 누락된 group/query를 정상 coverage로 세지 않는다.
- 원문 모두를 실제 서명 쿠키 게이트·production resolver로 **GET + HEAD 125,950회** 대조해 원문 byte/hash 불일치 **0**을 확인했다. 동일 canonical filename의 URL query 순서·actor metadata는 ASSETS 요청에 전달되지 않는다. UTF-8 길이, GET 본문, 빈 HEAD 본문, private cache 지시도 일치한다.
- 새 resource packet의 직접 비인증 접근은 401이다. 게이트 공개 예외를 늘리지 않았으며 로컬 production preview의 ASSETS 허용 목록에 정확한 새 packet prefix만 추가했다. 알 수 없는 query family·traversal·손상·25MiB 초과는 거부한다.
- production 게이트·resolver·배포 헤더를 사용하는 브라우저에서 390/1366px × sysadmin/commerce/author **6case PASS**. 목록은 각각 **36/4/28건**이다. 로컬 개정 저장/새로고침, 타 역할 건 거부, 같은 앱 내 관리자→상품 담당 역할 전환, 기존 업무 흐름도 첫 진입도 확인했다. JS/HTTP 오류 **0**, 화면 가로 넘침 **0**, 사업 API network write **0**.

이 결과는 해당 기준 작업 트리의 검증이며 공개 게시 완료를 주장하지 않는다. 이후 최신 통합의 P13 G6 관문 추가로 supplier 선행조건 회귀가 발견됐으므로, 이 원본 보존 검증은 최신 통합의 별도 선행조건 검증을 대체하지 않는다.

## 재현과 대표 cohort

키트 `out/showcase-double-20261109/`의 `baseline.json`, `preserved-doubled.json`, `repeated-doubled.json`, `measure.cjs`, 시험 로그가 증거다. meta에 원본 PK→hash 행렬과 단계별 생성 ID가 있다. 최종 증거는 `pack.log`, `final-canonical-coverage.log`, `packet-http-equivalence.json`, `browser.json`, 역할별 PNG다.

최종 산출물은 작업 트리 `FF/frontend/dist`에 한 벌만 보존한다. 재현 미리보기는 `node FF/tools/snapshot-pack.preview.ts FF/frontend/dist 9564`이며 종료했다. 같은 dist를 기본 frontend build로 덮어쓰면 보존한 스냅샷도 지워지므로 후속 빌드는 별도 출력 위치를 사용한다.

추가 Feature `FEAT-00289`~`FEAT-00473`, 상품 `CAT-00065`~`CAT-00087`, 정책 `POL-00048` 이후, 실험 `EXP-00003/00004`, 주문 `ORD-SHOWCASE-0001`~`0012`, 장애 `INC-00008`~`00014`를 E2E에 쓸 수 있다. 업무 UUID는 `browser-fixture.json` 또는 실제 `workflowCases` 응답에서 얻는다. `가상 시연 FPW.18 · 산출물 작성 cohort`는 상품 담당자의 초안 조회·개정·새로고침 표본이다.

원격 Grafana 계정·실제 외부 Gate 승인·실차 근거의 추가 검증은 이번 작업에서 수행하지 않았다.
