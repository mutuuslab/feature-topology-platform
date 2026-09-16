// Unleash/OSS 검토 항목(UL-xxx)을 **운영 규칙 행**으로 보여주는 공통 부품.
//
// 검토 문서를 옮겨 적지 않는다 — 각 행은 규칙, 현재 값, 판정, 근거만 담는다.
// 판정이 FAIL/WARN 이면 그 규칙이 막는 동작이 화면에서 비활성으로 남아야 한다.
import { type ReactNode } from 'react';
import { Table } from './AreaScreen';

export type UlVerdict = 'PASS' | 'WARN' | 'FAIL';

export interface UlRule {
  /** UL-xxx 검토 항목 ID — 화면이 담당하는 항목만 적는다. */
  ul: string;
  /** 운영 규칙 한 줄 (도구 용어가 아니라 업무 판단 기준) */
  rule: string;
  verdict: UlVerdict;
  /** 판정 근거 — 실제 값·해시·대상 수 */
  evidence: string;
}

export const UL_TONE: Record<UlVerdict, string> = {
  PASS: 'var(--pass)',
  WARN: 'var(--pending)',
  FAIL: 'var(--fail)',
};

export function UlBadge({ ul, verdict }: { ul: string; verdict?: UlVerdict }) {
  return (
    <span className="mono small" title={ul} style={{ color: verdict ? UL_TONE[verdict] : 'var(--muted)' }}>{ul}</span>
  );
}

/** 판정 요약 — 통과/주의/차단 건수. */
export function UlTally({ items }: { items: UlRule[] }) {
  const n = (v: UlVerdict) => items.filter(i => i.verdict === v).length;
  return (
    <div className="row small" style={{ gap: 10, flexWrap: 'wrap' }}>
      <span><b>검토 항목</b> {items.length}</span>
      <span style={{ color: 'var(--pass)' }}>통과 {n('PASS')}</span>
      <span style={{ color: 'var(--pending)' }}>주의 {n('WARN')}</span>
      <span style={{ color: 'var(--fail)' }}>차단 {n('FAIL')}</span>
      <span className="muted">차단 항목은 해당 실행 버튼의 사유로 쓰인다</span>
    </div>
  );
}

/** 검토 항목 표 — 규칙 · 판정 · 근거. */
export function UlRules({ items, title, empty }: { items: UlRule[]; title?: ReactNode; empty?: string }) {
  if (items.length === 0) return <p className="small muted">{empty || '이 화면에 배정된 검토 항목이 없다.'}</p>;
  return (
    <div>
      {title && <div className="small muted" style={{ marginBottom: 6 }}>{title}</div>}
      <Table head={['검토 항목', '운영 규칙', '판정', '근거']}>
        {items.map(i => (
          <tr key={i.ul}>
            <td className="mono small">{i.ul}</td>
            <td>{i.rule}</td>
            <td style={{ color: UL_TONE[i.verdict], fontWeight: 600 }}>{i.verdict}</td>
            <td className="small muted">{i.evidence}</td>
          </tr>
        ))}
      </Table>
      <div className="mt"><UlTally items={items} /></div>
    </div>
  );
}

/** 차단 사유만 모아 주는 도우미 — Gated 버튼의 reasons 로 그대로 넘긴다. */
export const ulBlocks = (items: UlRule[]): string[] =>
  items.filter(i => i.verdict === 'FAIL').map(i => `${i.ul} ${i.rule}`);

export const ulWarns = (items: UlRule[]): string[] =>
  items.filter(i => i.verdict === 'WARN').map(i => `${i.ul} ${i.rule}`);
