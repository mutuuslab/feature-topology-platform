// /_design — 디자인 키트 갤러리. 모든 부품·상태 조합을 한 화면에 두고 시각 회귀(e2e @visual)의 기준으로 쓴다.
// 샘플 값은 DATASET v0.81의 실제 행(FEAT-00022 등)을 쓴다.
import { useState } from 'react';
import { GATES, LIFECYCLE, type GateId } from '@ff/contracts';
import { ko } from '../copy/ko';
import {
  AsyncView,
  Button,
  DangerConfirm,
  DataTable,
  DiffView,
  Drawer,
  EventStream,
  GateBadge,
  GateRail,
  IdChip,
  Kpi,
  LifecycleBadge,
  LifecycleStepper,
  Panel,
  Tabs,
  VerdictBadge,
  type AsyncState,
} from '../design';

const T = ko.design;

const SAMPLE = [
  { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계', lifecycle: 'RELEASED', asil: 'B', owner: 'ADAS상품기획팀', baselineId: 'BL-00028' },
  { featureId: 'FEAT-00145', version: '5.4.2', name: '스마트 크루즈 컨트롤', lifecycle: 'RELEASED', asil: 'C', owner: 'ADAS상품기획팀', baselineId: 'BL-00163' },
  { featureId: 'FEAT-00001', version: '2.1.0', name: '원격 스마트 주차 보조', lifecycle: 'VERIFIED', asil: 'B', owner: 'Parking기획팀', baselineId: 'BL-00001' },
  { featureId: 'FEAT-00013', version: '0.3.0', name: '예측 공조', lifecycle: 'PROPOSED', asil: 'QM', owner: '공조상품기획팀', baselineId: null },
] as const;

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
            <IdChip id="FEAT-00022" version="1.0.0" to="/catalog?q=FEAT-00022" />
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
