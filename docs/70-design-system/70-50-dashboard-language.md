---
id: DS-DASHBOARD
type: design-system
title: "대시보드 디자인 언어 — Engineering Instrument 대시보드 판"
status: draft
version: 1.0.0
owner: feature-architect
cycle: 49
standards: [WCAG-2.1-AA]
traces:
  satisfies: [NFR-6, NFR-7]
last_updated: 2026-11-06
---

# 대시보드 디자인 언어 — "Engineering Instrument" 대시보드 판 (v1, 2026-11-06)

대상: FF 홈 대시보드(차량 정책 수신 현황·Feature 적용 현황), Feature DB·개발비 탐색판(design/workbook), Flag 코드 연결 화면 8개, Data Lake·Feature 상태 화면, ADS 화면, Grafana 대시보드 6종(+ 2종).
기준 구현: 홈 `screens/home/dashboard/`(ReadOnlyOperationOverview·overview-visuals·adoption-*). 이 문서와 어긋나면 이 문서를 고치고 화면을 따라 고친다.

원칙 다섯 줄
1. **한 화면 한 주인공.** 화면에서 가장 큰 숫자는 하나(히어로)다. 나머지 숫자는 그보다 작고, 같은 숫자를 두 번 크게 쓰지 않는다.
2. **색은 의미가 있을 때만.** 강조색(코발트)은 조작·선택·링크에만. 데이터 표식은 의미색(상태) 또는 범주색(정체) 둘 중 하나만 — 한 차트 안에서 섞지 않는다.
3. **숫자는 계기판 글꼴.** 값·단위·시각·ID는 JetBrains Mono tabular(`.ds-mono`·`font-variant-numeric: tabular-nums slashed-zero`). 0과 O가 헷갈리지 않는다.
4. **상자를 줄인다.** 카드 안 카드 금지. 섹션은 머리글 + 얇은 구분선, 카드는 "따로 클릭되는 것"에만.
5. **설명은 한 줄.** 패널 설명은 한 줄(약 60자) 이하. 그 이상은 "집계 기준" 접기(`<details>`) 또는 도움말 툴팁으로.

---

## 0. 감사 결과 (2026-11-06, 스크린샷·코드 근거)

| # | 문제 | 어디서 | 규칙 |
|---|---|---|---|
| A1 | 히어로가 코발트 **그라데이션 면**(밝은 테마 진한 남색, 다크 테마 형광 연보라 판) — 화면에서 가장 시끄러운 요소가 장식 | 홈 `.ov-hero` | §3.1 히어로는 면 그대로, 숫자만 크게 |
| A2 | 보조 KPI 카드 숫자가 카드 **바닥에 붙고 위가 비어** 있음, 왼쪽 색 막대(회·갈·갈·회) | 홈 `.ov-kpis` | §3.2 라벨 바로 아래 숫자, 색 막대 금지 |
| A3 | **같은 갈색이 두 뜻**(미확인 160·차단 수신 1), 흐름 단계 번호 1·2도 갈색(의미 없음), 3은 청록 | 홈 KPI·흐름 띠 | §4.1 의미색 표 |
| A4 | 고리 바깥(범주색 초록 = US·NE PE)과 안쪽(상태색 초록 = ON 포함)이 **같은 초록 두 뜻**. 범주 파랑(KR)과 상태 파랑(OFF만) 충돌 | 홈 국가·차종 고리 | §4.3 한 차트 한 인코딩 |
| A5 | 홈 '미확인'은 회색, 차량 지도 '미확인'은 호박색, 홈 '차단 수신'은 호박, 지도 '긴급 차단'은 빨강 — **드릴다운 목적지와 색 뜻이 다름** | 홈 ↔ /fleet/map | §4.2 상태 사전(지도 기준) |
| A6 | 숫자 글꼴 둘 — 머리 KPI는 Mono, 카드 숫자는 SUIT(0이 O처럼 보임) | 개발비·Feature DB·홈 | §2 숫자 타이포 |
| A7 | 머리 숫자가 KPI 카드에 **다시 크게** 나옴(7,577.4·1,052), '조건에 맞는 행' 카드가 선택 상태처럼 코발트 면 | 개발비·Feature DB | 원칙 1·§3.2 |
| A8 | 필터 레일이 값마다 상자, 0건 값도 같은 자리 | 개발비·Feature DB 오른쪽 | §7.4 0건 값은 흐리게·접기 |
| A9 | 설명 문단 남발(고리 아래 2줄, 지도 아래 1줄, 흐름 아래 1줄, KPI 아래 2줄, 시간축 아래 3줄) | 홈 | 원칙 5 |
| A10 | 필터 띠가 청록 면 + 청록 막대 — 운영 영역 표식(--area-ops)을 장식으로 씀 | 홈 | §1.4 |
| A11 | 회신 대기 막대가 **녹색**(대기는 좋은 상태가 아님), 다섯 줄 숫자가 모두 40 | 홈 Top | §4.1 진행 = 정보색, 같은 값 반복은 표로 |
| A12 | 시간축 점: 크기 인코딩 범례 없음, 청록·빨강 | 홈 시간 분포 | §5.6 |
| A13 | 반경 4px(`--sp-1`을 반경으로) — 하네스 ⑤ 반경 3·5·8 위반, 히어로 라벨 '정책 신뢰 수신율'↔'선택 차량' 겹침(좁은 폭) | 홈 `.ov-hero__bar` | §1.3 |
| A14 | 다크: 카드 테두리가 거의 안 보임, 지도 거품(청록) 대비 낮음, 주황 강조가 밝은 테마보다 뜨거움 | 홈 다크 | §8 |
| A15 | 상태 pill이 화면마다 다름(채운 녹색·회색 외곽선·대문자 회색 'DEPLOYED'), 출처 표시('FF 스캐너 서명')에 녹색 상태 pill | 개발비·Flag 코드·킬 | §6 |
| A16 | 카드 3단 중첩(상태별 어긋남 → 열 카드 → 행 카드), 행마다 같은 버튼 반복 | Flag 코드 대조 | 원칙 4 |
| A17 | 평가 추이: 두 선이 거의 겹침(차이를 못 읽음), 폴백 사유 막대에 상태 빨강을 범주로 사용 | Flag 코드 평가 | §5.2·§4.3 |
| A18 | Grafana: Stat 패널 `colorMode: background`(면 전체 색), 이름 색(green/orange/red)이 FF hex와 다름, bargauge `gradient`, 설명 3문장 | Grafana 6종 | §9 |
| A19 | 390폭: Feature DB 표가 6,900px 세로·이름 6~8줄, 개발비 표 오른쪽 잘림 | 탐색판 | §10 |

**표준으로 삼을 것(좋은 예):** Flag 코드 '커버리지' 머리(빨간 Mono 숫자 + 판정 한 문장 + Mono 보조 줄 = `.ds-key`+`.ds-summary`), Flag 코드·스캔 표(코발트 Mono 링크·점 달린 상태 pill·Mono 시각·옅은 행선), 저장소 키-값 표, 연계 요약 표(오른쪽 정렬 Mono 수, 실패 1만 빨강), Feature DB 두 줄(한/영) 행과 쪽 매김("1–50 / 1,052건 · 1 / 22쪽").

---

## 1. 레이아웃

### 1.1 12열 그리드
- 대시보드 본문은 **12열**, 열 간격 `--dash-gap`(= `--sp-4` 16px, compact `--sp-3` 12px). 바깥 여백 `--sp-5`(390폭 `--sp-4`).
- 행(row)마다 합 12. 허용 분할: 12 · 8+4 · 6+6 · 4+4+4 · 3×4(KPI) · 4+8(히어로+보조 KPI).
- 폭 기준은 **컨테이너 질의**(`container: dash / inline-size`) — 셸 패널이 열리고 닫혀도 같은 규칙. 미디어 질의는 글자 크기 토큰에만.

```css
.dash { container: dash / inline-size; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--dash-gap); }
.dash > * { grid-column: 1 / -1; min-width: 0; }
@container dash (min-width: 900px) { .dash__8 { grid-column: span 8; } .dash__4 { grid-column: span 4; } .dash__6 { grid-column: span 6; } }
```

### 1.2 밀도 2단계
| 단계 | 언제 | 행 높이 | 패널 안쪽 | KPI 히어로 숫자 | 보조 KPI 숫자 |
|---|---|---|---|---|---|
| comfortable | 1600px 이상(`--fs-base` 14) | `--row-h` 36 | `--sp-4`/`--sp-5` | `--fs-kpi-hero`(36px) | `--fs-kpi`(22px) |
| compact | 1599px 이하(`--fs-base` 13) | 32 | `--sp-3`/`--sp-4` | 33px | 20px |
시연 모드(`data-present`)는 토큰이 이미 키운다 — 화면 CSS에서 따로 키우지 않는다.

### 1.3 모서리·선
- 반경은 `--r-sm`(3) 막대·칩, `--r`(5) 패널, `--r-lg`(8) 떠 있는 것(서랍·팝오버), `--r-pill`, 50%(점)만. **간격 토큰을 반경에 쓰지 않는다**(`border-radius: var(--sp-1)` 금지 — 하네스 ⑤).
- 패널 테두리 `1px var(--line)`, 대시보드 바깥 틀 `--line-strong`. 그림자는 대시보드 안에서 쓰지 않는다(`--e-1`조차) — 떠 있는 층에만.

### 1.4 섹션 머리
- 패널 제목 `h3` `--fs-base` 700, 오른쪽에 보조(Mono 수·링크) 한 줄. 눈썹(eyebrow) `--fs-xs` 650 `--muted`는 묶음 이름에만.
- 운영 영역 표식(`--area-ops` 청록)은 셸의 영역 표식 전용. 필터 띠·숫자·점에 쓰지 않는다.

### 1.5 빈 공간
- 카드 높이를 맞추려 비우지 않는다: 같은 행 패널은 `align-items: start`, 내용이 다른 높이면 짧은 쪽에 보조 표(Top 5 등)를 붙이거나 열 수를 줄인다.
- KPI 타일은 라벨→숫자→보조가 위에서부터. `align-content: space-between` 금지(A2).

---

## 2. 숫자 타이포

| 쓰임 | 글꼴 | 크기 | 굵기 | 비고 |
|---|---|---|---|---|
| 히어로 값 | Mono tabular slashed-zero | `--fs-kpi-hero` | 700 | 줄간 1.05, 자간 -0.02em |
| 히어로 단위(%·대·백만원) | Mono | 값의 0.5 | 600 | 값 뒤 붙임, 색 `--muted` |
| 보조 KPI 값 | Mono | `--fs-kpi` | 700 | |
| 표·목록 수 | Mono | `--fs-sm` | 600 | **오른쪽 정렬**, 머리글도 오른쪽(하네스 L6) |
| 시각 | Mono | `--fs-xs` | 400 | `M. D. HH:MM:SS`, 날짜 줄바꿈 금지 |
| 변화량 | Mono | `--fs-xs` | 600 | `▲ 12`/`▼ 3`/`— 0` 기호 + 숫자. 좋고 나쁨은 의미색 글자 + 기호(색만으로 금지) |
| 라벨 | SUIT | `--fs-xs` | 600 | `--muted`, 문장형 아닌 명사형 |

- **Mono는 숫자·ID·코드·시각만.** 한글이 섞인 문자열('320/480대', '동기화 기록 8건', '비중 75% · 수신 67%')은 SUIT + `font-variant-numeric: tabular-nums` — JetBrains Mono에는 한글 글리프가 없어 대체 글꼴로 넓게 벌어진다(기준 구현 1차에서 확인). `.ds-badge` 안의 한국어 낱말은 `.ds-badge__ko`.
- 천 단위 쉼표, 소수는 화면 안에서 자릿수 고정(`format.ts`의 `formatCount`·`formatExact`). 단위는 머리글 또는 값 뒤 하나로만(개발비: 머리 '백만원'이면 표도 백만원 — A19 혼용 금지).
- 값이 없음: `—`(em dash) Mono `--faint`. '0'과 구분.
- 값 색: 기본 `--ink`. 의미색 글자는 **0이 아닌 주의·위험 값**에만(0이면 neutral 강제 — KeyMessage 규칙과 같다).

## 3. KPI

### 3.1 히어로(화면당 1개)
```
┌───────────────────────────────┐
│ 정책 신뢰 수신율        480대 중 │  ← 라벨 xs muted · 오른쪽 맥락 Mono xs
│ 67%                           │  ← --fs-kpi-hero Mono 700, '%'는 단위 크기
│ ▲ 320대  최근 회신 1,608건       │  ← 보조 한 줄 Mono xs
│ ▆▆▆▆▆▆▆▆▆▆▆▆░░░░░░  ⌇sparkline │  ← 구성 막대(의미 표식색) + 추세 스파크라인
└───────────────────────────────┘
```
- 면은 `--surface`, 테두리 `--line`, **그라데이션·채운 강조면 금지**. 왼쪽 4px 강조선도 쓰지 않는다.
- 구성 막대: 높이 8px, 반경 `--r-sm`, 조각 사이 2px 면 간격, 색은 §4.1 표식색, 조각 위 마우스·초점 시 툴팁, 막대 아래 범례 한 줄(점+낱말+수).
- 스파크라인: 폭 96~160px·높이 28px, 선 1.5px `--chart-line`, 마지막 점 3px `--ink`, 축·격자 없음, `aria-hidden` + 같은 내용 텍스트(`최근 n분 누적 회신 a→b`).

### 3.2 보조 KPI 타일
- 3·4·5·6개를 한 줄. 라벨(위) → 값(바로 아래) → 보조(변화량·기준). 타일 최소 폭 132px.
- 타일 전체가 링크일 때만 hover 면 `--surface-2`와 오른쪽 위 `→`. 라벨만 링크로 만들지 않는다.
- 상태 표시: 값이 주의·위험이면 라벨 앞 점(8px, 표식색) + 값 글자 의미색. 색 막대·면 금지.
- 히어로 값과 같은 수를 다시 KPI 타일로 만들지 않는다(A7).

## 4. 색

### 4.1 의미색(상태) — 글자용과 표식용을 나눈다
글자용은 기존 토큰(AA 4.5:1), 그림 표식(점·막대·선)용은 **새 `--mark-*`** (전 조합 색각 이상 ΔE 검증: 밝음 worst 8.6, 어두움 6.5 → 다크는 모양 병기 필수).

| 뜻 | 글자 토큰 | 표식 토큰(밝음 / 어두움) | 모양(색 없이도) | 쓰는 곳 |
|---|---|---|---|---|
| 정상·적용·통과 | `--ok` | `--mark-ok` `#16784a` / `#2fa66c` | ● 채운 원 | 적용 ON, 수신, PASS |
| 주의·미확인 | `--warn` | `--mark-warn` `#d69a00` / `#c99a2b` | ○ 빈 원(고리) | 미수신·미확인, REVIEW, 기한 임박 |
| 위험·차단·실패 | `--danger` | `--mark-danger` `#c42d1c` / `#e0453a` | ■ 사각 / ✕ | 긴급 차단, FAIL, 거부 회신 |
| 진행·정보 | `--info` | `--mark-info` `#3b6fd0` / `#4f8fe0` | ◆ 마름모 | Canary 단계, 동기화·전달 중, 회신 대기 |
| 중립·대상 아님 | `--muted` | `--mark-neutral` `#b3ae9f` / `#5b616c` | · 작은 점 | 대상 아님, 꺼짐, 데이터 없음 |
- 빨강은 파괴적 조작(Kill)·FAIL·차단 전용(기존 규칙). 진행 중을 녹색으로 칠하지 않는다(A11).
- 판정 뜻이 없는 숫자(합계·건수)는 무채색.

### 4.2 상태 사전 — 홈·지도·Grafana 공통
| 상태 키 | 이름 | 표식 | 근거 함수 |
|---|---|---|---|
| `ON` | 적용(전체 배포) | mark-ok ● | `activationState` = ON, Canary 대상 아님 |
| `CANARY` | 적용(단계 배포) | mark-info ◆ | ON 이면서 Canary 코호트 차량·정책 단계 < 100% |
| `OFF` | 대상 아님·꺼짐 | mark-neutral · | `activationState` = OFF |
| `DISABLED` | 긴급 차단 | mark-danger ■ | 차단 사유 수신(KILL_SWITCH)·차단 Feature |
| `UNKNOWN` | 미수신·미확인 | mark-warn ○ | 오프라인·신뢰 미확인·판단 불일치 |
- 홈 '수신 현황'의 상태(ON 포함·OFF만·차단 수신·미확인)도 같은 표식을 쓴다: ON→ok, OFF→neutral, SAFE(차단 수신)→danger, UNKNOWN→warn. **차량 지도와 같은 색 뜻**(A5).

### 4.3 범주색 6 (정체: 국가·차종·소스·팀)
| 슬롯 | 밝음 | 어두움 | 토큰 |
|---|---|---|---|
| 1 파랑 | `#2a78d6` | `#3987e5` | `--viz-1`(있음) |
| 2 주황 | `#eb6834` | `#d95926` | `--viz-2`(있음) |
| 3 청록 | `#1baf7a` | `#199e70` | `--viz-3`(있음) |
| 4 노랑 | `#eda100` | `#c98500` | `--viz-4`(신규) |
| 5 자홍 | `#e87ba4` | `#d55181` | `--viz-5`(신규) |
| 6 보라 | `#6250d6` | `#9085e9` | `--viz-6`(신규) |
- 검증(validate_palette, 인접 쌍): 밝음 CVD worst 9.1·정상 19.6 PASS, 대비 3:1 미만 3색(청록·노랑·자홍) → **직접 라벨 또는 표 보기 필수**. 어두움 PASS.
- 고정 순서, 순환 금지. 7번째 이상은 '그 밖'(`--mark-neutral`)으로 접는다. 산점·지도처럼 모든 쌍이 맞닿는 그림은 **3색까지**.
- **한 그림에 범주색과 의미색을 같이 쓰지 않는다.** 국가 비중 + 상태 구성은 '국가별 상태 막대'(행=국가, 조각=상태)로 그린다(A4). 범주가 필요하면 상태는 별도 그림.
- 정체 색은 개체를 따른다: 거르기로 개수가 바뀌어도 남은 항목 색이 바뀌지 않게 키→슬롯 표를 고정한다.

### 4.4 연속·발산
- 연속(히트맵·밀도): 한 색상 밝음→어두움 `--seq-1..5`(파랑 `#cde2fb #86b6ef #3987e5 #256abf #104281`, 다크는 역순 단계). 무지개 금지.
- 발산(목표 대비 편차): 파랑 ↔ 빨강, 가운데 회색 `--surface-3`.

## 5. 차트 문법

### 5.1 공통
- 축선 없음(기준선 0만 `--chart-line` 1px), 격자 가로만 `--chart-grid` 1px, 눈금 글자 Mono `--fs-xs` `--muted`, 눈금 4~6개.
- 제목이 단위를 말한다('회신 수(건/분)'). 축 제목은 단위가 바뀔 때만.
- 범례: 계열 2개 이상이면 항상, 위 왼쪽 한 줄(점·모양 + 낱말 + 수). 4개 이하는 선 끝 직접 라벨도.
- 툴팁: `--surface` 면·`--line-strong` 테두리·`--r`·`--e-2`, 첫 줄 시각(Mono), 이후 계열(모양+이름+값 오른쪽 정렬). 십자선 1px `--chart-line` 점선.
- **빈 데이터 없는 원칙**: 그림은 데이터가 있는 범위만 그린다. 값이 0인 범주는 범례에서 흐리게(`--faint`), 데이터가 아예 없으면 그 그림 대신 판정 문장 한 줄('모든 게시본 회신 완료') — 빈 축·빈 상자 금지(하네스 ⑩).
- 이중 축 금지. 단위가 다른 두 측정은 두 그림.

### 5.2 선(시계열)
선 1.5px(강조 계열 2px), 채움 없음(누적량 하나일 때만 8% 채움), 점은 마지막 값과 사건에만 6px. 두 선이 겹쳐 차이를 못 읽으면 차이(Δ) 선 하나로(A17).

### 5.3 막대
막대 두께 10~16px, 데이터 끝 반경 `--r-sm`, 기준선 쪽 직각, 막대 사이 2px. 가로 막대 목록(순위)은 라벨 왼쪽·값 오른쪽 Mono. 누적 막대 조각 사이 2px 면 간격.

### 5.4 고리(도넛)
한 인코딩·5조각 이하·전체 대비 몫일 때만. 가운데 합계 Mono. 바깥·안쪽 이중 고리 금지(A4). 그 밖에는 가로 누적 막대.

### 5.5 지도
- 지도 엔진(MapLibre)은 /fleet/map에만. 대시보드 안 지도는 **내장 육지 윤곽(overview-land) + Canvas 점**.
- 점 하나 = 차량 한 대(480대 이상도 Canvas), 국가 묶음은 해바라기 배치(phyllotaxis)로 겹치지 않게, 상태 순서로 정렬(가운데 적용 → 바깥 미수신) — 비율이 고리처럼 읽힌다.
- 모양 병기(§4.1), 대체 표(국가 × 상태 수) 필수.

### 5.6 시간축 주석 마커
- 배포·차단·복원 같은 사건은 시간축 위 세로 점선(1px) + 위쪽 작은 깃발(6px 삼각형) + 낱말 2~4자('배포', '차단', '복원'). 색은 사건 의미색(배포 info, 차단 danger, 복원 ok).
- 크기 인코딩(점 크기=건수)은 범례 원 2개(최소·최대)와 함께만.

## 6. 상태 배지·심각도
- 상태 낱말은 `.ds-badge` 한 종류: 높이 22px, `--r-sm`, 면은 의미색 10% 섞음, 글자는 의미색 72% + ink, **앞에 모양 글리프**(§4.1). 채운 진한 pill 금지(A15).
- Lifecycle 7단계는 `--lc-*`(기존). 배포 상태(DEPLOYED 등) 영문 대문자 pill 금지 — 한국어 낱말 + Mono 코드는 툴팁.
- 출처·도구 표시('FF 스캐너 서명')는 상태가 아니다 → 중립 태그(`.ds-tag`).
- 심각도 4단: 위험(danger ■) > 주의(warn ○) > 진행(info ◆) > 정보(neutral ·). 목록 정렬은 이 순서 다음 오래된 것부터.

## 7. 표
- 밀도: comfortable 36px / compact 32px(`--row-h`), 안쪽 `--sp-1h` `--sp-3`. 머리 `--surface-3`, `--fs-xs` 600, 위에 붙음(`position: sticky; top: 0`).
- 첫 열(ID·이름) 고정(`position: sticky; left: 0`, 오른쪽 1px `--line`) — 가로 스크롤 표일 때.
- 수·금액·비율 **오른쪽 정렬** + Mono + 머리글 오른쪽, 시각 Mono 왼쪽, 상태 배지 가운데 아님(왼쪽).
- 같은 행 반복 버튼은 행 끝 '⋯' 메뉴 또는 선택 후 위 도구줄(A16).
- 390폭: 표는 2줄 카드 목록으로 바뀐다(첫 줄 ID+상태, 둘째 줄 핵심 수 2~3개). 가로 스크롤 표는 첫 열 고정일 때만 허용.

### 7.4 필터 레일(탐색판)
값 목록은 상자 없이 행(체크 + 이름 + 오른쪽 Mono 수). 0건 값은 `--faint`로 흐리게 아래로, 6개 넘으면 '더 보기'.

## 8. 드릴다운
| 클릭 대상 | 가는 곳 | 유지할 조건 |
|---|---|---|
| KPI 타일 | 그 수를 센 목록 화면(예: 배포 Flag → /policies?status=DEPLOYED) | 지금 거른 국가·차종·Flag |
| 상태 막대 조각·범례 | 같은 화면 아래 표를 그 상태로 거름(스크롤) | |
| 지도 점·국가 묶음 | `/fleet/map?lens=activation&flagKey=…&state=…&country=…` | Flag·상태 |
| 깔때기 단계 | 지도에서 그 단계 차량만 강조(같은 화면) → 두 번째 클릭/Enter는 /fleet/map 같은 조건 | |
| 표 행 ID | 상세(차량·게시본·Feature) | |
| 시간축 사건 | 그 사건 상세(게시본·차단) | |
- 링크는 '→' 하나로 표시, 새 창 금지(외부 도구 제외). 거르기는 주소에 남긴다(뒤로 가기 복원).

## 9. 모션
- 장식 모션 금지. **상태 변화와 실시간 도착에만** 짧게: 값 바뀜 = 숫자 아래 1px 밑줄이 `--t-base` 동안 의미색으로 보였다 사라짐(크기·위치 변화 없음). 실시간 도착 = 점에 고리 1회(반지름 +4px, 400ms, 불투명 0.6→0).
- 숫자 굴리기(count-up) 금지 — 읽는 중 값이 변한다.
- 재생(시간 되감기)은 사용자가 누를 때만, 기본 정지. `prefers-reduced-motion: reduce`면 재생 단추가 '끝 상태 보기'로 바뀌고 고리 표시도 끈다(`--t-*` 0ms 토큰과 같은 규칙).

## 10. 다크·라이트
- 두 테마 모두 **선택된** 값: `--mark-*`·`--viz-*`의 다크 값은 다크 면(`#15181d`)에서 검증한 별도 단계.
- 다크에서 패널 경계는 `--line-strong`(A14), 지도 육지 `--track-bg`, 점 바깥 1px 면 고리(`--surface`)로 겹침을 가른다.
- 다크에서 히어로·선택 면을 밝은 판으로 뒤집지 않는다(A1).

## 11. 반응형
| 폭 | 열 | 히어로+KPI | 그림 | 표 |
|---|---|---|---|---|
| 390 | 1 | 히어로 → KPI 2열 | 세로로 쌓음, 지도 높이 220px, 깔때기는 지도 아래 가로 막대 | 2줄 카드 목록 |
| 1024 | 12(4+8 허용) | 히어로 12 / KPI 3열 | 6+6, 지도 12 | 첫 열 고정 가로 스크롤 |
| 1366 | 12 | 히어로 4 + KPI 8(5개 한 줄) | 8+4(지도+깔때기), 6+6 | 전 열 |
| 1920 | 12 | 같음, 숫자 comfortable | 같음, 최대 폭 1680px 가운데 | 전 열 + 보조 열 |
- 글자 겹침 0·가로 넘침 0(하네스 W6). 390에서 상단바 아래 본문 최소 폭 300px.

## 12. 접근성
- 대비: 글자 4.5:1(보조 글자 포함), 그림 표식 3:1(미만이면 직접 라벨·표 보기 — `--mark-warn` 밝음 2.4:1은 모양+라벨 동반).
- 색만으로 뜻 전달 금지: 모양(●○■◆·)·낱말·수를 함께.
- 모든 그림은 `role="img"`+요약 `aria-label` 또는 `role="group"`, 같은 내용의 **대체 표**(`<details>` '표로 보기' 또는 시각적 숨김 표).
- 키보드: 막대 조각·범례·깔때기 단계는 `button`, 초점 고리 `--focus` 2px. Canvas 지도는 그림이고, 조작은 옆 깔때기·범례·표로.
- 실시간 갱신은 `aria-live="polite"` 한 줄 요약('차단 회신 12대 도착')만, 숫자마다 알리지 않는다.

## 13. 토큰 제안 (tokens.css에 추가)
```css
:root {
  /* 데이터 표식 — 점·막대·선. 글자는 --ok·--warn·--danger·--info를 쓴다 */
  --mark-ok: #16784a; --mark-warn: #d69a00; --mark-danger: #c42d1c; --mark-info: #3b6fd0; --mark-neutral: #b3ae9f;
  --viz-4: #eda100; --viz-5: #e87ba4; --viz-6: #6250d6;
  --dash-gap: var(--sp-4);
}
@media (max-width: 1599px) { :root { --dash-gap: var(--sp-3); } }
[data-theme='dark'], [data-zone='ops'] {
  --mark-ok: #2fa66c; --mark-warn: #c99a2b; --mark-danger: #e0453a; --mark-info: #4f8fe0; --mark-neutral: #5b616c;
  --viz-4: #c98500; --viz-5: #d55181; --viz-6: #9085e9;
}
/* 파생(각 테마 범위에서) */
--fs-kpi-hero: calc(var(--fs-base) * 2.571);   /* 36px @14, 33px @13, 시연 46px */
--fs-kpi: calc(var(--fs-base) * 1.571);         /* = --fs-xl */
```
연속 램프 `--seq-1..5`는 히트맵을 처음 쓰는 화면(Data Lake)이 추가한다(값은 §4.4).

## 14. 금지 목록
보라 그라데이션·의미 없는 유리(backdrop-filter)·네온 그림자·이모지 아이콘·숫자 굴리기·3D 차트·이중 축·무지개 연속색·범주색과 의미색 혼용·상태 낱말 대문자 영문 pill·카드 안 카드·카드 높이 맞추기용 빈 공간·설명 두 줄 이상·새 글꼴·원시 hex(토큰 파일 밖).

---

## 15. Grafana 대응표 (C:/project/2026-06-04_Feature_Platform-grafana, FF/deploy/grafana/dashboards)

다크 테마 기준(Grafana 패널 면 `#181b1f` ≈ FF 다크 `--surface #15181d`). **이름 색(green/orange/red) 대신 아래 hex를 고정**한다.

### 15.1 색
| 뜻 | hex (다크·Grafana) | 밝은 테마 hex(FF 화면) | Grafana 쓰임 |
|---|---|---|---|
| 정상 ok | `#2fa66c` | `#16784a` | 임계값 정상 단계, 성공 계열 |
| 주의 warn | `#c99a2b` | `#d69a00` | 임계값 주의 단계, 미수신 |
| 위험 danger | `#e0453a` | `#c42d1c` | 임계값 위험 단계, 차단·실패 |
| 진행 info | `#4f8fe0` | `#3b6fd0` | Canary·진행, 단일 중립 계열 기본선 |
| 중립 neutral | `#5b616c` | `#b3ae9f` | 대상 아님·기타·기준선 |
| 범주 1~6 | `#3987e5 #d95926 #199e70 #c98500 #d55181 #9085e9` | `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #6250d6` | 계열 구분(국가·차종·소스) — `fixedColor` override로 키마다 고정 |
| 연속(히트맵) | `#104281 #256abf #3987e5 #86b6ef #cde2fb` | | Heatmap `color.mode: scheme` 대신 `opacity`+단색 또는 `Blues` |

### 15.2 패널 유형별 설정
| 패널 | 설정 |
|---|---|
| **Stat** | `colorMode: "value"`(면 칠하기 `background` 금지), `graphMode: "area"`(추세 스파크라인, 판정 값만) 또는 `"none"`, `textMode: "value"`(제목은 패널 제목으로), `justifyMode: "auto"`, `text.valueSize` 생략(자동) — 한 행 Stat은 같은 높이 4. 임계값 없는 건수는 `color.mode: "fixed"` `fixedColor: "#c9c6bd"`(무채). 0이면 neutral: 첫 단계를 `#5b616c`. |
| **Time series** | `custom.lineWidth: 1.5`(강조 2), `fillOpacity: 0`(누적 하나만 8), `gradientMode: "none"`, `pointSize: 4`, `showPoints: "never"`, `axisBorderShow: false`, `thresholdsStyle.mode: "dashed"`(임계값 있는 판정 그림만, 그 외 `"off"`), `legend: {displayMode: "list", placement: "bottom", calcs: ["lastNotNull"]}`, `tooltip.mode: "multi"`, `sort: "desc"`. 계열 색은 override `fixedColor`. |
| **Bar gauge** | `displayMode: "basic"`(그라데이션·LCD 금지), `orientation: "horizontal"`, `valueMode: "text"`, `namePlacement: "left"`, `showUnfilled: true`, `minVizHeight: 16`, `maxVizHeight: 20`. |
| **Gauge** | 판정 하나(예산 남음)일 때만. `showThresholdMarkers: true`, `showThresholdLabels: false`. 여러 값은 Bar gauge. |
| **Heatmap** | `color: {mode: "scheme", scheme: "Blues", steps: 64, reverse: false}`(빨강 계열은 '실패 밀도'일 때만 `Reds`), `cellGap: 1`, `yAxis.unit` 지정, `legend.show: true`, `tooltip.yHistogram: true`. |
| **State timeline** | 값 매핑 `ON→#2fa66c`, `CANARY→#4f8fe0`, `OFF→#5b616c`, `DISABLED→#e0453a`, `UNKNOWN→#c99a2b`, `rowHeight: 0.8`, `showValue: "never"`, `mergeValues: true`. |
| **Table** | `cellOptions.type: "auto"`, 상태 열만 `"color-text"`(배경 칠하기 금지), 수 열 `align: "right"` `unit` 지정, `footer.show` 합계 필요할 때만, `cellHeight: "sm"`. VIN 열 싣지 않음(차량 단위는 FF로 링크). |
| **Geomap** | 아래 15.4. |
| **Logs** | `dedupStrategy: "none"`, `wrapLogMessage: false`, `prettifyLogMessage: false`, `enableLogDetails: true`. |

### 15.3 행·격자(24열)
- 1행 `row` "요약": Stat 4~6개 — 폭 4(6개) 또는 6(4개), 높이 4. 판정 Stat(목표 대비) 맨 왼쪽.
- 2행 "추이": Time series 폭 16 + 보조 Bar gauge/Gauge 폭 8, 높이 8.
- 3행 "분포·원인": 폭 12+12, 높이 9(Heatmap·Bar gauge·Geomap).
- 4행 "목록": Table/Logs 폭 24, 높이 10, 기본 접힘(`collapsed: true`).
- `gridPos.y`는 행 머리 1칸 + 패널. 같은 행 패널 높이는 같게.

### 15.4 Feature 적용 지도(Geomap) — 홈 'Feature 적용 현황'과 같은 색
```json
{
  "type": "geomap", "title": "Feature 적용 현황 — $flag",
  "description": "차량 위치(국가 단위 묶음)와 적용 상태. 차량 한 대씩은 FF 차량 지도에서 봅니다.",
  "gridPos": { "h": 9, "w": 12, "x": 0, "y": 18 },
  "options": {
    "view": { "id": "zero", "lat": 30, "lon": 60, "zoom": 1.2 },
    "controls": { "showZoom": true, "mouseWheelZoom": false },
    "basemap": { "type": "default", "config": {}, "name": "기본" },
    "layers": [{
      "type": "markers", "name": "적용 상태",
      "location": { "mode": "coords", "latitude": "lat", "longitude": "lon" },
      "config": {
        "style": {
          "size": { "fixed": 4, "min": 3, "max": 14, "field": "vehicles" },
          "color": { "field": "state" }, "opacity": 0.9,
          "symbol": { "mode": "fixed", "fixed": "img/icons/marker/circle.svg" }
        }, "showLegend": true
      }
    }]
  },
  "fieldConfig": { "defaults": { "mappings": [{ "type": "value", "options": {
    "ON": { "color": "#2fa66c", "text": "적용", "index": 0 },
    "CANARY": { "color": "#4f8fe0", "text": "단계 배포", "index": 1 },
    "OFF": { "color": "#5b616c", "text": "대상 아님", "index": 2 },
    "DISABLED": { "color": "#e0453a", "text": "긴급 차단", "index": 3 },
    "UNKNOWN": { "color": "#c99a2b", "text": "미수신", "index": 4 } } }],
    "links": [{ "title": "FF 차량 지도에서 보기", "url": "${ff_url}/fleet/map?lens=activation&flagKey=${flag}&state=${__data.fields.state}" }] } }
}
```
Prometheus 측: `sum by (country, state, lat, lon) (ff_flag_adoption_vehicles{flag="$flag"})` — 차량 좌표가 아니라 국가 대표점(개인 위치 금지).

### 15.5 JSON 조각
Stat(판정):
```json
{ "type": "stat", "title": "정책 신뢰 수신율", "description": "선택 차량 중 신뢰할 수 있는 정책 보관 차량 비율.",
  "gridPos": { "h": 4, "w": 6, "x": 0, "y": 1 },
  "fieldConfig": { "defaults": { "unit": "percentunit", "decimals": 1, "color": { "mode": "thresholds" },
    "thresholds": { "mode": "absolute", "steps": [ { "value": null, "color": "#e0453a" }, { "value": 0.9, "color": "#c99a2b" }, { "value": 0.98, "color": "#2fa66c" } ] } } },
  "options": { "colorMode": "value", "graphMode": "area", "textMode": "value", "justifyMode": "auto", "wideLayout": true,
    "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false } } }
```
Stat(건수, 판정 없음):
```json
{ "type": "stat", "title": "배포 Flag", "fieldConfig": { "defaults": { "unit": "short", "color": { "mode": "fixed", "fixedColor": "#c9c6bd" } } },
  "options": { "colorMode": "value", "graphMode": "none", "textMode": "value" } }
```
Time series(임계값 판정):
```json
{ "type": "timeseries", "title": "차단 반영 지연(p95, 초)",
  "fieldConfig": { "defaults": { "unit": "s", "color": { "mode": "fixed", "fixedColor": "#4f8fe0" },
    "custom": { "lineWidth": 1.5, "fillOpacity": 0, "gradientMode": "none", "showPoints": "never", "pointSize": 4, "axisBorderShow": false, "thresholdsStyle": { "mode": "dashed" } },
    "thresholds": { "mode": "absolute", "steps": [ { "value": null, "color": "#2fa66c" }, { "value": 30, "color": "#c99a2b" }, { "value": 60, "color": "#e0453a" } ] } } },
  "options": { "legend": { "displayMode": "list", "placement": "bottom", "calcs": ["lastNotNull"] }, "tooltip": { "mode": "multi", "sort": "desc" } } }
```
계열 고정색 override:
```json
{ "matcher": { "id": "byName", "options": "KR" }, "properties": [ { "id": "color", "value": { "mode": "fixed", "fixedColor": "#3987e5" } } ] }
```
Bar gauge:
```json
{ "type": "bargauge", "options": { "displayMode": "basic", "orientation": "horizontal", "valueMode": "text", "namePlacement": "left", "showUnfilled": true, "minVizHeight": 16, "maxVizHeight": 20 } }
```

### 15.6 제목·설명 문체
- 제목: 명사구 + 단위/창(`차단 반영 지연(p95, 초)`), 목표가 있으면 괄호(`(목표 99.5%)`), 25자 이내. 영문 지표 이름은 설명 끝 코드 표기.
- 설명: **한 문장**(무엇을 세는가) + 필요하면 두 번째 문장 '조치: …'. 세 문장 이상 금지. VIN·개인 식별 정보 금지.
- 대시보드 태그 `ff`, 갱신 `1m`, 기본 창 `now-6h`, `graphTooltip: 1`(공유 십자선).

---

## 16. 화면별 적용 체크리스트 (다른 화면 에이전트)

공통(모든 화면): □ 숫자 Mono tabular □ 히어로 1개·중복 숫자 없음 □ 그라데이션·색 막대 카드 제거 □ 범주색/의미색 한 그림 혼용 없음 □ 상태 배지 `.ds-badge`+글리프 □ 설명 한 줄, 나머지 `<details>` '집계 기준' □ 표 수 열 오른쪽+머리글 오른쪽 □ 반경 3/5/8만 □ 390·1024·1366·1920 겹침·넘침 0 □ 다크 테두리 `--line-strong` □ 대체 표 □ lint:tokens/spacing/copy.

| 화면 | 할 일 |
|---|---|
| Feature DB 탐색판(workbook) | '조건에 맞는 행' 코발트 카드 → 머리 `.ds-key` 숫자 한 번만, KPI 5개 3열 빈칸 → 한 줄 `.ds-summary`, 13개 통계 줄 → 핵심 4개 + '더 보기', 필터 레일 상자 제거·0건 흐림, '검토 필요' warn 배지, 390은 2줄 카드 목록 |
| 개발비 탐색판 | 히어로 = '승인 과제 개발비 합계'(백만원 단위 하나로 통일), 머리 숫자와 카드 중복 제거, 상태 pill(승인됨 ok·승인 대기 warn·작성 중 neutral), 필터 0건 결과는 판정 문장(빈 표 금지), 390 표 카드화 |
| Flag 코드 8화면 | 커버리지 머리 패턴을 나머지 7화면 머리 표준으로, 패키지 막대는 절대 축(최대 패키지 기준) + 비율 라벨, 평가 추이는 Δ선 또는 작은 배수, 폴백 사유는 범주색(빨강 금지), 대조 화면 카드 3단 → 상태별 표 1개 + 행 끝 메뉴, 출처 태그 중립, 재스캔 버튼 위계 통일(보조 버튼) |
| Data Lake·Feature 상태 | 시계열은 §5.2, 히트맵은 `--seq-*`(추가), 상태 타임라인은 §4.2 사전, 수집 지연 KPI 히어로 1개 |
| ADS 화면 | 판정(PASS/REVIEW/FAIL)은 `--gate-*` + 글리프, 요구 커버리지 막대는 의미색 3단(통과·검토·미판정)만, 시나리오 범주는 범주색 3개까지 |
| 긴급 차단 | 상태 열 배지 통일('해제됨'도 배지), 서랍 체크리스트의 대기 항목은 ○ warn(녹색 점 금지) |
| 연계·Jira 모형 | 외부 도구 모형은 그 도구 색 허용(`--ext-*`), 단 FF 쪽 요약 표는 이 문서 |
| Grafana 6종(+2) | §15 전부: Stat `colorMode:"value"`, 이름 색 → hex, bargauge `basic`, 설명 1~2문장, 행 구성 §15.3, Feature 적용 Geomap 추가 |

---

## 17. 기준 구현 — 홈 '차량 정책 수신 현황' (2026-11-06)
| 이전 | 이후(규칙) |
|---|---|
| 코발트 그라데이션 히어로, 반경 4px(간격 토큰) 막대, 좁은 폭에서 라벨 겹침 | 면 그대로 + Mono 36px 값 + 단위 반 크기, 구성 막대(mark-ok/mark-warn, 2px 간격, `--r-sm`), 범례 한 줄, 회신 누적 스파크라인(§3.1). 420px 이하 세로 쌓기 |
| KPI 숫자 바닥 정렬·색 막대 | 라벨 → 값 위에서부터, 타일 전체 링크(→), 주의 ○·위험 ■ 모양 + 의미색 글자(0이면 무채)(§3.2) |
| 국가·차종 이중 고리(범주색 + 상태색) | 국가·차종 **상태 막대**(행 = 묶음, 길이 = 차량 수, 조각 = 마지막 수신값 의미색)(§4.3·§5.4) |
| 지역 미니 지도(거품) | **Feature 적용 현황**: Canvas 점 지도(점 하나 = 차량, 국가 묶음 해바라기 배치, 모양 병기) + 단계 깔때기(대상 → 게시본 전달 → 수신 → 적용 → 실제 사용) + 회신 시각 되감기(누적 곡선·배포/차단/복원 표식) + 대체 표. 지연 묶음 |
| 상태 색 홈/지도 불일치(미확인 회색↔호박, 차단 호박↔빨강) | §4.2 상태 사전 하나(지도 기준) |
| 설명 문단 6곳 | '집계 기준' 접기 2곳(현황·시간 분포) |
| 거르기 띠 청록 면 + 막대 | 도구줄(면 `--surface`, 테두리 `--line`) |
| 흐름 단계 번호 갈색·청록 | 무채 눈금 원(Mono), 주의는 부제에 ○ + warn 글자 |
| 회신 대기 막대 녹색 | 진행 = `--mark-info` |
| 시간 분포 점 청록·빨강(크기 범례 없음) | 진행 `--mark-info` ●, 실패 섞임 `--mark-danger` ■, 크기 뜻은 '집계 기준' |

데이터 계약: `GET /api/fleet/operation-summary`의 `adoption`(contracts `rules/operation-adoption.ts`) — 서버·정적 스냅샷·브라우저 시연이 같은 함수. 실제 사용 단계는 최근 평가 span(최대 500건)을 가명 subject → VIN으로 되짚은 표본 기준이며, 표본에 그 Flag가 없으면 null('미집계').
