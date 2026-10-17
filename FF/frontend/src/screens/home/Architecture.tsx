// /arch/components — 42 컴포넌트 아키텍처 (P9). 구현 상태(manifest)·백엔드 등록·최근 활동(이벤트·감사 componentId)을 6개 도메인으로,
// 플랫폼 이벤트가 오면 해당 컴포넌트를 잠시 강조한다. PoC 단계를 고르면 그 단계에 관여하는 컴포넌트만 또렷하게.
// 보고서 v1.1 반영: 규칙마다 집행할 기존 컴포넌트(STANDARDS_MAP)와 추적 상태(RULE_STATUS) — 작업 단계(WP)를 고르면 그 단계가 고치는 컴포넌트만 또렷하게.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { componentTcl, QUALIFICATION_METHODS, reportRule, RULE_STATUS, rulesOfComponent, STANDARDS_MAP, tclOf, TOOL_CLASSIFICATION, type WorkPackage } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, Drawer, KeyValue, PageHeader, RuleChecklist, Segmented, SummaryLine, VerdictBadge } from '../../design';
import { when } from '../shared';

const A = ko.arch;
const DOMAINS = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06'] as const;
const WPS: WorkPackage[] = ['WP0', 'WP1', 'WP2', 'WP3', 'WP4', 'WP5', 'WP6', 'WP7', 'WP8', 'WP9', 'WP10'];
const RULE_IDS = Object.keys(STANDARDS_MAP);
const done = (id: string) => !!RULE_STATUS[id]?.tested;
/** 컴포넌트가 집행하는 규칙 — 반영 단계 필터가 있으면 그 단계 규칙만 */
/** 컴포넌트를 SW 도구로 본 분류 — 오류 출력 유형별 TI·TD → TCL, TCL2 이상의 신뢰도 확보 방법과 근거 시험 */
function ToolQualification({ componentId }: { componentId: string }) {
  const c = TOOL_CLASSIFICATION.find((x) => x.componentId === componentId);
  if (!c) return null;
  const A = ko.arch;
  return (
    <section data-testid="tool-qualification" aria-label={A.tcl}>
      <h3 className="ds-eyebrow">{A.tcl}</h3>
      <KeyValue
        rows={[
          { k: 'TCL', v: c.kind === 'TOOL' ? <span className="ds-mono">{componentTcl(c)}</span> : '—', note: A.tclKind[c.kind] },
          ...c.outputs.map((o) => ({
            k: A.tclOutput,
            v: <span style={{ fontSize: 'var(--fs-xs)' }}>{o.error}</span>,
            note: `${o.ti}${o.td ? `·${o.td}` : ''} → ${tclOf(o.ti, o.td)} · ${A.tclDetect}: ${o.detection ?? A.tclNoDetect}`,
          })),
          ...(c.qualification
            ? [
                {
                  k: A.tclMethod,
                  v: <span style={{ fontSize: 'var(--fs-xs)' }}>{c.qualification.methods.map((m) => `${m} ${QUALIFICATION_METHODS[m]}`).join(' · ')}</span>,
                  note: [c.qualification.note, ...c.qualification.evidence].filter(Boolean).join(' · '),
                },
              ]
            : []),
        ]}
      />
      <p className="ds-field__hint">{A.tclSource[c.source]}</p>
    </section>
  );
}

const rulesFor = (c: string, wp: string) => rulesOfComponent(c).filter((id) => wp === 'ALL' || STANDARDS_MAP[id].wp === wp);

interface Comp {
  id: string;
  ko: string;
  domain: (typeof DOMAINS)[number];
  tier: string;
  status: 'implemented' | 'planned';
  endpoints: string[];
  screens: string[];
  tests: string[];
  ifs: string[];
  pocSteps: number[];
  registered: boolean;
  providers: string[];
}
interface Activity {
  id: string;
  events: number;
  lastAt: string | null;
  lastType: string | null;
  audits: number;
  refused: number;
}

export function ArchitectureScreen() {
  const [sp, setSp] = useSearchParams();
  const q = useApi<Comp[] | { items: Comp[] }>('components');
  const act = useApi<{ items: Activity[] }>('componentActivity', { query: { minutes: 60 } });
  const live = usePlatformEvents([''], ['componentActivity'], 50);
  const [hot, setHot] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);
  const step = sp.get('step') ?? 'ALL';
  const wp = sp.get('wp') ?? 'ALL';
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v === 'ALL') n.delete(k);
    else n.set(k, v);
    setSp(n, { replace: true });
  };

  // 새 이벤트의 컴포넌트를 3초 동안 강조
  const last = live.at(-1);
  useEffect(() => {
    if (!last?.componentId) return;
    const id = last.componentId;
    setHot((h) => ({ ...h, [id]: Date.now() }));
    const t = setTimeout(() => setHot((h) => Object.fromEntries(Object.entries(h).filter(([k, v]) => k !== id || Date.now() - v < 3000))), 3000);
    return () => clearTimeout(t);
  }, [last?.seq]);

  const comps: Comp[] = Array.isArray(q.data) ? q.data : (q.data?.items ?? []);
  const activity = new Map((act.data?.items ?? []).map((a) => [a.id, a]));
  const implemented = comps.filter((c) => c.status === 'implemented').length;
  const active = (act.data?.items ?? []).filter((a) => a.events > 0).length;
  const sel = comps.find((c) => c.id === open);
  return (
    <div className="ds-screen">
      <PageHeader
        codes="42 COMPONENTS · 6 DOMAINS"
        title={A.title}
        lead={A.lead}
        message={{ tone: 'ok', value: `${implemented}/${comps.length || 42}`, text: A.implemented }}
        actions={<Link to="/poc">{ko.poc.title} →</Link>}
      />
      <SummaryLine
        items={[
          { k: A.planned, v: comps.length - implemented },
          { k: A.active, v: active },
          { k: A.interfaces, v: new Set(comps.filter((c) => c.status === 'implemented').flatMap((c) => c.ifs)).size },
          { k: A.standards, v: `${RULE_IDS.filter(done).length}/${RULE_IDS.length}` },
        ]}
      />
      <Segmented
        label={A.step}
        options={[{ value: 'ALL', label: A.all }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: ['①', '②', '③', '④', '⑤', '⑥'][n - 1] }))]}
        value={step}
        onChange={(v) => setParam('step', v)}
      />
      <Segmented
        label={A.wp}
        options={[{ value: 'ALL', label: A.wpAll }, ...WPS.map((w) => ({ value: w, label: w, count: RULE_IDS.filter((id) => STANDARDS_MAP[id].wp === w).length }))]}
        value={wp}
        onChange={(v) => setParam('wp', v)}
      />
      <AsyncView state={asyncState(q, comps.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <div className="ds-arch">
          {DOMAINS.map((d) => (
            <section key={d} className="ds-arch__col" aria-label={A.domains[d]}>
              <h2>{A.domains[d]}</h2>
              <ul>
                {comps
                  .filter((c) => c.domain === d)
                  .map((c) => {
                    const a = activity.get(c.id);
                    const rules = rulesFor(c.id, wp);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="ds-comp"
                          data-status={c.status}
                          data-hot={!!hot[c.id]}
                          data-dim={(step !== 'ALL' && !c.pocSteps.includes(Number(step))) || (wp !== 'ALL' && rules.length === 0)}
                          onClick={() => setOpen(c.id)}
                          aria-label={`${c.id} ${c.ko} ${c.status === 'implemented' ? A.implemented : A.planned}`}
                        >
                          <span className="ds-comp__id">{`${c.id} · ${c.tier}`}</span>
                          <span className="ds-comp__name">{c.ko}</span>
                          <span className="ds-comp__meta">{`${c.status === 'implemented' ? '●' : '○'} ${a?.events ? `${A.events} ${a.events}` : ''}${c.ifs.length ? ` · ${c.ifs.join(' ')}` : ''}`}</span>
                          {rules.length > 0 && <span className="ds-comp__std">{A.standardsCard(rules.filter(done).length, rules.length)}</span>}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </div>
      </AsyncView>
      <Drawer open={!!sel} title={sel ? `${sel.id} ${sel.ko}` : ''} onClose={() => setOpen(null)}>
        {sel && (
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <KeyValue
              rows={[
                { k: 'status', v: <VerdictBadge value={sel.status === 'implemented' ? 'PASS' : '미판정'} />, note: sel.registered ? sel.providers.join(', ') : undefined },
                { k: 'Tier', v: <span className="ds-mono">{sel.tier}</span> },
                { k: A.step, v: <span className="ds-mono">{sel.pocSteps.map((n) => ['①', '②', '③', '④', '⑤', '⑥'][n - 1]).join(' ') || '—'}</span> },
                { k: A.interfaces, v: <span className="ds-mono">{sel.ifs.join(', ') || '—'}</span> },
                {
                  k: A.screens,
                  v: sel.screens.length ? (
                    <span style={{ display: 'grid', gap: 2 }}>
                      {sel.screens.map((s) =>
                        s.includes(':') ? (
                          <span key={s} className="ds-mono">
                            {s}
                          </span>
                        ) : (
                          <Link key={s} to={s} className="ds-mono">
                            {s}
                          </Link>
                        ),
                      )}
                    </span>
                  ) : (
                    '—'
                  ),
                },
                {
                  k: A.endpoints,
                  v: (
                    <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'pre-line' }}>
                      {sel.endpoints.join('\n') || '—'}
                    </span>
                  ),
                },
                {
                  k: A.tests,
                  v: (
                    <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {sel.tests.join('\n') || '—'}
                    </span>
                  ),
                },
                {
                  k: A.lastEvent,
                  v: (
                    <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {activity.get(sel.id)?.lastType ?? '—'}
                    </span>
                  ),
                  note: activity.get(sel.id)?.lastAt ? when(activity.get(sel.id)!.lastAt!) : undefined,
                },
              ]}
            />
            <ToolQualification componentId={sel.id} />
            {rulesOfComponent(sel.id).length ? (
              <RuleChecklist
                caption={A.standardsList}
                items={rulesOfComponent(sel.id).map((id) => ({
                  id,
                  status: done(id) ? ('pass' as const) : ('pending' as const),
                  title: reportRule(id)?.title,
                  reason: `${done(id) ? A.ruleDone : A.ruleTodo(STANDARDS_MAP[id].wp)}${STANDARDS_MAP[id].components[0] === sel.id ? ` · ${A.primary}` : ''}`,
                }))}
              />
            ) : (
              <p className="ds-field__hint">{A.standardsNone}</p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
