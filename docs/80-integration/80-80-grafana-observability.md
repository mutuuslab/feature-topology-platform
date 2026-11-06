---
id: INT-GRAFANA
type: integration
title: "Grafana Cloud 운영 관측·Closed loop / Grafana Observability"
status: draft
version: 0.1.0
owner: operations-sre
cycle: 0
standards: [OpenTelemetry, OpenFeature]
traces:
  depends_on: [ARC-UNLEASH-LIVE]
last_updated: 2026-11-06
---

# Grafana Cloud 운영 관측·Closed loop

> 사용자 요청(2026-11-06): "Telemetry에서 수신받은 건 Grafana로 표현하는 것도 추가." → "Grafana 구현도 실제 Practical하게 상세하게." → "Grafana를 통해 다시 Feature를 모니터링하고 문제나 개선점을 찾는 것도 하나의 목적이다."
> 결정: **Grafana Cloud 무료 계정**. 공개 데모(Cloudflare 정적 사이트)는 로컬 PC에 기대지 않는다 — 시연 시계열은 GitHub Actions가 보낸다. 자격 증명은 GitHub 저장소 비밀로만 둔다.
> 원천: 지표 카탈로그 `FF/contracts/src/rules/telemetry-metrics.ts` · 대시보드·경보 `FF/tools/grafana/dashboards.ts`(→ `FF/deploy/grafana/{dashboards,alerting}/*.json`) · 시연 생성기 `FF/tools/grafana/demo-generator.ts` · 프로비저닝 `FF/tools/grafana/provision.ts`.

## 0. 한눈에

```
 설치 서버(클라우드 VM·docker/unleash platform)                       공개 데모(로컬 PC 없음)
 ┌──────────────┐  /api/health/metrics(30s)   ┌─────────┐            ┌──────────────────────────┐
 │ FF 백엔드    │◀────────────────────────────│ Alloy   │            │ GitHub Actions 15분 예약 │
 │ 지표·OTLP    │──── OTLP 추적·로그(4318) ──▶│         │            │ push-demo-metrics.ts     │
 └──────┬───────┘                             └────┬────┘            │ (결정적 시연 시계열)     │
        │ Grafana 경보 webhook(HMAC)               │ OTLP/HTTP        └────────────┬─────────────┘
        ▼                                          ▼                               │ OTLP/HTTP
 운영 관찰(개선 후보)·이상 징후          Grafana Cloud OTLP 게이트웨이 ◀────────────┘
 → Feature 운영 점검 → 변경 요청          지표(Mimir)·로그(Loki)·추적(Tempo)
                                          대시보드 7개(+공개본)·경보 15개
```

| 항목 | 결정 |
|---|---|
| 전송 | **OTLP 게이트웨이 하나로 지표·로그·추적**(remote_write·Loki push 따로 두지 않는다). http/protobuf + gzip, Basic(Instance ID : 토큰) |
| 설치 서버 | Grafana Alloy 컨테이너(`deploy/cloud-vm/compose.grafana.yml`, `docker/unleash/compose.grafana.yml`) — FF 지표를 긁고 FF가 보낸 OTLP를 넘긴다. 호스트 포트를 열지 않는다 |
| 공개 데모 | `.github/workflows/grafana-demo.yml` — 15분마다 지난 30분(분 간격)을 '지금' 기준으로 보낸다. 의존성 설치 없이 Node 24로 돈다 |
| 대시보드 | 운영 개요(SLO)·차량 텔레메트리 수신·긴급 차단 반영·Canary 단계 배포·Flag 평가·플랫폼 서비스·Feature 운영 건강도. 로그인용(변수)과 공개본(변수 없음) |
| 경보 | Grafana 관리 경보 15개(운영·문제·개선·위험·플랫폼 축). 받을 곳이 FF webhook이면 FF '운영 관찰'과 이상 징후로 돌아온다(Closed loop) |
| FF 화면 | `/ops/telemetry` 머리 'Grafana에서 보기'(공개 대시보드), Feature 상세 외부 도구 카드 'Grafana — 운영 지표'(로그인 대시보드면 `var-feature`로 좁힌다). 설정이 없으면 숨긴다 |
| 개인정보 | 지표 라벨·로그·추적에 VIN·가명·사람 ID를 싣지 않는다. 라벨은 국가·차종·SW·Feature·Flag·결과뿐 |

## 1. 지표 카탈로그

모든 이름은 `TELEMETRY_METRICS`에 있다. 백엔드 `MetricRegistry`는 카탈로그에 없는 이름을 거부하고, 시험(`tools/grafana/grafana.test.ts`)이 대시보드·경보 쿼리 속 이름이 카탈로그와 같은지 교차 검사한다. 지표마다 라벨 조합 상한 500 — 넘으면 `_other`로 합치고 `ff_metrics_series_dropped_total`로 센다.

### 1.1 차량 수신(FF 백엔드가 낸다 — 커밋된 플랫폼 이벤트를 구독)

| 지표 | 종류 | 라벨 | 뜻 |
|---|---|---|---|
| `ff_vehicle_status_reports_total` | counter | country·vehicle_model·sw_version·feature·via·result·code | 상태 보고 v2 수신. result=accepted·rejected, code=위반 코드(REPLAY·AUTH_FAILED…) |
| `ff_vehicle_status_auth_total` | counter | country·vehicle_model·result | state_auth(CMAC) 검증 valid·invalid(스키마에서 멈춘 보고는 세지 않음) |
| `ff_vehicle_dtc_reports_total` | counter | country·vehicle_model·feature | DTC가 실린 상태 보고 |
| `ff_vehicle_readbacks_total` | counter | country·vehicle_model·sw_version·feature·kind·via·result·reason | 게시본 회신(readback) — 적용·거부와 사유 |
| `ff_vehicle_signature_checks_total` | counter | country·vehicle_model·kind·result | 차량이 회신한 게시본 서명 검증(거부 사유가 서명·키·인증이면 invalid) |
| `ff_vehicle_readback_latency_seconds` | histogram | kind·country | 게시본 서명 → 차량 회신 시간(1초~6시간 경계) |
| `ff_publication_deliveries_total` | counter | kind·channel | 게시본 전달 대상 차량 수(채널별, unreachable 포함) |
| `ff_vehicles_registered` | gauge | country·vehicle_model·sw_version | 등록 차량 |
| `ff_vehicles_silent` | gauge | country·vehicle_model·window(1h·24h) | 창 안에 상태 보고·회신이 없는 차량(미수신) |

### 1.2 긴급 차단·복원

| 지표 | 종류 | 라벨 | 뜻 |
|---|---|---|---|
| `ff_kill_commands_total` · `ff_kill_releases_total` | counter | feature(·deact_class) | 발령·해제 |
| `ff_kill_apply_latency_seconds` | histogram | feature·deact_class·request | 명령 발급 → 차량이 끝 상태를 **처음** 보고하기까지 |
| `ff_kill_overdue_vehicles_total` | counter | feature·deact_class | 기한 감시(kill.overdue)가 올린 차량 수 |
| `ff_kill_reissues_total` | counter | feature | 같은 명령 재전송 요청 |
| `ff_kill_target_vehicles` · `ff_kill_pending_vehicles` | gauge | feature·deact_class | 걸린 차단의 대상·아직 끝 상태가 아닌 차량 |

### 1.3 Flag 평가·Unleash·플랫폼

| 지표 | 종류 | 라벨 | 뜻 |
|---|---|---|---|
| `ff_flag_evaluations_total` | counter | flag·feature·reason·variant·provider | OpenFeature 평가(OFREP·번들 Hook). F2 이상은 reason=DISABLED·variant=safe_default(설계대로) |
| `ff_flag_evaluation_errors_total` | counter | flag·error | 평가 오류 종류 |
| `ff_flag_info` | gauge(1) | flag·policy·feature·feature_version·f_class | Flag ↔ 정책·Feature 결합 |
| `ff_rollout_stage_ratio` | gauge | flag·policy·feature | 단계 배포 비율 0~1 |
| `ff_unleash_edge_request_duration_seconds` | histogram | op·result | Edge 호출 시간·오류 |
| `ff_unleash_drift` | gauge | flag | Unleash 서버 정의가 FF 원천과 다르면 1 |
| `ff_events_total` | counter | type | 주석용 이벤트(정책 배포·단계 확대·차단·복원·기한 초과·운영 관찰) |
| `ff_ext_outbox_pending` | gauge | system | 외부 연계 보낼 함 대기(이벤트 큐) |
| `ff_ops_observations_total` | counter | axis·status | Grafana 경보로 들어온 운영 관찰 |
| `ff_http_requests_total` · `ff_http_request_duration_seconds` · `ff_process_*` | — | method·route·status | 기존 HTTP·프로세스 지표 |

### 1.4 Feature 운영 건강도(Data Lake Gold — 80-75 8장 지표와 같은 뜻)

운영 설치에서는 Data Lake 서버의 `/metrics`(TL-L01)가 낸다(Alloy에 긁기 대상 하나 추가). 공개 데모는 생성기가 같은 이름·뜻으로 만든다.

| 지표 | 라벨 | 뜻 |
|---|---|---|
| `ff_feature_active_vehicles` | feature·feature_version·country·vehicle_model·cohort | 켜져 있는 차량 |
| `ff_feature_usage_seconds_total` · `ff_feature_activations_total` | 〃 | 사용 시간·사용 빈도 |
| `ff_feature_manual_off_total` · `ff_feature_quick_off_total` | 〃 | 운전자가 끈 횟수 · 켠 뒤 60초 안에 끈 횟수(이탈) |
| `ff_feature_fallbacks_total` | 〃 ·reason | Safe Default 폴백(CONTEXT_UNKNOWN·ERROR_SAFE_DEFAULT·NOT_SUPPORTED·KILL_SWITCH) |
| `ff_feature_errors_total` · `ff_feature_dtc_total` | 〃 | 동작 오류 · 관련 DTC |
| `ff_feature_health_indicator` | feature·feature_version·axis·indicator | IF-15 `/v1/metrics/feature-health` Indicator 13종(축 OPERATION·PROBLEM·IMPROVEMENT·RISK) |
| `ff_lake_freshness_seconds` | dataset | 데이터셋 지연 — 30분을 넘으면 판정하지 않는다(판단 불가) |

cohort: Canary 중인 Version은 treatment(새 Version)·control(이전 Version), 나머지는 fleet.

## 2. 전송 경로

### 2.1 설치 서버
- 백엔드: `/api/health/metrics`(운영 모드는 `Authorization: Bearer FF_METRICS_TOKEN`). `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318`이면 추적(평가 span — `feature_flag.context.id` 가명 속성은 빼고)과 차량 수신 로그를 OTLP로 보낸다. 보내기가 실패해도 기능은 영향이 없다(버리고 센다).
- Alloy(`deploy/grafana/alloy/config.alloy`): `prometheus.scrape`(job `ff/ff-platform`, 30초) → `otelcol.receiver.prometheus` → batch → `otelcol.exporter.otlphttp`(Basic). OTLP 수신기 4318도 같은 내보내기로.
- 켜기: `.env`에 `deploy/grafana/grafana.env.example` 항목을 채우고 `FF_COMPOSE_EXTRA='-f compose.grafana.yml'`(클라우드 VM) 또는 `docker compose -f docker-compose.yml -f compose.grafana.yml --profile platform up -d`(docker/unleash).

### 2.2 공개 데모
- `grafana-demo.yml`: 15분 예약 + 수동(창 1~60분) + 병합 전 `feat/grafana-telemetry` push 때 한 번(최근 60분). 비밀이 없으면 '비밀 없음'으로 **실패**한다(건너뛰기 성공 아님).
- 같은 시각의 값은 언제 다시 만들어도 같다(결정적) — 겹쳐 보낸 점은 같은 값이라 중복 오류가 아니다. 누적 지표는 UTC 자정에 0부터(OTLP start_time = 자정).
- 자원 속성: `service.namespace=ff`, `service.name=ff-platform`(Lake 지표는 `ff-datalake`), `service.instance.id=ff-public-demo` → Prometheus `job="ff/ff-platform"`·`instance="ff-public-demo"`. 설치 서버와 같은 job 이름이라 대시보드가 둘을 같이 본다(`instance` 변수로 나눈다).

## 3. 비밀·변수

| 이름 | 종류 | 어디서 | 쓰는 곳 |
|---|---|---|---|
| `GRAFANA_STACK_URL` | 저장소 비밀 | `https://<스택>.grafana.net` | grafana-provision |
| `GRAFANA_SA_TOKEN` | 저장소 비밀 | 스택 Administration → Users and access → Service accounts → 역할 **Admin** → Add token | grafana-provision |
| `GRAFANA_OTLP_URL` | 저장소 비밀 | grafana.com 포털 → 스택 → **OpenTelemetry** Configure → Endpoint(`https://otlp-gateway-<지역>.grafana.net/otlp`) | grafana-demo, 설치 서버 Alloy |
| `GRAFANA_OTLP_INSTANCE_ID` | 저장소 비밀 | 같은 화면의 Instance ID(숫자) | 〃 |
| `GRAFANA_OTLP_TOKEN` | 저장소 비밀 | 같은 화면에서 만든 토큰(Cloud Access Policy — metrics·logs·traces **write**) | 〃 |
| `FF_GRAFANA_WEBHOOK_SECRET` · `_TOKEN` | 저장소 비밀(선택) | FF 설치 서버 `.env`와 같은 값 | 경보 → FF webhook 연락처 |
| `FF_GRAFANA_WEBHOOK_URL` · `GRAFANA_ALERT_EMAIL` · `FF_PUBLIC_URL` | 저장소 변수(선택) | — | 연락처·데이터 링크가 여는 FF 주소(기본 `https://feature-topology.pages.dev`) |
| `GRAFANA_PUBLIC_URL` · `GRAFANA_FEATURE_PUBLIC_URL` · `GRAFANA_URL` | 저장소 변수 | grafana-provision 실행 요약 | cloudflare·pages 빌드 → `VITE_GRAFANA_*` |

받을 곳(FF webhook·메일)이 없으면 FF 경보 경로에 하루 종일 묵음(`ff-quiet-no-receiver`)을 걸어 알림만 막는다 — 경보 평가·상태는 Grafana 경보 목록에 그대로 보인다(공개 시연이 관리자 메일함을 채우지 않게).

## 4. 대시보드 — 이 패널로 무엇을 판단하나

모든 패널에 설명(description)·단위·임계값 색이 있다. 시간축 주석: 정책 배포·단계 확대(파랑), 긴급 차단(빨강), 복원(초록), 기한 초과(주황), 운영 관찰(보라, 기본 끔). 머리 링크: FF 운영 대시보드 묶음(같은 변수·시간 유지), FF에서 열기, 런북. 데이터 링크는 FF Feature 상세(`/features/:id/:ver`)·정책 상세·긴급 차단 화면을 연다.

| 대시보드(uid) | 판단 | 핵심 패널 |
|---|---|---|
| FF 운영 개요 (`ff-ops-overview`) | 서비스 수준이 지켜지는가, 지금 배포를 멈춰야 하는가 | SLO 4종(수락률 99.5%·서명 99.9%·정책 반영 120초 안 95%·차단 기한 내 99%), 수락률 오류 예산 남음·소진 속도(1h 14.4 / 6h 6), 수신율·반영 p50/p95/p99 |
| 차량 텔레메트리 수신 (`ff-vehicle-telemetry`) | 어느 시장·차종·SW·채널의 수신이 나쁜가 | 국가·차종별 수신, 미수신 1h·24h 추세, 통신 채널별, 거부 코드, 회신 지연 히트맵, 서명 검증 실패, SW 버전별 표, 수신 로그(Loki) |
| 긴급 차단 반영 (`ff-kill-switch`) | 차단이 얼마나 빨리·얼마나 넓게 반영되는가 | 명령별 반영률 곡선, 명령→회신 p50/p95/p99(등급·요청별), 시간-반영 히트맵, 지연 차량 Top(Feature·등급), 재전송·기한 초과, 차단 로그 |
| Canary 단계 배포 (`ff-canary`) | 새 Version 적용군이 대조군보다 나쁜가 — 확대해도 되는가 | 적용군 비율, DTC·오류·폴백 상대위험(24시간 창, 1.5 주의·2 중단), 활성 1천 대당 비교, Flag 단계 비율·분할 평가 |
| Flag 평가 (`ff-flag-eval`) | 평가가 의도대로 나오는가, Edge·Unleash가 건강한가 | 평가/초·폴백·오류율·안전 경계(F2+), 사유·변형별, 오류 종류, Edge 지연·오류율, drift 타임라인, 배포 Flag 표(FF 정책 링크), 오류 추적(Tempo) |
| 플랫폼 서비스 (`ff-platform`) | FF 자체가 건강한가 | 요청·5xx·p95·가동 시간, 경로별, 메모리, 외부 연계 큐, 이벤트, drift·Edge, Lake 신선도, 운영 관찰, 상한 합침 |
| Feature 운영 건강도 (`ff-feature-health`) | 어느 Feature를 고쳐야 하나(개선 후보) | 4축 표(색=개선 후보, Feature 링크), 사용률·사용 시간·빈도, 수동 끄기·이탈, 차종별 폴백·사유, Version별 오류(출시 전후), DTC, 시장·차종 차이, Canary 상대위험, 신선도, FF로 돌아간 개선 후보 |

공개본(`<uid>-public`, 폴더 'FF 운영 (공개 시연)')은 외부 공유(Shared dashboards)가 변수를 지원하지 않아 변수를 `.*`, `$__rate_interval`을 5m로 고정하고 로그인 대시보드로 가는 링크를 뺐다. FF 데이터 링크는 남는다.

## 5. 경보 규칙과 런북

모든 규칙 라벨: `ff_source=feature-platform`, `ff_axis`(OPERATION·PROBLEM·IMPROVEMENT·RISK·PLATFORM), `severity`. `ff_anomaly_kind`가 있으면 FF가 이상 징후(D06-12) 신호로도 받는다. 개선 축은 운영 관찰로만 남는다. 알림 정책: Feature·Version으로 묶고 4시간마다(개선 축은 24시간) 다시 알린다.

<a id="ff-reception-drop"></a>
### 수신율 저하 (`ff-reception-drop`, 운영·warning)
- 조건: 국가·차종별 수락 보고가 지난주 같은 시간의 50% 아래로 15분(지난주 자료가 없으면 평가하지 않는다).
- 누가: 운영 담당(OPERATOR) → 운영 책임자(OPS_LEAD).
- 확인: 차량 텔레메트리 수신 → 통신 채널별·미수신 추세. 한 채널만 줄면 그 게이트웨이, 한 시장 전체면 지역 통신·OTA 서버.
- FF 조치: 외부 연계 현황(`/integration/connectors`, OTA 서버 IF-05)·운영 데이터(`/ops/telemetry`). 지연 중 배포는 보류.

<a id="ff-status-reject"></a>
### 상태 보고 거부율 상승 (`ff-status-reject`, 운영·warning)
- 조건: 거부율 0.5% 초과 10분(SLO 수락률 99.5%).
- 누가: 운영 담당 → 보안 담당(AUTH_FAILED가 많을 때).
- 확인: 거부 코드 — REPLAY(차량 순번 저장), SCHEMA·PSEUDONYM_MISMATCH(차량 SW 규격), AUTH_FAILED(서명).
- FF 조치: 이상 징후(`/ops/anomalies`, 보안)에서 차량 수 확인, 차량 SW 담당 협력사에 규격 위반 통보.

<a id="ff-signature-surge"></a>
### 서명 검증 실패 급증 (`ff-signature-surge`, 위험·critical)
- 조건: 국가·차종별 10분 서명 실패 3건 초과.
- 누가: 보안 담당(SECURITY_OFFICER·CSM).
- 확인: FF는 위반 보고를 이미 이상 징후(보안)로 올린다. 키 Epoch 회전 직후인지, 특정 SW 버전인지.
- FF 조치: 보안·인증서(`/admin/security`) — Epoch·키 상태, 필요하면 채널 제한. 위조로 보이면 Incident.

<a id="ff-kill-latency"></a>
### 긴급 차단 반영 지연 (`ff-kill-latency`, 운영·critical, 이상 징후 DELIVERY)
- 조건: 15분 안에 기한 초과 차량이 생김.
- 누가: 운영 책임자(OPS_LEAD) — 안전 담당(SAFETY_OFFICER)에게 공유.
- 확인: 긴급 차단 반영 → 반영 곡선이 멈춘 높이, 지연 차량 Top, 재전송.
- FF 조치: 긴급 차단·복구(`/ops/kill`) 상세에서 차량별 봉투·상태, 오프라인 차량은 OTA 서버 대기열. 오래 남으면 현장 회수(리콜 절차).

<a id="ff-flag-errors"></a>
### Flag 평가 오류율 (`ff-flag-errors`, 운영·warning)
- 조건: Flag별 ERROR 1% 초과 10분. SDK는 기본값(Safe Default)을 쓰므로 기능이 꺼진 채로 동작한다.
- 누가: 배포 담당(RELEASE_MANAGER) — 구현 담당(IMPLEMENTER).
- 확인: Flag 평가 → 오류 종류(flag_not_found면 배포 안 된 키, general이면 평가기·Edge).
- FF 조치: 정책 상세(`/policies/:id`)·Unleash 동기화, 소스 사용처(Feature Flag 소스) 확인.

<a id="ff-edge-errors"></a>
### Edge 오류율 (`ff-edge-errors`, 플랫폼·critical)
- 조건: Edge 호출 오류 5% 초과 5분. 차량 서명본 발급이 멈춘다(FF가 막는다).
- 누가: 플랫폼 운영(설치 담당).
- 확인: 설치 서버 edge 컨테이너 상태·Unleash 서버 연결(20-98).
- FF 조치: 외부 연계 현황에서 Unleash 상태, 복구 뒤 drift 대조.

<a id="ff-unleash-drift"></a>
### Unleash drift (`ff-unleash-drift`, 플랫폼·warning)
- 조건: 서버 정의가 FF 원천과 10분 넘게 다름.
- 누가: 배포 담당.
- 확인: Flag 평가 → drift 타임라인. Unleash에서 직접 바꾼 사람(감사).
- FF 조치: 정책 상세 → Unleash 동기화로 되돌린다(FF가 원천).

<a id="ff-api-5xx"></a>
### API 5xx 비율 (`ff-api-5xx`, 플랫폼·warning)
- 조건: 5xx 1% 초과 10분.
- 누가: 플랫폼 운영.
- 확인: 플랫폼 서비스 → 경로별 오류·p95, 설치 서버 JSON 로그(상관 ID).
- FF 조치: 상태 점검(`/api/health/ready`), 재시작 뒤 기한 감시 복구 확인.

<a id="ff-lake-stale"></a>
### Data Lake 신선도 초과 (`ff-lake-stale`, 위험·warning)
- 조건: gold_5m·relay 지연 30분 초과 15분.
- 누가: 데이터 운영(Lake).
- 확인: 플랫폼 서비스 → Data Lake 신선도. 이 동안 Feature 운영 판정은 '판단 불가', 단계 확대는 보류.
- FF 조치: Data Lake 연계(`/integration/datalake`, TL-UI10) — 80-75.

<a id="ff-imp-fallback-model"></a>
### 차종별 폴백 급증 (`ff-imp-fallback-model`, 문제·warning, 이상 징후 FEATURE_FAULT)
- 조건: Feature·Version·차종별 폴백(긴급 차단 제외)이 켜짐의 3% 초과 30분(평소 1% 아래).
- 누가: Feature Owner — 변형 담당(VARIANT_OWNER).
- 확인: Feature 운영 건강도 → 차종별 폴백·폴백 사유. NOT_SUPPORTED면 대상 정의가 실제 차량 구성보다 넓다.
- FF 조치: Feature 상세 → 지원 조건·변형 조건 재검토, 변경 요청 초안(JIRA CR). 효과는 같은 패널에서 확인.

<a id="ff-imp-error-regression"></a>
### 출시 후 오류 증가 (`ff-imp-error-regression`, 문제·warning, 이상 징후 FEATURE_FAULT)
- 조건: 같은 Feature의 가장 낮은 Version 대비 활성 차량당 오류 1.5배 이상 1시간.
- 누가: Feature Owner·Release Manager.
- 확인: Feature 운영 건강도 → Version별 오류(출시 전후), DTC.
- FF 조치: 결함 등록(JIRA), 롤백(`/ops/rollback`) 판단, 단계 배포 중이면 HOLD.

<a id="ff-imp-low-usage"></a>
### 사용률 저조 (`ff-imp-low-usage`, 개선·info)
- 조건: IF-15 usage_rate 30% 아래 6시간.
- 누가: Feature Owner(상품 기획과 함께).
- 확인: 사용률·국가·차종별 활성 비율 차이.
- FF 조치: 개선 후보로 Feature 운영 점검에 올리고 발견성(HMI)·기본값·안내 문구 개선을 변경 요청으로.

<a id="ff-imp-manual-off"></a>
### 운전자가 자주 끔 (`ff-imp-manual-off`, 개선·info)
- 조건: 켜짐 대비 수동 끄기 15% 이상 2시간(시장별).
- 누가: Feature Owner.
- 확인: 수동 끄기 비율, 사용 빈도·시간.
- FF 조치: 개입 강도·민감도 파라미터 변경 요청 → 새 Version → Canary로 효과 확인.

<a id="ff-imp-quick-off"></a>
### 켜고 바로 끔 (`ff-imp-quick-off`, 개선·info)
- 조건: 켠 뒤 60초 안에 끄는 비율 10% 이상 2시간.
- 누가: Feature Owner·HMI 담당.
- 확인: 이탈 비율, 첫 사용 시장·차종.
- FF 조치: 첫 경험(첫 안내·화면 가림) 개선 변경 요청.

<a id="ff-imp-canary-dtc"></a>
### Canary 적용군 DTC 증가 (`ff-imp-canary-dtc`, 위험·warning, 이상 징후 FEATURE_FAULT)
- 조건: 적용군/대조군 DTC 상대위험 1.5 이상 1시간.
- 누가: Release Manager·Safety Officer.
- 확인: Canary 단계 배포 → 상대위험·활성 1천 대당 비교.
- FF 조치: 정책 상세 → 단계 확대 HOLD, 필요하면 롤백. 원인 분석 뒤 확대 재개.

## 6. Closed loop — 운영 신호에서 개선까지

```
Grafana 운영 신호 → 경보(개선 후보) → FF webhook → 운영 관찰 기록(+ 이상 징후 신호)
   ↑                                                       ↓
 효과 확인(같은 패널·Canary)  ←  새 Version·정책 변경  ←  Feature Owner 검토 → 변경 요청 초안
```

- 수신: `POST /api/webhooks/grafana/alerts`(D04-03). 확인은 `FF_GRAFANA_WEBHOOK_SECRET`(HMAC-SHA256 hex, `X-Grafana-Alerting-Signature`, 시각 머리글 `X-Grafana-Alerting-Timestamp`가 있으면 `시각:본문`, ±5분) 또는 `FF_GRAFANA_WEBHOOK_TOKEN`(Bearer). 둘 다 비우면 창구가 꺼진다(404). 같은 경보(지문·시작 시각·상태)는 한 번만 기록한다.
- 기록: 이벤트 `ops.observation.recorded`(감사 `OPS_OBSERVATION`, 계약 `OpsObservation`) — Feature·Version·축·심각도·요약·값·대시보드/패널 URL. 조회 `GET /api/ops/observations?featureId=&axis=&status=`.
- 이상 징후: 규칙 라벨 `ff_anomaly_kind`가 있고 축이 개선이 아니며 Feature가 실재하면 `AnomalyService`가 신호(`GRAFANA:<규칙>`, ref=관찰 ID)로 받는다 → `/ops/anomalies`.
- 연결 지점(다른 브랜치 `feat/telemetry-ui`): Feature 운영 점검 판정 엔진(TL-B08 Finding)은 `ops.observation.recorded`를 근거로 읽고, Feature 상세 '운영 지표'(TL-UI04/18)·`/ops/feature-health`(TL-UI16)는 관찰 목록과 Grafana 링크(`var-feature`)를 함께 보인다. 지표 이름·축·Indicator 이름은 IF-15 계약(`datalake-if15.openapi.json` Indicator)과 같다.
- 양방향 링크: FF → Grafana(Feature 상세 외부 도구 카드, `/ops/telemetry` 머리), Grafana → FF(데이터 링크 `${ff_url}/features/:id/:ver`·정책·긴급 차단).
- 공개 데모는 정적 사이트라 webhook을 받을 수 없다 — 경보는 Grafana 경보 목록에서만 보이고(묵음), FF 연결은 설치 서버에서 켠다.

## 7. 시연 데이터 생성기

- FF 시연 데이터(`deploy/grafana/demo-catalog.json` — `node tools/grafana/demo-catalog.ts`가 정적 데모와 같은 시드로 뽑는다): 차량 480대(8칸: KR·EU·US × NX4 PE·GN7·NE PE × SW), 배포 Flag 5개(care_00022_*, ivi_00024_guide, ivi_00027_*), 실험 2개, 긴급 차단 KILL-00001(FEAT-00029, DC2), RELEASED Feature 21개(이전 Version 포함). 차량이 없는 시장(AU)은 보내지 않는다.
- 패턴: 시장 현지 시각 주행(평일 출퇴근 정점·주말 늦은 정점), 로그정규 회신 지연·오프라인 꼬리, 칸별 간헐 장애(하루 25% 확률, 15~45분), 사흘에 한 번 꼴 서명 위조 시도(20분), 주 1회 Edge 장애(목 01:00 UTC 30분)·Unleash drift(목 02:00 UTC 40분), 하루 정책 배포 2~3회(KR 업무 시간), 긴급 차단 1~2회(현지 업무 시간, 등급별 반영 지연·기한 초과·재전송·4~10시간 뒤 복원)와 FF 시연에 걸려 있는 KILL-00001(대상 1대, 반영 완료), Canary 14일 주기(FEAT-00145 KR NX4 PE 스마트 크루즈 5.5.0 적용군 5%→25%→50%→100%, 6일째부터 적용군 DTC 1.9배). Canary 비교는 적용군이 작아 24시간 창을 쓴다.
- 개선 후보 시나리오: FEAT-00024 사용률 17%, FEAT-00026(EU) 수동 끄기 21%, FEAT-00027(EU) 이탈 13%, FEAT-00002 1.6.0 오류 2.6배(1.5.0 대비), FEAT-00004 4.1.0 GN7 폴백 8.5%(주기 3일째부터).
- F2 이상 Flag(care_00022_*)는 OpenFeature 경계대로 평가가 DISABLED·safe_default다.

## 8. 비용 — Grafana Cloud 무료 한도(2026-11 확인)

| 항목 | 무료 | 이 연동(공개 데모) |
|---|---|---|
| 지표 | 활성 시계열 1만, 보존 14일, 분당 1점 | 약 1,000~1,100 시계열(Prometheus 기준, 히스토그램 칸 포함) · 분당 1점 |
| 로그 | 월 50 GB, 14일 | 15분마다 수십 줄(하루 수 MB) |
| 추적 | 월 50 GB, 14일 | 15분마다 100여 span |
| 사용자 | 월 활성 3명 | 공개 대시보드는 로그인 없이(사용자 수에 들지 않음) |
| GitHub Actions | 공개 저장소 무료 | 15분 예약(1회 1분 안쪽) |

설치 서버를 붙이면 HTTP 경로·차량 수에 따라 시계열이 늘어난다 — 지표당 상한 500과 `ff_metrics_series_dropped_total`로 지킨다.

## 9. 실행

| 무엇 | 명령 |
|---|---|
| 대시보드·경보 JSON 다시 만들기 | `node tools/grafana/build-dashboards.ts` (`--check` = verify 단계 `grafana:check`) |
| 시연 데이터 ID 다시 뽑기 | `npm run build -w feature-topology-backend && node tools/grafana/demo-catalog.ts` |
| 시연 전송 크기만 보기 | `node tools/grafana/push-demo-metrics.ts --dry-run` |
| 프로비저닝 | GitHub Actions `Grafana 프로비저닝`(수동 또는 `feat/grafana-telemetry` push) — 실행 요약의 `gh variable set …`을 실행한 뒤 Cloudflare 배포를 다시 돌린다 |
| 시험 | `node --test tools/grafana/grafana.test.ts` · 백엔드 `test/kernel/telemetry-metrics.spec.ts`·`test/d04/grafana-alert.spec.ts` · 프론트 `grafanaLinks.test.tsx` |

## 10. 한계

- 외부 공유(공개) 대시보드는 변수를 지원하지 않는다(Grafana 12.3·13 기준) — 공개본은 전체 Feature·국가를 함께 보이고 Feature로 좁히지 못한다. 좁힌 보기는 로그인 대시보드(`VITE_GRAFANA_URL`).
- Grafana 13은 `/api` 경로를 `/apis`로 옮기는 중이다. 공개 대시보드·경보 프로비저닝은 아직 `/api` 경로로 동작하지만 갱신되지 않는다 — 경보 단계 오류는 대시보드·공개 URL과 따로 보고한다(종료 1).
- 예약 실행은 기본 브랜치에서만 돈다. 병합 전에는 push 때 한 번(최근 60분)만 보내므로 대시보드가 이어지지 않는다.
- GitHub 예약은 늦어질 수 있다(수 분~수십 분) — 30분 창으로 겹쳐 보내지만 그보다 늦으면 빈 구간이 생긴다.
- Feature 운영 건강도 지표(1.4)는 운영 설치에서 Data Lake 서버(TL-L01)가 생긴 뒤 실제 값이 된다. 그 전에는 시연 생성기만 낸다.
- 공개 데모는 webhook을 받을 수 없다. FF 쪽 Closed loop(운영 관찰·이상 징후)는 설치 서버에서만 돈다.
- 임베드(`VITE_GRAFANA_EMBED=1`)는 공개 사이트 CSP `frame-src`에 스택 주소가 있어야 한다(`functions/_headers`는 다른 작업이 맡고 있어 바꾸지 않았다).
- Alloy·Prometheus 이미지는 태그로 고정했다(digest 고정은 설치 때). PromQL 문법·Alloy 설정·compose 검사는 CI(`grafana-provision.yml` 설정 검사)에서만 돈다 — 로컬에 Grafana·Prometheus를 두지 않는다.
