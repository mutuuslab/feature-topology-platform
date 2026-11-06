// ADS 상태 화면 핵심 메시지 — 탭마다 하나(P-10), 큰 값 하나(P-11). 화면 묶음이 가볍게 부품(StatePanels)과 나눠 둔다.
import { type ConvergenceView, type CustomerStateView, type FleetAxisView, type OrdersView, type VehicleFeatureStateView, type VehicleVerdictsView } from '@ff/contracts';
import { reasonLabel, VERDICT_ACTION_LABEL, VERDICT_LABEL } from '../../../../contracts/src/rules/ads-state';
import { axesTab, convergence as CV, customerTab, fleetAxes as FA, orders as OR, verdictsTab } from '../../copy/ads-state';

type Tone = 'ok' | 'warn' | 'danger' | 'neutral';
export interface KeySpec {
  tone: Tone;
  value?: string | number;
  text: string;
}

/** 상대 시간(분·시간·일 전) — design/ads relAgo와 같은 규칙(화면 묶음에 부품 CSS를 끌어오지 않게 따로) */
export function ago(at: string | null | undefined, now: number = Date.now()): string {
  if (!at) return '—';
  const m = Math.round(Math.max(0, now - Date.parse(at)) / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

/** 차량 '상태(6축)' — 현재 상태 미확인 기능 수, 그중 가장 최근 차량 보고 */
export function vehicleStateMessage(v: VehicleFeatureStateView | undefined, now = Date.now()): KeySpec {
  if (!v || !Array.isArray(v.features)) return { tone: 'neutral', value: '—', text: axesTab.key.loading };
  const un = v.features.filter((f) => f.freshness.state !== 'FRESH');
  if (!un.length) return { tone: 'ok', text: axesTab.key.clean(v.features.length) };
  const last = un.map((f) => f.freshness.observedAt).filter((x): x is string => !!x).sort().at(-1);
  return { tone: 'warn', value: un.length, text: axesTab.key.unconfirmed(un.length, last ? ago(last, now) : axesTab.key.noReport) };
}

/** 차량 '판정' — 활성화 판정 하나(거부 > 판단 불가 > 허용), 보고가 기준 시간을 넘겼으면 미확인 */
export function verdictsMessage(v: VehicleVerdictsView | undefined, now = Date.now()): KeySpec {
  if (!v || !Array.isArray(v.items)) return { tone: 'neutral', value: '—', text: verdictsTab.key.none };
  const rank = (x: VehicleVerdictsView['items'][number]) => (x.stale ? 3 : x.verdict === 'DENY' ? 0 : x.verdict === 'UNKNOWN' ? 1 : 2) * 10 + (x.action === 'ACTIVATE' ? 0 : 1);
  const top = [...v.items].sort((a, b) => rank(a) - rank(b))[0];
  if (!top) return v.unreported?.length ? { tone: 'warn', text: verdictsTab.key.unreported(v.unreported.length) } : { tone: 'neutral', text: verdictsTab.key.none };
  const action = VERDICT_ACTION_LABEL[top.action];
  if (top.stale) return { tone: 'warn', text: verdictsTab.key.stale(action, ago(top.observedAt, now)) };
  return { tone: top.verdict === 'ALLOW' ? 'ok' : 'warn', text: verdictsTab.key.verdict(action, VERDICT_LABEL[top.verdict], reasonLabel(top.reasonCodes[0]), ago(top.observedAt, now)) };
}

/** 차량 '고객에게 보이는 상태' — 첫 기능의 고객 문구(미확인이면 그 한 줄) */
export function customerMessage(v: CustomerStateView | undefined): KeySpec {
  const f = Array.isArray(v?.features) ? v.features[0] : undefined;
  if (!f) return { tone: 'neutral', value: v ? undefined : '—', text: customerTab.empty.title };
  return { tone: f.unconfirmedLine ? 'warn' : 'neutral', text: customerTab.key(f.unconfirmedLine ?? f.answers.canUse.text) };
}

/** 배포 상세 — 적용 확인 안 된 차량 N대(= 대상 − 적용 확인) */
export function convergenceMessage(c: ConvergenceView | undefined): KeySpec {
  if (!c) return { tone: 'neutral', value: '—', text: CV.key(0, 0) };
  if (c.total === 0) return { tone: 'neutral', text: CV.empty };
  if (c.notApplied === 0) return { tone: 'ok', text: CV.keyAll(c.total) };
  return { tone: 'warn', value: c.notApplied, text: CV.key(c.notApplied, c.total) };
}

/** Fleet — 고른 Feature의 실제 실행 미확인 차량 */
export function fleetAxesMessage(v: FleetAxisView | undefined): KeySpec {
  if (!v || !Array.isArray(v.features)) return { tone: 'neutral', value: '—', text: FA.keyNone };
  const s = v.selected;
  if (!s) return { tone: 'neutral', text: FA.keyNone };
  return { tone: s.unconfirmedRuntime ? 'warn' : 'neutral', value: s.unconfirmedRuntime, text: FA.key(s.unconfirmedRuntime, s.name, Math.round(s.staleAfterMs / 60_000)) };
}

/** 주문 추적 — 기한 넘긴 사용 준비 미확인 주문 N건 */
export function ordersMessage(v: OrdersView | undefined): KeySpec {
  if (!v || !Array.isArray(v.items)) return { tone: 'neutral', value: '—', text: OR.key(0, 24) };
  return { tone: v.overdueUnready ? 'warn' : 'neutral', value: v.overdueUnready, text: OR.key(v.overdueUnready, Math.round(v.deadlineMs / 3600_000)) };
}
