// 기준 행 → Feature 등록 칸 미리 채움(30-95 §6.3, D-REF-4). 화면과 시험이 같은 함수를 쓴다.
//   name ← nameKo · description ← definition.summary(없으면 nameEn) · asil ← asilRep
//   tags ← domain·component·swStack·lifecycle·vehicleType·region · refRegulations ← definition.regulations·sourceDetail(요구사항 ID와 따로)
import type { Asil, FeatureRefRole, RefStatus } from '@ff/contracts';

/** 등록 화면이 쓰는 기준 행 필드(검색·상세 응답의 일부) — 금액 필드는 서버가 뺀다 */
export interface RefLite {
  refId: string;
  status: RefStatus;
  replacedBy?: string | null;
  domain: string;
  cluster?: string;
  component: string;
  swStack?: string;
  lifecycle?: string;
  vehicleType?: string;
  region?: string;
  nameEn: string;
  nameKo: string;
  aliases?: string[];
  asilRep: Asil;
  tshirt: string;
  sourceDetail?: string;
  adminMemo?: string;
  definition?: { summary?: string | null; regulations?: string | null } | null;
}

export interface PickedRef {
  ref: RefLite;
  role: FeatureRefRole;
}

export interface Prefill {
  name: string;
  description: string;
  asil: Asil;
  tags: string;
}

const uniq = (xs: string[]) => [...new Set(xs)];
/** 쉼표 목록 → 값 배열(빈 값 제거) */
export const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
/** 태그 비교 — 순서·공백 무시 */
export const sameList = (a: string, b: string) => list(a).sort().join('\u0000') === list(b).sort().join('\u0000');

export function tagsOf(r: RefLite): string[] {
  // 태그 칸은 쉼표로 나누므로 값 안의 쉼표는 공백으로 바꾼다
  return uniq([r.domain, r.component, r.swStack, r.lifecycle, r.vehicleType, r.region].map((x) => (x ?? '').replace(/,/g, ' ').trim()).filter(Boolean)).map((x) => x.slice(0, 80));
}

/** 규제·표준 조항 — '·'·';'로 이어 쓴 엑셀 값을 나눈다. 요구사항 ID가 아니다 */
export function regulationsOf(r: RefLite): string[] {
  const parts = [r.definition?.regulations ?? '', r.sourceDetail ?? ''].flatMap((s) => s.split(/\s+·\s+|;\s*/));
  return uniq(parts.map((x) => x.trim()).filter(Boolean)).map((x) => x.slice(0, 500));
}

export function prefillOf(r: RefLite): Prefill {
  return {
    name: r.nameKo.slice(0, 200),
    description: (r.definition?.summary?.trim() || r.nameEn).slice(0, 2000),
    asil: r.asilRep,
    tags: tagsOf(r).join(', '),
  };
}

export const primaryOf = (picked: PickedRef[]) => picked.find((p) => p.role === 'PRIMARY')?.ref ?? null;
