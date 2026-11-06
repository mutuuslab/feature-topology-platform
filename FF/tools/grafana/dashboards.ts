// Grafana 대시보드·경보 정의(80-80) — 코드가 원천, deploy/grafana/{dashboards,alerting}/*.json은 이 파일로 만든다(build-dashboards.ts).
// 지표 이름은 @ff/contracts TELEMETRY_METRICS와 같아야 한다(시험이 쿼리 속 이름을 교차 검사). 데이터 소스는 ${DS_PROMETHEUS}·${DS_LOKI}·${DS_TEMPO}
// 자리표시 — provision.ts가 스택 기본 데이터 소스 uid로 바꾼다. 공개(외부 공유) 대시보드는 변수를 쓰지 못해 publicVariant()로 따로 만든다.

export const FF_URL_DEFAULT = 'https://feature-topology.pages.dev';
export const RUNBOOK = 'https://github.com/mutuuslab/feature-topology-platform/blob/main/docs/80-integration/80-80-grafana-observability.md';
export const FOLDER = { uid: 'ff-ops', title: 'FF 운영' };
export const PUBLIC_FOLDER = { uid: 'ff-public', title: 'FF 운영 (공개 시연)' };

const PROM = { type: 'prometheus', uid: '${DS_PROMETHEUS}' };
const LOKI = { type: 'loki', uid: '${DS_LOKI}' };
const TEMPO = { type: 'tempo', uid: '${DS_TEMPO}' };

type Json = Record<string, unknown>;
export interface Dashboard extends Json {
  uid: string;
  title: string;
  panels: Json[];
  templating: { list: Json[] };
}

// ── 패널 도우미 ────────────────────────────────────────────
interface PanelSpec {
  title: string;
  description: string;
  type?: string;
  w?: number;
  h?: number;
  targets: Json[];
  unit?: string;
  decimals?: number;
  min?: number;
  max?: number;
  /** [값, 색] — 첫 값은 null(기본) */
  steps?: [number | null, string][];
  options?: Json;
  custom?: Json;
  overrides?: Json[];
  links?: Json[];
  noValue?: string;
  mappings?: Json[];
  transformations?: Json[];
  datasource?: Json;
  fieldLinks?: { title: string; url: string }[];
}

const q = (expr: string, legend = '', extra: Json = {}): Json => ({ datasource: PROM, expr, legendFormat: legend, range: true, ...extra });
const qi = (expr: string, legend = '', extra: Json = {}): Json => ({ datasource: PROM, expr, legendFormat: legend, instant: true, range: false, format: 'table', ...extra });
const GOOD_HIGH: [number | null, string][] = [[null, 'red'], [0.95, 'orange'], [0.99, 'green']];
const GOOD_LOW_PCT: [number | null, string][] = [[null, 'green'], [0.01, 'orange'], [0.05, 'red']];

class Layout {
  private x = 0;
  private y = 0;
  private rowH = 0;
  private id = 1;
  readonly panels: Json[] = [];
  row(title: string) {
    this.newline();
    this.panels.push({ type: 'row', title, id: this.id++, collapsed: false, gridPos: { h: 1, w: 24, x: 0, y: this.y }, panels: [] });
    this.y += 1;
  }
  private newline() {
    if (this.x > 0) {
      this.y += this.rowH;
      this.x = 0;
      this.rowH = 0;
    }
  }
  add(p: PanelSpec) {
    const w = p.w ?? 12;
    const h = p.h ?? 8;
    if (this.x + w > 24) this.newline();
    const type = p.type ?? 'timeseries';
    const defaults: Json = {
      unit: p.unit ?? 'short',
      ...(p.decimals !== undefined && { decimals: p.decimals }),
      ...(p.min !== undefined && { min: p.min }),
      ...(p.max !== undefined && { max: p.max }),
      ...(p.noValue && { noValue: p.noValue }),
      ...(p.mappings && { mappings: p.mappings }),
      thresholds: { mode: 'absolute', steps: (p.steps ?? [[null, 'green']]).map(([value, color]) => ({ value, color })) },
      color: { mode: p.steps && ['stat', 'gauge', 'bargauge', 'table'].includes(type) ? 'thresholds' : 'palette-classic' },
      ...(type === 'timeseries' && { custom: { lineWidth: 2, fillOpacity: 10, showPoints: 'never', spanNulls: true, ...(p.steps && { thresholdsStyle: { mode: 'line+area' } }), ...p.custom } }),
      ...(type !== 'timeseries' && p.custom && { custom: p.custom }),
      ...(p.fieldLinks && { links: p.fieldLinks.map((l) => ({ ...l, targetBlank: true })) }),
    };
    const panel: Json = {
      id: this.id++,
      type,
      title: p.title,
      description: p.description,
      datasource: p.datasource ?? PROM,
      gridPos: { h, w, x: this.x, y: this.y },
      targets: p.targets.map((t, i) => ({ refId: String.fromCharCode(65 + i), ...t })),
      fieldConfig: { defaults, overrides: p.overrides ?? [] },
      options: { ...(type === 'stat' && { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'background', graphMode: 'area', textMode: 'value_and_name', justifyMode: 'center' }), ...(type === 'timeseries' && { legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max'] }, tooltip: { mode: 'multi', sort: 'desc' } }), ...(type === 'bargauge' && { displayMode: 'gradient', orientation: 'horizontal', reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, showUnfilled: true }), ...(type === 'gauge' && { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, showThresholdMarkers: true }), ...p.options },
      ...(p.links && { links: p.links }),
      ...(p.transformations && { transformations: p.transformations }),
    };
    this.panels.push(panel);
    this.x += w;
    this.rowH = Math.max(this.rowH, h);
    return panel;
  }
}

const variable = (name: string, label: string, query: string, opts: Json = {}): Json => ({
  name,
  label,
  type: 'query',
  datasource: PROM,
  definition: query,
  query: { query, refId: `${name}-var` },
  refresh: 2,
  includeAll: true,
  multi: true,
  allValue: '.*',
  current: { selected: true, text: ['All'], value: ['$__all'] },
  sort: 1,
  ...opts,
});
const ffUrlVar = (): Json => ({ name: 'ff_url', label: 'FF 주소', type: 'constant', query: FF_URL_DEFAULT, hide: 2, current: { text: FF_URL_DEFAULT, value: FF_URL_DEFAULT } });

/** 시간축 주석 — 정책 배포·긴급 차단·복원·기한 초과(ff_events_total) */
const ANNOTATIONS: Json[] = [
  { builtIn: 1, datasource: { type: 'grafana', uid: '-- Grafana --' }, enable: true, hide: true, iconColor: 'rgba(0, 211, 255, 1)', name: 'Annotations & Alerts', type: 'dashboard' },
  { datasource: PROM, enable: true, iconColor: 'blue', name: '정책 배포·단계 확대', expr: 'sum by (type) (increase(ff_events_total{type=~"policy.deployed|policy.restored|rollout.staged"}[2m])) > 0', step: '60s', titleFormat: '{{type}}', textFormat: '정책 배포·복원·단계 확대 — FF 정책 화면에서 확인' },
  { datasource: PROM, enable: true, iconColor: 'red', name: '긴급 차단', expr: 'sum(increase(ff_events_total{type="kill.issued"}[2m])) > 0', step: '60s', titleFormat: '긴급 차단 발령', textFormat: 'FF 긴급 차단·복구 화면(/ops/kill)' },
  { datasource: PROM, enable: true, iconColor: 'green', name: '복원', expr: 'sum(increase(ff_events_total{type="kill.released"}[2m])) > 0', step: '60s', titleFormat: '차단 해제(복원)', textFormat: '' },
  { datasource: PROM, enable: true, iconColor: 'orange', name: '기한 초과', expr: 'sum(increase(ff_events_total{type="kill.overdue"}[2m])) > 0', step: '60s', titleFormat: '차단 기한 초과', textFormat: '기한 안에 끝 상태가 아닌 차량이 있다' },
  { datasource: PROM, enable: false, iconColor: 'purple', name: 'Grafana 경보 → FF 운영 관찰', expr: 'sum(increase(ff_events_total{type="ops.observation.recorded"}[2m])) > 0', step: '60s', titleFormat: '운영 관찰 기록', textFormat: '' },
];

const LINKS = (ffPath = '/ops/telemetry?tab=observability&observe=readbacks'): Json[] => [
  { title: 'FF 운영 대시보드', type: 'dashboards', tags: ['ff'], asDropdown: true, includeVars: true, keepTime: true },
  { title: 'FF에서 열기', type: 'link', url: `\${ff_url}${ffPath}`, targetBlank: true, icon: 'external link' },
  { title: '런북', type: 'link', url: RUNBOOK, targetBlank: true, icon: 'doc' },
];

function dashboard(uid: string, title: string, description: string, tags: string[], layout: Layout, vars: Json[], ffPath?: string, time = 'now-6h'): Dashboard {
  return {
    __inputs: [
      { name: 'DS_PROMETHEUS', label: 'Prometheus(Grafana Cloud 지표)', type: 'datasource', pluginId: 'prometheus' },
      { name: 'DS_LOKI', label: 'Loki(Grafana Cloud 로그)', type: 'datasource', pluginId: 'loki' },
      { name: 'DS_TEMPO', label: 'Tempo(Grafana Cloud 추적)', type: 'datasource', pluginId: 'tempo' },
    ],
    uid,
    title,
    description,
    tags: ['ff', ...tags],
    timezone: 'browser',
    editable: true,
    graphTooltip: 1,
    schemaVersion: 39,
    version: 1,
    refresh: '1m',
    time: { from: time, to: 'now' },
    templating: { list: [...vars, ffUrlVar()] },
    annotations: { list: ANNOTATIONS },
    links: LINKS(ffPath),
    panels: layout.panels,
  };
}

const FEATURE_LINK = { title: 'FF에서 Feature 열기', url: '${ff_url}/features/${__field.labels.feature}/${__field.labels.feature_version}' };
const FEATURE_ROW_LINK = { title: 'FF에서 Feature 열기', url: '${ff_url}/features/${__data.fields.feature}/${__data.fields.feature_version}' };
const POLICY_ROW_LINK = { title: 'FF에서 정책 열기', url: '${ff_url}/policies/${__data.fields.policy}' };
const HEALTH_DRILL = { title: '이 Feature의 운영 건강도', url: '/d/ff-feature-health?var-feature=${__data.fields.feature}&var-feature_version=${__data.fields.feature_version}&${__url_time_range}' };

// ── 1. 운영 개요(SLO) ─────────────────────────────────────
const SLO = { accept: 0.995, signature: 0.999, latency120: 0.95, kill: 0.99 };
function opsOverview(): Dashboard {
  const L = new Layout();
  const C = 'country=~"$country"';
  const accept = (w: string) => `sum(increase(ff_vehicle_status_reports_total{result="accepted",${C}}[${w}])) / sum(increase(ff_vehicle_status_reports_total{${C}}[${w}]))`;
  const sig = (w: string) => `(sum(increase(ff_vehicle_status_auth_total{result="valid",${C}}[${w}])) + sum(increase(ff_vehicle_signature_checks_total{result="valid",${C}}[${w}]))) / (sum(increase(ff_vehicle_status_auth_total{${C}}[${w}])) + sum(increase(ff_vehicle_signature_checks_total{${C}}[${w}])))`;
  const fast = (w: string) => `sum(increase(ff_vehicle_readback_latency_seconds_bucket{kind="POLICY",le="120",${C}}[${w}])) / sum(increase(ff_vehicle_readback_latency_seconds_count{kind="POLICY",${C}}[${w}]))`;
  L.row('서비스 수준 목표(SLO) — 7일');
  L.add({ type: 'stat', w: 6, h: 5, title: '상태 보고 수락률 (목표 99.5%)', description: '차량 상태 보고 v2 가운데 6단계 수신 검사를 통과한 비율(7일). 떨어지면 위조·재전송·스키마 위반이 늘었거나 차량 SW가 규격과 어긋난 것이다. 조치: 차량 텔레메트리 수신 대시보드의 거부 코드 → FF 이상 징후(보안).', unit: 'percentunit', decimals: 2, steps: [[null, 'red'], [0.99, 'orange'], [SLO.accept, 'green']], targets: [q(accept('7d'), '수락률')] });
  L.add({ type: 'stat', w: 6, h: 5, title: '서명 검증 성공률 (목표 99.9%)', description: '상태 보고 state_auth(CMAC)와 차량이 회신한 게시본 서명 검증이 맞은 비율(7일). 떨어지면 키 회전·Epoch 불일치 또는 위조 시도다. 조치: FF 보안·인증서(/admin/security) — 키 Epoch, 이상 징후(보안).', unit: 'percentunit', decimals: 3, steps: [[null, 'red'], [0.995, 'orange'], [SLO.signature, 'green']], targets: [q(sig('7d'), '성공률')] });
  L.add({ type: 'stat', w: 6, h: 5, title: '정책 반영 120초 안 (목표 95%)', description: '정책 게시본 서명부터 차량 회신까지 120초 안에 끝난 비율(7일). 떨어지면 전달 채널(OTA 서버·GLEO) 지연이나 통신 장애다. 조치: 수신 상세의 통신 채널별 패널, FF 배포 화면(/deployments).', unit: 'percentunit', decimals: 1, steps: [[null, 'red'], [0.9, 'orange'], [SLO.latency120, 'green']], targets: [q(fast('7d'), '120초 안')] });
  L.add({ type: 'stat', w: 6, h: 5, title: '긴급 차단 기한 내 반영 (목표 99%)', description: '긴급 차단 대상 차량 가운데 등급별 기한(예상 시간 + 여유) 안에 끝 상태를 보고한 비율(7일). 떨어지면 오프라인 차량·DC3(다음 시동) 대기가 많은 것이다. 조치: 긴급 차단 반영 대시보드, FF 긴급 차단·복구(/ops/kill).', unit: 'percentunit', decimals: 2, steps: [[null, 'red'], [0.97, 'orange'], [SLO.kill, 'green']], noValue: '차단 0건', targets: [q('1 - sum(increase(ff_kill_overdue_vehicles_total[7d])) / sum(increase(ff_kill_apply_latency_seconds_count{request="deactivate"}[7d]))', '기한 내')] });
  L.row('오류 예산');
  L.add({ type: 'gauge', w: 6, h: 6, title: '수락률 오류 예산 남음', description: '7일 동안 허용된 거부(0.5%) 가운데 아직 쓰지 않은 몫. 0%에 가까우면 배포·정책 변경을 멈추고 원인부터 본다(오류 예산 정책).', unit: 'percentunit', min: 0, max: 1, steps: [[null, 'red'], [0.25, 'orange'], [0.5, 'green']], targets: [q(`clamp_min(1 - (1 - (${accept('7d')})) / ${(1 - SLO.accept).toFixed(3)}, 0)`, '남은 예산')] });
  L.add({ type: 'timeseries', w: 18, h: 6, title: '수락률 오류 예산 소진 속도(burn rate)', description: '1시간·6시간 창의 소진 속도. 14.4 이상(1시간)이 지속되면 이틀 안에 7일 예산을 다 쓴다 — 즉시 대응. 6(6시간)은 근무 시간 안 대응.', unit: 'none', steps: [[null, 'green'], [6, 'orange'], [14.4, 'red']], targets: [q(`(1 - (${accept('1h')})) / ${(1 - SLO.accept).toFixed(3)}`, '1시간'), q(`(1 - (${accept('6h')})) / ${(1 - SLO.accept).toFixed(3)}`, '6시간')] });
  L.row('지금(1시간)');
  L.add({ type: 'stat', w: 4, h: 5, title: '수신율', description: '등록 차량 가운데 최근 1시간 안에 상태 보고·회신이 있었던 비율. 밤에는 주차 차량이 많아 낮아지는 것이 정상 — 같은 시간대의 지난주와 비교한다.', unit: 'percentunit', decimals: 1, steps: [[null, 'red'], [0.5, 'orange'], [0.7, 'green']], targets: [q(`1 - sum(ff_vehicles_silent{window="1h",${C}}) / sum(ff_vehicles_registered{${C}})`, '수신율')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '정책 반영 p50', description: '정책 게시본 서명 → 차량 회신 중앙값(1시간).', unit: 's', decimals: 1, steps: [[null, 'green'], [60, 'orange'], [120, 'red']], noValue: '배포 0건', targets: [q(`histogram_quantile(0.5, sum by (le) (rate(ff_vehicle_readback_latency_seconds_bucket{kind="POLICY",${C}}[1h])))`, 'p50')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '정책 반영 p95', description: '정책 반영 지연 95번째 백분위(1시간). 120초를 넘으면 SLO 위험.', unit: 's', decimals: 0, steps: [[null, 'green'], [120, 'orange'], [600, 'red']], noValue: '배포 0건', targets: [q(`histogram_quantile(0.95, sum by (le) (rate(ff_vehicle_readback_latency_seconds_bucket{kind="POLICY",${C}}[1h])))`, 'p95')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '정책 반영 p99', description: '꼬리 지연 — 오프라인 뒤 다시 연결된 차량이 대부분이다.', unit: 's', decimals: 0, steps: [[null, 'green'], [600, 'orange'], [3600, 'red']], noValue: '배포 0건', targets: [q(`histogram_quantile(0.99, sum by (le) (rate(ff_vehicle_readback_latency_seconds_bucket{kind="POLICY",${C}}[1h])))`, 'p99')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '긴급 차단 반영률', description: '걸려 있는 차단 대상 차량 가운데 끝 상태(DISABLED 등)를 보고한 비율.', unit: 'percentunit', decimals: 1, steps: [[null, 'red'], [0.9, 'orange'], [0.99, 'green']], noValue: '걸린 차단 0건', targets: [q('1 - sum(ff_kill_pending_vehicles) / sum(ff_kill_target_vehicles)', '반영률')] });
  L.add({ type: 'stat', w: 4, h: 5, title: 'Flag 평가 오류율', description: 'OpenFeature 평가 가운데 ERROR 사유 비율(1시간). 오르면 Edge·평가기 장애 — Flag 평가 대시보드.', unit: 'percentunit', decimals: 2, steps: GOOD_LOW_PCT, targets: [q('sum(rate(ff_flag_evaluations_total{reason="ERROR"}[1h])) / sum(rate(ff_flag_evaluations_total[1h]))', '오류율')] });
  L.row('추세');
  L.add({ w: 12, title: '상태 보고 수락·거부(분당)', description: '국가별 수락과 거부. 수락이 현지 출퇴근 시간에 오르는 모양이 정상. 거부가 함께 오르면 수신 상세에서 코드를 본다.', unit: 'short', targets: [q(`sum by (country) (rate(ff_vehicle_status_reports_total{result="accepted",${C}}[$__rate_interval])) * 60`, '{{country}} 수락'), q(`sum by (country) (rate(ff_vehicle_status_reports_total{result="rejected",${C}}[$__rate_interval])) * 60`, '{{country}} 거부')] });
  L.add({ w: 12, title: '정책·차단 반영 지연 분위수', description: '게시본 종류별 p50·p95 — 차단(KILL)은 등급에 따라 길 수 있다.', unit: 's', targets: [q(`histogram_quantile(0.5, sum by (le, kind) (rate(ff_vehicle_readback_latency_seconds_bucket{${C}}[15m])))`, '{{kind}} p50'), q(`histogram_quantile(0.95, sum by (le, kind) (rate(ff_vehicle_readback_latency_seconds_bucket{${C}}[15m])))`, '{{kind}} p95')] });
  return dashboard('ff-ops-overview', 'FF 운영 개요 (SLO)', '차량 OTA·Feature Flag 운영의 서비스 수준 — 수신·서명·반영 지연·긴급 차단·평가 오류와 오류 예산', ['slo'], L, [variable('country', '국가', 'label_values(ff_vehicles_registered, country)')]);
}

// ── 2. 차량 텔레메트리 수신 ─────────────────────────────────
function vehicleTelemetry(): Dashboard {
  const L = new Layout();
  const V = 'country=~"$country",vehicle_model=~"$vehicle_model"';
  const VS = `${V},sw_version=~"$sw_version"`;
  const VF = `${VS},feature=~"$feature"`;
  L.row('지금');
  L.add({ type: 'stat', w: 4, h: 5, title: '등록 차량', description: 'FF에 등록된 차량(운영·시연). SW 버전 변수로 좁힌다.', unit: 'short', targets: [q(`sum(ff_vehicles_registered{${VS}})`, '등록')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '미수신 1시간', description: '최근 1시간 동안 상태 보고·회신이 한 번도 없는 차량 수. 밤·주말에는 주차로 늘어난다.', unit: 'short', steps: [[null, 'green'], [50, 'orange'], [150, 'red']], targets: [q(`sum(ff_vehicles_silent{window="1h",${V}})`, '1시간')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '미수신 24시간', description: '하루 넘게 소식이 없는 차량 — 장기 주차·통신 단절·해외 로밍. 늘면 OTA 서버 연결 목록과 대조한다.', unit: 'short', steps: [[null, 'green'], [10, 'orange'], [30, 'red']], targets: [q(`sum(ff_vehicles_silent{window="24h",${V}})`, '24시간')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '수신 보고(분당)', description: '상태 보고 v2 수신 속도(5분 평균).', unit: 'short', decimals: 1, targets: [q(`sum(rate(ff_vehicle_status_reports_total{${VF}}[5m])) * 60`, '분당')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '거부율(1시간)', description: '수신 검사 위반 비율. 0.5%를 넘으면 경보.', unit: 'percentunit', decimals: 2, steps: [[null, 'green'], [0.005, 'orange'], [0.02, 'red']], targets: [q(`sum(rate(ff_vehicle_status_reports_total{result="rejected",${VF}}[1h])) / sum(rate(ff_vehicle_status_reports_total{${VF}}[1h]))`, '거부율')] });
  L.add({ type: 'stat', w: 4, h: 5, title: 'DTC 보고(1시간)', description: 'DTC가 실린 상태 보고 수. Feature 운영 건강도의 문제 축과 함께 본다.', unit: 'short', steps: [[null, 'green'], [5, 'orange'], [20, 'red']], targets: [q(`sum(increase(ff_vehicle_dtc_reports_total{${V},feature=~"$feature"}[1h]))`, 'DTC')] });
  L.row('수신 추세');
  L.add({ w: 12, title: '국가·차종별 수신(분당)', description: '수락된 상태 보고. 시장별 현지 시각 주행 패턴(출퇴근 정점)을 따른다. 한 칸만 급감하면 그 지역 통신·OTA 서버 장애.', targets: [q(`sum by (country, vehicle_model) (rate(ff_vehicle_status_reports_total{result="accepted",${VF}}[$__rate_interval])) * 60`, '{{country}} {{vehicle_model}}')] });
  L.add({ w: 12, title: '미수신 차량 추세', description: '1시간·24시간 창 미수신 차량. 24시간 값이 꾸준히 오르면 단절 차량이 쌓이는 것 — 오프라인 차량 회수 계획이 필요하다.', targets: [q(`sum by (country, window) (ff_vehicles_silent{${V}})`, '{{country}} {{window}}')] });
  L.add({ w: 12, title: '통신 채널별 수신', description: 'IF-06(OTA 서버·mTLS)과 GLEO 등 수신 경로별. 한 경로만 줄면 그 경로 게이트웨이 점검.', targets: [q(`sum by (via) (rate(ff_vehicle_status_reports_total{${VF}}[$__rate_interval])) * 60`, '{{via}}')] });
  L.add({ w: 12, title: '거부 코드', description: 'REPLAY(재전송)·AUTH_FAILED(서명)·SCHEMA·PSEUDONYM_MISMATCH. AUTH_FAILED가 몰리면 위조 시도 — FF 이상 징후(보안)·채널 제한.', steps: undefined, targets: [q(`sum by (code) (increase(ff_vehicle_status_reports_total{result="rejected",${VF}}[$__rate_interval]))`, '{{code}}')], custom: { drawStyle: 'bars', stacking: { mode: 'normal' }, fillOpacity: 80 } });
  L.row('회신(readback)·서명 검증');
  L.add({ type: 'heatmap', w: 12, h: 9, title: '회신 지연 분포', description: '게시본 서명 → 차량 회신 시간의 분포(칸별 개수). 위쪽 띠가 두꺼워지면 통신 지연·오프라인 재연결이 많은 것.', unit: 's', targets: [q(`sum by (le) (increase(ff_vehicle_readback_latency_seconds_bucket{country=~"$country"}[$__rate_interval]))`, '{{le}}', { format: 'heatmap' })], options: { calculate: false, yAxis: { unit: 's' }, color: { scheme: 'Oranges', mode: 'scheme' }, cellGap: 1, tooltip: { show: true, yHistogram: true } } });
  L.add({ w: 12, h: 9, title: '회신 결과·거부 사유', description: '적용(applied)과 거부 사유. SIGNATURE_INVALID·UNKNOWN_KEY는 서명 문제, REPLAY는 순번, TARGET_MISMATCH는 대상 오류.', targets: [q(`sum by (result, reason) (increase(ff_vehicle_readbacks_total{${VF}}[$__rate_interval]))`, '{{result}} {{reason}}')], custom: { drawStyle: 'bars', stacking: { mode: 'normal' }, fillOpacity: 70 } });
  L.add({ w: 12, title: '서명 검증 실패', description: '상태 보고 state_auth 실패 + 차량이 거부한 게시본 서명. 0이 정상. 오르면 경보 "서명 검증 실패 급증".', steps: [[null, 'green'], [1, 'red']], targets: [q(`sum by (country, vehicle_model) (increase(ff_vehicle_status_auth_total{result="invalid",${V}}[$__rate_interval]))`, '상태 보고 {{country}} {{vehicle_model}}'), q(`sum by (country, vehicle_model, kind) (increase(ff_vehicle_signature_checks_total{result="invalid",${V}}[$__rate_interval]))`, '게시본 {{kind}} {{country}} {{vehicle_model}}')] });
  L.add({ w: 12, title: '게시본 전달(채널별 대상 차량)', description: '정책·차단 게시본을 어느 채널로 몇 대에 보냈는지. unreachable은 연결이 끊겨 보내지 못한 차량.', targets: [q('sum by (kind, channel) (increase(ff_publication_deliveries_total[$__rate_interval]))', '{{kind}} {{channel}}')], custom: { drawStyle: 'bars', stacking: { mode: 'normal' }, fillOpacity: 70 } });
  L.row('Feature·SW 버전별');
  L.add({ type: 'bargauge', w: 12, h: 9, title: 'Feature별 수신 보고(1시간)', description: 'Feature마다 받은 상태 보고. 막대를 누르면 FF Feature 상세로 간다.', targets: [q(`sum by (feature) (increase(ff_vehicle_status_reports_total{${VF}}[1h]))`, '{{feature}}')], fieldLinks: [{ title: 'FF에서 Feature 목록 열기', url: '${ff_url}/features?q=${__field.labels.feature}' }] });
  L.add({ type: 'table', w: 12, h: 9, title: 'SW 버전별 수신·거부(1시간)', description: '국가·차종·SW 버전마다 수락·거부. 특정 SW 버전만 거부가 많으면 그 SW의 상태 보고 구현을 의심한다.', targets: [qi(`sum by (country, vehicle_model, sw_version, result) (increase(ff_vehicle_status_reports_total{${VF}}[1h]))`)], transformations: [{ id: 'pivot', options: {} }, { id: 'groupingToMatrix', options: { columnField: 'result', rowField: 'sw_version', valueField: 'Value' } }], options: { showHeader: true } });
  L.row('차량 수신 로그(개인정보 없는 필드)');
  L.add({ type: 'logs', w: 24, h: 9, title: '차량 회신·거부 이벤트', description: 'OTLP 로그(Loki) — 국가·차종·SW·Feature·결과·지연만 싣는다(VIN·가명 없음). event로 거른다.', datasource: LOKI, targets: [{ datasource: LOKI, expr: '{service_name=~"ff-platform"} | event=~"vehicle.readback|vehicle.status.rejected|vehicle.status.accepted" | country=~"$country"', queryType: 'range' }], options: { showTime: true, wrapLogMessage: true, enableLogDetails: true, sortOrder: 'Descending' } });
  return dashboard('ff-vehicle-telemetry', '차량 텔레메트리 수신', '차량 상태 보고 v2·게시본 회신·서명 검증·미수신·통신 채널 — 국가·차종·SW·Feature 드릴다운', ['telemetry'], L, [
    variable('country', '국가', 'label_values(ff_vehicles_registered, country)'),
    variable('vehicle_model', '차종', 'label_values(ff_vehicles_registered{country=~"$country"}, vehicle_model)'),
    variable('sw_version', 'SW 버전', 'label_values(ff_vehicles_registered{country=~"$country",vehicle_model=~"$vehicle_model"}, sw_version)'),
    variable('feature', 'Feature', 'label_values(ff_vehicle_status_reports_total{country=~"$country"}, feature)'),
  ]);
}

// ── 3. 긴급 차단 반영 ────────────────────────────────────
function killSwitch(): Dashboard {
  const L = new Layout();
  const F = 'feature=~"$feature"';
  L.row('지금');
  L.add({ type: 'stat', w: 4, h: 5, title: '걸린 차단', description: '대상 차량이 있는 걸린 차단(Feature·등급 단위).', unit: 'short', noValue: '0', targets: [q(`count(ff_kill_target_vehicles{${F}} > 0)`, '차단')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '대상 차량', description: '걸린 차단의 대상 차량 합.', unit: 'short', noValue: '0', targets: [q(`sum(ff_kill_target_vehicles{${F}})`, '대상')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '아직 반영 안 됨', description: '끝 상태를 보고하지 않은 차량. 기한이 지나면 FF가 이상 징후(전달)로 올린다.', unit: 'short', steps: [[null, 'green'], [1, 'orange'], [10, 'red']], noValue: '0', targets: [q(`sum(ff_kill_pending_vehicles{${F}})`, '미반영')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '반영률', description: '걸린 차단 대상 가운데 끝 상태를 보고한 차량 비율(1 − 미반영/대상). 99% 아래로 오래 머물면 오프라인 차량이 남은 것.', unit: 'percentunit', decimals: 1, steps: [[null, 'red'], [0.9, 'orange'], [0.99, 'green']], noValue: '걸린 차단 0건', targets: [q(`1 - sum(ff_kill_pending_vehicles{${F}}) / sum(ff_kill_target_vehicles{${F}})`, '반영률')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '기한 초과(24시간)', description: '등급별 기한(DC0 1분·DC1 10분·DC2 30분·DC3 6시간 + 여유)을 넘긴 차량 수.', unit: 'short', steps: [[null, 'green'], [1, 'orange'], [5, 'red']], targets: [q(`sum(increase(ff_kill_overdue_vehicles_total{${F}}[24h]))`, '기한 초과')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '재전송(24시간)', description: '차량이 같은 명령을 다시 요청한 수 — 통신 품질·NV 쓰기 실패 신호.', unit: 'short', steps: [[null, 'green'], [5, 'orange'], [20, 'red']], targets: [q(`sum(increase(ff_kill_reissues_total{${F}}[24h]))`, '재전송')] });
  L.row('반영 곡선·시간');
  L.add({ w: 12, h: 9, title: '명령별 반영률 곡선', description: '걸린 차단마다 시간에 따른 반영률(1 − 미반영/대상). 발령 직후 가파르게 오르다 오프라인 꼬리에서 멈춘다. 평평하게 멈춘 높이가 낮으면 오프라인 차량이 많다.', unit: 'percentunit', min: 0, max: 1, targets: [q(`1 - sum by (feature, deact_class) (ff_kill_pending_vehicles{${F}}) / sum by (feature, deact_class) (ff_kill_target_vehicles{${F}})`, '{{feature}} {{deact_class}}')], fieldLinks: [{ title: 'FF 긴급 차단·복구', url: '${ff_url}/ops/kill' }] });
  L.add({ w: 12, h: 9, title: '명령 → 회신 시간 분위수', description: '발급부터 차량이 끝 상태를 처음 보고하기까지(등급·요청별 p50·p95·p99). DC2는 인계·램프, DC3는 다음 시동까지 기다린다.', unit: 's', targets: [q(`histogram_quantile(0.5, sum by (le, deact_class, request) (rate(ff_kill_apply_latency_seconds_bucket{${F}}[30m])))`, '{{deact_class}} {{request}} p50'), q(`histogram_quantile(0.95, sum by (le, deact_class, request) (rate(ff_kill_apply_latency_seconds_bucket{${F}}[30m])))`, '{{deact_class}} {{request}} p95'), q(`histogram_quantile(0.99, sum by (le, deact_class, request) (rate(ff_kill_apply_latency_seconds_bucket{${F}}[30m])))`, '{{deact_class}} {{request}} p99')] });
  L.add({ type: 'heatmap', w: 12, h: 9, title: '시간-반영 히트맵', description: '반영 지연 칸별 차량 수의 시간 변화. 발령 시점마다 세로 띠가 생기고, 위로 길게 남는 칸이 지연 차량이다.', unit: 's', targets: [q(`sum by (le) (increase(ff_kill_apply_latency_seconds_bucket{${F},request="deactivate"}[$__rate_interval]))`, '{{le}}', { format: 'heatmap' })], options: { calculate: false, yAxis: { unit: 's' }, color: { scheme: 'Reds', mode: 'scheme' }, cellGap: 1 } });
  L.add({ type: 'bargauge', w: 12, h: 9, title: '지연 차량 Top(Feature·등급)', description: '지금 끝 상태가 아닌 차량이 많은 차단부터. 차량 한 대씩은 FF 차단 상세(차량별 봉투·상태)에서 본다 — Grafana에는 VIN을 싣지 않는다.', steps: [[null, 'green'], [1, 'orange'], [10, 'red']], targets: [qi(`topk(10, sum by (feature, deact_class) (ff_kill_pending_vehicles{${F}}))`, '{{feature}} {{deact_class}}', { format: 'time_series' })], fieldLinks: [{ title: 'FF 긴급 차단·복구', url: '${ff_url}/ops/kill' }] });
  L.add({ w: 12, title: '재전송·기한 초과', description: '재전송은 차량이 명령을 다시 요청한 것, 기한 초과는 기한 감시가 올린 차량 수.', targets: [q(`sum by (feature) (increase(ff_kill_reissues_total{${F}}[$__rate_interval]))`, '재전송 {{feature}}'), q(`sum by (feature) (increase(ff_kill_overdue_vehicles_total{${F}}[$__rate_interval]))`, '기한 초과 {{feature}}')], custom: { drawStyle: 'bars', fillOpacity: 70 } });
  L.add({ w: 12, title: '발령·해제', description: '긴급 차단 발령과 복원(해제) 명령 수.', targets: [q(`sum by (feature, deact_class) (increase(ff_kill_commands_total{${F}}[$__rate_interval]))`, '발령 {{feature}} {{deact_class}}'), q(`sum by (feature) (increase(ff_kill_releases_total{${F}}[$__rate_interval]))`, '해제 {{feature}}')], custom: { drawStyle: 'bars', fillOpacity: 80 } });
  L.row('차단 이벤트 로그');
  L.add({ type: 'logs', w: 24, h: 8, title: '발령·반영·기한 초과·해제', description: 'OTLP 로그(Loki) — 차단 ID·Feature·등급·반영 지연(차량 식별자 없음).', datasource: LOKI, targets: [{ datasource: LOKI, expr: '{service_name=~"ff-platform"} | event=~"kill.*"', queryType: 'range' }], options: { showTime: true, wrapLogMessage: true, enableLogDetails: true, sortOrder: 'Descending' } });
  return dashboard('ff-kill-switch', '긴급 차단 반영', '긴급 차단·복원 명령의 차량 반영률·반영 시간·기한 초과·재전송', ['kill'], L, [variable('feature', 'Feature', 'label_values(ff_kill_commands_total, feature)')], '/ops/kill', 'now-24h');
}

// ── 4. Canary 단계 배포 ──────────────────────────────────
function canary(): Dashboard {
  const L = new Layout();
  const F = 'feature=~"$feature"';
  // 적용군은 작다(5% 단계) — 24시간 창으로 표본을 모은다
  const per = (metric: string, cohort: string) => `sum(rate(${metric}{${F},cohort="${cohort}"}[24h])) / sum(avg_over_time(ff_feature_active_vehicles{${F},cohort="${cohort}"}[24h]))`;
  L.row('단계');
  L.add({ type: 'stat', w: 6, h: 5, title: '적용군 비율', description: '새 Version을 쓰는 차량 비율(적용군 활성 / 전체 활성). 14일 주기로 5%→25%→50%→100%.', unit: 'percentunit', decimals: 0, targets: [q(`sum(ff_feature_active_vehicles{${F},cohort="treatment"}) / sum(ff_feature_active_vehicles{${F},cohort=~"treatment|control"})`, '적용군')] });
  L.add({ type: 'stat', w: 6, h: 5, title: 'DTC 상대위험(적용군/대조군)', description: '활성 차량당 DTC 발생률의 비(24시간 창). 1.5 이상이면 주의, 2 이상이면 확대 중단 검토 — FF 정책 상세의 단계 확대 화면에서 HOLD.', unit: 'none', decimals: 2, steps: [[null, 'green'], [1.5, 'orange'], [2, 'red']], noValue: '대조군 0대', targets: [q(`(${per('ff_feature_dtc_total', 'treatment')}) / (${per('ff_feature_dtc_total', 'control')})`, 'DTC RR')] });
  L.add({ type: 'stat', w: 6, h: 5, title: '오류 상대위험', description: '활성 차량당 Feature 동작 오류의 비.', unit: 'none', decimals: 2, steps: [[null, 'green'], [1.5, 'orange'], [2, 'red']], noValue: '대조군 0대', targets: [q(`(${per('ff_feature_errors_total', 'treatment')}) / (${per('ff_feature_errors_total', 'control')})`, '오류 RR')] });
  L.add({ type: 'stat', w: 6, h: 5, title: '폴백 상대위험', description: '활성 차량당 Safe Default 폴백의 비.', unit: 'none', decimals: 2, steps: [[null, 'green'], [1.5, 'orange'], [2, 'red']], noValue: '대조군 0대', targets: [q(`(${per('ff_feature_fallbacks_total', 'treatment')}) / (${per('ff_feature_fallbacks_total', 'control')})`, '폴백 RR')] });
  L.row('적용군 대 대조군');
  for (const [metric, title, desc] of [
    ['ff_feature_dtc_total', 'DTC(활성 1천 대·시간당)', 'Canary 이상 감지의 핵심 — 적용군 선이 대조군 위로 벌어지면 확대를 멈춘다.'],
    ['ff_feature_errors_total', 'Feature 오류(활성 1천 대·시간당)', '같은 시간대 대조군과 비교한다 — 주행 패턴 영향을 지운다.'],
    ['ff_feature_fallbacks_total', '폴백(활성 1천 대·시간당)', 'Safe Default로 떨어진 횟수. 사유는 Feature 운영 건강도에서.'],
    ['ff_feature_manual_off_total', '수동 끄기(활성 1천 대·시간당)', '운전자가 새 Version을 끄는지 — 사용성 회귀 신호.'],
  ] as const)
    L.add({ w: 12, title, description: desc, targets: ['treatment', 'control'].map((c) => q(`sum by (feature, feature_version) (rate(${metric}{${F},cohort="${c}"}[3h])) * 3600 * 1000 / sum by (feature, feature_version) (avg_over_time(ff_feature_active_vehicles{${F},cohort="${c}"}[3h]))`, `${c === 'treatment' ? '적용군' : '대조군'} {{feature}} {{feature_version}}`)), fieldLinks: [FEATURE_LINK] });
  L.add({ w: 12, title: '활성 차량(적용군·대조군)', description: '두 군의 활성 차량. 단계 확대 때 적용군이 계단처럼 오른다(시간축 주석: 단계 확대).', targets: [q(`sum by (cohort, feature_version) (ff_feature_active_vehicles{${F},cohort=~"treatment|control"})`, '{{cohort}} {{feature_version}}')] });
  L.add({ w: 12, title: 'Flag 단계 비율·분할 평가', description: '배포된 정책의 단계 비율(ff_rollout_stage_ratio)과 실험 Flag의 분할(SPLIT) 평가 변형.', unit: 'percentunit', targets: [q('ff_rollout_stage_ratio', '{{flag}} 단계'), q('sum by (flag, variant) (rate(ff_flag_evaluations_total{reason="SPLIT"}[15m])) / ignoring(variant) group_left sum by (flag) (rate(ff_flag_evaluations_total{reason="SPLIT"}[15m]))', '{{flag}} {{variant}}')] });
  return dashboard('ff-canary', 'Canary 단계 배포', '적용군(새 Version)과 대조군 비교 — DTC·오류·폴백·수동 끄기 상대위험과 단계 확대', ['canary'], L, [variable('feature', 'Feature', 'label_values(ff_feature_active_vehicles{cohort="treatment"}, feature)', { includeAll: false, multi: false, current: {} })], '/policies');
}

// ── 5. Flag 평가 ────────────────────────────────────────
function flagEval(): Dashboard {
  const L = new Layout();
  const G = 'flag=~"$flag",feature=~"$feature"';
  L.row('지금(1시간)');
  L.add({ type: 'stat', w: 4, h: 5, title: '평가(초당)', description: 'OFREP·차량 번들 Hook의 Flag 평가 속도.', unit: 'reqps', decimals: 2, targets: [q(`sum(rate(ff_flag_evaluations_total{${G}}[5m]))`, '평가')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '폴백 비율', description: '기본값(DEFAULT)·오류(ERROR)로 떨어진 비율 — 대상 밖·권한 없음이 대부분. 갑자기 오르면 문맥(context) 누락·정책 오류.', unit: 'percentunit', decimals: 1, steps: [[null, 'green'], [0.1, 'orange'], [0.25, 'red']], targets: [q(`sum(rate(ff_flag_evaluations_total{${G},reason=~"DEFAULT|ERROR"}[1h])) / sum(rate(ff_flag_evaluations_total{${G}}[1h]))`, '폴백')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '오류율', description: 'ERROR 사유 비율. 1%를 넘으면 경보.', unit: 'percentunit', decimals: 2, steps: GOOD_LOW_PCT, targets: [q(`sum(rate(ff_flag_evaluations_total{${G},reason="ERROR"}[1h])) / sum(rate(ff_flag_evaluations_total{${G}}[1h]))`, '오류')] });
  L.add({ type: 'stat', w: 4, h: 5, title: '안전 경계(F2 이상)', description: 'F2 이상 Flag는 OpenFeature로 값을 계산하지 않고 Safe Default(DISABLED)를 준다 — 이 비율은 설계대로이며 오류가 아니다.', unit: 'percentunit', decimals: 1, targets: [q(`sum(rate(ff_flag_evaluations_total{${G},variant="safe_default"}[1h])) / sum(rate(ff_flag_evaluations_total{${G}}[1h]))`, '안전 경계')] });
  L.add({ type: 'stat', w: 4, h: 5, title: 'Edge p95', description: 'Unleash Edge 호출 95번째 백분위.', unit: 's', decimals: 3, steps: [[null, 'green'], [0.05, 'orange'], [0.2, 'red']], targets: [q('histogram_quantile(0.95, sum by (le) (rate(ff_unleash_edge_request_duration_seconds_bucket[1h])))', 'p95')] });
  L.add({ type: 'stat', w: 4, h: 5, title: 'Unleash drift', description: 'Unleash 서버 정의가 FF 원천과 다른 Flag 수. 0이 정상 — 1 이상이면 차량 서명본 발급이 멈춘다(FF가 막는다). 조치: FF 정책 Unleash 동기화.', unit: 'short', steps: [[null, 'green'], [1, 'red']], targets: [q('sum(ff_unleash_drift)', 'drift')] });
  L.row('평가 사유·변형');
  L.add({ w: 12, title: '사유별 평가', description: 'TARGETING_MATCH(대상 일치)·DEFAULT·DISABLED(차단·안전 경계)·SPLIT(실험)·ERROR. 긴급 차단 중에는 해당 Feature의 DISABLED가 오른다(시간축 주석).', targets: [q(`sum by (reason) (rate(ff_flag_evaluations_total{${G}}[$__rate_interval]))`, '{{reason}}')], custom: { stacking: { mode: 'normal' }, fillOpacity: 40 } });
  L.add({ w: 12, title: 'Flag·변형별 평가', description: 'Flag마다 on·off·safe_default·treatment·control 분포. 한 변형이 갑자기 사라지면 정책 변경을 확인한다.', targets: [q(`sum by (flag, variant) (rate(ff_flag_evaluations_total{${G}}[$__rate_interval]))`, '{{flag}} {{variant}}')] });
  L.add({ w: 12, title: '오류 종류', description: 'flag_not_found(배포 안 된 키 — SDK는 기본값), general(평가기·Edge 장애), invalid_context(금지 문맥 속성).', targets: [q('sum by (flag, error) (increase(ff_flag_evaluation_errors_total{flag=~"$flag"}[$__rate_interval]))', '{{flag}} {{error}}')], custom: { drawStyle: 'bars', stacking: { mode: 'normal' }, fillOpacity: 70 } });
  L.add({ w: 12, title: 'Edge 지연·오류', description: 'Unleash Edge 평가·정의 조회 p50·p95와 오류 비율.', unit: 's', targets: [q('histogram_quantile(0.5, sum by (le, op) (rate(ff_unleash_edge_request_duration_seconds_bucket[$__rate_interval])))', '{{op}} p50'), q('histogram_quantile(0.95, sum by (le, op) (rate(ff_unleash_edge_request_duration_seconds_bucket[$__rate_interval])))', '{{op}} p95')], overrides: [] });
  L.add({ w: 12, title: 'Edge 오류율', description: '실패 호출 비율. 5%를 넘으면 경보 — 차량 서명본 발급·평가가 Safe Default로 떨어진다.', unit: 'percentunit', steps: [[null, 'green'], [0.01, 'orange'], [0.05, 'red']], targets: [q('sum(rate(ff_unleash_edge_request_duration_seconds_count{result="error"}[$__rate_interval])) / sum(rate(ff_unleash_edge_request_duration_seconds_count[$__rate_interval]))', 'Edge 오류율')] });
  L.add({ type: 'state-timeline', w: 12, title: 'Unleash drift(Flag별)', description: '1인 구간 = 서버 정의가 FF 원천과 다르던 시간.', steps: [[null, 'green'], [1, 'red']], targets: [q('max by (flag) (ff_unleash_drift)', '{{flag}}')], mappings: [{ type: 'value', options: { '0': { text: '일치', color: 'green' }, '1': { text: 'drift', color: 'red' } } }] });
  L.row('배포된 Flag·추적');
  L.add({ type: 'table', w: 12, h: 8, title: '배포된 Flag', description: 'Flag ↔ 정책·Feature·F 등급. 행을 누르면 FF 정책 상세로 간다.', targets: [qi('max by (flag, policy, feature, feature_version, f_class) (ff_flag_info{flag=~"$flag"})')], transformations: [{ id: 'organize', options: { excludeByName: { Time: true, Value: true } } }], overrides: [{ matcher: { id: 'byName', options: 'policy' }, properties: [{ id: 'links', value: [{ ...POLICY_ROW_LINK, targetBlank: true }] }] }, { matcher: { id: 'byName', options: 'feature' }, properties: [{ id: 'links', value: [{ ...FEATURE_ROW_LINK, targetBlank: true }] }] }] });
  L.add({ type: 'table', w: 12, h: 8, title: '오류 평가 추적', description: 'Tempo — 오류로 끝난 feature_flag.evaluation span(가명 속성 없음). 추적 ID를 누르면 span을 연다.', datasource: TEMPO, targets: [{ datasource: TEMPO, queryType: 'traceql', query: '{ name = "feature_flag.evaluation" && status = error }', limit: 20 }] });
  return dashboard('ff-flag-eval', 'Flag 평가', 'OpenFeature 평가 수·사유·변형·폴백·오류율, Unleash Edge 지연·오류, drift', ['flags'], L, [variable('flag', 'Flag', 'label_values(ff_flag_evaluations_total, flag)'), variable('feature', 'Feature', 'label_values(ff_flag_evaluations_total{flag=~"$flag"}, feature)')], '/policies');
}

// ── 6. 플랫폼 서비스 ─────────────────────────────────────
function platform(): Dashboard {
  const L = new Layout();
  const I = 'instance=~"$instance"';
  L.row('API');
  L.add({ type: 'stat', w: 6, h: 5, title: '요청(초당)', description: 'FF API 전체 요청 속도.', unit: 'reqps', decimals: 1, targets: [q(`sum(rate(ff_http_requests_total{${I}}[5m]))`, '요청')] });
  L.add({ type: 'stat', w: 6, h: 5, title: '5xx 비율(1시간)', description: '서버 오류 비율. 1%를 넘으면 경보.', unit: 'percentunit', decimals: 2, steps: GOOD_LOW_PCT, targets: [q(`sum(rate(ff_http_requests_total{${I},status=~"5.."}[1h])) / sum(rate(ff_http_requests_total{${I}}[1h]))`, '5xx')] });
  L.add({ type: 'stat', w: 6, h: 5, title: 'p95 처리 시간', description: '전체 경로의 처리 시간 95번째 백분위(1시간). 0.5초를 넘으면 경로별 p95에서 느린 경로를 찾는다.', unit: 's', decimals: 3, steps: [[null, 'green'], [0.5, 'orange'], [2, 'red']], targets: [q(`histogram_quantile(0.95, sum by (le) (rate(ff_http_request_duration_seconds_bucket{${I}}[1h])))`, 'p95')] });
  L.add({ type: 'stat', w: 6, h: 5, title: '가동 시간', description: '프로세스 가동 시간. 갑자기 0이 되면 재시작 — 재시작 복구(기한 감시 재설정)를 확인한다.', unit: 's', targets: [q(`max(ff_process_uptime_seconds{${I}})`, '가동')] });
  L.add({ w: 12, title: '경로별 요청', description: '라우트 틀(:id)로 묶은 경로별 요청.', unit: 'reqps', targets: [q(`sum by (route) (rate(ff_http_requests_total{${I}}[$__rate_interval]))`, '{{route}}')] });
  L.add({ w: 12, title: '경로별 p95', description: '차량 경로(/vehicle/v1·/ofrep)는 차량 수에 비례하고, 화면 경로는 업무 시간에 오른다.', unit: 's', targets: [q(`histogram_quantile(0.95, sum by (le, route) (rate(ff_http_request_duration_seconds_bucket{${I}}[$__rate_interval])))`, '{{route}}')] });
  L.add({ w: 12, title: '상태별 오류', description: '4xx(요청 오류)와 5xx(서버 오류).', targets: [q(`sum by (route, status) (rate(ff_http_requests_total{${I},status!~"2..|3.."}[$__rate_interval]))`, '{{route}} {{status}}')] });
  L.add({ w: 12, title: '메모리', description: '상주 메모리·힙. 꾸준히 오르기만 하면 누수 의심.', unit: 'bytes', targets: [q(`max(ff_process_resident_memory_bytes{${I}})`, '상주'), q(`max(ff_process_heap_used_bytes{${I}})`, '힙')] });
  L.row('연계·이벤트 큐');
  L.add({ w: 12, title: '외부 연계 보낼 함(이벤트 큐)', description: 'GitLab·JIRA·codeBeamer로 보낼 대기 건. 계속 쌓이면 외부 시스템 장애 — FF 외부 연계 현황(/integration/connectors).', targets: [q('sum by (system) (ff_ext_outbox_pending)', '{{system}}')], fieldLinks: [{ title: 'FF 외부 연계 현황', url: '${ff_url}/integration/connectors' }] });
  L.add({ w: 12, title: '플랫폼 이벤트(종류별)', description: '대시보드 주석에 쓰는 이벤트 — 정책 배포·차단·복원·동기화.', targets: [q('sum by (type) (increase(ff_events_total[$__rate_interval]))', '{{type}}')], custom: { drawStyle: 'bars', stacking: { mode: 'normal' }, fillOpacity: 70 } });
  L.add({ w: 12, title: 'Unleash drift·Edge 오류', description: 'Unleash 사본이 원천과 다른 Flag 수와 Edge 오류 비율.', targets: [q('sum(ff_unleash_drift)', 'drift Flag'), q('sum(rate(ff_unleash_edge_request_duration_seconds_count{result="error"}[$__rate_interval])) / sum(rate(ff_unleash_edge_request_duration_seconds_count[$__rate_interval]))', 'Edge 오류율')] });
  L.add({ w: 12, title: 'Data Lake 신선도', description: 'IF-15 데이터셋 지연(초). 30분을 넘으면 Feature 운영 판정은 "판단 불가"로 둔다(정상으로 보지 않는다).', unit: 's', steps: [[null, 'green'], [900, 'orange'], [1800, 'red']], targets: [q('max by (dataset) (ff_lake_freshness_seconds)', '{{dataset}}')] });
  L.add({ w: 12, title: 'Grafana 경보 → FF 운영 관찰', description: 'FF가 받은 Grafana 경보(축·상태). FF 이상 징후·Feature 운영 점검으로 이어진다.', targets: [q('sum by (axis, status) (increase(ff_ops_observations_total[$__rate_interval]))', '{{axis}} {{status}}')], custom: { drawStyle: 'bars', stacking: { mode: 'normal' }, fillOpacity: 70 } });
  L.add({ w: 12, title: '지표 상한으로 합친 기록', description: '라벨 조합이 지표당 상한(500)을 넘어 _other로 합친 수. 0이 정상 — 오르면 라벨 값이 늘어나는 원인을 찾는다.', targets: [q('sum by (metric) (increase(ff_metrics_series_dropped_total[$__rate_interval]))', '{{metric}}')] });
  return dashboard('ff-platform', '플랫폼 서비스', 'FF API 지연·오류, 프로세스, Unleash 동기화 drift·Edge, 외부 연계 큐, Data Lake 신선도', ['platform'], L, [variable('instance', '설치', 'label_values(ff_process_uptime_seconds, instance)')], '/integration/connectors');
}

// ── 7. Feature 운영 건강도(Closed loop) ───────────────────
function featureHealth(): Dashboard {
  const L = new Layout();
  const G = 'feature=~"$feature",feature_version=~"$feature_version",country=~"$country",vehicle_model=~"$vehicle_model"';
  const H = 'feature=~"$feature",feature_version=~"$feature_version"';
  const perActive = (metric: string, by = 'feature, feature_version') => `sum by (${by}) (rate(${metric}{${G}}[1h])) * 3600 / sum by (${by}) (avg_over_time(ff_feature_active_vehicles{${G}}[1h]))`;
  L.row('한눈에 — 4축 입력 지표(IF-15)');
  L.add({ type: 'table', w: 24, h: 9, title: 'Feature Version 4축', description: '동작(적용 성공·거부)·문제(DTC·고장·안전 이벤트)·개선(사용률·수동 끄기)·위험(이상 징후·보안·결측). 칸 색이 주황·빨강이면 개선 후보 — Feature를 누르면 FF Feature 상세, 오른쪽 링크는 이 대시보드의 해당 Feature로 좁힌다. 판정(정상·주의·조치 필요·판단 불가)은 FF가 한다.', targets: [qi(`max by (feature, feature_version, indicator) (ff_feature_health_indicator{${H},indicator=~"delivery_success_rate|status_rejected_rate|dtc_vehicle_rate|fault_rate_per_1k|usage_rate|manual_off_rate|anomaly_open_count|data_missing_rate"})`)], transformations: [{ id: 'groupingToMatrix', options: { columnField: 'indicator', rowField: 'feature', valueField: 'Value' } }], overrides: [
    { matcher: { id: 'byName', options: 'usage_rate' }, properties: [{ id: 'unit', value: 'percentunit' }, { id: 'thresholds', value: { mode: 'absolute', steps: [{ value: null, color: 'red' }, { value: 0.3, color: 'orange' }, { value: 0.5, color: 'green' }] } }, { id: 'custom.cellOptions', value: { type: 'color-background' } }] },
    { matcher: { id: 'byName', options: 'manual_off_rate' }, properties: [{ id: 'unit', value: 'percentunit' }, { id: 'thresholds', value: { mode: 'absolute', steps: [{ value: null, color: 'green' }, { value: 0.1, color: 'orange' }, { value: 0.15, color: 'red' }] } }, { id: 'custom.cellOptions', value: { type: 'color-background' } }] },
    { matcher: { id: 'byName', options: 'delivery_success_rate' }, properties: [{ id: 'unit', value: 'percentunit' }, { id: 'thresholds', value: { mode: 'absolute', steps: [{ value: null, color: 'red' }, { value: 0.98, color: 'orange' }, { value: 0.99, color: 'green' }] } }, { id: 'custom.cellOptions', value: { type: 'color-background' } }] },
    { matcher: { id: 'byName', options: 'fault_rate_per_1k' }, properties: [{ id: 'decimals', value: 2 }, { id: 'thresholds', value: { mode: 'absolute', steps: [{ value: null, color: 'green' }, { value: 5, color: 'orange' }, { value: 8, color: 'red' }] } }, { id: 'custom.cellOptions', value: { type: 'color-background' } }] },
    { matcher: { id: 'byName', options: 'feature' }, properties: [{ id: 'links', value: [{ title: 'FF에서 Feature 열기', url: '${ff_url}/features/${__data.fields.feature}', targetBlank: true }, { ...HEALTH_DRILL }] }] },
  ] });
  L.row('사용 — 잘 쓰이는가(개선 축)');
  L.add({ w: 12, title: '활성 차량(Version별)', description: 'Feature가 켜져 있는 차량. 개선 후보: 같은 시장의 비슷한 Feature보다 낮으면 발견성(HMI 노출)이나 기본값 설계를 본다.', targets: [q(`sum by (feature, feature_version) (ff_feature_active_vehicles{${G}})`, '{{feature}} {{feature_version}}')], fieldLinks: [FEATURE_LINK] });
  L.add({ w: 12, title: '사용률(활성/대상)', description: 'IF-15 usage_rate. 개선 후보: 30% 아래가 이어지면 "사용률 저조" 경보 — 기능 가치·안내 문구·기본 켜짐 여부를 Feature Owner가 검토한다.', unit: 'percentunit', steps: [[null, 'red'], [0.3, 'orange'], [0.5, 'green']], targets: [q(`max by (feature, feature_version) (ff_feature_health_indicator{${H},indicator="usage_rate"})`, '{{feature}} {{feature_version}}')], fieldLinks: [FEATURE_LINK] });
  L.add({ w: 12, title: '사용 시간(활성 차량당 분/시간)', description: '켜진 차량이 실제로 쓰는 시간. 개선 후보: 활성은 높은데 사용 시간이 짧으면 켜 두기만 하고 실제 작동 조건(ODD)에 거의 들지 않는 것.', unit: 'm', targets: [q(`${perActive('ff_feature_usage_seconds_total')} / 60`, '{{feature}} {{feature_version}}')], fieldLinks: [FEATURE_LINK] });
  L.add({ w: 12, title: '사용 빈도(활성 차량당 켜짐/시간)', description: '켜짐 횟수. 개선 후보: 빈도가 높고 사용 시간이 짧으면 자주 꺼지고 다시 켜지는 것 — 조건 경계(히스테리시스) 조정 후보.', targets: [q(perActive('ff_feature_activations_total'), '{{feature}} {{feature_version}}')], fieldLinks: [FEATURE_LINK] });
  L.add({ w: 12, title: '수동 끄기 비율', description: '켜짐 대비 운전자가 직접 끈 비율. 개선 후보: 15% 이상이면 "운전자가 자주 끔" — 개입 강도·경고음·민감도 파라미터 검토(변경 요청 → 새 Version).', unit: 'percentunit', steps: [[null, 'green'], [0.1, 'orange'], [0.15, 'red']], targets: [q(`sum by (feature, feature_version, country) (rate(ff_feature_manual_off_total{${G}}[1h])) / sum by (feature, feature_version, country) (rate(ff_feature_activations_total{${G}}[1h]))`, '{{feature}} {{feature_version}} {{country}}')], fieldLinks: [FEATURE_LINK] });
  L.add({ w: 12, title: '이탈(켜고 60초 안에 끔)', description: '켜자마자 끄는 비율. 개선 후보: 10% 이상이면 첫 경험(첫 안내·화면 가림·오작동 인상) 문제 — UX 개선 후보.', unit: 'percentunit', steps: [[null, 'green'], [0.06, 'orange'], [0.1, 'red']], targets: [q(`sum by (feature, feature_version, country) (rate(ff_feature_quick_off_total{${G}}[1h])) / sum by (feature, feature_version, country) (rate(ff_feature_activations_total{${G}}[1h]))`, '{{feature}} {{feature_version}} {{country}}')], fieldLinks: [FEATURE_LINK] });
  L.row('문제 — 고장·폴백이 늘었는가(문제 축)');
  L.add({ w: 12, title: '폴백 비율(차종별)', description: 'Safe Default로 떨어진 비율을 차종별로. 개선 후보: 한 차종만 높으면 그 차종의 신호·ECU 조합 지원 문제 — 변형 조건(지원 조건) 재검토.', unit: 'percentunit', steps: [[null, 'green'], [0.03, 'orange'], [0.06, 'red']], targets: [q(`sum by (feature, feature_version, vehicle_model) (rate(ff_feature_fallbacks_total{${G},reason!="KILL_SWITCH"}[1h])) / sum by (feature, feature_version, vehicle_model) (rate(ff_feature_activations_total{${G}}[1h]))`, '{{feature}} {{feature_version}} {{vehicle_model}}')], fieldLinks: [FEATURE_LINK] });
  L.add({ w: 12, title: '폴백 사유', description: 'CONTEXT_UNKNOWN(문맥 없음)·ERROR_SAFE_DEFAULT(평가 오류)·NOT_SUPPORTED(미지원 조합)·KILL_SWITCH(긴급 차단). 개선 후보: NOT_SUPPORTED가 많으면 대상 정의(Targeting)가 실제 차량 구성보다 넓다.', targets: [q(`sum by (reason) (increase(ff_feature_fallbacks_total{${G}}[$__rate_interval]))`, '{{reason}}')], custom: { drawStyle: 'bars', stacking: { mode: 'normal' }, fillOpacity: 70 } });
  L.add({ w: 12, title: '오류율 — 출시 전후(Version 비교)', description: '활성 1천 대·시간당 오류를 Version별로. 개선 후보: 새 Version이 이전 Version보다 1.5배 이상이면 "출시 후 오류 증가" — 결함 등록(JIRA)·롤백 판단.', targets: [q(`${perActive('ff_feature_errors_total')} * 1000`, '{{feature}} {{feature_version}}')], fieldLinks: [FEATURE_LINK] });
  L.add({ w: 12, title: 'DTC(활성 1천 대·시간당)', description: 'Feature 관련 DTC. 개선 후보: 특정 Version·차종에서만 오르면 그 조합의 HW·SW 통합 문제.', targets: [q(`${perActive('ff_feature_dtc_total', 'feature, feature_version, vehicle_model')} * 1000`, '{{feature}} {{feature_version}} {{vehicle_model}}')], fieldLinks: [FEATURE_LINK] });
  L.row('차이 — 국가·차종·SW·코호트');
  L.add({ type: 'bargauge', w: 12, h: 9, title: '국가·차종별 활성 비율 차이', description: '시장·차종의 등록 차량 대비 Feature 활성 차량(24시간 평균). 개선 후보: 같은 Feature가 한 시장만 낮으면 현지화(언어·법규 경고·도로 특성)를 본다.', unit: 'percentunit', steps: [[null, 'red'], [0.1, 'orange'], [0.2, 'green']], targets: [qi(`sum by (feature, country, vehicle_model) (avg_over_time(ff_feature_active_vehicles{${G}}[24h])) / on (country, vehicle_model) group_left sum by (country, vehicle_model) (ff_vehicles_registered)`, '{{feature}} {{country}} {{vehicle_model}}', { format: 'time_series' })] });
  L.add({ w: 12, h: 9, title: 'SW 버전별 수신 거부(같은 Feature)', description: '이 Feature 상태 보고의 SW 버전별 거부율 — 특정 SW에서만 오르면 그 SW 배포를 의심한다.', unit: 'percentunit', targets: [q(`sum by (sw_version) (rate(ff_vehicle_status_reports_total{feature=~"$feature",result="rejected",country=~"$country"}[1h])) / sum by (sw_version) (rate(ff_vehicle_status_reports_total{feature=~"$feature",country=~"$country"}[1h]))`, 'SW {{sw_version}}')] });
  L.add({ w: 12, title: 'Canary 대 대조군(DTC 상대위험)', description: '적용군/대조군 DTC 비. 2를 넘으면 Canary 이상 — 확대 중단(FF 정책 단계 확대 HOLD). 자세히는 Canary 단계 배포 대시보드.', unit: 'none', steps: [[null, 'green'], [1.5, 'orange'], [2, 'red']], targets: [q(`(sum by (feature) (rate(ff_feature_dtc_total{${G},cohort="treatment"}[2h])) / sum by (feature) (ff_feature_active_vehicles{${G},cohort="treatment"})) / (sum by (feature) (rate(ff_feature_dtc_total{${G},cohort="control"}[2h])) / sum by (feature) (ff_feature_active_vehicles{${G},cohort="control"}))`, '{{feature}}')], links: [{ title: 'Canary 단계 배포', url: '/d/ff-canary?${__url_time_range}', targetBlank: false }] });
  L.add({ w: 12, title: '데이터 신선도·결측', description: 'Lake 데이터셋 지연과 결측률. 지연이 30분을 넘거나 결측이 5%를 넘으면 위 신호로 판정하지 않는다(판단 불가).', unit: 's', steps: [[null, 'green'], [900, 'orange'], [1800, 'red']], targets: [q('max by (dataset) (ff_lake_freshness_seconds)', '{{dataset}} 지연')] });
  L.row('FF로 돌아간 개선 후보');
  L.add({ type: 'table', w: 24, h: 7, title: '개선 후보 경보(최근 7일)', description: 'Grafana 경보가 FF 운영 관찰로 들어간 기록(축·상태). FF에서 Feature 상세 → 운영 지표, 이상 징후(/ops/anomalies)로 이어서 담당(Feature Owner)이 검토한다.', targets: [qi('sum by (axis, status) (increase(ff_ops_observations_total[7d]))')], transformations: [{ id: 'organize', options: { excludeByName: { Time: true } } }], links: [{ title: 'FF 이상 징후', url: '${ff_url}/ops/anomalies', targetBlank: true }] });
  return dashboard('ff-feature-health', 'Feature 운영 건강도', 'Feature·Version별 사용·문제·차이 신호와 개선 후보 — 운영 신호 → 개선 후보 → Feature Owner 검토 → 변경 요청/새 Version → 효과 확인(Closed loop)', ['feature', 'closed-loop'], L, [
    variable('feature', 'Feature', 'label_values(ff_feature_active_vehicles, feature)'),
    variable('feature_version', 'Version', 'label_values(ff_feature_active_vehicles{feature=~"$feature"}, feature_version)'),
    variable('country', '국가', 'label_values(ff_feature_active_vehicles{feature=~"$feature"}, country)'),
    variable('vehicle_model', '차종', 'label_values(ff_feature_active_vehicles{feature=~"$feature",country=~"$country"}, vehicle_model)'),
  ], '/features', 'now-24h');
}

export function dashboards(): Dashboard[] {
  return [opsOverview(), vehicleTelemetry(), killSwitch(), canary(), flagEval(), platform(), featureHealth()];
}

/** 공개 시연 대시보드 — 변수·전역 변수를 쓰지 않게 고정 값으로 바꾸고, FF 주소를 넣는다(외부 공유는 변수를 지원하지 않는다) */
export function publicVariant(d: Dashboard, ffUrl = FF_URL_DEFAULT): Dashboard {
  let s = JSON.stringify(d);
  s = s.replace(/\$\{ff_url\}/g, ffUrl);
  s = s.replace(/\$__rate_interval/g, '5m').replace(/\$__interval/g, '1m');
  for (const v of d.templating.list) {
    const name = String(v.name);
    if (name === 'ff_url') continue;
    s = s.replace(new RegExp(`=~\\\\"\\$${name}\\\\"`, 'g'), '=~\\".*\\"').replace(new RegExp(`=~\\\\"\\$\\{${name}\\}\\\\"`, 'g'), '=~\\".*\\"');
  }
  const out = JSON.parse(s) as Dashboard;
  out.uid = `${d.uid}-public`;
  out.title = `${d.title} (공개 시연)`;
  out.templating = { list: [] };
  out.links = (out.links as Json[]).filter((l) => l.type !== 'dashboards');
  out.tags = [...(d.tags as string[]).filter((t) => t !== 'ff'), 'ff-public'];
  // 대시보드 간 링크·드릴다운은 로그인 대시보드를 가리킨다 — 공개본에서는 FF 링크만 남긴다
  for (const p of out.panels) {
    delete p.links;
    for (const o of ((p.fieldConfig as Json)?.overrides as Json[]) ?? []) o.properties = (o.properties as Json[]).map((x) => (x.id === 'links' ? { ...x, value: (x.value as Json[]).filter((l) => !String(l.url).startsWith('/d/')) } : x));
  }
  return out;
}

// ── 경보 규칙 ────────────────────────────────────────────
export interface AlertRule {
  uid: string;
  title: string;
  group: string;
  expr: string;
  /** 조건 — 쿼리 값과 비교 */
  op: 'gt' | 'lt';
  threshold: number;
  for: string;
  labels: Record<string, string>;
  summary: string;
  description: string;
  dashboardUid: string;
  /** 경보가 가리키는 패널 — Grafana는 __dashboardUid__와 __panelId__를 함께 요구한다 */
  panelTitle: string;
  noData?: 'OK' | 'NoData' | 'Alerting';
}

/** 축: OPERATION(동작)·PROBLEM(문제)·IMPROVEMENT(개선)·RISK(위험)·PLATFORM. ff_anomaly_kind가 있으면 FF가 이상 징후 신호로도 받는다 */
export function alertRules(): AlertRule[] {
  const R = (r: Omit<AlertRule, 'labels'> & { labels: Record<string, string> }) => ({ ...r, labels: { ff_source: 'feature-platform', ...r.labels } });
  return [
    R({ uid: 'ff-reception-drop', title: '수신율 저하', group: 'ff-vehicle', expr: 'sum by (country, vehicle_model) (rate(ff_vehicle_status_reports_total{result="accepted"}[15m])) / (sum by (country, vehicle_model) (rate(ff_vehicle_status_reports_total{result="accepted"}[15m] offset 7d)) > 0)', op: 'lt', threshold: 0.5, for: '15m', labels: { ff_axis: 'OPERATION', severity: 'warning' }, summary: '{{ $labels.country }} {{ $labels.vehicle_model }} 수신이 지난주 같은 시간의 절반 아래', description: '지난주 같은 시간 대비 수락된 상태 보고가 50% 아래로 15분 지속. 지역 통신·OTA 서버·수신 게이트웨이 장애를 의심한다. 확인: 차량 텔레메트리 수신 → 통신 채널별. 조치: FF 외부 연계 현황(OTA 서버 IF-05)·운영 데이터(/ops/telemetry).', panelTitle: '국가·차종별 수신(분당)', dashboardUid: 'ff-vehicle-telemetry' }),
    R({ uid: 'ff-status-reject', title: '상태 보고 거부율 상승', group: 'ff-vehicle', expr: 'sum by (country, vehicle_model) (rate(ff_vehicle_status_reports_total{result="rejected"}[15m])) / sum by (country, vehicle_model) (rate(ff_vehicle_status_reports_total[15m]))', op: 'gt', threshold: 0.005, for: '10m', labels: { ff_axis: 'OPERATION', severity: 'warning' }, summary: '{{ $labels.country }} {{ $labels.vehicle_model }} 상태 보고 거부율 {{ humanizePercentage $values.A.Value }}', description: '수신 검사 거부가 0.5%를 넘었다(SLO 수락률 99.5%). 확인: 거부 코드 패널. REPLAY는 차량 순번 저장, SCHEMA는 차량 SW 규격, AUTH_FAILED는 서명.', panelTitle: '거부 코드', dashboardUid: 'ff-vehicle-telemetry' }),
    R({ uid: 'ff-signature-surge', title: '서명 검증 실패 급증', group: 'ff-vehicle', expr: 'sum by (country, vehicle_model) (increase(ff_vehicle_status_auth_total{result="invalid"}[10m])) + sum by (country, vehicle_model) (increase(ff_vehicle_signature_checks_total{result="invalid"}[10m]))', op: 'gt', threshold: 3, for: '0m', labels: { ff_axis: 'RISK', severity: 'critical' }, summary: '{{ $labels.country }} {{ $labels.vehicle_model }} 서명 검증 실패 10분 {{ $values.A.Value }}건', description: '위조·재전송 시도나 키 Epoch 불일치. FF는 위반 보고를 이상 징후(보안)로 이미 올린다. 확인: FF 이상 징후(보안)·보안 이벤트(/admin/security). 조치: 채널 제한·키 Epoch 점검(CSM).', panelTitle: '서명 검증 실패', dashboardUid: 'ff-vehicle-telemetry' }),
    R({ uid: 'ff-kill-latency', title: '긴급 차단 반영 지연', group: 'ff-kill', expr: 'sum by (feature, deact_class) (increase(ff_kill_overdue_vehicles_total[15m]))', op: 'gt', threshold: 0, for: '0m', labels: { ff_axis: 'OPERATION', severity: 'critical', ff_anomaly_kind: 'DELIVERY' }, summary: '{{ $labels.feature }} 차단 기한 초과 차량 {{ $values.A.Value }}대', description: '등급별 기한 안에 끝 상태를 보고하지 않은 차량이 있다. 확인: 긴급 차단 반영 → 반영 곡선·지연 차량 Top. 조치: FF 긴급 차단 상세에서 차량별 봉투·재전송, 오프라인 차량은 OTA 서버 대기열 확인(운영 책임자).', panelTitle: '명령별 반영률 곡선', dashboardUid: 'ff-kill-switch' }),
    R({ uid: 'ff-flag-errors', title: 'Flag 평가 오류율', group: 'ff-flag', expr: 'sum by (flag) (rate(ff_flag_evaluations_total{reason="ERROR"}[10m])) / sum by (flag) (rate(ff_flag_evaluations_total[10m]))', op: 'gt', threshold: 0.01, for: '10m', labels: { ff_axis: 'OPERATION', severity: 'warning' }, summary: '{{ $labels.flag }} 평가 오류율 {{ humanizePercentage $values.A.Value }}', description: 'OpenFeature 평가 오류가 1%를 넘었다 — SDK는 기본값(Safe Default)을 쓰므로 기능이 꺼진 채로 동작한다. 확인: Flag 평가 → 오류 종류·Edge. 조치: FF 정책 상세·Unleash 동기화.', panelTitle: '오류 종류', dashboardUid: 'ff-flag-eval' }),
    R({ uid: 'ff-edge-errors', title: 'Edge 오류율', group: 'ff-flag', expr: 'sum(rate(ff_unleash_edge_request_duration_seconds_count{result="error"}[5m])) / sum(rate(ff_unleash_edge_request_duration_seconds_count[5m]))', op: 'gt', threshold: 0.05, for: '5m', labels: { ff_axis: 'PLATFORM', severity: 'critical' }, summary: 'Unleash Edge 오류율 {{ humanizePercentage $values.A.Value }}', description: 'Edge가 응답하지 않으면 차량 서명본 발급이 멈춘다(FF가 막는다). 조치: 설치 서버의 edge 컨테이너 상태, Unleash 서버 연결(20-98).', panelTitle: 'Edge 오류율', dashboardUid: 'ff-flag-eval' }),
    R({ uid: 'ff-unleash-drift', title: 'Unleash drift', group: 'ff-flag', expr: 'max by (flag) (ff_unleash_drift)', op: 'gt', threshold: 0, for: '10m', labels: { ff_axis: 'PLATFORM', severity: 'warning' }, summary: '{{ $labels.flag }} Unleash 정의가 FF 원천과 다르다', description: 'Unleash에서 직접 바꾼 정의가 있다 — FF가 원천이다. 조치: FF 정책 → Unleash 동기화로 되돌리고 변경자 확인(감사).', panelTitle: 'Unleash drift(Flag별)', dashboardUid: 'ff-flag-eval' }),
    R({ uid: 'ff-api-5xx', title: 'API 5xx 비율', group: 'ff-platform', expr: 'sum(rate(ff_http_requests_total{status=~"5.."}[10m])) / sum(rate(ff_http_requests_total[10m]))', op: 'gt', threshold: 0.01, for: '10m', labels: { ff_axis: 'PLATFORM', severity: 'warning' }, summary: 'FF API 5xx {{ humanizePercentage $values.A.Value }}', description: '서버 오류가 1%를 넘었다. 확인: 플랫폼 서비스 → 경로별 오류, 설치 서버 로그.', panelTitle: '상태별 오류', dashboardUid: 'ff-platform' }),
    R({ uid: 'ff-lake-stale', title: 'Data Lake 신선도 초과', group: 'ff-platform', expr: 'max by (dataset) (ff_lake_freshness_seconds{dataset=~"gold_5m|relay"})', op: 'gt', threshold: 1800, for: '15m', labels: { ff_axis: 'RISK', severity: 'warning' }, summary: '{{ $labels.dataset }} 지연 {{ $values.A.Value }}초', description: '30분 넘게 늦은 데이터로는 Feature 운영 판정을 하지 않는다(판단 불가). 단계 확대도 보류된다. 조치: Data Lake 운영(80-75).', panelTitle: 'Data Lake 신선도', dashboardUid: 'ff-platform' }),
    // 개선 후보(Closed loop) — 5분 주기, 축 라벨로 FF 운영 관찰
    R({ uid: 'ff-imp-fallback-model', title: '차종별 폴백 급증', group: 'ff-feature-improvement', expr: 'sum by (feature, feature_version, vehicle_model) (rate(ff_feature_fallbacks_total{reason!="KILL_SWITCH"}[1h])) / sum by (feature, feature_version, vehicle_model) (rate(ff_feature_activations_total[1h]))', op: 'gt', threshold: 0.03, for: '30m', labels: { ff_axis: 'PROBLEM', severity: 'warning', ff_anomaly_kind: 'FEATURE_FAULT' }, summary: '{{ $labels.feature }} {{ $labels.feature_version }} {{ $labels.vehicle_model }} 폴백 {{ humanizePercentage $values.A.Value }}', description: '이 차종에서 Safe Default 폴백(긴급 차단 제외)이 켜짐의 3%를 넘었다(평소 1% 아래). 다른 차종·전날과 Feature 운영 건강도의 차종별 폴백 패널에서 비교한다. 개선 후보: 지원 조건(신호·ECU 조합) 재검토. 담당: Feature Owner — FF Feature 상세에서 변경 요청 초안.', panelTitle: '폴백 비율(차종별)', dashboardUid: 'ff-feature-health' }),
    R({ uid: 'ff-imp-error-regression', title: '출시 후 오류 증가', group: 'ff-feature-improvement', expr: 'sum by (feature, feature_version) (rate(ff_feature_errors_total[2h])) / sum by (feature, feature_version) (ff_feature_active_vehicles) / on (feature) group_left min by (feature) (sum by (feature, feature_version) (rate(ff_feature_errors_total[2h])) / sum by (feature, feature_version) (ff_feature_active_vehicles))', op: 'gt', threshold: 1.5, for: '1h', labels: { ff_axis: 'PROBLEM', severity: 'warning', ff_anomaly_kind: 'FEATURE_FAULT' }, summary: '{{ $labels.feature }} {{ $labels.feature_version }} 오류율이 다른 Version의 {{ humanize $values.A.Value }}배', description: '같은 Feature의 가장 낮은 Version 대비 활성 차량당 오류가 1.5배 이상. 개선 후보: 결함 등록(JIRA)·롤백 판단. 담당: Feature Owner·Release Manager.', panelTitle: '오류율 — 출시 전후(Version 비교)', dashboardUid: 'ff-feature-health' }),
    R({ uid: 'ff-imp-low-usage', title: '사용률 저조', group: 'ff-feature-improvement', expr: 'max by (feature, feature_version) (ff_feature_health_indicator{indicator="usage_rate"})', op: 'lt', threshold: 0.3, for: '6h', labels: { ff_axis: 'IMPROVEMENT', severity: 'info' }, summary: '{{ $labels.feature }} {{ $labels.feature_version }} 사용률 {{ humanizePercentage $values.A.Value }}', description: '대상 차량 가운데 실제로 켜는 비율이 30% 아래. 개선 후보: 발견성(HMI 노출)·기본값·안내 문구. 담당: Feature Owner(상품 기획과 함께).', panelTitle: '사용률(활성/대상)', dashboardUid: 'ff-feature-health' }),
    R({ uid: 'ff-imp-manual-off', title: '운전자가 자주 끔', group: 'ff-feature-improvement', expr: 'sum by (feature, feature_version, country) (rate(ff_feature_manual_off_total[2h])) / sum by (feature, feature_version, country) (rate(ff_feature_activations_total[2h]))', op: 'gt', threshold: 0.15, for: '2h', labels: { ff_axis: 'IMPROVEMENT', severity: 'info' }, summary: '{{ $labels.feature }} {{ $labels.country }} 수동 끄기 {{ humanizePercentage $values.A.Value }}', description: '켜짐 대비 운전자가 끈 비율이 15% 이상. 개선 후보: 개입 강도·민감도 파라미터. 담당: Feature Owner — 변경 요청 → 새 Version → 이 대시보드에서 효과 확인.', panelTitle: '수동 끄기 비율', dashboardUid: 'ff-feature-health' }),
    R({ uid: 'ff-imp-quick-off', title: '켜고 바로 끔(이탈)', group: 'ff-feature-improvement', expr: 'sum by (feature, feature_version, country) (rate(ff_feature_quick_off_total[2h])) / sum by (feature, feature_version, country) (rate(ff_feature_activations_total[2h]))', op: 'gt', threshold: 0.1, for: '2h', labels: { ff_axis: 'IMPROVEMENT', severity: 'info' }, summary: '{{ $labels.feature }} {{ $labels.country }} 이탈 {{ humanizePercentage $values.A.Value }}', description: '켠 뒤 60초 안에 끄는 비율이 10% 이상. 개선 후보: 첫 경험(첫 안내·화면 가림). 담당: Feature Owner·HMI.', panelTitle: '이탈(켜고 60초 안에 끔)', dashboardUid: 'ff-feature-health' }),
    R({ uid: 'ff-imp-canary-dtc', title: 'Canary 적용군 DTC 증가', group: 'ff-feature-improvement', expr: '(sum by (feature) (rate(ff_feature_dtc_total{cohort="treatment"}[2h])) / sum by (feature) (ff_feature_active_vehicles{cohort="treatment"})) / (sum by (feature) (rate(ff_feature_dtc_total{cohort="control"}[2h])) / sum by (feature) (ff_feature_active_vehicles{cohort="control"}))', op: 'gt', threshold: 1.5, for: '1h', labels: { ff_axis: 'RISK', severity: 'warning', ff_anomaly_kind: 'FEATURE_FAULT' }, summary: '{{ $labels.feature }} 적용군 DTC 상대위험 {{ humanize $values.A.Value }}', description: '새 Version 적용군의 DTC가 대조군의 1.5배 이상. 조치: 단계 확대 보류(FF 정책 상세 → 단계 확대 HOLD). 담당: Release Manager·Safety Officer.', panelTitle: 'DTC 상대위험(적용군/대조군)', dashboardUid: 'ff-canary' }),
  ];
}

/** Grafana 프로비저닝 API 모양(데이터 소스 uid는 provision이 채운다) */
export function alertRuleJson(r: AlertRule, promUid = '${DS_PROMETHEUS}', folderUid = FOLDER.uid): Json {
  return {
    uid: r.uid,
    orgID: 1,
    title: r.title,
    ruleGroup: r.group,
    folderUID: folderUid,
    condition: 'C',
    data: [
      { refId: 'A', relativeTimeRange: { from: 3600, to: 0 }, datasourceUid: promUid, model: { refId: 'A', expr: r.expr, instant: true, intervalMs: 60000, maxDataPoints: 43200 } },
      { refId: 'C', relativeTimeRange: { from: 0, to: 0 }, datasourceUid: '__expr__', model: { refId: 'C', type: 'threshold', expression: 'A', conditions: [{ evaluator: { type: r.op, params: [r.threshold] } }] } },
    ],
    noDataState: r.noData ?? 'OK',
    execErrState: 'Error',
    for: r.for,
    labels: r.labels,
    annotations: { summary: r.summary, description: r.description, runbook_url: `${RUNBOOK}#${r.uid}`, __dashboardUid__: r.dashboardUid, __panelId__: String(alertPanelId(r)) },
    isPaused: false,
  };
}
/** 경보 패널 id — 대시보드 제목으로 찾는다(없으면 오류: Grafana 13은 둘 중 하나만 있으면 400) */
export function alertPanelId(r: AlertRule): number {
  const d = dashboards().find((x) => x.uid === r.dashboardUid);
  const p = d?.panels.find((x) => x.title === r.panelTitle && x.type !== 'row');
  if (!p) throw new Error(`${r.uid}: 대시보드 ${r.dashboardUid}에 패널 '${r.panelTitle}'이 없다`);
  return p.id as number;
}
export const RULE_GROUP_INTERVAL: Record<string, number> = { 'ff-vehicle': 60, 'ff-kill': 60, 'ff-flag': 60, 'ff-platform': 60, 'ff-feature-improvement': 300 };

/** 쿼리·주석·경보 식에서 지표 이름(ff_…)을 모은다 */
export function metricNamesIn(x: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, key = '') => {
    if (typeof v === 'string') {
      if (['expr', 'query', 'definition'].includes(key)) for (const m of v.matchAll(/\b(ff_[a-z0-9_]+)\b/g)) out.add(m[1]);
    } else if (Array.isArray(v)) v.forEach((y) => walk(y, key));
    else if (v && typeof v === 'object') for (const [k, y] of Object.entries(v)) walk(y, k);
  };
  walk(x);
  return [...out].sort();
}
