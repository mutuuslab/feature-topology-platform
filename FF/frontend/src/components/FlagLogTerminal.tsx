/**
 * §17.3 Feature Flag 데이터 로그 터미널 — 3D 공장 뷰 하단.
 *
 * 정책 엔진 · OTA · 차량 에이전트 · Local Guard · Twin 서비스가 실제로 발행한
 * 이벤트를 터미널 형태로 흘려 보여준다. 라인은 `flagLog.ts` 의 순수 모델에서만
 * 나오므로 화면이 로그를 지어내지 않는다(정지 상태에서는 멈춰 있는 것이 정상).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TwinStoreSnapshot } from '../data/twin/port';
import type { Lang } from '../data/twin/types';
import {
  LOG_CHANNELS,
  LOG_CHANNEL_LABEL,
  LOG_LEVELS,
  LOG_LEVEL_HEX,
  buildLogLines,
  filterLog,
  logClock,
  logCounts,
  type LogChannel,
  type LogLevel,
} from './flagLog';

export interface FlagLogTerminalProps {
  snapshot: TwinStoreSnapshot;
  lang: Lang;
}

export default function FlagLogTerminal({ snapshot, lang }: FlagLogTerminalProps) {
  const [level, setLevel] = useState<LogLevel | 'ALL'>('ALL');
  const [channel, setChannel] = useState<LogChannel | 'ALL'>('ALL');
  const [vin, setVin] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [hiddenBefore, setHiddenBefore] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const all = useMemo(() => buildLogLines(snapshot), [snapshot]);
  const counts = useMemo(() => logCounts(all), [all]);
  const vins = useMemo(() => Array.from(new Set(all.map((l) => l.vin))).sort(), [all]);

  const shown = useMemo(
    () => filterLog(all, { level, channel, vin, query, afterSeq: hiddenBefore }, lang),
    [all, level, channel, vin, query, hiddenBefore, lang],
  );

  const tail = shown.length ? shown[shown.length - 1].seq : hiddenBefore;
  useEffect(() => {
    if (!follow) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [follow, tail, shown.length]);

  const running = snapshot.clock.rate > 0;
  const filtered = level !== 'ALL' || channel !== 'ALL' || vin !== 'ALL' || !!query.trim();

  return (
    <section className="flaglog" data-testid="flaglog" aria-label="Feature Flag 데이터 로그">
      <header className="flaglog-head">
        <div className="flaglog-title">
          <span className={`flaglog-dot${running ? ' is-live' : ''}`} aria-hidden="true" />
          <b>feature-flag-stream</b>
          <span className="flaglog-muted">
            {running ? `LIVE ${snapshot.clock.rate}×` : 'PAUSED'} · sim_tick {snapshot.clock.simTick} · rev{' '}
            {snapshot.revision}
          </span>
        </div>
        <div className="flaglog-tools">
          <div className="flaglog-chips" role="group" aria-label="레벨 필터">
            <button
              type="button"
              className={`flaglog-chip${level === 'ALL' ? ' is-on' : ''}`}
              aria-pressed={level === 'ALL'}
              onClick={() => setLevel('ALL')}
            >
              ALL {counts.total}
            </button>
            {LOG_LEVELS.map((lv) => (
              <button
                key={lv}
                type="button"
                className={`flaglog-chip${level === lv ? ' is-on' : ''}`}
                aria-pressed={level === lv}
                style={level === lv ? { borderColor: LOG_LEVEL_HEX[lv], color: LOG_LEVEL_HEX[lv] } : undefined}
                onClick={() => setLevel(lv)}
              >
                {lv}
              </button>
            ))}
          </div>
          <select
            className="flaglog-select"
            aria-label="채널 필터"
            value={channel}
            onChange={(e) => setChannel(e.target.value as LogChannel | 'ALL')}
          >
            <option value="ALL">채널 전체</option>
            {LOG_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {LOG_CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
          <select
            className="flaglog-select"
            aria-label="VIN 필터"
            value={vin}
            onChange={(e) => setVin(e.target.value)}
          >
            <option value="ALL">VIN 전체</option>
            {vins.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <input
            className="flaglog-input"
            type="search"
            aria-label="로그 검색"
            placeholder="grep 문자열"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={`flaglog-btn${follow ? ' is-on' : ''}`}
            aria-pressed={follow}
            onClick={() => setFollow((f) => !f)}
          >
            자동 스크롤
          </button>
          <button type="button" className="flaglog-btn" onClick={() => setHiddenBefore(tail)}>
            clear
          </button>
        </div>
      </header>

      <div className="flaglog-src">
        <span>datasource=VehicleStatePort.journal + vehicles[].auditTrail</span>
        <span>sim_time={snapshot.clock.simTimeMs ? new Date(snapshot.clock.simTimeMs).toISOString() : '-'}</span>
        <span>
          {filtered ? `filtered ${shown.length}/${counts.total}` : `lines ${counts.total}`} · error {counts.error} ·
          warn {counts.warn}
        </span>
        {!running ? <span className="flaglog-paused">정지 상태 — 재생 또는 +5s 를 누르면 라인이 계속 흐릅니다</span> : null}
      </div>

      <div className="flaglog-body" role="log" aria-live="off" ref={bodyRef} data-testid="flaglog-body">
        {shown.length === 0 ? (
          <p className="flaglog-empty">
            {counts.total === 0
              ? '아직 발행된 이벤트가 없습니다. 재생을 시작하세요.'
              : '필터에 맞는 라인이 없습니다. 필터를 초기화하거나 clear 이후 새 라인을 기다리세요.'}
          </p>
        ) : (
          shown.map((l) => (
            <p className="flaglog-row" data-testid="flaglog-row" key={l.id}>
              <span className="flaglog-seq">{String(l.seq).padStart(5, '0')}</span>
              <span className="flaglog-time">{logClock(l.at)}</span>
              <span className="flaglog-level" style={{ color: LOG_LEVEL_HEX[l.level] }}>
                {l.level.padEnd(5)}
              </span>
              <span className="flaglog-chan">{LOG_CHANNEL_LABEL[l.channel]}</span>
              <span className={`flaglog-vin${l.scope === 'FLEET' ? ' is-fleet' : ''}`}>{l.vin}</span>
              <span className="flaglog-event">{l.event.replace(/^twin\./, 'vehicle-state.')}</span>
              <span className="flaglog-msg">{l.message[lang]}</span>
              {l.detail ? <span className="flaglog-detail">{l.detail}</span> : null}
            </p>
          ))
        )}
      </div>
    </section>
  );
}
