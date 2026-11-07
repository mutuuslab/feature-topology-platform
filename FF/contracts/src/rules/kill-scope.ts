// 긴급 차단 범위·해제·사건 범위 규칙(P11a, D03-03·D03-04) — 화면·서버 공용 순수 규칙.
// · 차단 중 활성화 거부(FR-KSW-002-006): 긴급(안전·보안·규제·운영) 차단이 걸린 Feature는 새 배포(활성화)를 받지 않는다. 상업 차단(체험 만료 한 대)은 막지 않는다.
// · 차단 상태 차량(FR-KSW-004-004·007): 부분 복원한 차량은 차단에서 빠진다 — 나머지 차량만 차단 유지.
// · 해제 요청 확인 항목(FR-KSW-004-001·002): 차단 사유 해소·원인 조치 완료 둘 다 체크해야 요청을 만든다.
import { z } from 'zod';
import type { KillRequest } from '../schemas/ops';

/** 활성화를 막는 차단 사유 — 상업 사유(체험 만료 등 차량 한 대의 비활성화)는 기능 배포를 막지 않는다 */
export const ACTIVATION_BLOCKING_CATEGORIES = ['SAFETY', 'SECURITY', 'REGULATORY', 'OPERATIONAL'] as const;

type KillLike = Pick<KillRequest, 'killId' | 'featureId' | 'featureIds' | 'vins' | 'status' | 'reasonCategory' | 'restoredVins'>;

/** 아직 차단 중인 차량 — ACTIVE 차단의 차량에서 부분 복원한 차량을 뺀다 */
export function blockedVins(k: Pick<KillRequest, 'vins' | 'status' | 'restoredVins'>): string[] {
  if (k.status !== 'ACTIVE') return [];
  const done = new Set(k.restoredVins ?? []);
  return k.vins.filter((v) => !done.has(v));
}

/** 이 차량·Feature가 차단 중인가 — 대상 Feature(의존 포함)·남은 차단 차량 모두에 들어야 한다 */
export function isKilled(kills: readonly KillLike[], featureId: string, vin: string): boolean {
  return kills.some((k) => k.featureIds.includes(featureId) && blockedVins(k).includes(vin));
}

/** 활성화(배포)를 막는 차단 — 대상 Feature(의존 포함)에 걸린 ACTIVE 긴급 차단 중 남은 차량이 있는 것 */
export function activationBlockers(kills: readonly KillLike[], featureId: string): KillLike[] {
  return kills.filter(
    (k) => k.featureIds.includes(featureId) && (ACTIVATION_BLOCKING_CATEGORIES as readonly string[]).includes(k.reasonCategory ?? 'SAFETY') && blockedVins(k).length > 0,
  );
}

/** 활성화 거부 문구 — 긴급 차단 상태임을 포함한다(FR-KSW-002-006) */
export function activationBlockedMessage(featureId: string, blockers: readonly Pick<KillRequest, 'killId'>[]): string {
  return `${featureId}은(는) 긴급 차단 상태라 활성화할 수 없습니다 (${blockers.map((b) => b.killId).join(', ')}) — 복원 승인으로 차단을 해제한 뒤 배포하세요.`;
}

/** 해제 요청 확인 항목 — 둘 다 체크해야 요청을 만든다(FR-KSW-004-002) */
export const RESTORE_CHECKS = ['resolved', 'causeFixed'] as const;
export type RestoreCheck = (typeof RESTORE_CHECKS)[number];
export const RESTORE_CHECK_LABEL: Record<RestoreCheck, string> = { resolved: '차단 사유 해소', causeFixed: '원인 조치 완료' };

/** 체크하지 않은 확인 항목 */
export function missingRestoreChecks(body: Partial<Record<RestoreCheck, boolean | undefined>>): RestoreCheck[] {
  return RESTORE_CHECKS.filter((c) => body[c] !== true);
}

// ─── 차단 대상 범위(FR-KSW-001-002) · Variant 조건 확인(002-003) · 영향 차량 그룹(003-001) ───
// Variant Rule은 독립 엔티티가 아니다(결정 D8) — Feature의 Variant 조건(국가·차종·트림·UPG-VC)과 지원 조건(요구 SW Version)으로 대응한다.
// 생산 지역 코드는 지역 코드 대응 표(분류 체계 묶음)가 생긴 뒤 이 범위에 더한다.

const list = z.array(z.string().trim().min(1).max(60)).max(500);
/** 차단 대상 범위 — 비우면 전체(영향 범위의 모든 차량). 여러 칸을 주면 모두 맞는 차량만 */
export const KillScopeFilter = z
  .object({ countries: list.optional(), vehicleModels: list.optional(), trims: list.optional(), upgVcs: list.optional(), swVersions: list.optional() })
  .strict();
export type KillScopeFilter = z.infer<typeof KillScopeFilter>;

export const KILL_SCOPE_KINDS = ['countries', 'vehicleModels', 'trims', 'upgVcs', 'swVersions'] as const;
export type KillScopeKind = (typeof KILL_SCOPE_KINDS)[number];
export const KILL_SCOPE_LABEL: Record<KillScopeKind | 'all' | 'vins', string> = {
  all: '전체',
  countries: '적용 지역',
  vehicleModels: '차종',
  trims: '트림',
  upgVcs: 'Variant 조건(UPG-VC)',
  swVersions: 'SW 버전',
  vins: 'VIN',
};

export interface KillScopeVehicle {
  vin: string;
  country: string;
  vehicleModel: string;
  trim: string;
  upgVc: string;
  swVersion: string;
}
const FIELD: Record<KillScopeKind, keyof KillScopeVehicle> = { countries: 'country', vehicleModels: 'vehicleModel', trims: 'trim', upgVcs: 'upgVc', swVersions: 'swVersion' };

/** 쓰인 범위 칸 — 하나도 없으면 전체 */
export function scopeKinds(f: KillScopeFilter | null | undefined): KillScopeKind[] {
  return KILL_SCOPE_KINDS.filter((k) => !!f?.[k]?.length);
}

/** 차량이 범위에 드는가 — 준 칸마다 그 값 목록에 들어야 한다 */
export function scopeMatches(f: KillScopeFilter | null | undefined, v: KillScopeVehicle): boolean {
  return scopeKinds(f).every((k) => f![k]!.includes(String(v[FIELD[k]])));
}

/** 영향 차량 그룹 — 범위 유형(지역·차종·트림·Variant 조건·SW 버전)이 같은 차량을 묶고, Variant 판정 분포를 센다 */
export interface ImpactGroup {
  key: string;
  country: string;
  vehicleModel: string;
  trim: string;
  upgVc: string;
  swVersion: string;
  vins: string[];
  verdicts: Record<string, number>;
}
export function impactGroups(rows: readonly (KillScopeVehicle & { verdict: string })[]): ImpactGroup[] {
  const by = new Map<string, ImpactGroup>();
  for (const r of rows) {
    const key = [r.country, r.vehicleModel, r.trim, r.upgVc, r.swVersion].join('/');
    const g = by.get(key) ?? { key, country: r.country, vehicleModel: r.vehicleModel, trim: r.trim, upgVc: r.upgVc, swVersion: r.swVersion, vins: [], verdicts: {} };
    g.vins.push(r.vin);
    g.verdicts[r.verdict] = (g.verdicts[r.verdict] ?? 0) + 1;
    by.set(key, g);
  }
  return [...by.values()].sort((a, b) => b.vins.length - a.vins.length || a.key.localeCompare(b.key));
}

// ─── 관련 담당자(FR-KSW-003-002) ───
export interface KillParties {
  owner: string | null;
  requester: string;
  approvers: string[];
  /** 협력사 — 대상 Feature 구현 SW의 납품 정보(IF-08) */
  suppliers: { supplier: string; swId: string; version: string; ecuPno: string | null }[];
}
