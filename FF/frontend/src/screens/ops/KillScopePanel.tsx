import { useUiLocale } from '../../locale/react';
// 차단 대상 범위(FR-KSW-001-002)·Variant 조건 확인(002-003)·영향 차량 그룹(003-001) — 새 차단 요청 폼 안의 패널.
// 범위는 미리보기 차량의 속성으로 화면에서 거른다(정적 시연도 같은 결과). 요청에는 범위와 고른 차량을 함께 보내 서버가 다시 확인한다.
import { impactGroups, KILL_SCOPE_KINDS, scopeMatches, type KillScopeFilter, type KillScopeKind } from '../../../../contracts/src/rules/kill-scope';
import { killScope as S } from '../../copy/kill-scope';
import { DataTable, Select } from '../../design';

export interface ScopeRow {
  vin: string;
  country: string;
  vehicleModel: string;
  trim: string;
  upgVc: string;
  swVersion: string;
  verdict?: string;
}
export interface VariantRuleView {
  country: string;
  vehicleModel: string;
  trim: string;
  upgVc: string[];
  requiredSw: string | null;
}

const FIELD: Record<KillScopeKind, keyof ScopeRow> = { countries: 'country', vehicleModels: 'vehicleModel', trims: 'trim', upgVcs: 'upgVc', swVersions: 'swVersion' };

/** 범위에 드는 차량 — 범위 칸이 없으면 전부 */
export const scopedRows = <T extends ScopeRow>(rows: readonly T[], scope: KillScopeFilter): T[] => rows.filter((r) => scopeMatches(scope, r));

export function KillScopePanel({ rows, rule, scope, onScope }: { rows: readonly ScopeRow[]; rule?: VariantRuleView | null; scope: KillScopeFilter; onScope: (s: KillScopeFilter) => void }) {
  useUiLocale();
  const kept = scopedRows(rows, scope);
  const groups = impactGroups(kept.map((r) => ({ ...r, verdict: r.verdict ?? 'UNKNOWN' })));
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: 0 }} data-testid="kill-scope">
      <span className="ds-field__label">{S.title}</span>
      <div className="ds-form-grid">
        {KILL_SCOPE_KINDS.map((k) => {
          const values = [...new Set(rows.map((r) => String(r[FIELD[k]])))].sort();
          return (
            <Select
              key={k}
              label={S.kinds[k]}
              value={scope[k]?.[0] ?? ''}
              onChange={(e) => {
                const { [k]: _drop, ...rest } = scope;
                onScope(e.target.value ? { ...rest, [k]: [e.target.value] } : rest);
              }}
            >
              <option value="">{S.all}</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          );
        })}
      </div>
      <p className="ds-field__hint">{S.hint}</p>
      {rule && (
        <p className="ds-field__hint" data-testid="kill-variant-rule">
          {S.variantRule}: {S.variantRuleText(rule.country, rule.vehicleModel, rule.trim, rule.upgVc.join(', '), rule.requiredSw)}
        </p>
      )}
      <DataTable
        caption={S.groups}
        rows={groups}
        rowKey={(g) => g.key}
        columns={[
          { key: 's', header: S.col.scope, cell: (g) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`${g.country} · ${g.vehicleModel} · ${g.trim} · ${g.upgVc} · SW ${g.swVersion}`}</span> },
          { key: 'n', header: S.col.vehicles, cell: (g) => <span className="ds-mono">{g.vins.length}</span> },
          { key: 'v', header: S.col.verdict, cell: (g) => Object.entries(g.verdicts).map(([v, n]) => `${S.verdict[v] ?? v} ${n}`).join(' · ') },
        ]}
      />
    </div>
  );
}

/** 관련 담당자(FR-KSW-003-002) — Feature Owner·요청자·승인자·협력사(구현 SW 납품 정보) */
export interface PartiesView {
  owner: string | null;
  requester: string;
  approvers: string[];
  suppliers: { supplier: string; swId: string; version: string }[];
}
export function KillParties({ p, person }: { p: PartiesView; person: (id: string) => string }) {
  useUiLocale();
  const rows = [
    { k: S.partyCol.owner, v: p.owner ?? '—' },
    { k: S.partyCol.requester, v: person(p.requester) },
    { k: S.partyCol.approvers, v: p.approvers.map(person).join(', ') || '—' },
    { k: S.partyCol.suppliers, v: p.suppliers.map((s) => S.supplierText(s.supplier, s.swId, s.version)).join(' / ') || '—' },
  ];
  return (
    <DataTable
      caption={S.parties}
      rows={rows}
      rowKey={(r) => r.k}
      columns={[
        { key: 'k', header: S.parties, cell: (r) => r.k },
        { key: 'v', header: S.partyWho, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.v}</span> },
      ]}
    />
  );
}
