// Feature DB 품질 지표(30-95 §8.4, 엑셀 15_DB운영 4절) — Feature DB 화면 머리. 순수 함수: 서버 응답과 화면 계산이 같다.
import { REF_STATUSES, type FeatureRefRow, type RefChange, type RefRelease, type RefStatus } from '../../schemas/refdb';

/** 근거 확인 뒤 정기 점검 대상이 되는 기간(엑셀: 12개월) */
export const EVIDENCE_STALE_MONTHS = 12;

export interface RefQuality {
  total: number;
  byStatus: Record<RefStatus, number>;
  /** 상태 미입력 — 0이어야 한다 */
  statusMissing: number;
  /** 출처 ID 없는 행 — 0이어야 한다 */
  noSource: number;
  /** 최종 근거 확인일이 12개월 지난 행(확인일 없는 행 포함) */
  evidenceStale: number;
  /** 규모 근거 D(작성자 판단) 비중 0~1 — 사내 실적(B)으로 바꿔 갈 대상 */
  sizeGradeDShare: number;
  /** 발행 대기 — 승인됐지만 아직 발행되지 않은 변경 요청 */
  awaitingPublish: number;
  /** 진행 중 — 작성·검토 중인 변경 요청 */
  openChanges: number;
  /** 최신 발행 버전(없으면 null) */
  latestRelease: string | null;
  /** 발행본 행 수 — 요청 중(PENDING)을 뺀 행(폐기 포함, 발행 해시·내보내기와 같은 범위) */
  published: number;
  /** 요청 중 행 — 아직 발행되지 않은 추가 요청 */
  pending: number;
  /** 속성 미입력 — 발행본(폐기 제외)에서 SW 계층·수명주기·기술 영역 중 빈 칸이 있는 행 */
  attrMissing: number;
}

/** 분류 속성(엑셀 E·H·I) — 추가 요청이 비워 두면 발행 때 '검토 필요'로 들어간다(P5-8) */
export const REF_ATTR_FIELDS = ['swStack', 'lifecycle', 'techStack'] as const;
export const refAttrMissing = (r: Pick<FeatureRefRow, (typeof REF_ATTR_FIELDS)[number]>) => REF_ATTR_FIELDS.some((k) => !String(r[k] ?? '').trim());

const monthsBefore = (iso: string, months: number) => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
};

/** 발행 버전 비교 — v1.3 < v1.10 */
export function compareRelease(a: string, b: string): number {
  const [am, an] = a.replace(/^v/, '').split('.').map(Number);
  const [bm, bn] = b.replace(/^v/, '').split('.').map(Number);
  return (am ?? 0) - (bm ?? 0) || (an ?? 0) - (bn ?? 0);
}

export function refQuality(rows: readonly FeatureRefRow[], releases: readonly RefRelease[], changes: readonly RefChange[], now: string): RefQuality {
  const byStatus = Object.fromEntries(REF_STATUSES.map((s) => [s, 0])) as Record<RefStatus, number>;
  let statusMissing = 0;
  for (const r of rows) {
    if ((REF_STATUSES as readonly string[]).includes(r.status)) byStatus[r.status]++;
    else statusMissing++;
  }
  const cutoff = monthsBefore(now, EVIDENCE_STALE_MONTHS);
  const graded = rows.filter((r) => r.sizeEvidenceGrade != null);
  return {
    total: rows.length,
    byStatus,
    statusMissing,
    noSource: rows.filter((r) => r.sourceIds.length === 0).length,
    evidenceStale: rows.filter((r) => r.status !== 'RETIRED' && (!r.evidenceCheckedAt || r.evidenceCheckedAt < cutoff)).length,
    sizeGradeDShare: graded.length ? graded.filter((r) => r.sizeEvidenceGrade === 'D').length / graded.length : 0,
    awaitingPublish: changes.filter((c) => c.status === 'APPROVED').length,
    openChanges: changes.filter((c) => c.status === 'DRAFT' || c.status === 'REVIEW').length,
    latestRelease: [...releases].sort((a, b) => compareRelease(a.release, b.release)).at(-1)?.release ?? null,
    published: rows.filter((r) => r.status !== 'PENDING').length,
    pending: rows.filter((r) => r.status === 'PENDING').length,
    attrMissing: rows.filter((r) => r.status !== 'PENDING' && r.status !== 'RETIRED' && refAttrMissing(r)).length,
  };
}
