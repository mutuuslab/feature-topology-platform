// /learn — 표준 따라하기 허브와 시나리오 화면. 보고서 v1.1 18장 케이스 시나리오를 실제 화면에서 따라 한다(가이드 패널: shell/GuideDock).
import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clausesOfRules, tutorialById, TUTORIALS, type ReadingPath, type Tutorial } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { roleLabel } from '../../data/refdata';
import { Button, Explain, ExplainCodes, KeyValue, PageHeader, Panel, RuleText, Segmented, type KeyMessageSpec, useReportCatalog } from '../../design';
import { learnStore, useLearn, type LearnMode } from '../../shell/learn';

const L = ko.learn;
/** 운영 빌드 검사 표식(tools/prod-bundle.test.ts) — 운영 설치는 이 화면을 싣지 않는다(결정 D-RD-8) */
const LEARN_MARKER = 'ff-learn-v1';
const PATHS = ['ALL', 'BASIS', 'DESIGN', 'BUILD', 'VERIFY_OPERATE'] as const;

/** 제목 끝의 케이스 번호 '(CS-05)'는 본문에서 뺀다 — 번호는 트랙 표시의 툴팁·설명 모드에 있다(UX3-01) */
const titleOf = (t: Tutorial) => t.title.replace(/\s*\(CS-\d+\)$/, '');

function rolesOfTutorial(t: Tutorial): string[] {
  return [...new Set(t.steps.map((s) => s.role))];
}

/** 시나리오 코드(CS-01·CLASSIFY-GATE)는 툴팁·설명 모드에서만(UX3-01) — 본문은 트랙 이름 */
function TrackLabel({ t }: { t: Tutorial }) {
  const code = t.cs ?? t.id;
  return (
    <span className="ds-eyebrow ds-eyebrow--ko" title={code}>
      {L.track[t.track]}
      <ExplainCodes codes={[code]} />
    </span>
  );
}

/** 시나리오 카드 — 시작은 보조 버튼(핵심 메시지보다 먼저 보이지 않게, UX3-07) */
function Card({ t }: { t: Tutorial }) {
  const st = useLearn();
  const nav = useNavigate();
  const active = st?.scenarioId === t.id;
  return (
    <li className="ds-learn-card">
      <div className="ds-learn-card__head">
        <TrackLabel t={t} />
      </div>
      <h2>
        <Link to={`/learn/${t.id}`}>{titleOf(t)}</Link>
      </h2>
      <p className="ds-learn-card__sum">
        <RuleText text={t.summaryKo} explain />
      </p>
      {/* 근거 규칙 칩은 설명 모드에서만(3초 테스트) — 카드는 제목·요약·시작 버튼 */}
      <Explain rules={t.rules} />
      <div className="ds-learn-card__foot">
        <span className="ds-field__hint">{rolesOfTutorial(t).map(roleLabel).join(', ')}</span>
        <Button icon="play" onClick={() => nav(`/learn/${t.id}`)}>
          {active && st ? L.resumeRun(st.step + 1, t.steps.length) : L.startCta(t.steps.length, t.minutes)}
        </Button>
      </div>
    </li>
  );
}

/** 핵심 메시지 — 진행 중인 실습이 먼저, 없으면 실습 수 */
function hubMessage(running: Tutorial | undefined): KeyMessageSpec {
  if (running) return { tone: 'neutral', text: L.key.running(titleOf(running)), action: <Link to={`/learn/${running.id}`}>{L.key.resume}</Link> };
  return { tone: 'neutral', value: TUTORIALS.length, text: L.key.ready };
}

export function LearnHub() {
  const [sp, setSp] = useSearchParams();
  const path = (sp.get('path') ?? 'ALL') as (typeof PATHS)[number];
  const list = TUTORIALS.filter((t) => path === 'ALL' || t.readingPath === path);
  const st = useLearn();
  const running = st ? tutorialById(st.scenarioId) : undefined;
  const counts = useMemo(() => Object.fromEntries(PATHS.map((p) => [p, TUTORIALS.filter((t) => p === 'ALL' || t.readingPath === p).length])), []);
  // 예시 데이터가 없는 설치(고객 운영 — 시드 없음)면 시나리오 ID가 이 설치에 없다고 먼저 알린다(출시 준비 RD-OPS-02)
  const health = useApi<{ seed: string | null }>('health');
  const noSample = !!health.data && !health.data.seed;
  return (
    <div className="ds-screen" data-learn={LEARN_MARKER}>
      <PageHeader codes="FFP-FS-STR-001 v1.1 · 18장" title={L.title} lead={L.lead} message={hubMessage(running)} />
      {noSample && (
        <div className="ds-stale" role="note" data-learn-sample-notice="">
          {L.sampleNotice}
        </div>
      )}
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
  useReportCatalog();
  const { id = '' } = useParams();
  const nav = useNavigate();
  const t = tutorialById(id);
  const st = useLearn();
  if (!t) return <p className="ds-stale">{id}</p>;
  const clauses = clausesOfRules([...t.rules, ...t.steps.flatMap((s) => s.rules)]);
  const running = st?.scenarioId === t.id;
  const start = (mode: LearnMode) => {
    // 같은 방식으로 진행 중이면 이어서(지금 단계 화면으로), 아니면 1단계부터
    if (running && st!.mode === mode) return nav(t.steps[Math.min(st!.step, t.steps.length - 1)].route);
    learnStore.start(t.id, mode);
    if (t.steps[0].route !== `/learn/${t.id}`) nav(t.steps[0].route);
  };
  return (
    <div className="ds-screen" data-learn={LEARN_MARKER}>
      <PageHeader
        codes={`${t.cs ?? t.id} · ${L.track[t.track]} · ${L.path[t.readingPath as ReadingPath]}`}
        title={titleOf(t)}
        message={running ? { tone: 'neutral', value: `${st!.step + 1}/${t.steps.length}`, text: L.key.inProgress } : { tone: 'neutral', value: t.steps.length, text: L.key.stepsMinutes(t.minutes) }}
      />
      <div className="ds-split">
        <div style={{ display: 'grid', gap: 'var(--sp-4)', alignContent: 'start' }}>
          {/* 시나리오 요약은 학습 본문 — 머리 설명(한 줄)이 아니라 본문 맨 위에 */}
          <p className="ds-learn-card__sum">{t.summaryKo}</p>
          {(t.before || t.after) && (
            <Panel title={L.compare} codes={L.compareRef} id="learn-compare" tour="learn-compare">
              <KeyValue
                rows={[
                  { k: L.before, v: t.before ?? '—' },
                  { k: L.after, v: t.after ?? '—' },
                ]}
              />
            </Panel>
          )}
          <Panel title={L.stepList} id="learn-steps">
            <ol className="ds-learn-steps">
                {t.steps.map((s, k) => (
                  <li key={s.id} data-kind={s.kind} aria-current={st?.scenarioId === t.id && st.step === k ? 'step' : undefined}>
                    <span className="ds-learn-steps__no">{k + 1}</span>
                    <div>
                      <div className="ds-learn-steps__title">
                        {s.title} <span className="ds-field__hint">· {L.kind[s.kind]} · {roleLabel(s.role)}</span>
                      </div>
                      <p className="ds-field__hint">{s.doKo}</p>
                      {/* 단계 근거 규칙 칩은 설명 모드에서만(UX3-01) */}
                      <Explain rules={s.rules} />
                    </div>
                  </li>
                ))}
              </ol>
          </Panel>
        </div>
        <div style={{ display: 'grid', gap: 'var(--sp-4)', alignContent: 'start' }}>
          <Panel title={L.modes} id="learn-modes">
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {/* 직접 하기는 쓰기(요청·승인·저장)를 해야 판정이 열린다 — 쓰기를 받지 않는 정적 데모에서는 보기만 연다(단계에서 막히지 않게) */}
              {(STATIC_MODE ? (['view'] as const) : (['view', 'self'] as const)).map((m) => (
                <div key={m} style={{ display: 'grid', gap: 4 }}>
                  <Button variant={m === 'view' && !running ? 'primary' : 'default'} icon={m === 'view' ? 'play' : 'pen'} onClick={() => start(m)} data-tour={m === 'view' ? 'learn-start' : undefined} data-mode={m}>
                    {running && st!.mode === m ? L.resumeRun(st!.step + 1, t.steps.length) : L.mode[m]}
                  </Button>
                  <span className="ds-field__hint">{L.modeHint[m]}</span>
                </div>
              ))}
            </div>
          </Panel>
          {/* 근거 조항 목록은 추적 정보 — 설명 모드에서만 보인다(UX3-01) */}
          <div className="ds-explain-block">
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
    </div>
  );
}
