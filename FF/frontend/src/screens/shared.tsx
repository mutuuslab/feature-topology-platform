// v2 화면 공용 조각 — 작은 Gate 점열, 범위 표기, 시각 표기, 역할 안내.
import type { CSSProperties } from 'react';
import { GATES, ROLE_LABEL, type Role } from '@ff/contracts';
import { canAct } from '../api/actor';
import { STATIC_MODE } from '../api/client';
import { ko } from '../copy/ko';
import { StatusGlyph, gateKind } from '../design';
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
