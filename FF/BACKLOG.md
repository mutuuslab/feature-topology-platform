# Backlog

- 상태: `대기` · `진행` · `완료`
- 우선순위: P1(먼저) → P5
- 항목을 시작하거나 끝내면 이 파일의 상태와 [PROGRESS.md](PROGRESS.md)를 함께 고친다.

## 텔레메트리 · Data Lake · 분석·학습 (2026-10-18)

### 배경
- 사용자 요청
  - "현대차 Data Lake와 인터페이스, 차량 데이터를 텔레메트리로 받아 분석·학습"
  - "Data Lake도 외부 시스템 — 우리가 설계하지만 FF Platform과 서버가 다르다"
  - "전체 구현을 Backlog에, UI/UX 프론트 우선"
- 설계 문서는 [`docs/80-integration/80-70-telemetry-datalake-ml.md`](../docs/80-integration/80-70-telemetry-datalake-ml.md)다.

### 경계
- FF Platform(9101·9012)과 Data Lake 서버(별도, 개발 포트 9301)는 **IF-15** 하나로만 연결된다.
- FF에는 Lake의 코드·저장소·학습을 두지 않는다. 공유하는 것은 IF-15 계약(contracts 스키마)뿐이다.
- 주인 규칙은 80-70의 0장을 따른다.
  - Lake의 주인: 원천·집계·모델
  - FF의 주인: 판정·단계·차단·라벨·수집 정책·모델 사용 승인

### 화면 공통 완료 기준 (P1 모든 항목)
- 3초 규칙
  - 화면마다 PageHeader 핵심 메시지는 하나다.
  - lead는 70자 이하이고 FFG/IF/D0x 코드를 쓰지 않는다.
  - 장식 eyebrow·KPI 줄은 두지 않고, 핵심 문구를 반복하지 않는다.
- 문구는 copy 파일에 둔다(lint-copy: JSX에 한글 금지). 'Evidence' 용어를 쓰고 'Twin/트윈'은 쓰지 않는다.
- 로딩 중에는 중립 표시를 둔다. 텔레메트리 수치에는 `FreshnessChip`을 붙인다.
- 판단을 자동으로 바꾸는 것은 규칙(①·신선도)뿐이다. 모델 점수는 "권고"로 표시한다.
- 시험
  - frontend 화면 시험
  - e2e three-second
  - 스크린샷 판정은 서브에이전트에 맡긴다.
- 데이터는 IF-15 mock fixture를 쓴다. Lake 서버를 기다리지 않는다.

### P1 — UI/UX (먼저)
- 진행 순서: TL-UI01 → **TL-UI16 → TL-UI17**(Closed loop 중심 화면) → TL-UI02~15
| ID | 상태 | 화면·위치 | 내용(핵심 메시지) | 선행 |
|---|---|---|---|---|
| TL-UI01 | 대기 | design `FreshnessChip` + `_design` 갤러리 | 출처 데이터셋·기준 시각·지연. SLA 초과면 경고와 "판단 보류" 사유 | TL-C01 |
| TL-UI02 | 대기 | 정책 상세 `/policies/:id` (`screens/policy/Policies.tsx`) — Canary 관측 패널 | 적용군과 대조군의 실패율·DTC·안전 이벤트 추이와 중단 기준선, 모델 위험 점수(권고·기여 요인). "이상 없음 — 확대 가능 / DTC 상대위험 1.8 — 확대 중단 / 지표 23분 지연 — 확대 보류" | TL-UI01 |
| TL-UI03 | 대기 | 정책 상세 단계 확대 Drawer(`drawer === 'stage'`) | 중단 기준 사전 등록: 지표·임계·신뢰수준·관측 시간·신선도(FR-ROL-002-006). 기준이 없으면 확대 버튼이 사유를 안내 | TL-UI02 |
| TL-UI04 | 대기 | Feature 상세 `/features/:id/:ver` 새 탭 '운영 지표' (`screens/features/FeatureDetail.tsx`) | 버전별 활성 차량(만 단위)·사용률·적용 실패율·DTC·배포 후 VOC·롤백 수 | TL-UI01 |
| TL-UI05 | 대기 | 이상 징후 `/ops/anomalies` (`screens/ops/Anomalies.tsx`) | 출처(규칙 ①·모델 ②와 버전), Lake 증거 스냅샷 링크, 사람 판정(확인·오탐 → 재학습 라벨) | TL-UI01 |
| TL-UI06 | 대기 | 운행 중 감시 지표 `/ops/safety-kpi` (`screens/ops/SafetyKpi.tsx`) | Lake 실측 + 신선도. 임계 초과면 이상 징후 건으로 연결 | TL-UI01 |
| TL-UI07 | 대기 | 실험·효과 `/experiments` (`screens/ext/Experiments.tsx`) | 모의값을 실측 효과·신뢰구간·표본 수로 바꾼다. 표본이 부족하면 "아직 판단 불가" | TL-UI01 |
| TL-UI08 | 대기 | 체험 전환 분석 `/biz/trials` (`screens/biz/TrialAnalytics.tsx`) | 실사용일과 구매 전환의 관계, 추천 대상(모델 ④, 공정성 점검 결과) | TL-UI01 |
| TL-UI09 | 대기 | **신설** 수집 정책 `/ops/collection` | 신호·대상 차량군·트리거·데이터 범주·동의 근거·예상 데이터량(일 GB)·시장. 서명 배포·회신은 기존 배포 화면 흐름 재사용 | TL-C01 |
| TL-UI10 | 대기 | **신설** Data Lake 연계 `/integration/datalake` | 데이터 계약(신선도·품질·최근 적재), 모델 목록(Lake 소유, 읽기)과 FF 사용 승인, 라벨 보내기 현황. 핵심 메시지: "데이터 계약 N건 지연" 또는 "모두 기준 안" | TL-C01 |
| TL-UI11 | 대기 | 외부 연계 현황 `/integration/connectors` (`screens/ext/Integrations.tsx`) | IF-15 행(모의·실제, 지연, 실패 수), Data Lake 연계 화면으로 이동 | TL-UI10 |
| TL-UI12 | 대기 | 데이터·규제 기록 `/admin/data` (`screens/admin/DataGovernance.tsx`) | 받는 데이터의 근거(동의·법령)·보존·가명 처리, 보내는 라벨 목록, CN 국외 이전 보류 | TL-C01 |
| TL-UI13 | 대기 | 검토함 `/admin/approval` (`screens/home/Inbox.tsx`) | 새 대기열: 모델 사용 승인, 이상 징후 판정, 신선도 초과로 보류된 확대 | TL-UI02·05·10 |
| TL-UI14 | 대기 | 운영 데이터·이벤트 `/ops/telemetry` (`screens/master/Ops.tsx` TelemetryScreen) | 제어 채널(FF가 직접 받는 상태 보고)과 Lake 출처 지표를 나눠 표시 | TL-UI01 |
| TL-UI15 | 대기 | 홈 `/` 역할별 카드 | 안전 담당: 판정 대기 이상 징후 수. 배포 담당: 보류된 확대 수. 통합 담당: IF-15 지연 | TL-UI13 |
| TL-UI16 | 대기 | **신설** Feature 운영 점검 `/ops/feature-health` (Closed loop 허브) | 운영 중인 Feature 버전 × 4축(동작·문제·개선·위험) 상태 표, 상태는 정상·주의·조치 필요·판단 불가. 핵심 메시지: "조치 필요 N건 — 기한 지남 M" 또는 "모두 정상". 축·상태·담당 필터 | TL-UI01 |
| TL-UI17 | 대기 | 점검 결과 상세(Drawer 또는 `/ops/feature-health/:findingId`) | 근거 지표 스냅샷(신선도)·담당·기한·조치 연결(JIRA·codeBeamer·정책)·효과 기준·조치 전후 비교. 상태 흐름: 감지 → 분석 중 → 조치 중 → 효과 확인 중 → 닫힘/다시 열림 | TL-UI16 |
| TL-UI18 | 대기 | Feature 상세 '운영 지표' 탭(TL-UI04)에 4축 이력과 열린 점검 결과, Release Sign-off·Flag Retirement 화면에 근거로 연결 | 판정 이력 추이, 반복 문제 표시 | TL-UI16 |

### P2 — 계약 · FF backend
| ID | 상태 | 내용 | 완료 기준 | 선행 |
|---|---|---|---|---|
| TL-C01 | 대기 | contracts: IF-15 매니페스트(D05-01 소속, D04-03·D06-12·D01-07 사용), 응답 스키마(GoldMetric·SafetyEvent·ModelScore·ModelSummary·DataContractStatus·Freshness), 라벨 CDC 스키마, CollectionPolicy, AbortCriteria, routes | contracts 시험, openapi 갱신. **P1 화면이 쓸 최소본을 먼저** 만든다 | — |
| TL-C02 | 대기 | IF-15 어댑터: mock(fixture, 5년 재생 모집단과 맞춤)·live(HTTP pull, 이벤트 구독, 라벨 쓰기), `IF_MODE_15` | 어댑터 시험(fixture·live fetch 대역) | TL-C01 |
| TL-B01 | 대기 | 신선도 HOLD: SLA 초과 지표로 단계 확대 불가 | 시험: 지연 지표 → 확대 거부 + 사유 | TL-C02 |
| TL-B02 | 대기 | 중단 기준 판정(규칙 ①, Lake 집계 기준) → 자동 HOLD, 사전 등록·변경 감사 | 시험: 임계 초과 → HOLD, 모델 점수만으로는 HOLD 안 됨 | TL-B01 |
| TL-B03 | 대기 | 이상 징후 자동 생성(규칙·모델 출처) + 사람 판정 → 라벨 | 시험 | TL-C02 |
| TL-B04 | 대기 | 라벨 CDC: 정책·게시본·단계·차단·롤백·실험 배정·차량별 적용 상태·사람 판정 → Lake. ext-sync 보낼 함 엔진 재사용(`backend/src/domains/d05-ext/api-gateway/ext-sync`) | 시험: 누락 0, 재시도·멱등 | TL-C02 |
| TL-B05 | 대기 | 수집 정책 엔티티·승인·서명 게시본 배포·차량 회신 | 시험: 서명·대상·거부 회신 | TL-C01 |
| TL-B06 | 대기 | 모델 사용 승인(2인·직무 분리·감사), 드리프트 시 "참고 불가" | 시험: 자기 승인 거부 | TL-C02 |
| TL-B07 | 대기 | 5년 재생 연동 + INV-16~19(FF 쪽 검사) | 재생 PASS, 보고서 갱신 | TL-B01~B06 |
| TL-B08 | 대기 | 4축 판정 엔진(1일·5분·실시간 주기, 규칙 + 모델 권고) → 점검 결과(Finding) 생성·갱신, 같은 원인은 다시 열기 | 시험: 축별 판정, 판단 불가 분리, 중복 방지 | TL-C02 |
| TL-B09 | 대기 | Finding 상태 흐름·담당·기한·조치 연결(JIRA 결함·개선 IF-14, codeBeamer 재검토 IF-01, 정책 HOLD·롤백·차단) | 시험: 조치 없이 단계 이동 불가, 감사 기록 | TL-B08 |
| TL-B10 | 대기 | 효과 확인: 조치 전후 비교(표본·신뢰구간)로 닫기/다시 열기, 예외 닫기는 사유·2인 승인. 판정·조치·효과를 라벨로 Lake에 보냄(TL-B04) | 시험: 효과 미달 → 다시 열림. INV-20·21 | TL-B09·B04 |

### P3 — Data Lake 서버 (별도 서버)
| ID | 상태 | 내용 | 완료 기준 | 선행 |
|---|---|---|---|---|
| TL-L01 | 대기 | `datalake/` 별도 workspace·프로세스(포트 9301)·자체 저장소. IF-15 서빙 API | 계약 준수 시험(contracts 스키마), FF live 어댑터로 연결 확인 | TL-C01 |
| TL-L02 | 대기 | 수집 게이트웨이(MQTT 모의) → Bronze(서명 검증, 실패는 격리) → Silver(가명화·라벨 조인) → Gold(5분·1시간·1일 집계) | 파이프라인 시험, 데이터 계약 품질 검사 | TL-L01 |
| TL-L03 | 대기 | 차량 신호 합성기. 5년 재생 모집단·배포·차단·롤백 이력과 맞물리고, 사고 달에 DTC를 올린다. **FF가 아니라 Lake로** 보낸다 | 재생 결과로 Gold가 채워짐 | TL-L02 |
| TL-L04 | 대기 | 학습 작업(Python, 시드 고정): 규칙 ① 검정, 모델 ② 이상 탐지, ③ 배포 위험(설명 포함), ④ 체험 전환(공정성) | 재현 가능한 평가 지표 | TL-L03 |
| TL-L05 | 대기 | 모델 레지스트리·모델 카드·드리프트 감시·재학습, Lake 쪽 모델 승인(학습자 ≠ 승인자) | 시험 | TL-L04 |
| TL-L06 | 대기 | 시장 리전 분리(CN 현지 수집·학습), 국외 반출은 k≥5 집계·점수만 | 시험: CN 원천 반출 0 | TL-L02 |
| TL-L07 | 대기 | FF ↔ Lake 대사: 라벨 누락 0, 신선도, INV-16~19 양쪽 검사 | 대사 보고서 | TL-B07·L05 |
| TL-L08 | 대기 | Feature별 4축 근거 집계(동작·문제·개선·위험 지표: 사용률·수동 끄기·차종/시장 편차·추세·결측)와 조치 전후 비교 데이터셋 | 데이터 계약·계약 시험 | TL-L02 |

### P4 — 차량 측
| ID | 상태 | 내용 | 비고 |
|---|---|---|---|
| TL-V01 | 대기 | 텔레메트리 로거·수집 정책 적용(데이터 채널 MQTT 5·mTLS·서명 봉투) | vECU 저장소 변경은 별도 승인이 필요하다. 그 전까지는 TL-L03 합성기로 대신한다 |

### P5 — 실제 연결
| ID | 상태 | 내용 | 비고 |
|---|---|---|---|
| TL-X01 | 대기 | 현대차 Data Lake 실제 연결(live 어댑터 설정·인증·계약 대사) | 아래 결정이 오면 진행한다 |

### 정해야 할 것 (80-70 8장)
1. Data Lake 제품·위치, 접근 방식(Kafka·REST·SQL), 인증
2. 차량 신호 목록의 소유 조직, 차량 로거 용량(대당 하루 MB)
3. 기능 사용 데이터 동의, 위치 기준(D5), CN 처리
4. 안전 지표 신선도 SLA(제안 10분), Canary 관측 시간
5. ISO/PAS 8800 적용 범위(모델 ②③을 안전 관련으로 분류할지)

<!-- ads:begin (tools/ads-report.ts가 harness/ads/design.json에서 생성 — 직접 고치지 말 것) -->
## ADS·UNECE 보고서 v3.0 반영 (2026-10-18)

### 배경
- 사용자 요청: "FF Platform의 목적·vision과 시나리오·Case가 들어 있으니 모두 반영. 분석·저장·HTML 보고"
- 이어서: "다른 세션 내용과 통합해 UI/UX·프론트·백엔드·DB 수정 설계"
- 원본: 저장소 밖(`C:/project/2026-06-04_Feature_Platform_sources/ads-unece-v3.0/`, sha256 `712e75bc6542…`)
- 추출본: `harness/ads/catalog.json`
- 판정: `harness/ads/review.json` — 요건 64 중 구현 7 · 부분 48 · 미구현 6 · 범위 밖 3
- 설계: `harness/ads/design.json`
- 보고서: `docs/10-requirements/ads-unece-v3/report.html`
- 반영 순서: 설계 단계 0 → 5. UI/UX가 먼저이고 결함 4건은 1단계에서 회귀 시험과 함께 고친다.
- 이 절은 `npm run ads:report`로 생성한다. 상태를 바꿀 때는 design.json을 고친다.

### 0 · 정리
- 완료 기준: verify:full 녹색

| ID | 상태 | 우선 | 층 | 내용 | 요구(FFP-) | 선행 |
|---|---|---|---|---|---|---|
| ADS-FIX01 | 대기 | P0 | 정리 | 양방향 연계 작업으로 깨진 verify:full 복구 | — | — |

### 1 · 기준선·계약 + 화면(UI 우선)
- 완료 기준: 결함 4건 회귀 시험 통과, 의도·전달·실제 분리 화면, 대표 Feature 2개의 상태 계약 합의(보고서 1단계)

| ID | 상태 | 우선 | 층 | 내용 | 요구(FFP-) | 선행 |
|---|---|---|---|---|---|---|
| ADS-UI13 | 대기 | P1 | UI | 상태 용어 고정 | — | — |
| ADS-UI10 | 대기 | P1 | UI | 신설 요건·시험 추적 화면 /trace/ads | F054·F064 | ADS-BE18 |
| ADS-UI01 | 대기 | P1 | UI | 의도·전달·실제·최신성 분리 표시 | F018·F044·F049·F058 | ADS-BE01 |
| ADS-UI02 | 대기 | P1 | UI | 종료·차단·복원 화면 개편 (Kill·Rollback·타임라인) | F031·F034·F035·F036 | ADS-BE02·ADS-BE03 |
| ADS-UI06 | 대기 | P1 | UI | 행위별 판정과 사유 코드 표시 | F023·F027·F029 | ADS-BE01·ADS-SIM01 |
| ADS-UI03 | 대기 | P1 | UI | 일괄 명령 미리보기와 서명 대상 일치 | F057·F059 | ADS-BE05 |
| ADS-BE01 | 대기 | P2 | BE | 상태 보고 계약 2.1 (판정·전달 단계·제어 책임·차단·MRC) | F018·F023·F029·F030·F031·F034 | — |
| ADS-BE03 | 대기 | P2 | BE | **[결함]** 복원 ≠ 활성화 | F036 | — |
| ADS-BE04 | 대기 | P2 | BE | **[결함]** 같은 명령 재전송은 멱등 ACK | F019 | — |
| ADS-BE05 | 대기 | P2 | BE | **[결함]** 대상 검증 — 대상 밖 차량 적용·서명 대상 미검증 | F014·F059 | — |
| ADS-BE06 | 대기 | P2 | BE | **[결함]** 출시 뒤 열린 재-HARA가 출시·배포·서명을 막지 않음 | F007 | — |

### 2 · 구성 관리 화면·엔티티
- 완료 기준: P0 요구 중 CP 담당 통과, TC01~03·13·14·17·21 자동 시험

| ID | 상태 | 우선 | 층 | 내용 | 요구(FFP-) | 선행 |
|---|---|---|---|---|---|---|
| ADS-UI04 | 대기 | P1 | UI | 신설 ODD 프로파일 화면 /config/odd | F016·F025·F026 | ADS-BE09 |
| ADS-UI05 | 대기 | P1 | UI | 신설 호환 형상 화면 /config/compat | F005·F039 | ADS-BE10 |
| ADS-UI09 | 대기 | P1 | UI | 변경 종류·승인 영향·릴리스 비교 | F002·F007·F008 | ADS-BE06·ADS-BE08 |
| ADS-UI12 | 대기 | P1 | UI | Feature 분류·시장 기준선 보강 | F001·F003·F004 | ADS-BE16 |
| ADS-BE07 | 대기 | P2 | BE | Feature 단위 epoch — KILL 뒤 과거 정책 게시본 거부 | F015 | — |
| ADS-BE08 | 대기 | P2 | BE | 변경 종류 분류와 유형별 영향 경로 | F002·F007 | — |
| ADS-BE09 | 대기 | P2 | BE | ODD 프로파일 엔티티·의미 검증·승인 상한 컴파일 검사 | F016·F025·F026 | — |
| ADS-BE10 | 대기 | P2 | BE | 호환 형상 집합·보안 최소 버전 | F005·F039·F040 | — |
| ADS-BE11 | 대기 | P2 | BE | 결정적 정책 빌드 digest | F013 | — |
| ADS-BE16 | 대기 | P2 | BE | Feature 분류 보강·시장 기준선 | F001·F003·F004 | — |

### 3 · 운영·증거·보고
- 완료 기준: TC12·15·19·20·24 자동 시험, 확대 판정이 미확인·지연을 성공으로 세지 않음

| ID | 상태 | 우선 | 층 | 내용 | 요구(FFP-) | 선행 |
|---|---|---|---|---|---|---|
| ADS-UI07 | 대기 | P1 | UI | 신설 사건 보고 화면 /ops/incident-reports | F050·F052 | ADS-BE13 |
| ADS-UI08 | 대기 | P1 | UI | 신설 Safety Case·Evidence manifest 화면 /verify/safety-case | F010·F053·F055·F056 | ADS-BE14 |
| ADS-UI11 | 대기 | P1 | UI | 확대 판정 패널(텔레메트리 TL-UI02와 통합) | F012·F020·F051 | ADS-BE12 |
| ADS-BE02 | 대기 | P2 | BE | 사건 범위 종료 차단·선택 해제 | F011·F035 | ADS-BE01 |
| ADS-BE12 | 대기 | P2 | BE | 확대 판정 엔진(텔레메트리 TL-B01·B02와 통합) | F012·F020·F049·F051 | ADS-BE01 |
| ADS-BE13 | 대기 | P2 | BE | 사건 보고·DSSAD 경계 | F050·F052 | — |
| ADS-BE14 | 대기 | P2 | BE | Safety Case CAE·Evidence manifest·독립 검토 | F010·F053·F055·F056 | — |
| ADS-BE15 | 대기 | P2 | BE | 권한 범위(시장·Feature·환경) | F057 | — |
| ADS-BE17 | 대기 | P2 | BE | 캠페인 ↔ 릴리스 양방향 조회 | F017 | — |
| ADS-BE18 | 대기 | P2 | BE | FFP 추적 하네스(@ffp 표식·래칫·표준 개정 영향) | F054·F064 | — |

### 4 · 차량 시뮬레이터·와이어
- 완료 기준: TC04~10·22 시뮬레이터 시험, FF_IMP 2.1 반영

| ID | 상태 | 우선 | 층 | 내용 | 요구(FFP-) | 선행 |
|---|---|---|---|---|---|---|
| ADS-SIM01 | 대기 | P3 | 차량 시뮬레이터 | 로컬 Safety Supervisor 시뮬레이터(행위별 판정·ODD 3값·재검증) | F021·F024·F027·F028·F029·F030·F045 | ADS-BE01 |
| ADS-SIM02 | 대기 | P3 | 차량 시뮬레이터 | 오프라인·재시작 시뮬레이션 | F041·F042·F043 | ADS-SIM01 |
| ADS-SIM03 | 대기 | P3 | 차량 시뮬레이터 | 인계·MRC·종료 완료·시간 예산 | F031·F032·F034 | ADS-SIM01 |
| ADS-SIM04 | 대기 | P3 | 차량 시뮬레이터 | FF_IMP GLEO 와이어 2.1 동기 | F018·F035 | ADS-BE01·ADS-BE02 |

### 5 · OTA·수명주기
- 완료 기준: TC16·18·23

| ID | 상태 | 우선 | 층 | 내용 | 요구(FFP-) | 선행 |
|---|---|---|---|---|---|---|
| ADS-OTA01 | 대기 | P4 | CCS·OTA | 설치 사전조건·복구·안전 상태 증거 계약(IF-05) | F037·F038·F039 | — |
| ADS-LC01 | 대기 | P5 | 수명주기 | 차량 Shadow 경로 격리 계약 | F061 | — |
| ADS-LC02 | 대기 | P5 | 수명주기 | 지원 종료·서버 교체 연습 | F063 | — |

### 결정 필요
- **D-ADS-1** FF_IMP GLEO 와이어를 2.1로 확장해도 되는가? — 제안: FF는 2.0·2.1을 함께 수락하도록 먼저 만들고, FF_IMP는 승인 후 별도 커밋.
- **D-ADS-2** 보고서 1단계의 '대표 ADS 1개 + 비 ADS 1개'를 어느 Feature로 할까? — 제안: ADS: 고속도로 자율주행(ADSF-2 성격) 1개, 비 ADS: 체험권 IVI 기능 1개 — 데이터셋에서 후보를 골라 제시.
- **D-ADS-3** 사건 보고의 시장별 기한·양식은 누가 소유하는가? — 제안: 플랫폼은 인지 시각·기한 계산·초안만, 시장별 기한 표는 규제 담당(R-REG) 승인 데이터.
- **D-ADS-4** 업무 절차 모델(FPW.8·FPW.13)은 어느 세션이 고칠까? — 제안: 이 세션이 항목마다 모델 diff를 제안하고, 업무 절차 세션 기준(scripts/check.py)으로 같은 커밋에 반영.
- **D-ADS-5** 차량 팀과 확정할 결정 5건(HARA·ASIL·시간 예산, ODD 신호·한계, 설치·정지 유지·전원, 컴포넌트 대응, 시장 운영 절차)의 담당은? — 제안: 플랫폼은 계약·시뮬레이터 기본값을 '가정값'으로 표시하고 차량 팀 확정 후 교체.
- **D-ADS-6** FFP 요구 64개를 codeBeamer 요구 항목으로 등록할까? — 제안: 카탈로그를 ReqIF로 내보내 codeBeamer에 등록하고, FF는 판정·Evidence만 쓰기.
<!-- ads:end -->
