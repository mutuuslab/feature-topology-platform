// v2 화면 공용 조각 — 작은 Gate 점열, 범위 표기, 시각 표기, 역할 안내.
import type { CSSProperties, ReactNode } from 'react';
import { COMPONENTS, GATES, INTERFACES, ROLE_LABEL, ROLES, type Role } from '@ff/contracts';
import { canAct } from '../api/actor';
import { STATIC_MODE } from '../api/client';
import { ko } from '../copy/ko';
import { ExplainCodes, StatusGlyph, VerdictBadge, gateKind } from '../design';
import { useAppShell } from '../store';

/** G1~G9 판정을 점 9개로 — 표 안에서 쓰는 축약형 */
export function MiniGates({ gates }: { gates: Record<string, string | null | undefined> }) {
  return (
    <span className="ds-mini-gates" aria-label={GATES.map((g) => `${g} ${ko.gate[gateKind(gates[g])]}`).join(', ')}>
      {GATES.map((g) => {
        const k = gateKind(gates[g]);
        return (
          <span key={g} title={`${g} ${ko.gate[k]}`} style={{ color: `var(--gate-${k})` } as CSSProperties}>
            <StatusGlyph kind={k} size={10} />
          </span>
        );
      })}
    </span>
  );
}

export const scopeOf = (x: { country: string; vehicleModel: string; trim: string }) => `${x.country} · ${x.vehicleModel} · ${x.trim}`;

/** 항목 안에서는 줄을 바꾸지 않고 구분자(·)에서만 바꾼다 — 좁은 열에서 'Calligraph / y'처럼 낱말이 잘리지 않게 */
export function Segments({ items, sep = ' · ' }: { items: string[]; sep?: string }) {
  return (
    <>
      {items.map((x, i) => (
        <span key={i}>
          {/* 구분자는 뒤 항목과 붙여 둔다 — '·'만 한 줄에 남던 줄바꿈(1366 Registry 적용 범위) 방지 */}
          {i > 0 && sep.startsWith(' ') && ' '}
          <span className="ds-nowrap">
            {i > 0 && sep.trimStart()}
            {x}
          </span>
        </span>
      ))}
    </>
  );
}

/** ISO 시각 → 'YYYY-MM-DD HH:MM' (KST 그대로 표기) */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 16)}`;
}

/** 현재 역할로 이 작업을 할 수 있는지와 안내 문구 */
export function usePermission(allowed: readonly Role[]) {
  const { role } = useAppShell();
  const ok = !STATIC_MODE && canAct(role, allowed);
  const hint = STATIC_MODE ? ko.page.readOnly : ok ? undefined : ko.page.noPermission(allowed.map((r) => ROLE_LABEL[r]).join(' · '));
  return { ok, hint, role };
}

/** 예외만 강조(UX3-02) — 충족이면 작은 표시(툴팁에 원문), 미충족만 배지 */
export function Done({ ok, title = 'PASS', otherwise }: { ok: boolean; title?: string; otherwise?: ReactNode }) {
  return ok ? (
    <span className="ds-done" role="img" title={title} aria-label={title}>
      <StatusGlyph kind="PASS" />
    </span>
  ) : (
    <>{otherwise ?? <VerdictBadge value="UNJUDGED" />}</>
  );
}

const COMPONENT_KO = new Map(COMPONENTS.map((c) => [c.id, c.ko]));
/** 컴포넌트 ID(D0x-xx) → 이름 — 본문은 이름, ID는 툴팁·설명 모드(UX3-01) */
export function ComponentName({ id }: { id: string }) {
  const name = COMPONENT_KO.get(id);
  if (!name) return <span className="ds-mono">{id}</span>;
  return (
    <span title={id}>
      {name}
      <ExplainCodes codes={[id]} />
    </span>
  );
}

/** 역할 enum(FEATURE_AUTHOR) → 한글 라벨, 모르는 값은 그대로 — 대문자 enum을 본문에 노출하지 않는다(UX3-02) */
export const roleText = (role: string | null | undefined) => (role && (ROLES as readonly string[]).includes(role) ? ROLE_LABEL[role as Role] : (role ?? '—'));

/** 컴포넌트 여러 개 — 이름을 ' · '로 잇는다(줄바꿈은 구분자에서) */
export function ComponentList({ ids }: { ids: readonly string[] }) {
  return (
    <span style={{ fontSize: 'var(--fs-xs)' }}>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ' · '}
          <ComponentName id={id} />
        </span>
      ))}
    </span>
  );
}

/** 인터페이스 ID(IF-xx) → 연계 이름 — ID는 툴팁·설명 모드(UX3-01) */
export function InterfaceName({ id }: { id: string }) {
  const name = INTERFACES[id];
  if (!name) return <span className="ds-tag">{id}</span>;
  return (
    <span className="ds-tag" title={id}>
      {name}
      <ExplainCodes codes={[id]} />
    </span>
  );
}
