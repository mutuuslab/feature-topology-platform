// Feature DB 발행 버전(30-95 §5.5·§8.2) — 다음 버전 번호, 전체 Feature DB 정규화 해시, 지난 발행 시점의 기준 행 다시 만들기.
// 발행 내용 = 요청 중(PENDING)이 아닌 모든 기준 행. 요청 중 행은 아직 발행되지 않은 추가 요청이라 해시·내보내기에 넣지 않는다.
// 해시 = sha256(키 정렬 JSON(refId 순 행 목록)) — 같은 내용이면 저장 순서·시각과 무관하게 같다.
// 참고: 첫 기동 가져오기 v1.3의 해시는 시드(refdb-seed)가 manifest.json 원문으로 정한다 — 이 정규화 해시와 비교하지 않는다.
import { canonicalJson, compareRelease, type FeatureRefRow, type RefChange, type RefRelease } from '@ff/contracts';
import { sha256hex } from '../../../kernel/crypto';
import { byChangeId } from './change-rules';

/** 발행 내용 — 요청 중 행을 빼고 refId 순 */
export const releaseRows = (rows: readonly FeatureRefRow[]): FeatureRefRow[] => rows.filter((r) => r.status !== 'PENDING').sort((a, b) => (a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0));

/** 전체 Feature DB 정규화 해시(64자 16진) */
export const refdbHash = (rows: readonly FeatureRefRow[]): string => sha256hex(canonicalJson(releaseRows(rows)));

/** 다음 발행 버전 — v1.3 → v1.4, v1.9 → v1.10. 발행 이력이 없으면 v1.0 */
export function nextReleaseId(latest: string | undefined): string {
  if (!latest) return 'v1.0';
  const m = /^v(\d+)\.(\d+)$/.exec(latest);
  if (!m) throw new Error(`발행 버전 형식이 아닙니다: ${latest}`);
  return `v${m[1]}.${Number(m[2]) + 1}`;
}

/**
 * 지난 발행(target) 시점의 기준 행 — 지금 행에서 target 뒤 발행들을 최신부터 거꾸로 되돌린다.
 * 발행만 기준 행을 바꾸고(승인된 변경은 발행 전까지 쓰지 않는다), 발행은 요청의 '전' 값이 지금 값과 같을 때만 적용하므로 되돌리기가 정확하다.
 *  · ADD(승인 → 새 행, 반려 → 요청 중 행을 폐기) — 그 발행 전에는 발행 내용에 없었다(없음·요청 중) → 뺀다
 *  · MODIFY·DEPRECATE·RETIRE — '전' 값을 다시 덮는다
 */
export function rowsAtRelease(current: readonly FeatureRefRow[], releases: readonly RefRelease[], changes: readonly RefChange[], target: string): FeatureRefRow[] {
  const byId = new Map(releaseRows(current).map((r) => [r.refId, { ...r }]));
  const changeOf = new Map(changes.map((c) => [c.changeId, c]));
  const later = releases.filter((r) => compareRelease(r.release, target) > 0).sort((a, b) => compareRelease(b.release, a.release));
  for (const rel of later) {
    for (const id of [...rel.changeIds].sort(byChangeId).reverse()) {
      const c = changeOf.get(id);
      if (!c) throw new Error(`발행 ${rel.release}의 변경 요청 ${id}이(가) 없습니다`);
      if (c.kind === 'ADD') byId.delete(c.refId);
      else {
        const row = byId.get(c.refId);
        if (row) byId.set(c.refId, { ...row, ...(c.before ?? {}) } as FeatureRefRow);
      }
    }
  }
  return releaseRows([...byId.values()]);
}
