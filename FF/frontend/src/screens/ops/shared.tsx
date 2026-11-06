// 배포·차단 전달 화면 공용 — 회신 진행 막대, 게시본 상태 배지, 회신 대기 시간, 승인자 이름
import { ko } from '../../copy/ko';
import { control as CT } from '../../copy/control';
import { DEMO_ACCOUNTS } from '../../data/demoAccounts';
import { VerdictBadge } from '../../design';

export interface Delivery {
  publicationId: string;
  status: string;
  confirmed: number;
  denominator: number;
  deadlineAt?: string;
  closedAt?: string | null;
  nodes: { nodeId: string; state: string; reason: string }[];
  ackOnly?: string[];
}

/** 게시본 상태 → 공통 판정 배지 */
export const PUB_VERDICT: Record<string, string> = { SIGNED: '미판정', DISPATCHED: '검토 중', CONFIRMED: 'PASS', PARTIAL: 'CONDITIONAL', TIMEOUT: 'FAIL', DIVERGED: 'FAIL' };

/** 게시본 상태 이름 — 화면은 한국어(P4-10 한·영 혼용 제거), 원래 값은 툴팁 */
export const pubStatusLabel = (status: string) => CT.pub.status[status] ?? status;

export function PubStatus({ status }: { status: string }) {
  return <VerdictBadge value={PUB_VERDICT[status] ?? '미판정'} label={pubStatusLabel(status)} />;
}

/** Evidence 화면 이름 — 데이터셋 원본 ID(SAMPLE-EV-000190-TEST-RESULT)는 '시험 결과 보고서 EV-000190'. 모르는 모양은 그대로 */
export const evidenceLabel = (ref: string) => {
  const m = /^SAMPLE-EV-(\d+)-([A-Z][A-Z-]*)$/.exec(ref);
  return m && CT.evidenceKind[m[2]] ? CT.evidenceName(CT.evidenceKind[m[2]], m[1]) : ref;
};

/** 차량 노드 상태·사유 이름 */
export const nodeStateLabel = (state: string) => CT.pub.node[state] ?? state;
export const nodeReasonLabel = (reason: string) => {
  const [code, detail] = reason.split(':');
  const base = CT.pub.reason[code] ?? code;
  return detail ? `${base} · ${detail}` : base;
};

/** 회신을 기다린 분 — 게시본이 아직 닫히지 않았으면 만든 때부터 지금까지 */
export const waitedMinutes = (createdAt: string, now = Date.now()) => Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));

/** 승인자·요청자 표시 이름 — 데모 계정은 이름(담당), 그 밖은 회사 계정 ID(내부 데모 ID는 보이지 않는다) */
export function personLabel(id: string): string {
  const a = DEMO_ACCOUNTS.find((x) => x.id === id);
  if (a) return `${a.name}(${a.label})`;
  return id.startsWith('usr-') ? CT.approval.someone : id;
}

export function Progress({ d }: { d: Pick<Delivery, 'status' | 'confirmed' | 'denominator'> | null | undefined }) {
  if (!d) return <span className="ds-mono">—</span>;
  const pct = d.denominator ? Math.round((d.confirmed / d.denominator) * 100) : 100;
  return (
    <div className="ds-progress" data-status={d.status} role="meter" aria-label={ko.fleet.progress} aria-valuemin={0} aria-valuemax={d.denominator} aria-valuenow={d.confirmed}>
      <div className="ds-progress__track">
        <div className="ds-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span title={d.status}>
        {d.confirmed}/{d.denominator} · {pubStatusLabel(d.status)}
      </span>
    </div>
  );
}
