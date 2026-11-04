// Feature 등록 시험용 Feature DB 연결(30-95 D-REF-3: 등록 때 연결 필수).
// 같은 국가·차종·트림에 같은 대표 기준 행을 두 번 쓰면 409(D-REF-13)라, ASIL마다 활성 기준 행을 차례로 돌려준다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Asil, FeatureRefRow } from '@ff/contracts';

const REFS = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'reference', 'feature-db', 'v1.3', 'refs.json'), 'utf8')) as FeatureRefRow[];
const BY_ASIL = new Map<string, string[]>();
for (const r of REFS) if (r.status === 'ACTIVE') (BY_ASIL.get(r.asilRep) ?? BY_ASIL.set(r.asilRep, []).get(r.asilRep)!).push(r.refId);
const next = new Map<string, number>();

/** 이 ASIL을 대표 ASIL로 가진 활성 기준 행 하나 — 부를 때마다 다른 행 */
export function refFor(asil: Asil = 'QM'): string {
  const ids = BY_ASIL.get(asil)!;
  const i = next.get(asil) ?? 0;
  next.set(asil, i + 1);
  return ids[i % ids.length];
}

/** 생성 본문에 펼쳐 넣는 연결 — `{ ...body, ...featureRefs('B') }` */
export const featureRefs = (asil: Asil = 'QM') => ({ featureRefs: [{ refId: refFor(asil), role: 'PRIMARY' as const }] });
