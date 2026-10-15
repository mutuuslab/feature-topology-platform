// 종료·복원 이벤트 시간 기록 (보고서 v1.1 13장 · FFG-ADS-007·TEL-004·TEL-010) — 차량이 서명해 보낸 status_report v2(수신 검사 통과분)로
// 명령마다 다섯 시각을 재구성한다: 종료 수락, 비활성화 완료, MRC 도달(ADS만 — 이 플랫폼 기능은 해당 없음), 복원 수락, 복원 효력.
// 각 시각은 보고의 time_sync로 신뢰 여부를 표시하고, 신뢰 시간이 없으면 UNCERTAIN(30초 규칙 판정에서 보수적으로 — TEL-010).
// 원격 Kill과 차량 내 고장은 보고 reason.source(REMOTE·ONBOARD)로 구분하고 EDR 정합 상태를 함께 남긴다(TEL-004).

export interface TimelineReport {
  vin: string;
  state: string;
  request_result: string;
  vehicle_seq: number;
  observed_at: string;
  time_sync: string;
  edr_aligned_state: string;
  reason: { category: string; source: string };
}

export interface TimelineCommand {
  commandId: string;
  request: 'deactivate' | 'restore' | 'activate' | 'sync';
  vin: string;
  vehicleSeq: number;
}

export interface TimelinePoint {
  at: string;
  /** SYNCED만 신뢰 시간 — 그 밖(DEGRADED·UNKNOWN 등)은 불확실 */
  trust: 'TRUSTED' | 'UNCERTAIN';
  timeSync: string;
}

export interface KillTimeline {
  vin: string;
  deactivate: { commandId: string; accepted: TimelinePoint | null; completed: TimelinePoint | null; mrc: TimelinePoint | null; mrcApplicable: boolean } | null;
  restore: { commandId: string; accepted: TimelinePoint | null; effective: TimelinePoint | null } | null;
  /** 원격 Kill인가 차량 내 고장인가 — 차단 완료 보고의 reason.source */
  cause: 'REMOTE_KILL' | 'ONBOARD_FAULT' | 'UNKNOWN';
  edrAtCompletion: string | null;
  /** 30초 규칙 판정에 필요한 시각 중 신뢰 시간이 없는 것 */
  uncertain: string[];
}

const END_STATES = ['DISABLED', 'INACTIVE'];
const point = (r: TimelineReport): TimelinePoint => ({ at: r.observed_at, trust: r.time_sync === 'SYNCED' ? 'TRUSTED' : 'UNCERTAIN', timeSync: r.time_sync });

/**
 * 차량 한 대의 명령·보고 → 다섯 시각. 보고는 수신 검사를 통과한 것만 넘긴다(위조·재전송 제외).
 * @rule FFG-ADS-007, FFG-TEL-004, FFG-TEL-010 — 플랫폼 쪽 재구성·보존(명령 ID 연결). DSSAD 이벤트 자체·MRC 시각은 차량(ADS) 기록
 */
export function killTimeline(vin: string, commands: TimelineCommand[], reports: TimelineReport[], opts: { adsFeature: boolean }): KillTimeline {
  const mine = reports.filter((r) => r.vin === vin).sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const cmd = (req: TimelineCommand['request']) => commands.filter((c) => c.vin === vin && c.request === req).sort((a, b) => b.vehicleSeq - a.vehicleSeq)[0] ?? null;
  const de = cmd('deactivate');
  const re = cmd('restore');
  // 한 명령의 보고 = 그 명령 vehicle_seq를 실은 수락 보고와, 그 뒤 다음 명령 전까지의 단계 보고
  const after = (seq: number, until: number | null) => mine.filter((r) => r.vehicle_seq === seq || (r.vehicle_seq >= seq && (until == null || r.vehicle_seq < until)));
  const deR = de ? after(de.vehicleSeq, re && re.vehicleSeq > de.vehicleSeq ? re.vehicleSeq : null) : [];
  const reR = re ? after(re.vehicleSeq, null) : [];
  const acc = deR.find((r) => r.vehicle_seq === de?.vehicleSeq && r.request_result === 'ACCEPTED');
  const done = deR.find((r) => END_STATES.includes(r.state));
  const racc = reR.find((r) => r.vehicle_seq === re?.vehicleSeq && r.request_result === 'ACCEPTED');
  const eff = reR.find((r) => r.state === 'ACTIVE' && r.request_result !== 'REJECTED');
  const t: KillTimeline = {
    vin,
    deactivate: de ? { commandId: de.commandId, accepted: acc ? point(acc) : null, completed: done ? point(done) : null, mrc: null, mrcApplicable: opts.adsFeature } : null,
    restore: re ? { commandId: re.commandId, accepted: racc ? point(racc) : null, effective: eff ? point(eff) : null } : null,
    cause: !done ? 'UNKNOWN' : done.reason.source === 'REMOTE' ? 'REMOTE_KILL' : done.reason.source === 'ONBOARD' ? 'ONBOARD_FAULT' : 'UNKNOWN',
    edrAtCompletion: done?.edr_aligned_state ?? null,
    uncertain: [],
  };
  const named: [string, TimelinePoint | null | undefined][] = [
    ['종료 수락', t.deactivate?.accepted],
    ['비활성화 완료', t.deactivate?.completed],
    ['복원 수락', t.restore?.accepted],
    ['복원 효력', t.restore?.effective],
  ];
  t.uncertain = named.filter(([, p]) => p && p.trust === 'UNCERTAIN').map(([n]) => n);
  return t;
}
