// /_design — 디자인 키트 갤러리. 모든 부품·상태 조합을 한 화면에 두고 시각 회귀(e2e @visual)의 기준으로 쓴다.
// 샘플 값은 DATASET v0.81의 실제 행(FEAT-00022 등)을 쓴다.
import { useState } from 'react';
import { DEACT_CLASSES, deactStages, F_CLASSES, FLAG_TYPES, GATES, LIFECYCLE, REG_CLASSES, stageIndexOf, type GateId } from '@ff/contracts';
import { ko } from '../copy/ko';
import {
  ApprovalSlots,
  AsyncView,
  Button,
  ChainStatus,
  ClassBadge,
  ClassBadges,
  ClauseChip,
  DangerConfirm,
  DataTable,
  DiffView,
  Drawer,
  EventStream,
  Explain,
  GateBadge,
  GateRail,
  IdChip,
  Kpi,
  LifecycleBadge,
  LifecycleStepper,
  Panel,
  ReasonActionNote,
  RuleChecklist,
  RuleText,
  StageStrip,
  Tabs,
  VerdictBadge,
  WindowGauge,
  type AsyncState,
} from '../design';

const T = ko.design;

const SAMPLE = [
  { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계', lifecycle: 'RELEASED', asil: 'B', owner: 'ADAS상품기획팀', baselineId: 'BL-00028' },
  { featureId: 'FEAT-00145', version: '5.4.2', name: '스마트 크루즈 컨트롤', lifecycle: 'RELEASED', asil: 'C', owner: 'ADAS상품기획팀', baselineId: 'BL-00163' },
  { featureId: 'FEAT-00001', version: '2.1.0', name: '원격 스마트 주차 보조', lifecycle: 'VERIFIED', asil: 'B', owner: 'Parking기획팀', baselineId: 'BL-00001' },
  { featureId: 'FEAT-00013', version: '0.3.0', name: '예측 공조', lifecycle: 'PROPOSED', asil: 'QM', owner: '공조상품기획팀', baselineId: null },
] as const;

// 기능안전 부품 샘플 — 보고서 v1.1 부록 D 예제(FEAT-00022 F3/DC2/R1, 시간값은 예제 파라미터)
const PROFILE = { takeover_ms: 4000, ramp_ms: 1500, max_pending_ms: 600000, max_cycle_wait_ms: 28800000 };
const RULES = [
  { id: 'FFG-PLT-002', title: 'Registry RELEASED·Version 일치', status: 'pass' as const },
  { id: 'FFG-PLT-003', title: '등급이 Registry와 같다', status: 'pass' as const },
  { id: 'FFG-PLT-004', title: 'DC4·GSR 의무 기능 원격 요청 금지', status: 'pass' as const },
  { id: 'FFG-PLT-005', title: '서로 다른 2인 승인(F2+ 안전 사유는 FSM)', status: 'pending' as const, reason: '승인 1/2 — OPS_LEAD 서명 대기' },
  { id: 'FFG-PLT-009', title: '시장·형식승인·리콜 근거', status: 'fail' as const, reason: '안전 Kill에 리콜 번호·봉쇄 근거가 없다' },
  { id: 'FFG-PLT-010', title: 'activate·restore의 BOM·SBOM', status: 'na' as const },
];
const NOW = Date.parse('2026-10-13T10:05:12Z'); // 시각 회귀가 흔들리지 않게 고정
const GATE_SAMPLE: Partial<Record<GateId, string>> = { G1: 'PASS', G2: 'PASS', G3: 'PASS', G4: 'PASS', G5: '검토 중', G6: 'PASS', G7: 'FAIL' };

const STREAM = [
  { seq: 1, at: '2026-10-11T09:00:12.000Z', type: 'gate.judged', aggregate: 'FEAT-00022@1.1.0', summary: 'G1 PASS' },
  { seq: 2, at: '2026-10-11T09:02:40.000Z', type: 'feature.lifecycle.changed', aggregate: 'FEAT-00022@1.1.0', summary: 'PROPOSED → APPROVED' },
  { seq: 3, at: '2026-10-11T09:05:03.000Z', type: 'baseline.confirmed', aggregate: 'FEAT-00022@1.1.0', summary: 'BL-00168' },
];

const SWATCHES = [
  ['paper', '--paper'],
  ['surface', '--surface'],
  ['ink', '--ink'],
  ['accent', '--accent'],
  ['ok', '--ok'],
  ['warn', '--warn'],
  ['danger', '--danger'],
] as const;

/** 계산된 실제 색 값 — 토큰이 바뀌면 갤러리에 그대로 드러난다 */
function Swatch({ v }: { v: string }) {
  const [hex, setHex] = useState('');
  return (
    <span
      ref={(el) => {
        if (el && !hex) setHex(getComputedStyle(el).getPropertyValue(v).trim());
      }}
      className="ds-mono"
      style={{ display: 'block', color: 'var(--muted)' }}
    >
      {hex}
    </span>
  );
}

export default function DesignGallery() {
  const [state, setState] = useState<AsyncState>('ready');
  const [danger, setDanger] = useState(false);
  const [drawer, setDrawer] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-5)', maxWidth: 1440 }}>
      <header>
        <div className="ds-eyebrow">FF · DESIGN SYSTEM</div>
        <h1 style={{ margin: '4px 0 6px', fontSize: 'var(--fs-2xl)' }}>{T.title}</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>{T.lead}</p>
      </header>

      <Panel title={T.tokens} id="tokens">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--sp-3)' }}>
          {SWATCHES.map(([k, v]) => (
            <div key={k} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
              <div style={{ height: 44, background: `var(${v})` }} />
              <div style={{ padding: '6px 8px', fontSize: 'var(--fs-xs)' }}>
                <b>{T.swatch[k]}</b> <code>{v}</code>
                <Swatch v={v} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-4)' }}>
          {LIFECYCLE.map((l) => (
            <LifecycleBadge key={l} value={l} showKo />
          ))}
        </div>
      </Panel>

      <Panel title={T.type} id="type">
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, letterSpacing: '-0.03em' }}>{SAMPLE[0].name}</div>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{SAMPLE[1].name}</div>
          <div>{SAMPLE[2].name} · {SAMPLE[2].owner}</div>
          <div className="ds-mono">FEAT-00022@1.0.0 · BL-00028 · sha256:d6c7d3ac6de0…65e1 · 0123456789</div>
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--sp-5)' }}>
        <Panel title={T.status} id="status">
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <GateBadge status="PASS" />
            <GateBadge status="검토 중" />
            <GateBadge status={null} />
            <GateBadge status="FAIL" />
            <VerdictBadge value="PASS" />
            <VerdictBadge value="CONDITIONAL" />
            <VerdictBadge value="미판정" />
            <VerdictBadge value="FAIL" />
          </div>
        </Panel>
        <Panel title={T.ids} id="ids">
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <IdChip id="FEAT-00022" version="1.0.0" to="/features?q=FEAT-00022" />
            <IdChip id="BL-00028" />
            <IdChip id="CAT-00019" version="1.0.0" />
            <IdChip id="SIM-G8-000193" copy={false} />
          </div>
        </Panel>
      </div>

      <Panel title={T.lifecycle} eyebrow="FEAT-00022@1.1.0" id="stepper">
        <LifecycleStepper
          current="DEVELOPING"
          transitions={[{ to: 'VERIFIED', auto: true, blockers: [{ message: 'G5 Verification Gate 검토 중' }, { message: 'Control Point 2개 중 정책 등록 0개' }] }]}
        />
      </Panel>

      <Panel title={T.gates} id="gates">
        <GateRail statuses={GATE_SAMPLE} onSelect={() => undefined} />
        <p className="ds-kpi__hint" style={{ marginTop: 8 }}>{GATES.length} Gates · G1–G3 PROPOSED · G4–G7 DEVELOPING · G8–G9 VERIFIED</p>
      </Panel>

      <Panel title={T.kpi} id="kpi">
        <div className="ds-kpis">
          <Kpi label="Feature" value="80" hint="68 IDs" />
          <Kpi label="Baseline" value="67" hint="BL-00001 … BL-00163" tone="accent" />
          <Kpi label="Gate PASS" value="441" hint="/ 477" tone="ok" />
          <Kpi label="CONDITIONAL" value="36" tone="warn" />
          <Kpi label="DQ" value="22" tone="danger" />
        </div>
      </Panel>

      <Panel
        title={T.table}
        id="table"
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            {(['ready', 'loading', 'empty', 'error', 'forbidden'] as const).map((s) => (
              <Button key={s} variant={state === s ? 'primary' : 'default'} onClick={() => setState(s)}>
                {s}
              </Button>
            ))}
          </div>
        }
      >
        <AsyncView state={state} onRetry={() => setState('ready')}>
          <DataTable
            caption={T.table}
            rows={[...SAMPLE]}
            rowKey={(r) => `${r.featureId}@${r.version}`}
            onOpen={() => undefined}
            initialSort={{ key: 'id', dir: 'asc' }}
            columns={[
              { key: 'id', header: T.sample.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} />, sort: (r) => r.featureId },
              { key: 'name', header: T.sample.name, cell: (r) => r.name, sort: (r) => r.name },
              { key: 'lc', header: T.sample.lifecycle, cell: (r) => <LifecycleBadge value={r.lifecycle} />, sort: (r) => LIFECYCLE.indexOf(r.lifecycle) },
              { key: 'asil', header: T.sample.asil, cell: (r) => <span className="ds-mono">{r.asil}</span>, sort: (r) => r.asil },
              { key: 'owner', header: T.sample.owner, cell: (r) => r.owner },
              { key: 'bl', header: T.sample.baseline, cell: (r) => (r.baselineId ? <IdChip id={r.baselineId} copy={false} /> : <span style={{ color: 'var(--faint)' }}>—</span>) },
            ]}
          />
        </AsyncView>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--sp-5)' }}>
        <Panel title={T.diff} id="diff">
          <DiffView
            rows={[
              { field: 'description', before: '전방 차량과의 거리를 정상·주의·위험 3단계로 판정', after: '…위험 단계에서 감속을 요청' },
              { field: 'version', before: '1.0.0', after: '1.1.0' },
            ]}
          />
        </Panel>
        <Panel title={T.stream} id="stream">
          <EventStream items={STREAM} />
        </Panel>
      </div>

      <Panel title={T.safetyClasses} eyebrow="FFP-FS-STR-001 v1.1 · 5장" id="safety-classes">
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <div className="ds-cls-row">{F_CLASSES.map((f) => <ClassBadge key={f} axis="F" value={f} />)}</div>
          <div className="ds-cls-row">{DEACT_CLASSES.map((d) => <ClassBadge key={d} axis="DC" value={d} />)}</div>
          <div className="ds-cls-row">
            {REG_CLASSES.map((r) => <ClassBadge key={r} axis="R" value={r} />)}
            {FLAG_TYPES.map((t) => <ClassBadge key={t} axis="TYPE" value={t} />)}
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <IdChip id="FEAT-00022" version="1.1.0" copy={false} />
            <ClassBadges f="F3" dc="DC2" r="R1" type="OPS" short />
            <IdChip id="FEAT-00040" version="2.0.0" copy={false} />
            <ClassBadges f="F4" dc="DC4" r="R2" type="OPS" short />
            <ClauseChip id="FFG-CLS-009" title={T.clauseSample} onOpen={() => undefined} />
            <ClauseChip id="ISO 26262-3 cl.7" />
            {/* 표준 설명 모드(상단 책 아이콘)를 켜면 보인다 */}
            <Explain rules={['FFG-CLS-001', 'FFG-CLS-009']} />
          </div>
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--sp-5)' }}>
        <Panel title={T.safetyRules} id="safety-rules">
          <RuleChecklist items={RULES} onRule={() => undefined} />
        </Panel>
        <Panel title={T.safetyApprovals} id="safety-approvals">
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <ApprovalSlots
              now={NOW}
              requester={{ id: 'u-2001', name: '박운영 (OPERATOR)' }}
              slots={[
                { role: 'FSM', approver: { id: 'u-3003', name: '김안전', signedAt: '2026-10-13T10:02:41Z' } },
                { role: 'OPS_LEAD', waitingSince: '2026-10-13T10:02:41Z' },
              ]}
            />
            <ApprovalSlots requester={{ id: 'u-2001' }} slots={[{ role: 'FSM', blocked: T.blockedSample }, { role: 'CSM', waitingSince: null }]} now={NOW} />
            <WindowGauge used={3} adding={2} cap={5000} />
            <WindowGauge used={4200} adding={1200} cap={5000} />
          </div>
        </Panel>
      </div>

      <Panel title={T.safetyStages} id="safety-stages">
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <StageStrip caption="DC2 · SAFETY" stages={deactStages('DC2', 'SAFETY')} current={3} params={PROFILE} />
          <StageStrip caption="DC2 · COMMERCIAL" stages={deactStages('DC2', 'COMMERCIAL')} current={1} params={PROFILE} />
          <StageStrip caption="DC4" stages={deactStages('DC4', 'SAFETY')} current={1} />
          <StageStrip caption="UNKNOWN" stages={deactStages('DC2', 'SAFETY')} current={stageIndexOf(deactStages('DC2', 'SAFETY'), 'UNKNOWN')} params={PROFILE} />
        </div>
      </Panel>

      <Panel title={T.safetyReplies} id="safety-replies">
        <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          <ReasonActionNote result="ACCEPTED" />
          <ReasonActionNote result="ACCEPTED_NOT_DURABLE" />
          <ReasonActionNote result="REJECTED" code="REPLAY" />
          <ReasonActionNote result="REJECTED" code="E2E_CRC" />
          <ReasonActionNote result="REJECTED" code="DC4_REMOTE_FORBIDDEN" />
          <ReasonActionNote result="REJECTED" code="RESPONSE_INVALID" />
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <ChainStatus ok verified={1284} head="sha256:9f2c41d0a8b7e6" />
            <ChainStatus ok={false} verified={812} />
          </div>
          <p className="ds-field__hint" style={{ margin: 0 }}>
            <RuleText text={T.ruleTextSample} />
          </p>
        </div>
      </Panel>

      <Panel title={T.states} id="tabs">
        <Tabs tabs={[{ key: 'a', label: T.lifecycle, count: 7 }, { key: 'b', label: T.gates, count: 9 }, { key: 'c', label: T.stream }]} param="gtab">
          {(k) => <p style={{ margin: 0 }} className="ds-mono">tab={k}</p>}
        </Tabs>
      </Panel>

      <section data-zone="ops" style={{ background: 'var(--paper)', color: 'var(--ink)', padding: 'var(--sp-5)', borderRadius: 'var(--r-lg)', border: '1px solid var(--line)', display: 'grid', gap: 'var(--sp-4)' }}>
        <div className="ds-eyebrow">{T.zone}</div>
        <div className="ds-kpis">
          <Kpi label="SAFE_DEFAULT" value="1 / 1" tone="ok" hint="ego-01" />
          <Kpi label="Kill" value="FEAT-00022" tone="danger" />
        </div>
        <GateRail statuses={GATE_SAMPLE} />
        <ClassBadges f="F3" dc="DC2" r="R1" type="OPS" />
        <StageStrip caption="DC2 · SAFETY" stages={deactStages('DC2', 'SAFETY')} current={2} params={PROFILE} />
        <RuleChecklist items={RULES.slice(2, 5)} />
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <Button variant="danger" icon="alert" onClick={() => setDanger(true)}>{T.dangerOpen}</Button>
          <Button onClick={() => setDrawer(true)}>{T.drawerOpen}</Button>
        </div>
      </section>

      <DangerConfirm
        open={danger}
        title={T.dangerTitle}
        body={T.dangerBody}
        confirmWord="FEAT-00022"
        actionLabel="Kill"
        onConfirm={() => setDanger(false)}
        onClose={() => setDanger(false)}
      />
      <Drawer open={drawer} title={T.drawer} onClose={() => setDrawer(false)}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <IdChip id="FEAT-00022" version="1.0.0" />
          <LifecycleBadge value="RELEASED" showKo />
          <GateRail statuses={{ G1: 'PASS', G2: 'PASS', G3: 'PASS', G4: 'PASS', G5: 'PASS', G6: 'PASS', G7: 'PASS', G8: 'PASS', G9: 'PASS' }} />
        </div>
      </Drawer>
    </div>
  );
}
