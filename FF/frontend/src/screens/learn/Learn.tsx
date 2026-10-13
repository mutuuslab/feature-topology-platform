// /learn — 표준 따라하기 허브와 시나리오 화면. 보고서 v1.1 18장 케이스 시나리오를 실제 화면에서 따라 한다(가이드 패널: shell/GuideDock).
import { useMemo, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clausesOfRules, reportRule, tutorialById, TUTORIALS, type ReadingPath, type Tutorial } from '@ff/contracts';
import { ko } from '../../copy/ko';
import { roleLabel } from '../../data/refdata';
import { Button, ClauseChip, KeyValue, PageHeader, Panel, Segmented, StatusGlyph, openRule } from '../../design';
import { learnStore, useLearn } from '../../shell/learn';

const L = ko.learn;
const PATHS = ['ALL', 'BASIS', 'DESIGN', 'BUILD', 'VERIFY_OPERATE'] as const;

function rolesOfTutorial(t: Tutorial): string[] {
  return [...new Set(t.steps.map((s) => s.role))];
}

function Card({ t }: { t: Tutorial }) {
  const st = useLearn();
  const active = st?.scenarioId === t.id;
  return (
    <li className="ds-learn-card" data-status={t.status}>
      <div className="ds-learn-card__head">
        <span className="ds-eyebrow">
          {t.cs ?? t.id} · {L.track[t.track]}
        </span>
        <span className="ds-badge" style={{ '--c': t.status === 'ready' ? 'var(--ok)' : 'var(--faint)' } as CSSProperties}>
          <StatusGlyph kind={t.status === 'ready' ? 'PASS' : 'UNJUDGED'} />
          <span className="ds-badge__ko">{L.status[t.status]}</span>
        </span>
      </div>
      <h3>
        <Link to={`/learn/${t.id}`}>{t.title}</Link>
      </h3>
      <p className="ds-learn-card__sum">{t.summaryKo}</p>
      <div className="ds-cls-row" aria-label={L.rules}>
        {t.rules.map((id) => (
          <ClauseChip key={id} id={id} title={reportRule(id)?.title} onOpen={openRule} />
        ))}
      </div>
      <div className="ds-learn-card__foot">
        <span className="ds-field__hint">
          {t.status === 'ready' ? `${L.steps(t.steps.length)} · ${L.minutes(t.minutes)} · ${rolesOfTutorial(t).map(roleLabel).join(', ')}` : L.plannedNote}
        </span>
        {active && st && (
          <span className="ds-field__hint">
            {L.resume} {st.step + 1}/{t.steps.length}
          </span>
        )}
      </div>
    </li>
  );
}

export function LearnHub() {
  const [sp, setSp] = useSearchParams();
  const path = (sp.get('path') ?? 'ALL') as (typeof PATHS)[number];
  const list = TUTORIALS.filter((t) => path === 'ALL' || t.readingPath === path);
  const counts = useMemo(() => Object.fromEntries(PATHS.map((p) => [p, TUTORIALS.filter((t) => p === 'ALL' || t.readingPath === p).length])), []);
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="FFP-FS-STR-001 v1.1 · 18장" title={L.title} lead={L.lead} />
      <Segmented
        label={L.pathLabel}
        value={path}
        onChange={(v) => setSp(v === 'ALL' ? {} : { path: v }, { replace: true })}
        options={PATHS.map((p) => ({ value: p, label: L.path[p], count: counts[p] }))}
      />
      <ul className="ds-learn-grid">
        {list.map((t) => (
          <Card key={t.id} t={t} />
        ))}
      </ul>
    </div>
  );
}

export function LearnRun() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const t = tutorialById(id);
  const st = useLearn();
  if (!t) return <p className="ds-stale">{id}</p>;
  const clauses = clausesOfRules([...t.rules, ...t.steps.flatMap((s) => s.rules)]);
  const start = () => {
    learnStore.start(t.id, 'view');
    if (t.steps[0] && t.steps[0].route !== `/learn/${t.id}`) nav(t.steps[0].route);
  };
  return (
    <div className="ds-screen">
      <PageHeader eyebrow={`${t.cs ?? t.id} · ${L.track[t.track]} · ${L.path[t.readingPath as ReadingPath]}`} title={t.title} lead={t.summaryKo} />
      <div className="ds-split">
        <div style={{ display: 'grid', gap: 'var(--sp-4)', alignContent: 'start' }}>
          {(t.before || t.after) && (
            <Panel title={L.compare} id="learn-compare" tour="learn-compare">
              <KeyValue
                rows={[
                  { k: L.before, v: t.before ?? '—' },
                  { k: L.after, v: t.after ?? '—' },
                ]}
              />
            </Panel>
          )}
          <Panel title={L.stepList} id="learn-steps">
            {t.steps.length ? (
              <ol className="ds-learn-steps">
                {t.steps.map((s, k) => (
                  <li key={s.id} data-kind={s.kind} aria-current={st?.scenarioId === t.id && st.step === k ? 'step' : undefined}>
                    <span className="ds-learn-steps__no">{k + 1}</span>
                    <div>
                      <div className="ds-learn-steps__title">
                        {s.title} <span className="ds-field__hint">· {L.kind[s.kind]} · {roleLabel(s.role)}</span>
                      </div>
                      <p className="ds-field__hint">{s.doKo}</p>
                      <div className="ds-cls-row">
                        {s.rules.map((r) => (
                          <ClauseChip key={r} id={r} title={reportRule(r)?.title} onOpen={openRule} />
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ds-field__hint">{L.plannedNote}</p>
            )}
          </Panel>
        </div>
        <div style={{ display: 'grid', gap: 'var(--sp-4)', alignContent: 'start' }}>
          <Panel title={L.modes} id="learn-modes">
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {(['view', 'auto', 'self'] as const).map((m) => (
                <div key={m} style={{ display: 'grid', gap: 4 }}>
                  <Button variant={m === 'view' ? 'primary' : 'default'} icon={m === 'view' ? 'play' : undefined} disabled={m !== 'view' || !t.steps.length} onClick={start} data-tour={m === 'view' ? 'learn-start' : undefined}>
                    {L.mode[m]}
                  </Button>
                  <span className="ds-field__hint">{L.modeHint[m]}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title={L.clauses} id="learn-clauses">
            <ul className="sh-guide__clauses">
              {clauses.map((c) => (
                <li key={c}>
                  <span className="ds-rule-id">{c}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
