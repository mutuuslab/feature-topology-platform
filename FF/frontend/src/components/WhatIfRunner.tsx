/**
 * §17.5 What-if **시뮬레이션 러너**.
 *
 * "재실행" 버튼은 결과 표만 갈아끼우고 끝났다. 여기서는 엔진이 만든 실제 이벤트
 * 시퀀스를 시뮬레이션 시계에 맞춰 **1초에 1이벤트씩 재생**해서, 무슨 일이 어떤
 * 순서로 일어나는지 눈으로 따라갈 수 있게 한다. 시계를 멈추면 재생도 멈춘다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimulationResult } from '../data/twin/types';
import { L, toneColor } from './twin';
import { buildPhases, frameOf, phaseSummary, type PhaseStatus } from './whatIfRun';
import './whatIfRun.css';

const STATUS_GLYPH: Record<PhaseStatus, string> = {
  PENDING: '○',
  RUNNING: '◐',
  PASS: '✓',
  WARN: '!',
  FAIL: '⛔',
};

const STATUS_LABEL: Record<PhaseStatus, { ko: string; en: string }> = {
  PENDING: { ko: '대기', en: 'pending' },
  RUNNING: { ko: '진행 중', en: 'running' },
  PASS: { ko: '통과', en: 'pass' },
  WARN: { ko: '주의', en: 'warn' },
  FAIL: { ko: '실패', en: 'fail' },
};

export interface WhatIfRunnerProps {
  result: SimulationResult;
  simTimeMs: number;
  simTick: number;
  rate: 0 | 1 | 5;
  onSetRate: (rate: 0 | 1 | 5) => void;
  onStep: (seconds?: number) => void;
  onRerun: () => void;
  lang: 'ko' | 'en';
}

export function WhatIfRunner({ result, simTimeMs, simTick, rate, onSetRate, onStep, onRerun, lang }: WhatIfRunnerProps) {
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const phases = useMemo(() => buildPhases(result), [result]);
  const frame = useMemo(() => frameOf(startedAtMs, simTimeMs, result, phases), [startedAtMs, simTimeMs, result, phases]);
  const logRef = useRef<HTMLUListElement | null>(null);

  // 입력이 바뀌면 simulationId 가 새로 발급된다 → 진행 중이던 재생은 처음으로 되돌린다.
  useEffect(() => {
    setStartedAtMs(null);
  }, [result.simulationId]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [frame.revealed.length]);

  const ko = lang === 'ko';
  const running = frame.started && !frame.finished;
  const current = phases[frame.phaseIndex];
  const failGates = result.qualityGates.filter((g) => g.status === 'FAIL').length;
  const warnGates = result.qualityGates.filter((g) => g.status === 'WARN').length;

  const start = () => {
    setStartedAtMs(simTimeMs);
    if (rate === 0) onSetRate(1);
  };
  const restart = () => {
    setStartedAtMs(simTimeMs);
    onRerun();
  };

  return (
    <div className="card wif" data-testid="whatif-runner" data-rate={rate} data-elapsed={frame.elapsedSeconds}>
      <div className="wif-head">
        <b>시뮬레이션 실행 (Live Replay)</b>
        <div className="wif-pills">
          <span className={'wif-pill ' + (running ? 'on' : 'off')} data-testid="wif-state">
            {running ? (ko ? `▶ 재생 중 t+${frame.elapsedSeconds}s` : `▶ replaying t+${frame.elapsedSeconds}s`) : frame.finished ? (ko ? '✓ 재생 완료' : '✓ replay complete') : ko ? '⏹ 정지' : '⏹ idle'}
          </span>
          <span className="wif-pill">tick {simTick}</span>
          <span className="wif-pill">{rate === 0 ? (ko ? '시계 정지 (0×)' : 'clock paused (0×)') : `시계 ${rate}×`}</span>
          <span className="wif-pill">sim {new Date(simTimeMs).toISOString().slice(11, 19)}</span>
        </div>
      </div>

      <div className="wif-bar" role="progressbar" aria-valuemin={0} aria-valuemax={frame.totalSeconds} aria-valuenow={frame.elapsedSeconds}>
        <i style={{ width: `${Math.round(frame.progress * 100)}%` }} />
        <span className="wif-bar-label">
          {ko ? '재생 진행' : 'replay'} {frame.elapsedSeconds} / {frame.totalSeconds}s · {ko ? '이벤트' : 'events'} {frame.revealed.length}/{result.eventLog.length}
        </span>
      </div>

      <div className="wif-toolbar">
        <button className="btn primary" onClick={start} disabled={running} data-testid="wif-run">
          ▶ {frame.finished ? (ko ? '다시 재생' : 'Replay') : ko ? '시뮬레이션 실행' : 'Run simulation'}
        </button>
        <button className="btn" onClick={() => onSetRate(0)} disabled={rate === 0 || !running} data-testid="wif-pause">
          ⏸ {ko ? '정지' : 'Pause'}
        </button>
        <button className="btn" onClick={() => onSetRate(rate === 0 ? 1 : rate)} disabled={frame.finished} data-testid="wif-resume">
          {rate === 0 ? '▶ ' + (ko ? '재개' : 'Resume') : `1×${ko ? ' 유지' : ''}`}
        </button>
        <button className="btn" onClick={() => onStep(1)} disabled={frame.finished} data-testid="wif-step">
          ⏭ 1초 {ko ? '스텝' : 'step'}
        </button>
        <button className="btn" onClick={restart} data-testid="wif-restart">
          ⟲ {ko ? '재실행' : 'Re-run'}
        </button>
        <button
          className="btn"
          onClick={() => {
            setStartedAtMs(null);
            onSetRate(0);
          }}
          data-testid="wif-reset"
        >
          ✕ {ko ? '초기화' : 'Reset'}
        </button>
        <span className="wif-rates">
          {([0, 1, 5] as const).map((v) => (
            <button key={v} className={'wif-rate' + (rate === v ? ' sel' : '')} onClick={() => onSetRate(v)}>
              {v}×
            </button>
          ))}
        </span>
      </div>

      <div className="wif-pipeline" data-testid="wif-pipeline">
        {phases.map((p, i) => {
          const st = frame.phaseStatus[i];
          const revealed = frame.revealed.filter((_, idx) => idx >= p.from && idx < p.to);
          return (
            <div key={p.id} className={'wif-node ' + st.toLowerCase() + (i === frame.phaseIndex && running ? ' current' : '')} data-status={st} data-phase={p.group}>
              <div className="wif-node-top">
                <span className={'wif-badge ' + st.toLowerCase()}>{STATUS_GLYPH[st]}</span>
                <span className="wif-node-no">P{p.no}</span>
                <span className="wif-node-status">{STATUS_LABEL[st][lang]}</span>
              </div>
              <div className="wif-node-title">{p.title[lang]}</div>
              <div className="wif-node-hint">{p.hint[lang]}</div>
              <ul className="wif-node-events">
                {p.events.map((e, j) => (
                  <li key={j} className={j < revealed.length ? 'on' : ''}>
                    <code className="mono">{e.eventType.replace(/^twin\./, 'vehicle-state.')}</code>
                  </li>
                ))}
              </ul>
              <div className="wif-node-sum">{phaseSummary(p, st, lang)}</div>
              {i < phases.length - 1 && <span className={'wif-arrow ' + (st === 'PASS' || st === 'WARN' || st === 'FAIL' ? 'done' : '')} />}
            </div>
          );
        })}
      </div>

      <div className="wif-body">
        <div className="wif-current" data-testid="wif-current">
          <b className="small">
            {ko ? '현재 단계' : 'current stage'} · P{current.no} {current.title[lang]}
          </b>
          <p className="small muted">{current.hint[lang]}</p>
          <div className="kv mt">
            <div className="muted">{ko ? '단계 상태' : 'stage status'}</div>
            <div>
              <span className={'wif-badge ' + frame.phaseStatus[frame.phaseIndex].toLowerCase()}>
                {STATUS_GLYPH[frame.phaseStatus[frame.phaseIndex]]} {STATUS_LABEL[frame.phaseStatus[frame.phaseIndex]][lang]}
              </span>
            </div>
            <div className="muted">{ko ? 'Desired → Reported → Effective' : 'Desired → Reported → Effective'}</div>
            <div className="mono small">
              {result.desired} → {result.reported} → {result.effective}
            </div>
            <div className="muted">Local Guard</div>
            <div className="small">
              {result.localGuard.passed ? '✓ PASS' : '⛔ BLOCK'} <code className="mono">{result.localGuard.reasonCode}</code>
            </div>
            <div className="muted">Reconciliation</div>
            <div className="small">{result.reconciliation} · <code className="mono">{result.reasonCode.code}</code></div>
            <div className="muted">{ko ? '남은 이벤트' : 'pending events'}</div>
            <div className="small">{frame.pendingEvents} {ko ? '건' : ''}</div>
          </div>
        </div>

        <div className="wif-log" data-testid="wif-log">
          <b className="small">{ko ? '실행 로그 (재생 순서)' : 'run log (replay order)'}</b>
          <ul className="wif-lines" ref={logRef}>
            {frame.revealed.map((e, i) => (
              <li key={i} className="wif-line" data-severity={e.severity} style={{ ['--tone' as string]: toneColor(e.severity) }}>
                <code className="mono">{e.at.slice(11, 19)}</code>
                <span className="wif-sev">{e.severity}</span>
                <code className="mono wif-type">{e.eventType.replace(/^twin\./, 'vehicle-state.')}</code>
                <span className="wif-desc">{e.desc[lang]}</span>
              </li>
            ))}
            {!frame.revealed.length && <li className="small muted">▶ {ko ? '실행 버튼을 누르면 실제 이벤트가 1초 간격으로 재생됩니다.' : 'Press run to replay real events at one per second.'}</li>}
          </ul>
        </div>
      </div>

      <div className={'wif-verdict' + (frame.finished ? ' on' : '')} data-testid="wif-verdict">
        <span className="wif-verdict-title">{frame.finished ? (ko ? '최종 판정' : 'final verdict') : ko ? '최종 판정 (재생 완료 후 공개)' : 'final verdict (revealed on completion)'}</span>
        {frame.finished ? (
          <div className="wif-verdict-rows">
            <span className="wif-v"><b>{result.eligibility}</b> Eligibility</span>
            <span className="wif-v"><b>{result.desired}/{result.reported}/{result.effective}</b> DRE</span>
            <span className={'wif-v ' + (result.reconciliation === 'CONVERGED' ? 'ok' : 'bad')}><b>{result.reconciliation}</b> Reconciliation</span>
            <span className={'wif-v ' + (result.localGuard.passed ? 'ok' : 'bad')}><b>{result.localGuard.passed ? 'PASS' : 'BLOCK'}</b> Local Guard</span>
            <span className={'wif-v ' + (failGates ? 'bad' : 'ok')}><b>{failGates} FAIL / {warnGates} WARN</b> Quality Gate</span>
            <span className="wif-v"><b>{result.evidence.length}</b> Evidence</span>
            <span className="wif-v"><b>{result.twinVersionBefore} → {result.twinVersionAfter}</b> State Version</span>
            <span className="wif-v"><b>{result.eventLog.length}</b> Events</span>
          </div>
        ) : (
          <span className="small muted">
            Desired·Reported·Effective·Drift 판정은 마지막 이벤트까지 재생된 뒤에 표시됩니다.
          </span>
        )}
      </div>

      <p className="small muted mt">
        <L text={{ ko: '재생은 시뮬레이션 시계에 묶여 있습니다 — 정지하면 재생도 멈추고, 1초 스텝은 정확히 이벤트 1건을 공개합니다.', en: 'Replay is bound to the simulation clock: pausing the clock pauses the replay, and one 1-second step reveals exactly one event.' }} />
        <span className="ml"> seed <code className="mono">{result.seed}</code> · sim <code className="mono">{result.simulationId}</code></span>
      </p>
    </div>
  );
}

export default WhatIfRunner;
