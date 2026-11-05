import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { localTime } from '../../data/people';
import { readbackFlow as T } from '../../copy/observability';
import { useMotion } from '../../state/motion';
import './readback-flow.css';

export type VehicleReadback = { vin: string; publicationId: string; at: string; observed: string; rejectReason?: string | null; featureVersion?: string; bootId?: string; sequence?: number; policyHash?: string; metricType?: string };
const recordKey = (r: VehicleReadback) => JSON.stringify(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
const stateTone = (r: VehicleReadback) => r.rejectReason ? 'rejected' : r.observed === 'ON' ? 'on' : 'off';
const resultLabel = (r: VehicleReadback) => r.rejectReason || (/^sha256:/i.test(r.observed) ? T.hashReceived : r.observed);


/** Replay only records returned by the server. Animation never creates a receipt or changes its timestamp. */
export function ReadbackFlow({ rows, updatedAt, fetching, staticMode = false, onOpen }: { rows: VehicleReadback[]; updatedAt: number; fetching: boolean; staticMode?: boolean; onOpen: (row: VehicleReadback) => void }) {
  const [mode, setMode] = useState<'replay' | 'live'>('replay');
  const motion = useMotion();
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState(0);
  const [arrival, setArrival] = useState(0);
  const [liveKey, setLiveKey] = useState<string | null>(null);
  const previous = useRef<{ keys: Set<string>; newest: number } | null>(null);
  const records = useMemo(() => [...new Map(rows.map(r => [recordKey(r), r])).values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-24), [rows]);
  const selectedLive = records.findIndex(r => recordKey(r) === liveKey);
  const cursor = mode === 'live' ? selectedLive >= 0 ? selectedLive : records.length - 1 : Math.min(position, records.length - 1);
  const current = records[cursor];
  const running = mode === 'replay' && playing && motion.running && records.length > 1;
  useEffect(() => {
    if (!running) return;
    return motion.every(2400 / speed, () => setPosition(p => (p + 1) % records.length));
  }, [running, speed, records.length, motion.every]);
  useEffect(() => { if (!motion.running || !playing) setArrival(0); }, [motion.running, playing]);
  useEffect(() => {
    const before = previous.current;
    const newest = records.length ? Date.parse(records[records.length - 1].at) : 0;
    const added = before ? records.filter(r => !before.keys.has(recordKey(r)) && Date.parse(r.at) >= before.newest) : [];
    if (mode === 'live' && added.length) { setLiveKey(recordKey(added[added.length - 1])); setArrival(n => n + 1); }
    previous.current = { keys: new Set(records.map(recordKey)), newest };
  }, [records, mode]);
  if (!current) return null;
  const recent = records.slice(Math.max(0, cursor - 4), cursor + 1).reverse();
  const tone = stateTone(current);
  const canAnimate = motion.running && playing && (mode === 'replay' || arrival > 0);
  return <section className="rx-flow" aria-label={T.title} data-mode={mode} data-running={running} data-tone={tone}>
    <header className="rx-flow__head">
      <div><h2>{T.title}</h2><p>{mode === 'replay' ? T.replayHint : staticMode ? T.staticHint : T.liveHint}</p></div>
      <div className="rx-flow__controls" role="group" aria-label={T.controls}>
        <button type="button" className="ds-btn" aria-pressed={mode === 'replay'} onClick={() => { setMode('replay'); setArrival(0); }}>{T.replay}</button>
        <button type="button" className="ds-btn" aria-pressed={mode === 'live'} onClick={() => { setLiveKey(null); setArrival(0); setMode('live'); }}>{T.live}</button>
        {<><button className="ds-btn" type="button" onClick={() => setPlaying(p => !p)}>{playing ? T.pause : T.play}</button>{mode === 'replay' && <label className="rx-flow__speed">{T.speed}<select className="ds-select" aria-label={T.speed} value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[1, 2, 4].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>}</>}
      </div>
    </header>
    <div className="rx-flow__body">
      <div className="rx-flow__stage">
        <div className="rx-flow__status"><span className="rx-flow__indicator" /><strong>{!motion.running ? T.motionPaused : mode === 'replay' ? playing ? T.replaying : T.paused : staticMode ? T.snapshot : fetching ? T.checking : T.waiting}</strong><span>{mode === 'replay' ? T.position(cursor + 1, records.length) : updatedAt ? T.checked(localTime(new Date(updatedAt).toISOString())) : T.unchecked}</span></div>
        <div className="rx-flow__route" aria-hidden="true">
          <svg viewBox="0 0 640 150" className="rx-flow__diagram">
            <path className="rx-flow__track" d="M125 75 H510" />
            <path className="rx-flow__guide" d="M125 75 H510" />
            <g className="rx-flow__vehicle" transform="translate(28 28)"><rect x="0" y="25" width="94" height="46" rx="12" /><path d="M15 25 L25 5 H67 L80 25 M16 48 H28 M67 48 H79" /><circle cx="20" cy="76" r="7" /><circle cx="75" cy="76" r="7" /></g>
            <g className="rx-flow__receiver" transform="translate(515 30)"><rect width="96" height="88" rx="10" /><path d="M20 24 H76 M20 44 H76 M20 64 H56" /><circle cx="76" cy="64" r="4" /></g>
            {canAnimate && <g key={`${mode}:${mode === 'replay' ? recordKey(current) : arrival}`} className="rx-flow__packet" onAnimationEnd={() => { if (mode === 'live') setArrival(0); }} style={{ animationDuration: `${1.6 / speed}s` }}><circle cx="125" cy="75" r="8" /><circle cx="107" cy="75" r="3" /><circle cx="95" cy="75" r="2" /></g>}
          </svg>
          <div className="rx-flow__route-labels"><span>{T.vehicle}</span><span>{T.path}</span><span>Feature Platform</span></div>
        </div>
        <div className="rx-flow__receipt" key={recordKey(current)} data-testid="readback-active-record">
          <div><span className="rx-flow__label">{T.vehicle}</span><Link to={`/fleet/vehicles/${encodeURIComponent(current.vin)}`}>{current.vin}</Link></div>
          <div><span className="rx-flow__label">{T.receivedAt}</span><time dateTime={current.at}>{localTime(current.at)}</time></div>
          <div><span className="rx-flow__label">{T.result}</span><strong className="rx-flow__result">{resultLabel(current)}</strong></div>
          <div><span className="rx-flow__label">{T.publication}</span><Link to={`/deployments/${encodeURIComponent(current.publicationId)}`}>{current.publicationId}</Link></div>
          <div><span className="rx-flow__label">{T.sequence}</span><span>{current.sequence ?? T.unavailable}</span></div>
          <button className="ds-btn" type="button" onClick={() => onOpen(current)}>{T.detail}</button>
        </div>
        <div className="rx-flow__timeline" role="group" aria-label={T.timeline}>{records.map((r, i) => <button key={recordKey(r)} type="button" data-tone={stateTone(r)} data-past={i <= cursor} aria-pressed={i === cursor} aria-label={T.select(i + 1, r.vin, localTime(r.at), r.rejectReason || r.observed)} onClick={() => { setMode('replay'); setPosition(i); setPlaying(false); }}><span /></button>)}</div>
        <div className="rx-flow__legend"><span>{T.legendOn}</span><span>{T.legendOff}</span><span>{T.legendRejected}</span><span>{T.timelineHint}</span></div>
      </div>
      <aside className="rx-flow__feed" aria-label={T.recent}>
        <h3>{T.recent}<span>{T.shown(recent.length)}</span></h3>
        <ol>{recent.map((r, i) => <li key={recordKey(r)} data-current={i === 0} data-tone={stateTone(r)}><button type="button" onClick={() => onOpen(r)}><span className="rx-flow__feed-top"><strong>{r.vin}</strong><span className="rx-flow__result">{resultLabel(r)}</span></span><time dateTime={r.at}>{localTime(r.at)}</time><span>{r.rejectReason || r.publicationId}</span></button></li>)}</ol>
        <p>{T.source}</p>
      </aside>
    </div>
  </section>;
}
