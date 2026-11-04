// Feature DB 규칙 — 상태 정책(D-REF-6·7), Feature 연결 점검, 검색, 품질 지표, ECU 도메인 대응(D-REF-9).
// 설계 docs/30-data-model/30-95 §4·§5.2·§6·§8.4. 표는 데이터, 계산은 순수 함수 — 백엔드·화면·적재기가 함께 쓴다.
import type { FeatureRefLink, FeatureRefRow, FeatureRefStatus, TshirtSize } from '../schemas/refdb';

/** 상태별 허용 — 등록 화면 선택, Feature 승인 전이, 산정 줄 */
export const REF_STATUS_POLICY: Record<FeatureRefStatus, { select: boolean; warn: boolean; blocksApproval: boolean; costLine: boolean }> = {
  ACTIVE: { select: true, warn: false, blocksApproval: false, costLine: true },
  REVIEW: { select: true, warn: true, blocksApproval: false, costLine: true },
  DEPRECATED: { select: true, warn: true, blocksApproval: false, costLine: true },
  RETIRED: { select: false, warn: true, blocksApproval: true, costLine: false },
  PENDING: { select: true, warn: true, blocksApproval: true, costLine: false },
};

/** 엑셀 BQ열 → 상태 */
export const REF_STATUS_OF_EXCEL: Record<string, FeatureRefStatus> = {
  활성: 'ACTIVE',
  '검토 필요': 'REVIEW',
  '폐기 예정': 'DEPRECATED',
  폐기: 'RETIRED',
};

export type RefLinkIssue = { refId: string; code: 'REF_NOT_FOUND' | 'REF_RETIRED' | 'REF_PENDING' | 'REF_REVIEW' | 'REF_DEPRECATED'; blocking: boolean; replacedBy?: string | null };

/**
 * Feature 연결 점검 — 생성(create)과 승인 전이(approval)에서 다르게 막는다.
 * create: 없는 행·폐기 행은 막고 나머지 경고. approval: 요청 중·폐기 행이 남아 있으면 막는다.
 */
export function checkRefLinks(links: readonly Pick<FeatureRefLink, 'refId'>[], lookup: (id: string) => Pick<FeatureRefRow, 'refId' | 'status' | 'replacedBy'> | undefined, stage: 'create' | 'approval'): RefLinkIssue[] {
  const out: RefLinkIssue[] = [];
  for (const { refId } of links) {
    const row = lookup(refId);
    if (!row) {
      out.push({ refId, code: 'REF_NOT_FOUND', blocking: true });
      continue;
    }
    const policy = REF_STATUS_POLICY[row.status];
    if (row.status === 'RETIRED') out.push({ refId, code: 'REF_RETIRED', blocking: true, replacedBy: row.replacedBy });
    else if (row.status === 'PENDING') out.push({ refId, code: 'REF_PENDING', blocking: stage === 'approval' && policy.blocksApproval });
    else if (row.status === 'REVIEW') out.push({ refId, code: 'REF_REVIEW', blocking: false });
    else if (row.status === 'DEPRECATED') out.push({ refId, code: 'REF_DEPRECATED', blocking: false, replacedBy: row.replacedBy });
  }
  return out;
}

/** 대표 기준 행 */
export const primaryRefId = (links: readonly FeatureRefLink[] | undefined): string | undefined => links?.find((l) => l.role === 'PRIMARY')?.refId;

// ── 파생 값 (엑셀 03_FeatureDB M·T열, 05_기준값 A·D절) ─────────────────────────

export const SIZE_POINTS: Record<TshirtSize, number> = { XS: 1, S: 3, M: 8, L: 21, XL: 55, XXL: 144, XXXL: 377 };
const OVERALL_BASE = 1.2;
const LIFECYCLE_ADD: Record<string, number> = { Commodity: 0, Differentiating: 0.2, Innovation: 0.4 };
const QUALITY_ADD: Record<string, number> = { High: 0, Mid: 0.2, Low: 0.4 };

/** 구현 난이도 Overall = 1.2 + 수명주기 가산 + Automotive 신뢰도 가산 */
export const refOverall = (r: Pick<FeatureRefRow, 'lifecycle' | 'autoQuality'>): number => OVERALL_BASE + LIFECYCLE_ADD[r.lifecycle] + QUALITY_ADD[r.autoQuality];

// ── 검색 ─────────────────────────────────────────────────────────

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/**
 * 검색 점수 — ID 정확 일치 > 이름 시작 > 별칭 정확 > 이름·별칭 포함 > 설명 포함. 0이면 결과에서 뺀다.
 * 한글·영문 이름, 별칭(견적서 별칭·사내 용어), 컴포넌트, 03b 정의 요약을 본다.
 */
export function refSearchScore(r: Pick<FeatureRefRow, 'refId' | 'nameKo' | 'nameEn' | 'aliases' | 'component' | 'definition'>, query: string): number {
  const q = norm(query);
  if (!q) return 1;
  if (norm(r.refId) === q) return 100;
  const names = [r.nameKo, r.nameEn].map(norm);
  const aliases = r.aliases.map(norm);
  if (names.some((n) => n.startsWith(q))) return 80;
  if (aliases.some((a) => a === q)) return 70;
  if (norm(r.refId).startsWith(q)) return 60;
  if (names.some((n) => n.includes(q)) || aliases.some((a) => a.includes(q))) return 50;
  if (norm(r.component).includes(q)) return 30;
  if (r.definition?.summary && norm(r.definition.summary).includes(q)) return 10;
  return 0;
}

// ── 품질 지표 (엑셀 15_DB운영 4절) ─────────────────────────────────

export interface RefQuality {
  total: number;
  byStatus: Record<FeatureRefStatus, number>;
  noSource: number;
  staleEvidence: number;
  gradeDShare: number;
}

/** 근거 확인 후 12개월 지난 행·출처 없는 행·규모 근거 D 비중 */
export function refQuality(rows: readonly Pick<FeatureRefRow, 'status' | 'sourceIds' | 'evidenceCheckedAt' | 'sizeEvidenceGrade'>[], today: string): RefQuality {
  const byStatus = { ACTIVE: 0, REVIEW: 0, DEPRECATED: 0, RETIRED: 0, PENDING: 0 } as Record<FeatureRefStatus, number>;
  let noSource = 0;
  let stale = 0;
  let gradeD = 0;
  const limit = new Date(today);
  limit.setUTCFullYear(limit.getUTCFullYear() - 1);
  for (const r of rows) {
    byStatus[r.status]++;
    if (r.sourceIds.length === 0) noSource++;
    if (r.evidenceCheckedAt && new Date(r.evidenceCheckedAt) < limit) stale++;
    if (r.sizeEvidenceGrade === 'D') gradeD++;
  }
  return { total: rows.length, byStatus, noSource, staleEvidence: stale, gradeDShare: rows.length ? gradeD / rows.length : 0 };
}

// ── ECU 도메인 대응 (D-REF-9) ───────────────────────────────────

/** ECU 마스터의 자유 문자열 도메인 → Feature DB 공식 도메인. 대응이 없으면 data:check가 경고한다 */
export const ECU_DOMAIN_ALIAS: Record<string, string> = {
  Body: 'Body & Comfort',
  Comfort: 'Body & Comfort',
  ADAS: 'ADAS & AD',
  AD: 'ADAS & AD',
  Chassis: 'Chassis & Vehicle Dynamics',
  Powertrain: 'Powertrain - Electrified',
  EV: 'Powertrain - Electrified',
  ICE: 'Powertrain - Combustion',
  Infotainment: 'Infotainment & HMI',
  IVI: 'Infotainment & HMI',
  HMI: 'Infotainment & HMI',
  Connectivity: 'Connectivity & Telematics',
  Telematics: 'Connectivity & Telematics',
  Safety: 'Safety',
  Platform: 'Vehicle Platform & Base SW',
  Gateway: 'Vehicle Platform & Base SW',
  Cloud: 'Back-end & Cloud',
};

/** 다음 기준 행 ID — 같은 도메인·컴포넌트 약어의 최대 일련번호 + 1 (폐기 행 포함, 재사용 금지) */
export function nextRefId(existing: readonly string[], domainAbbr: string, componentAbbr: string): string {
  const prefix = `${domainAbbr}-${componentAbbr}-`;
  const max = existing.filter((id) => id.startsWith(prefix)).reduce((m, id) => Math.max(m, Number(id.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
