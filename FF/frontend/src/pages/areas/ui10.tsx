// UI10 출시와 차량 적용 — 정본 상세 영역 8개 본문.
//
// 작업 하나(작업 ID)를 고르면 정책·대상·승인·발행·Wave·readback·복구가 그 작업의 정확 버전으로 이어진다.
// 정본이 요구하는 구분을 화면에서 지킨다:
//  · 전달(도구가 보냈다) ≠ 적용(차량이 받아 실행했다) ≠ 관측(실제로 그렇게 동작한다)
//  · Pause 는 신규 전달 중지이지 이미 적용된 차량의 OFF 가 아니다
//  · 확대 중지(운영) ≠ 긴급 차단(안전) ≠ 이전 정책 복구
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CanonicalScreen, Gated, Reasons, StageRail, Table, FIELD, type Kpi } from '../../components/AreaScreen';
import { UlRules, ulBlocks, type UlRule } from '../../components/ulRules';
import { useApp, useLive, useLiveSlices, useToast, ROLLOUT_STEPS, type Campaign } from '../../store';
import { sampleVehicles, fleetStats } from '../../data/fleet';
import { features } from '../../data/model';
import { SCREEN_ENTRY } from '../../data/uiLinks';

/** 정본 상태 8개 — 화면 표시는 한국어, 값은 정본 토큰을 쓴다. */
const STATE_KO: Record<string, string> = {
  DRAFT: '초안', IN_REVIEW: '검토 중', APPROVED: '승인됨', RUNNING: '전달 중',
  PAUSED: '확대 중지', COMPLETED: '완료', PARTIAL: '부분 완료', EXPIRED: '기간 만료',
};
/** 정본 상태 진행 순서 — 완료·부분 완료·기간 만료는 갈래다. */
const STATE_STEPS = [
  { key: 'DRAFT', ko: '초안' }, { key: 'IN_REVIEW', ko: '검토 중' }, { key: 'APPROVED', ko: '승인됨' },
  { key: 'RUNNING', ko: '전달 중' }, { key: 'PAUSED', ko: '확대 중지' }, { key: 'COMPLETED', ko: '완료' },
];
const STATE_TERMINAL = [{ ko: '부분 완료(PARTIAL)' }, { ko: '기간 만료(EXPIRED)' }];

const OWNERS = ['김민영', '정하늘', '박서준', '이도현'];
const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; };
const stamp = (n: number) => `2026-09-13 ${String(9 + (n % 8)).padStart(2, '0')}:${String((n * 7) % 60).padStart(2, '0')}`;
const num = (n: number) => n.toLocaleString('ko-KR');

/** 정본 화면으로 가는 링크 — 대상 객체를 다른 화면에서 열 때 쓴다. */
function ScreenLink({ id, children }: { id: string; children: ReactNode }) {
  const to = SCREEN_ENTRY[id];
  if (!to || to.includes(':')) return <span>{children}</span>;
  return <Link to={to}>{children}</Link>;
}

/** 17개 공개 연산자 — 정본 지원표를 화면 선택지로 쓴다. */
const OPERATORS = [
  'IN', 'NOT_IN', 'STR_STARTS_WITH', 'STR_ENDS_WITH', 'STR_CONTAINS', 'NUM_EQ', 'NUM_GT', 'NUM_GTE', 'NUM_LT',
  'NUM_LTE', 'DATE_AFTER', 'DATE_BEFORE', 'SEMVER_EQ', 'SEMVER_GT', 'SEMVER_LT', 'FLEXIBLE_ROLLOUT', 'CUSTOM_STRATEGY',
];
/** 지원 Profile — 연산자를 어느 평가기가 보장하는지. */
const PROFILES = ['FP 평가기 v1', 'flexibleRollout v1', 'SDK Node 8.2', 'SDK Android 8.2', 'AAOS 차량 Agent'];

interface PolicyRow {
  id: string; rule: string; ctx: string; op: string; value: string;
  kind: '전략(OR)' | '제약(AND)' | '필수 자격(AND)'; results: string; profile: string;
}
const SEED_POLICY_ROWS: PolicyRow[] = [
  { id: 'S02-R01', rule: '국가 포함', ctx: 'region', op: 'IN', value: 'KR, EU', kind: '제약(AND)', results: 'Constraint', profile: 'FP 평가기 v1' },
  { id: 'S02-R02', rule: '차종 포함', ctx: 'vehicleModel', op: 'IN', value: 'IONIQ5, IONIQ6, GV80', kind: '제약(AND)', results: 'Constraint', profile: 'FP 평가기 v1' },
  { id: 'S02-R03', rule: 'HW 세대', ctx: 'hardwareCapability', op: 'STR_CONTAINS', value: 'GEN3', kind: '제약(AND)', results: 'Constraint', profile: 'AAOS 차량 Agent' },
  { id: 'S02-R04', rule: '권리 보유', ctx: 'entitlementId', op: 'IN', value: 'BAT_PRECOND_PLUS', kind: '필수 자격(AND)', results: 'Entitlement', profile: 'FP 평가기 v1' },
  { id: 'S02-R05', rule: '점진 확대', ctx: 'targetingKey', op: 'FLEXIBLE_ROLLOUT', value: '20%', kind: '전략(OR)', results: 'Variant', profile: 'flexibleRollout v1' },
  { id: 'S02-R06', rule: '예외 시장', ctx: 'market', op: 'NOT_IN', value: 'JP', kind: '제약(AND)', results: 'Constraint', profile: 'FP 평가기 v1' },
  { id: 'S02-R07', rule: '게시 시작', ctx: 'currentTime', op: 'DATE_AFTER', value: '2026-10-01T00:00Z', kind: '제약(AND)', results: 'Constraint', profile: 'FP 평가기 v1' },
  { id: 'S02-R08', rule: '최소 SW 버전', ctx: 'bmsSoftwareVersion', op: 'SEMVER_GTE', value: '2.7.0', kind: '제약(AND)', results: 'Constraint', profile: 'SDK Android 8.2' },
];

export function ReleaseOps() {
  const { state, dispatch, can } = useApp();
  const live = useLive();
  const toast = useToast();
  const { campaigns } = useLiveSlices();

  const [pick, setPick] = useState<string>('');
  const [filter, setFilter] = useState<{ state: string; action: string }>({ state: 'ALL', action: 'ALL' });
  const [rows, setRows] = useState<PolicyRow[]>(() => SEED_POLICY_ROWS.map(r => ({ ...r })));
  const [paused, setPaused] = useState<Record<string, boolean>>({});
  const [wave, setWave] = useState<Record<string, number>>({});
  const [approval, setApproval] = useState<Record<string, { role: string; reason: string; hash: string }>>({});
  const [reason, setReason] = useState('');
  const [recovered, setRecovered] = useState<Record<string, boolean>>({});
  const [replayed, setReplayed] = useState(false);
  const [selfApproval, setSelfApproval] = useState(false);

  const cur: Campaign | undefined = campaigns.find(c => c.id === (pick || campaigns[0]?.id)) || campaigns[0];
  const pol = state.policies.find(p => p.feature === cur?.feature);
  const audit = (action: string, target: string, detail: string) =>
    dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:20', actor: state.role, action, target, detail } });

  if (!cur) return <div className="card">출시 작업이 없습니다.</div>;

  // ── 작업 하나의 정확 참조 (상품 버전·BOM·대상 분모·담당) ──────────────────
  const h = hashStr(cur.id);
  const product = `UPC-${cur.feature.split('-')[1]}-${['3.2.1', '3.4.0', '2.8.0', '3.3.0'][h % 4]}`;
  const bom = `BOM-2027.${(h % 4) + 1}`;
  const policyVersion = `v${pol?.version ?? 4}.${(h % 9) + 1}`;
  const targets = cur.cohort === 'All' ? fleetStats.total : Math.round(fleetStats.total * 0.42);
  const owner = OWNERS[h % OWNERS.length];
  const stateToken = paused[cur.id] ? 'PAUSED'
    : cur.rollout >= 100 ? 'COMPLETED'
      : approval[cur.id] ? 'RUNNING'
        : cur.status === 'rolling' ? 'IN_REVIEW' : 'DRAFT';
  const waveIdx = wave[cur.id] ?? 0;
  const planned = Math.round(targets * (ROLLOUT_STEPS[waveIdx] / 100));
  const confirmed = Math.round(planned * (live.failRate < 5 ? 0.981 : 0.94));
  const partialFail = Math.round((planned - confirmed) * 0.62);
  const unreported = planned - confirmed - partialFail;
  const contentHash = `sha256:${(hashStr(cur.id + policyVersion).toString(16) + 'a91f4c').slice(0, 16)}`;
  const captureHash = `sha256:${(hashStr(cur.id + product).toString(16) + 'b7e0').slice(0, 16)}`;

  /** 승인·발행·확대 전 확인 — 화면의 실행 버튼이 같은 차단 사유를 쓴다. */
  const approveReasons = [
    !can('approve') && `역할 ${state.role} 에게 승인 권한이 없다`,
    selfApproval && '작성자와 승인자가 같다 (직무 분리 위반)',
    !reason.trim() && '승인 사유가 없다',
    live.failRate > 5 && `현재 실패율 ${live.failRate}% — 품질 기준(5%) 초과`,
  ].filter(Boolean) as string[];
  const publishReasons = [
    !approval[cur.id] && '운영 승인이 없다',
    !can('deploy') && `역할 ${state.role} 에게 발행 권한이 없다`,
    live.failRate > 5 && `실패율 ${live.failRate}% — 확대 조건 미달`,
  ].filter(Boolean) as string[];
  const expandReasons = [
    paused[cur.id] && '확대가 중지된 상태다',
    unreported > 0 && `미확인 ${num(unreported)}대 — 확대 조건은 미확인 0대다`,
    confirmed / Math.max(1, planned) < 0.98 && `확인 성공률 ${((confirmed / Math.max(1, planned)) * 100).toFixed(1)}% < 98%`,
  ].filter(Boolean) as string[];

  // ── S01 검토 항목 ─────────────────────────────────────────────────────
  const s01Rules: UlRule[] = [
    { ul: 'UL-010', rule: '도구 Flag 생애주기와 FP 정의·출시·차량 적용 상태를 분리한다', verdict: 'PASS', evidence: `Feature ${features.length} · 출시 작업 상태 ${STATE_KO[stateToken]} · 차량 미보고 ${num(unreported)}` },
    { ul: 'UL-008', rule: '메타데이터(이름·설명·유형·노출 정보)와 업무 상태를 구분해 저장한다', verdict: 'PASS', evidence: `작업 ${campaigns.length}건 · 메타 필드 6종 고정` },
    { ul: 'UL-012', rule: '대상 밖에서 이전 소비자가 쓰던 이름을 다른 의미로 재사용하지 않는다', verdict: h % 2 === 0 ? 'PASS' : 'WARN', evidence: `외부 식별자 ${cur.id} 불변 · 이름 재사용 요청 0건` },
    { ul: 'UL-014', rule: '도구의 활성·전략·정렬·Variant 수와 FP 의 목표·실제 상태를 다른 필드로 조회한다', verdict: 'PASS', evidence: `정책 ${policyVersion} · 도구 표시값을 판정 근거로 쓰지 않음` },
    { ul: 'UL-018', rule: '등록 속성과 운영 정책 속성의 소유자를 분리한다', verdict: 'PASS', evidence: '등록 184 · 운영 249 · 충돌 0건' },
    { ul: 'UL-077', rule: '작업 패턴을 화면 탭·패널·필터로만 매핑하고 화면 ID 30개를 유지한다', verdict: 'PASS', evidence: 'UI10 상세 영역 8개 · 개인 대시보드는 미구현으로 표시' },
    { ul: 'UL-080', rule: '권한 부족·412 삼자비교·미저장 입력 보존을 화면 인수 조건으로 삼는다', verdict: 'WARN', evidence: '412 비교 패널은 후속 범위 · 권한 부족 사유는 표시됨' },
  ];

  // ── S02 검토 항목 (전략 OR · 제약 AND · 안전 처리) ──────────────────────
  const strategyCount = rows.filter(r => r.kind === '전략(OR)').length;
  const constraintCount = rows.filter(r => r.kind === '제약(AND)').length;
  const entitlementCount = rows.filter(r => r.kind === '필수 자격(AND)').length;
  const inverted = rows.filter(r => r.op === 'NOT_IN' || r.op === 'CUSTOM_STRATEGY');
  const s02Rules: UlRule[] = [
    { ul: 'UL-019', rule: '전략은 OR, 제약·세그먼트는 AND, 필수 자격은 전략과 별도 검사로 평가한다', verdict: constraintCount > 0 && entitlementCount > 0 ? 'PASS' : 'FAIL', evidence: `전략 ${strategyCount} · 제약 ${constraintCount} · 자격 ${entitlementCount}` },
    { ul: 'UL-020', rule: '지원 전략과 레거시 API·SDK 호환 범위를 버전별로 표시한다', verdict: 'PASS', evidence: `지원 Profile ${new Set(rows.map(r => r.profile)).size}개 · 레거시 API 미사용` },
    { ul: 'UL-021', rule: '전략의 정렬 순서와 활성 상태의 반대 의미를 변환표로 고정한다', verdict: 'PASS', evidence: `정렬 ${strategyCount}건 · disabled↔활성 변환 1건 고정` },
    { ul: 'UL-022', rule: '빈 전략으로 발행하지 않고 확대 기본값을 보수적으로 둔다', verdict: strategyCount === 0 ? 'FAIL' : 'PASS', evidence: `전략 ${strategyCount}건 · 발행 전 확대 기본 0%` },
    { ul: 'UL-023', rule: '연산자·타입·정규화(대소문자·공백·단위·시간대)를 지원표로 제한한다', verdict: rows.every(r => OPERATORS.includes(r.op)) ? 'PASS' : 'FAIL', evidence: `사용 연산자 ${new Set(rows.map(r => r.op)).size} / 지원 ${OPERATORS.length}` },
    { ul: 'UL-024', rule: '부정 조건에서 값이 없거나 신뢰할 수 없으면 단순 반전으로 TRUE 를 만들지 않는다', verdict: inverted.length > 0 ? 'PASS' : 'WARN', evidence: inverted.length > 0 ? `${inverted[0].id} ${inverted[0].op} · 누락 시 보류(HOLD)` : '부정 조건 미사용 — 예외 시장 규칙 추가 권고' },
    { ul: 'UL-031', rule: '사용자 정의 전략은 코드 배포와 metadata 등록을 분리하고 임의 코드 삽입을 금지한다', verdict: rows.some(r => r.op === 'CUSTOM_STRATEGY') ? 'WARN' : 'PASS', evidence: rows.some(r => r.op === 'CUSTOM_STRATEGY') ? 'CUSTOM_STRATEGY 1건 — 서명 Artifact 필요' : '사용자 정의 전략 0건' },
    { ul: 'UL-033', rule: 'Variant 의 이름·가중치·선택 규칙을 지원 버전에 결속한다', verdict: 'PASS', evidence: 'Variant 2개 · 가중치 합 100 · stickiness=targetingKey' },
    { ul: 'UL-034', rule: 'Variant payload 의 타입·단위를 결과 스키마 버전에 결속한다', verdict: 'PASS', evidence: 'payload type=json · ResultSchema v3' },
    { ul: 'UL-035', rule: '환경 Variant 는 읽기·평가만 허용하고 신규 작성은 전략 Variant 로 유도한다', verdict: 'PASS', evidence: '환경 Variant 0건 · 신규 작성 차단' },
    { ul: 'UL-078', rule: '정책·대상·Variant 를 공통 편집기 한 곳에서 다루고 변경 차이를 보여준다', verdict: 'PASS', evidence: `편집 행 ${rows.length} · 변경 ${rows.filter((r, i) => r.value !== SEED_POLICY_ROWS[i]?.value).length}건` },
  ];

  // ── S03 검토 항목 (대상·고정 분모·가명 키) ───────────────────────────────
  const s03Rules: UlRule[] = [
    { ul: 'UL-027', rule: '공유 세그먼트는 불변 버전과 원천 hash 로 고정하고 변경 영향 대상을 먼저 계산한다', verdict: 'PASS', evidence: 'SEG-KR-GEN3 v3 · sourceHash 8f2c… · 영향 작업 1건' },
    { ul: 'UL-029', rule: '차량 Stickiness 는 차량 단위 가명 키와 Cohort Profile 을 쓴다 (userId→sessionId 폴백 금지)', verdict: 'PASS', evidence: `targetingKey FP-VIN-HMAC · salt v2 · 확대 대상 ${num(targets)}` },
    { ul: 'UL-030', rule: '해시 알고리즘·정규화·groupId·seed 를 고정해 확대 분모를 재현한다', verdict: 'PASS', evidence: `groupId ${cur.id} · xmur3+sha256 · seed 20260913` },
    { ul: 'UL-058', rule: '미리보기는 고정 Capture·BOM·Context schema 로 비작동 평가만 수행한다', verdict: 'PASS', evidence: `미리보기 대상 ${num(planned)}대 · 실행 부작용 0건` },
  ];

  // ── S04 검토 항목 (승인·hash 결속) ─────────────────────────────────────
  const s04Rules: UlRule[] = [
    { ul: 'UL-032', rule: '시간 제약·예약은 timezone·경계 포함·시계 오차를 명시하고 현재 시각을 입력 사실로 받지 않는다', verdict: 'PASS', evidence: 'KST/UTC 병기 · 경계 포함 · 시계 오차 ±30s' },
    { ul: 'UL-038', rule: '승인은 Flag 전환·전략·세그먼트·Variant 변경 집합의 정확 hash 에 결속한다', verdict: approval[cur.id] ? 'PASS' : 'WARN', evidence: `ChangeSet ${contentHash} · 승인 ${approval[cur.id] ? '결속됨' : '미결속'}` },
    { ul: 'UL-040', rule: '예약 변경은 편집·원천 변경 시 재검증하고 취소 상태를 남긴다', verdict: 'PASS', evidence: '예약 1건 · 원천 hash 변경 시 자동 보류' },
  ];

  // ── S05 검토 항목 (Capture·발행·명령) ──────────────────────────────────
  const s05Rules: UlRule[] = [
    { ul: 'UL-048', rule: 'Release Template 과 Plan 인스턴스를 분리하고 단계별 전략·조건·대상을 고정한다', verdict: 'PASS', evidence: `Template RT-2027-1 v2 → Plan ${cur.id}` },
    { ul: 'UL-064', rule: 'Capture 는 bindingSetHash·원천 revision·queryHash·ETag·rawDigest 를 보존한다', verdict: 'PASS', evidence: `capture ${captureHash} · tool revision c66d4a4` },
    { ul: 'UL-071', rule: '도구 명령을 실제 endpoint 로 복사하지 않고 Capture·Validate·Preview·Submit 단계로만 실행한다', verdict: 'PASS', evidence: `명령 미리보기 ${rows.length}건 · 직접 실행 0건` },
  ];

  // ── S06 검토 항목 (Wave 분모·중지 구분) ────────────────────────────────
  const s06Rules: UlRule[] = [
    { ul: 'UL-049', rule: 'Wave 는 고정 대상·기준선·정책 hash·관측 분모·timeout·최소 증적으로 정의한다', verdict: 'PASS', evidence: `Wave ${waveIdx + 1} · 분모 ${num(planned)}대 고정` },
    { ul: 'UL-050', rule: 'Pause·Disable·긴급 차단·이전 정책 복구·Binary OTA 롤백의 효과를 구분한다', verdict: 'PASS', evidence: `현재 ${paused[cur.id] ? 'Pause(신규 전달 중지)' : '확대 중'} · 차량 OFF 아님` },
    { ul: 'UL-051', rule: '확대 판단 지표의 원천·단위·집계 창·임계·신선도를 함께 본다', verdict: live.failRate > 5 ? 'FAIL' : 'PASS', evidence: `실패율 ${live.failRate}% (임계 5%) · p95 ${live.p95}ms · 창 15분` },
  ];

  // ── S07 검토 항목 (readback·실험 효과) ─────────────────────────────────
  const s07Rules: UlRule[] = [
    { ul: 'UL-079', rule: '요청→검토→허가→서명 발행→전달→차량 Guard→readback 을 분리해 표시한다', verdict: 'PASS', evidence: `7단계 · 미확인 ${num(unreported)}대를 성공으로 합산하지 않음` },
    { ul: 'UL-037', rule: '실험은 목적·표본 단위·가설·지표·기간·중단 조건·안전 허용 범위를 기록하고 상관을 인과로 쓰지 않는다', verdict: 'WARN', evidence: '실험 계획 1건 — 표본 단위 미정(차량/ECU)' },
  ];

  // ── S08 검토 항목 (긴급 차단 경로) ─────────────────────────────────────
  const s08Rules: UlRule[] = [
    { ul: 'UL-046', rule: '유지보수 모드는 작성·예약·배포를 멈추되 조회·관측은 계속하고, 긴급 차단은 별도 승인 경로로 남긴다', verdict: 'PASS', evidence: '조회·관측 지속 · 긴급 차단 경로 분리 유지' },
  ];

  const kpis: Kpi[] = [
    { v: campaigns.length, l: '출시 작업' },
    { v: campaigns.filter(c => !approval[c.id]).length, l: '승인 대기' },
    { v: num(targets), l: '대상 차량' },
    { v: `${((confirmed / Math.max(1, planned)) * 100).toFixed(1)}%`, l: '적용 확인률' },
    { v: num(unreported), l: '미확인' },
  ];

  const areas: Record<string, () => ReactNode> = {
    // ── S01 출시 목록과 기본정보 ─────────────────────────────────────────
    'UI10-S01': () => {
      const list = campaigns.filter(c =>
        (filter.state === 'ALL' || (filter.state === 'OPEN' ? !approval[c.id] : !!approval[c.id]))
        && (filter.action === 'ALL' || (filter.action === 'POLICY' ? c.type === 'Policy-only' : c.type !== 'Policy-only')));
      const rowof = (c: Campaign): string[] => {
        const ch = hashStr(c.id);
        const t = c.cohort === 'All' ? fleetStats.total : Math.round(fleetStats.total * 0.42);
        const on = Math.round(t * (c.rollout / 100));
        const cf = Math.round(on * (live.failRate < 5 ? 0.981 : 0.94));
        return [c.id, `UPC-${c.feature.split('-')[1]}-${['3.2.1', '3.4.0', '2.8.0', '3.3.0'][ch % 4]}`, c.type === 'Policy-only' ? '정책 활성화' : 'Binary OTA',
          num(t), approval[c.id] ? '승인됨' : '검토 중', `${num(on)}대 전달`, `${num(cf)}대 확인`, OWNERS[ch % OWNERS.length]];
      };
      return (
        <div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="small">상태
              <select style={FIELD} value={filter.state} onChange={e => setFilter({ ...filter, state: e.target.value })}>
                <option value="ALL">전체</option><option value="OPEN">승인 대기</option><option value="APPROVED">승인·진행</option>
              </select>
            </label>
            <label className="small">조치
              <select style={FIELD} value={filter.action} onChange={e => setFilter({ ...filter, action: e.target.value })}>
                <option value="ALL">전체</option><option value="POLICY">정책 활성화</option><option value="BINARY">Binary OTA</option>
              </select>
            </label>
            <span className="small muted">행을 고르면 그 작업의 정확 버전이 아래 영역 전체에 적용된다</span>
          </div>
          <Table head={['작업 ID', '상품 버전', '조치', '대상 수', '승인', '전달', '적용 확인', '현재 담당']}>
            {list.map(c => (
              <tr key={c.id} onClick={() => setPick(c.id)} style={{ cursor: 'pointer', background: c.id === cur.id ? 'var(--surface-2)' : undefined }}>
                {rowof(c).map((v, i) => <td key={i} className={i === 0 ? 'mono' : i === 6 ? 'mono small' : undefined}>{v}</td>)}
              </tr>
            ))}
          </Table>
          <div className="card mt">
            <b>{cur.id} · {STATE_KO[stateToken]}</b>
            <div className="mt">
              <StageRail steps={STATE_STEPS} current={stateToken} terminal={STATE_TERMINAL}
                note="전달 결과와 차량 적용 결과를 따로 집계한다. Pause 는 신규 전달 중지이며 이미 적용된 차량을 OFF 로 만들지 않는다." />
            </div>
            <div className="kv mt">
              <div>목적</div><div>{cur.feature} 를 {cur.cohort} 대상으로 {cur.type === 'Policy-only' ? '정책만으로 켠다' : 'Binary 와 함께 배포한다'}</div>
              <div>상품·BOM 정확 버전</div><div className="mono">{product} · {bom} · <ScreenLink id="UI04">UI04 BOM</ScreenLink></div>
              <div>정책 정확 버전</div><div className="mono">{pol ? pol.id + ' ' + policyVersion : 'POLICY-' + cur.feature + ' ' + policyVersion} · {pol?.stage ?? 'Draft'}</div>
              <div>기간</div><div>2026-10-01 09:00 KST ~ 2026-12-31 23:59 KST</div>
              <div>현재 담당</div><div>{owner} (operator)</div>
            </div>
            <div className="mt"><UlRules items={s01Rules} /></div>
          </div>
        </div>
      );
    },

    // ── S02 정책과 전략 ─────────────────────────────────────────────────
    'UI10-S02': () => (
      <div>
        <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span>정책 정확 버전 <b className="mono">{policyVersion}</b></span>
          <span>전략 OR <b>{strategyCount}</b></span>
          <span>제약 AND <b>{constraintCount}</b></span>
          <span>필수 자격 <b>{entitlementCount}</b></span>
          <span className={live.failRate > 5 ? '' : 'muted'} style={live.failRate > 5 ? { color: 'var(--fail)' } : undefined}>미리보기 ≠ 실제 실행</span>
        </div>
        <Table head={['규칙', 'Context 속성', '연산자', '비교 값', '결과 유형', '지원 Profile']}>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td>{r.rule}<div className="small muted">{r.id} · {r.kind}</div></td>
              <td className="mono small">{r.ctx}</td>
              <td>
                <select style={FIELD} value={r.op} onChange={e => setRows(list => list.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}>
                  {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td><input style={FIELD} value={r.value} onChange={e => setRows(list => list.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} /></td>
              <td>{r.results}</td>
              <td>
                <select style={FIELD} value={r.profile} onChange={e => setRows(list => list.map((x, j) => j === i ? { ...x, profile: e.target.value } : x))}>
                  {PROFILES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </Table>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={!can('edit')} onClick={() => {
            setRows(list => [...list, { id: `S02-R${String(list.length + 1).padStart(2, '0')}`, rule: '추가 조건', ctx: 'region', op: 'IN', value: '', kind: '제약(AND)', results: 'Constraint', profile: 'FP 평가기 v1' }]);
            audit('POLICY_EDIT', cur.id, '규칙 추가');
          }}>조건 추가</button>
          <Gated label="검토 완료 표시" reasons={rows.some(r => !r.value.trim()) ? ['비교 값이 빈 규칙이 있다'] : []}
            onClick={() => { audit('POLICY_REVIEW', cur.id, `규칙 ${rows.length}건 검토 완료`); toast('규칙 검토 완료 — 발행 전 후보 상태 유지'); }} />
          <span className="small muted">검토 완료는 후보 상태를 유지한다. 저장이나 운영 ON 만으로 발행되지 않는다.</span>
        </div>
        <div className="mt"><UlRules items={s02Rules} /></div>
        <Reasons title="발행 차단 조건" list={ulBlocks(s02Rules).concat(publishReasons)} />
      </div>
    ),

    // ── S03 대상과 적용 범위 ────────────────────────────────────────────
    'UI10-S03': () => {
      const conds = sampleVehicles.map((v, i) => {
        const gen3 = v.hw === 'Gen3';
        const ok = ['KR', 'EU'].includes(v.region) && gen3 && v.sw >= '3.2';
        return {
          id: `S03-C${String(i + 1).padStart(2, '0')}`, vin: v.vin,
          axis: v.region === 'KR' ? '법규 시장(KR)' : '시장(Market)',
          code: v.region, model: `${v.model} · ${v.my}`, trim: v.trim,
          variant: `${v.hw} · sw ${v.sw}`, impl: `${bom} · TD v0.8`,
          verdict: ok ? 'INCLUDE' : gen3 ? 'EXCLUDE' : 'UNKNOWN',
          why: ok ? '모든 제약 충족' : gen3 ? '지역 또는 SW 버전 미충족' : 'HW 세대 미확정 — Variant 재검토 필요',
        };
      });
      const inc = conds.filter(c => c.verdict === 'INCLUDE').length;
      const exc = conds.filter(c => c.verdict === 'EXCLUDE').length;
      const unk = conds.filter(c => c.verdict === 'UNKNOWN').length;
      return (
        <div>
          <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span>대상 후보 <b>{conds.length}</b></span>
            <span style={{ color: 'var(--pass)' }}>포함 {inc}</span>
            <span style={{ color: 'var(--fail)' }}>제외 {exc}</span>
            <span style={{ color: 'var(--pending)' }}>미정 {unk}</span>
            <span className="muted">미정은 임의 확정하지 않고 사유와 함께 남긴다</span>
          </div>
          <Table head={['조건행', '국가 의미 축', '국가 코드', '차종·연식', 'Trim 참조', 'Variant 조건', '구현 참조', '확인 상태']}>
            {conds.map(c => (
              <tr key={c.id}>
                <td className="mono small">{c.id}<div className="small muted">{c.vin}</div></td>
                <td>{c.axis}</td><td className="mono">{c.code}</td><td>{c.model}</td><td>{c.trim}</td>
                <td className="mono small">{c.variant}</td><td className="mono small">{c.impl}</td>
                <td style={{ color: c.verdict === 'INCLUDE' ? 'var(--pass)' : c.verdict === 'UNKNOWN' ? 'var(--pending)' : 'var(--fail)' }}>
                  {c.verdict}<div className="small muted">{c.why}</div>
                </td>
              </tr>
            ))}
          </Table>
          <div className="card mt">
            <b>고정 분모와 가명 키</b>
            <div className="kv mt">
              <div>TargetSnapshot</div><div className="mono">TS-{cur.id} · {num(planned)}대 고정 (Wave {waveIdx + 1} / {ROLLOUT_STEPS[waveIdx]}%)</div>
              <div>Cohort Profile</div><div className="mono">{cur.cohort} · 코호트 {new Set(sampleVehicles.map(v => v.cohort)).size}개</div>
              <div>차량 가명 키</div><div className="mono">targetingKey = FP-VIN-HMAC (salt v2) · 개인 식별자 미사용</div>
              <div>재현 조건</div><div className="mono">groupId {cur.id} · xmur3+sha256 · seed 20260913</div>
              <div>권리 교집합</div><div>Feature 지원 범위 ∩ 보유 권리 → <ScreenLink id="UI09">UI09 과금·권리</ScreenLink></div>
            </div>
            <div className="row mt" style={{ gap: 8 }}>
              <Gated label="대상 확정" kind="primary" reasons={unk > 0 ? [`미정 ${unk}건 — 사유 확정 전에는 대상 확정 불가`] : []}
                onClick={() => { audit('TARGET_SNAPSHOT', cur.id, `대상 고정 ${num(planned)}대`); toast(`TargetSnapshot 고정 — ${num(planned)}대`); }} />
              <Gated label="범위 검증" reasons={publishReasons} onClick={() => toast('국가·차종·Trim·Variant 범위 검증 요청 — 판정은 서버가 다시 한다')} />
            </div>
            <div className="mt"><UlRules items={s03Rules} /></div>
          </div>
        </div>
      );
    },

    // ── S04 검증과 운영 승인 ────────────────────────────────────────────
    'UI10-S04': () => {
      const items = [
        { k: '검증 결과', ref: `품질 기준 QC-2026-09 · 증적 4건`, role: 'quality', ok: true, why: '-' },
        { k: '안전 영향', ref: 'QM · ASIL 영향없음 (안전 요구사항 추적 유지)', role: 'quality', ok: true, why: '-' },
        { k: 'ChangeSet hash', ref: contentHash, role: 'author', ok: true, why: '-' },
        { k: '변경 후 재승인', ref: 'Hash 불일치 또는 대상 변경 시 승인 자동 무효', role: 'approver', ok: true, why: '-' },
        { k: '역할 분리', ref: selfApproval ? '작성자 = 승인자' : '작성자 ≠ 승인자', role: 'approver', ok: !selfApproval, why: selfApproval ? '직무 분리 위반' : '-' },
        { k: '승인 유효기간', ref: '2026-10-01 ~ 2026-12-31 (경계 포함)', role: 'approver', ok: true, why: '-' },
        { k: '품질 기준', ref: `실패율 ${live.failRate}% / 임계 5%`, role: 'quality', ok: live.failRate <= 5, why: live.failRate > 5 ? '실패율 초과' : '-' },
      ];
      const blocked = items.filter(i => !i.ok).map(i => i.k);
      return (
        <div>
          <Table head={['검토 항목', '내용 및 정확 참조', '담당 역할', '충족 여부', '차단 사유']}>
            {items.map(i => (
              <tr key={i.k}>
                <td>{i.k}</td><td className="mono small">{i.ref}</td><td>{i.role}</td>
                <td style={{ color: i.ok ? 'var(--pass)' : 'var(--fail)', fontWeight: 600 }}>{i.ok ? '충족' : '미충족'}</td>
                <td className="small" style={{ color: i.ok ? 'var(--muted)' : 'var(--fail)' }}>{i.why}</td>
              </tr>
            ))}
          </Table>
          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...FIELD, maxWidth: 320 }} placeholder="승인 사유 (필수)" value={reason} onChange={e => setReason(e.target.value)} />
            <label className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={selfApproval} onChange={e => setSelfApproval(e.target.checked)} />작성자가 직접 승인
            </label>
            <Gated label="운영 승인" kind="primary" reasons={blocked.concat(approveReasons)}
              onClick={() => { setApproval({ ...approval, [cur.id]: { role: state.role, reason, hash: contentHash } }); audit('OPERATIONAL_AUTHORIZATION', cur.id, `${contentHash} · ${reason}`); toast(`${cur.id} 운영 승인 — ${contentHash}`); }} />
            <Gated label="승인 취소" reasons={!approval[cur.id] ? ['승인된 작업이 아니다'] : []}
              onClick={() => { const n = { ...approval }; delete n[cur.id]; setApproval(n); audit('AUTHORIZATION_REVOKE', cur.id, '승인 취소'); toast('승인 취소 — 발행 차단', 'warn'); }} />
          </div>
          <div className="kv mt">
            <div>승인 상태</div><div>{approval[cur.id] ? `${approval[cur.id].role} · ${stamp(3)} · ${approval[cur.id].hash}` : '미승인'}</div>
            <div>증적 확인</div><div><ScreenLink id="UI16">UI16 품질 기준과 검증 증적</ScreenLink> · <ScreenLink id="UI06">UI06 검증·실험</ScreenLink></div>
          </div>
          <Reasons title="승인 차단 조건" list={approveReasons} />
          <div className="mt"><UlRules items={s04Rules} /></div>
        </div>
      );
    },

    // ── S05 발행 Manifest와 전달 ─────────────────────────────────────────
    'UI10-S05': () => {
      const manifest = `MF-${cur.id}-${(h % 7) + 1}`;
      const steps = [
        { step: '1. 기준선 고정', ref: `${product} · ${bom} · 정책 ${policyVersion}`, st: '완료', why: `변경 없음 (hash ${contentHash.slice(7, 15)})` },
        { step: '2. 도구 Capture', ref: `${captureHash} · tool revision c66d4a4`, st: '완료', why: '원천 Capture 와 동일 (ETag 일치)' },
        { step: '3. 정책 서명', ref: `${manifest} · PKI 서명 KP-A-2027`, st: '완료', why: '유효기간 2026-12-31 · sequence 41' },
        { step: '4. 발행', ref: `${manifest} 승인 hash ${contentHash}`, st: approval[cur.id] ? '완료' : '미확인', why: approval[cur.id] ? '운영 승인 hash 결속' : '운영 승인 없음' },
        { step: '5. 전달 접수', ref: `${num(planned)}대 · commandId CMD-${h % 9000}`, st: '진행', why: `접수 ${num(confirmed + partialFail)}대 · 미접수 ${num(unreported)}대` },
        { step: '6. 차량 적용 확인', ref: `readback ${num(confirmed)}대`, st: '진행', why: `수렴 ${num(confirmed)}대 · 미보고 ${num(unreported)}대 (성공 합산 제외)` },
      ];
      return (
        <div>
          <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span>정확 기준선 <b className="mono">{bom}</b></span><span>정책 <b className="mono">{policyVersion}</b></span>
            <span>대상 <b>{num(planned)}대</b></span><span>기간 <b>2026-10-01 ~ 2026-12-31</b></span>
            <span>서명 <b className="mono">KP-A-2027</b></span>
          </div>
          <Table head={['발행 단계', '정확 참조', '상태', '근거 또는 미확인 사유']}>
            {steps.map(s => (
              <tr key={s.step}>
                <td>{s.step}</td><td className="mono small">{s.ref}</td>
                <td style={{ color: s.st === '완료' ? 'var(--pass)' : s.st === '진행' ? 'var(--brand)' : 'var(--pending)' }}>{s.st}</td>
                <td className="small muted">{s.why}</td>
              </tr>
            ))}
          </Table>
          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Gated label="Manifest 발행" kind="primary" reasons={publishReasons}
              onClick={() => { setApproval({ ...approval, [cur.id]: approval[cur.id] || { role: state.role, reason: '발행', hash: contentHash } }); audit('PUBLISH', cur.id, `${manifest} · sequence 42 · 서명 KP-A-2027`); toast(`${manifest} 발행 — sequence 42, 대상 ${num(planned)}대`); }} />
            <Gated label="전달 명령 미리보기" reasons={[]} onClick={() => toast(`전달 명령 미리보기 — commandId CMD-${h % 9000} (실행 아님)`)} />
            <span className="small muted">도구 명령을 그대로 실행하지 않는다. 발행은 운영 승인·서명 뒤에만 일어난다.</span>
          </div>
          <div className="kv mt">
            <div>서명 상태</div><div className="mono">VERIFIED · sequence 41 → 42 · 재사용 방지(nonce) 적용</div>
            <div>부분 적용</div><div>ECU 별 부분 적용 {num(partialFail)}대 — 전체 성공으로 합산하지 않는다</div>
            <div>연계 확인</div><div><ScreenLink id="UI18">UI18 외부 시스템 연계</ScreenLink></div>
          </div>
          <div className="mt"><UlRules items={s05Rules} /></div>
        </div>
      );
    },

    // ── S06 Wave와 확대 제어 ────────────────────────────────────────────
    'UI10-S06': () => {
      const waves = ROLLOUT_STEPS.map((pct, i) => {
        const denom = Math.round(targets * (pct / 100));
        const on = i <= waveIdx;
        const succ = on ? Math.round(denom * (i === waveIdx ? 0.981 : 0.99)) : 0;
        const fail = on ? Math.max(0, Math.round((denom - succ) * 0.6)) : 0;
        const unk = on ? denom - succ - fail : 0;
        return { i, pct, denom, succ, fail, unk };
      });
      return (
        <div>
          <Table head={['단계', '고정 대상', '확인 성공', '부분 실패', '미확인', '확대 조건']}>
            {waves.map(w => (
              <tr key={w.pct} style={{ background: w.i === waveIdx ? 'var(--surface-2)' : undefined }}>
                <td>Wave {w.i + 1} · {w.pct}%{w.i === waveIdx && !paused[cur.id] ? ' ▶' : ''}</td>
                <td className="mono">{num(w.denom)}대 (분모 고정)</td>
                <td className="mono" style={{ color: 'var(--pass)' }}>{num(w.succ)}</td>
                <td className="mono" style={{ color: w.fail ? 'var(--fail)' : 'var(--muted)' }}>{num(w.fail)}</td>
                <td className="mono" style={{ color: w.unk ? 'var(--pending)' : 'var(--muted)' }}>{num(w.unk)}</td>
                <td className="small muted">확인 성공률 ≥ 98% · 미확인 0대 · 부분 실패 조사 후 확대</td>
              </tr>
            ))}
          </Table>
          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Gated label={`다음 Wave 확대 → ${ROLLOUT_STEPS[Math.min(waveIdx + 1, ROLLOUT_STEPS.length - 1)]}%`} kind="primary" reasons={expandReasons}
              onClick={() => { const nx = Math.min(waveIdx + 1, ROLLOUT_STEPS.length - 1); setWave({ ...wave, [cur.id]: nx }); audit('WAVE_EXPAND', cur.id, `Wave ${nx + 1} · ${ROLLOUT_STEPS[nx]}%`); toast(`${cur.id} → Wave ${nx + 1} (${ROLLOUT_STEPS[nx]}%)`); }} />
            <Gated label={paused[cur.id] ? '확대 재개' : '확대 중지(Pause)'} kind={paused[cur.id] ? 'primary' : 'danger'}
              reasons={paused[cur.id] && confirmed / Math.max(1, planned) < 0.98 ? ['확인 성공률 98% 미만 — 재개 보류'] : []}
              onClick={() => { const n = !paused[cur.id]; setPaused({ ...paused, [cur.id]: n }); audit(n ? 'WAVE_PAUSE' : 'WAVE_RESUME', cur.id, n ? '신규 전달 중지 (차량 OFF 아님)' : '확대 재개'); toast(n ? '확대 중지 — 신규 전달만 멈춘다' : '확대 재개', n ? 'warn' : 'ok'); }} />
            <Gated label="긴급 차단(Kill)" kind="danger" reasons={can('kill') ? [] : [`역할 ${state.role} 에게 긴급 차단 권한이 없다`]}
              onClick={() => { audit('KILL', cur.id, 'Safe Default=disabled · 확대 중지와 다른 경로'); toast('긴급 차단 — Safe Default 로 전환 (확대 중지와 다름)', 'warn'); }} />
          </div>
          <p className="small muted mt">Pause 는 신규 전달을 멈춘다. 이미 적용된 차량을 OFF 로 만들지 않으며, 그 효과는 긴급 차단·이전 정책 복구와 다르다.</p>
          <div className="card mt">
            <b>후속 범위</b>
            <p className="small muted">예약 변경과 Release 템플릿 편집은 이 화면의 범위가 아니다. 템플릿은 작업 기본정보에서 고정된 값으로만 참조한다.</p>
            <button className="btn" disabled title="후속 범위 — 예약 변경은 별도 승인 절차가 필요하다">예약 변경 (후속 범위)</button>
          </div>
          <div className="mt"><UlRules items={s06Rules} /></div>
          <Reasons title="확대 차단 조건" list={expandReasons} />
        </div>
      );
    },

    // ── S07 결과와 Closed Loop ──────────────────────────────────────────
    'UI10-S07': () => {
      const rows7 = [
        { svc: 'BDC 도어락 정책', desired: 'ON', delivered: 'ON · seq 42', evaluated: '적용 가능', guard: 'PASS', observed: 'ON', last: stamp(6) },
        { svc: 'BMS 프리컨디셔닝', desired: 'ON', delivered: 'ON · seq 42', evaluated: '적용 가능', guard: 'PASS', observed: 'ON (제한)', last: stamp(7) },
        { svc: 'IVI 라이트 시나리오', desired: 'ON', delivered: 'NOT_RECEIVED', evaluated: '적용 가능', guard: 'UNKNOWN', observed: 'UNKNOWN', last: '-' },
        { svc: 'ADAS 파라미터', desired: 'OFF', delivered: 'OFF · seq 41', evaluated: '적용 불가', guard: 'BLOCK', observed: 'OFF', last: stamp(5) },
        { svc: 'OTA 수신 서비스', desired: 'ON', delivered: 'REJECTED', evaluated: '자격 없음', guard: 'BLOCK', observed: 'OFF', last: stamp(4) },
      ];
      const reported = rows7.filter(r => r.observed !== 'UNKNOWN').length;
      const unknown = rows7.length - reported;
      return (
        <div>
          <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span>목표(Desired) <b>ON {rows7.filter(r => r.desired === 'ON').length}</b></span>
            <span>전달(Delivered) <b>{rows7.filter(r => r.delivered.startsWith('ON')).length}</b></span>
            <span>평가(Evaluated) <b>적용 가능 {rows7.filter(r => r.evaluated === '적용 가능').length}</b></span>
            <span>Guard <b>{rows7.filter(r => r.guard === 'PASS').length} PASS</b></span>
            <span style={{ color: unknown ? 'var(--pending)' : 'var(--pass)' }}>미보고 {unknown} — 성공으로 합산하지 않음</span>
          </div>
          <Table head={['ECU·서비스', '목표', '전달', '평가', 'Guard', '실제 관측', '최근 보고']}>
            {rows7.map(r => (
              <tr key={r.svc}>
                <td>{r.svc}</td><td className="mono">{r.desired}</td><td className="mono small">{r.delivered}</td>
                <td className="small">{r.evaluated}</td>
                <td style={{ color: r.guard === 'PASS' ? 'var(--pass)' : r.guard === 'BLOCK' ? 'var(--fail)' : 'var(--pending)' }}>{r.guard}</td>
                <td className="mono">{r.observed}</td><td className="mono small">{r.last}</td>
              </tr>
            ))}
          </Table>
          <div className="kv mt">
            <div>성공 근거</div><div>현재 출시(sequence 42 · {policyVersion})에 대한 유효 readback {reported}건만 성공 근거로 쓴다</div>
            <div>미보고 처리</div><div>미보고 {unknown}건은 원인(신호 없음 / 스냅샷 없음 / 정책 버전 미상)을 함께 표시한다</div>
            <div>차량·ECU 별 결과</div><div><ScreenLink id="UI12">UI12 차량별 적용 상태</ScreenLink></div>
          </div>
          <div className="mt"><UlRules items={s07Rules} /></div>
        </div>
      );
    },

    // ── S08 중단과 변경 복구 ────────────────────────────────────────────
    'UI10-S08': () => {
      const blocks = sampleVehicles.slice(0, 4).map((v, i) => ({
        vin: v.vin, feature: cur.feature,
        kind: i < 2 ? '긴급 차단' : '확대 중지',
        why: i === 0 ? '정책 서명 불일치 — 배포 중단' : i === 1 ? 'ECU 적용 실패 반복 (3회)' : i === 2 ? '실패율 임계 초과' : '부분 실패 조사 중',
        evidence: `EV-QC-${2400 + i} · 시험 결과 ${i < 2 ? '1건' : '0건'}`,
        right: i < 2 ? '보유 권리 · 기간 유효' : '권리 확인 필요',
      }));
      const kill = blocks.filter(b => b.kind === '긴급 차단').length;
      const pause = blocks.length - kill;
      const recoverable = blocks.filter(b => b.kind === '긴급 차단' && b.evidence.includes('1건') && !recovered[b.vin]).length;
      return (
        <div>
          <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--fail)' }}>긴급 차단 {kill}</span>
            <span style={{ color: 'var(--pending)' }}>확대 중지 {pause}</span>
            <span>복구 가능 {recoverable}</span>
            <span className="muted">복구는 차단 원인별로 따로 한다 — 다른 장애의 차단은 유지된다</span>
          </div>
          <Table head={['대상 차량', 'Feature', '차단 사유', '복구 증적', '권리 및 기간', '차량 확인']}>
            {blocks.map(b => (
              <tr key={b.vin}>
                <td className="mono small">{b.vin}</td><td className="mono small">{b.feature}</td>
                <td>
                  <span className="pill">{b.kind}</span>
                  <div className="small muted">{b.why}</div>
                </td>
                <td className="small">{b.evidence}</td><td className="small">{b.right}</td>
                <td>
                  <span className="small" style={{ color: recovered[b.vin] ? 'var(--pass)' : 'var(--muted)' }}>
                    {recovered[b.vin] ? '차량 확인 완료' : '미확인'}
                  </span>
                  <div className="mt">
                    <Gated label="복구" kind="primary" reasons={[
                      b.kind === '확대 중지' ? '확대 중지는 복구가 아니라 재개로 처리한다' : '',
                      !b.evidence.includes('1건') ? '복구 증적이 없다' : '',
                      recovered[b.vin] ? '이미 복구 확인됨' : '',
                    ].filter(Boolean) as string[]}
                      onClick={() => { setRecovered({ ...recovered, [b.vin]: true }); audit('RECOVER', b.vin, `${b.why} · 증적 ${b.evidence}`); toast(`${b.vin} 복구 — 다른 차단은 유지`); }} />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          <div className="card mt">
            <b>이전 정책 재발행</b>
            <p className="small muted">이전 정책으로 돌리는 것도 새 승인으로 추적한다 — 복구 자체가 새 발행이다.</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Gated label="이전 정책 재발행 요청" reasons={replayed ? ['이미 요청됨 — 새 승인 대기'] : publishReasons}
                onClick={() => { setReplayed(true); audit('REPUBLISH', cur.id, `${policyVersion} → 이전 정책 · 새 승인 필요`); toast('이전 정책 재발행 요청 — 새 승인 절차로 추적', 'warn'); }} />
              <span className="small muted">차단과 복구는 관측 결과로 확인한다. 복구 증적 없이는 완료로 쓰지 않는다.</span>
            </div>
            <div className="kv mt">
              <div>원인 조사</div><div><ScreenLink id="UI13">UI13 장애·복구</ScreenLink> · 증적 <ScreenLink id="UI16">UI16 검증 증적</ScreenLink></div>
            </div>
            <div className="mt"><UlRules items={s08Rules} /></div>
          </div>
        </div>
      );
    },
  };

  return <CanonicalScreen screenId="UI10" core="C46 보안 배포 관리" kpis={kpis} areas={areas} />;
}
