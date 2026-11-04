// Feature DB 내보내기(30-95 §10, D-REF-5·11) — GET /api/refdb/export?format=xlsx&release=v1.4. FF가 원천이고 엑셀은 내보내기만.
//  · xlsx: 엑셀 03_FeatureDB 마스터 열(A~AE, BJ~BL, BO~BV)을 **원래 열 위치**에 둔다 — 과제 입력·자동 계산 열(AF~BI, BM·BN, BW)은 비운다.
//    그래서 tools/refdb 가져오기(열 문자 대응)가 이 파일을 다시 읽을 수 있다. 둘째 시트 09_출처.
//  · json(기본): 같은 발행 시점의 기준 행·출처.
//  · release: 지난 발행이면 그 시점 기준 행으로 되돌려 내보낸다(release-hash rowsAtRelease). 요청 중(PENDING) 행은 발행 내용이 아니라 넣지 않는다.
//  · 벤치마크 열(O 금액·P Kearney 메모·V·W Make/Buy)과 금액에서 나오는 U 명목 포인트는 산정 역할(read-view canSeeBenchmark)만 — 그 밖에는 머리글까지 비운다.
// 한계: 출처 표는 발행 이력이 없어 늘 지금 값이다. M(Overall)은 FF 규칙이 아직 없어 비운다(TODO 20-94). AE는 v1.3 가져오기가 옮긴 필드가 없어 비운다.
import { Injectable, StreamableFile } from '@nestjs/common';
import { compareRelease, nominalPoints, REF_MONEY_FIELDS, sizePoints, type FeatureRefRow, type RefMoneyField, type RefSource, type Role } from '@ff/contracts';
import { DomainError } from '../../../kernel/errors';
import { writeWorkbook, type XlsxCell } from '../../../kernel/xlsx-write';
import { canSeeBenchmark, refView } from './read-view';
import { refdbHash, releaseRows, rowsAtRelease } from './release-hash';
import { RefdbRepository } from './refdb.repository';

/** 엑셀 BQ 관리 상태 글자 */
const STATUS_KO: Record<FeatureRefRow['status'], string> = { ACTIVE: '활성', REVIEW: '검토 필요', DEPRECATED: '폐기 예정', RETIRED: '폐기', PENDING: '요청 중' };

interface Column {
  col: string;
  header: string;
  value: (r: FeatureRefRow) => XlsxCell;
  /** 이 열이 보여 주거나(O·P·V·W) 계산에 쓰는(U) 벤치마크 필드 — 있으면 산정 역할만(목록은 contracts REF_MONEY_FIELDS) */
  money?: RefMoneyField;
}

const list = (v: readonly string[]) => v.join('; ');

/** 03_FeatureDB 마스터 열 — 머리글은 엑셀 v1.x 4행 머리글(가져오기 HEADER_EXPECT와 같은 앞부분) */
export const FEATURE_DB_COLUMNS: readonly Column[] = [
  { col: 'A', header: 'ID', value: (r) => r.refId },
  { col: 'B', header: '도메인', value: (r) => r.domain },
  { col: 'C', header: '컴포넌트 클러스터', value: (r) => r.cluster },
  { col: 'D', header: '컴포넌트', value: (r) => r.component },
  { col: 'E', header: 'SW Stack', value: (r) => r.swStack },
  { col: 'F', header: 'Feature (EN)', value: (r) => r.nameEn },
  { col: 'G', header: '기능명', value: (r) => r.nameKo },
  { col: 'H', header: 'Lifecycle', value: (r) => r.lifecycle },
  { col: 'I', header: 'Technology stack', value: (r) => r.techStack },
  { col: 'J', header: 'Automotive quality / confidence', value: (r) => r.autoQuality },
  { col: 'K', header: 'Tech quality / confidence', value: (r) => r.techQuality },
  { col: 'L', header: 'QM / ASIL (대표, 가정)', value: (r) => r.asilRep },
  // TODO(20-94): Overall(M)은 엑셀 파생 값 — FF 규칙(contracts rules/cost)이 생기면 계산해 채운다
  { col: 'M', header: 'Overall', value: () => null },
  { col: 'N', header: 'Method', value: (r) => r.method },
  { col: 'O', header: 'Average Player (€, Kearney)', value: (r) => r.benchmarkEur, money: 'benchmarkEur' },
  { col: 'P', header: 'Kearney 판독 메모', value: (r) => r.kearneyNote, money: 'kearneyNote' },
  { col: 'Q', header: '번들 ID', value: (r) => r.bundleId },
  { col: 'R', header: '번들 대표', value: (r) => (r.bundleRep === true ? 'Y' : r.bundleRep === false ? 'N' : null) },
  { col: 'S', header: 'T-shirt 등급', value: (r) => r.tshirt },
  { col: 'T', header: '등급 포인트', value: (r) => sizePoints(r.tshirt) },
  { col: 'U', header: '명목 포인트', value: (r) => nominalPoints({ tshirt: r.tshirt, asilRep: r.asilRep, benchmarkEur: r.benchmarkEur ?? null }), money: 'benchmarkEur' },
  { col: 'V', header: 'MoB volume player', value: (r) => r.makeBuyVolume, money: 'makeBuyVolume' },
  { col: 'W', header: 'MoB premium player', value: (r) => r.makeBuyPremium, money: 'makeBuyPremium' },
  { col: 'X', header: 'Relevance', value: (r) => r.relevance },
  { col: 'Y', header: '출처 ID', value: (r) => list(r.sourceIds) },
  { col: 'Z', header: '출처 상세 (표준 조항·VSS 경로)', value: (r) => r.sourceDetail },
  { col: 'AA', header: '비고', value: (r) => r.remark },
  { col: 'AB', header: '근거 유형', value: (r) => r.basisType },
  { col: 'AC', header: '차량 유형', value: (r) => r.vehicleType },
  { col: 'AD', header: '적용 권역', value: (r) => r.region },
  // AE — v1.3 가져오기가 옮긴 필드가 없다(열 위치만 둔다)
  { col: 'BJ', header: '중복 점검 기준 ID', value: (r) => r.duplicateOf },
  { col: 'BK', header: '규모 근거 등급', value: (r) => r.sizeEvidenceGrade },
  { col: 'BL', header: '선행 Feature ID', value: (r) => list(r.requires) },
  { col: 'BO', header: '등록 버전', value: (r) => r.registeredIn },
  { col: 'BP', header: '최종 근거 확인일', value: (r) => r.evidenceCheckedAt },
  { col: 'BQ', header: '관리 상태', value: (r) => STATUS_KO[r.status] ?? r.status },
  { col: 'BR', header: '관리 메모', value: (r) => r.adminMemo },
  { col: 'BS', header: '조달 형태', value: (r) => r.procurement },
  { col: 'BT', header: 'SW 패키지 분류', value: (r) => r.swPackage },
  { col: 'BU', header: '라이선스 비용 항목', value: (r) => r.licenseItem },
  { col: 'BV', header: '과금 방식', value: (r) => r.billing },
];

// 벤치마크 필드마다 그 값을 그대로 싣는 열이 있어야 한다 — 목록(REF_MONEY_FIELDS)에 필드가 늘면 열 정의도 함께
for (const f of REF_MONEY_FIELDS) if (!FEATURE_DB_COLUMNS.some((c) => c.money === f)) throw new Error(`Feature DB 내보내기: 벤치마크 필드 ${f}의 열이 없습니다`);

const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const WIDTH = colIndex('BV') + 1;

export const SOURCE_HEADERS = ['ID', '자료', '발행처·저자', '연도·버전', 'URL·식별자', '도구 내 사용처', '최종 확인일', '다음 점검일'] as const;

/** 기준 행 → 03_FeatureDB 시트 행(원래 열 위치). 벤치마크를 볼 수 없으면 그 열은 머리글까지 비운다 */
export function featureDbSheetRows(rows: readonly FeatureRefRow[], role: Role): XlsxCell[][] {
  const cols = FEATURE_DB_COLUMNS.filter((c) => !c.money || canSeeBenchmark(role));
  const line = (f: (c: Column) => XlsxCell) => {
    const out: XlsxCell[] = new Array(WIDTH).fill(null);
    for (const c of cols) out[colIndex(c.col)] = f(c);
    return out;
  };
  return [line((c) => c.header), ...rows.map((r) => line((c) => c.value(r)))];
}

export function sourceSheetRows(sources: readonly RefSource[]): XlsxCell[][] {
  return [
    [...SOURCE_HEADERS],
    ...sources.map((s) => [s.sourceId, s.title, s.publisher, s.version, s.url, String((s as RefSource & { usage?: unknown }).usage ?? ''), s.checkedAt, s.nextReviewAt]),
  ];
}

/** 시트 이름 — 엑셀과 같게(가져오기가 이름으로 찾는다) */
export const EXPORT_SHEETS = { featureDb: '03_FeatureDB', sources: '09_출처' } as const;

@Injectable()
export class RefdbExportService {
  constructor(private readonly repo: RefdbRepository) {}

  /** 발행 시점 기준 행 — release가 없으면 최신 발행(= 지금 발행 내용) */
  snapshot(release?: string): { release: string | null; rows: FeatureRefRow[]; hash: string; recordedHash: string | null } {
    const releases = this.repo.releases();
    const latest = releases.at(-1)?.release ?? null;
    const target = release ?? latest;
    if (release && !releases.some((r) => r.release === release)) throw new DomainError('NOT_FOUND', `Feature DB 발행 버전 ${release}이(가) 없습니다.`, { release, releases: releases.map((r) => r.release) });
    const current = this.repo.listRefs();
    const rows = target && latest && compareRelease(target, latest) < 0 ? rowsAtRelease(current, releases, this.repo.changes(), target) : releaseRows(current);
    return { release: target, rows, hash: refdbHash(rows), recordedHash: releases.find((r) => r.release === target)?.hash ?? null };
  }

  /** exportRefdb — format json(기본)·xlsx */
  export(format: string | undefined, release: string | undefined, role: Role) {
    const fmt = format ?? 'json';
    if (fmt !== 'json' && fmt !== 'xlsx') throw new DomainError('VALIDATION', '내보내기 형식(format)은 json 또는 xlsx입니다.', { field: 'format', value: fmt });
    const snap = this.snapshot(release);
    const sources = this.repo.sources();
    if (fmt === 'json') return { release: snap.release, format: 'json', hash: snap.hash, refs: snap.rows.map((r) => refView(r, role)), sources };
    const buf = this.xlsx(snap.rows, sources, role);
    return new StreamableFile(buf, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="FeatureDB_${snap.release ?? 'current'}.xlsx"`,
      length: buf.length,
    });
  }

  xlsx(rows: readonly FeatureRefRow[], sources: readonly RefSource[], role: Role): Buffer {
    return writeWorkbook([
      { name: EXPORT_SHEETS.featureDb, rows: featureDbSheetRows(rows, role) },
      { name: EXPORT_SHEETS.sources, rows: sourceSheetRows(sources) },
    ]);
  }
}

/** 시험·도구용 — 열 문자 → 0부터 인덱스 */
export const exportColIndex = colIndex;
