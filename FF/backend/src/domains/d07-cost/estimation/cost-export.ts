// SW 개발비 산정 → 엑셀 산정 도구 v1.3 양식(D-COST-13, C3 사용자 결정 "원본 양식에 값 채우기 · 양식 XML 직접 수정").
// 과제의 입력 칸만 쓴다: 02 과제 정보·설정·드라이버·공통 인력·직접경비, 03 줄 입력(AF~AQ), 12 MBD 작업 행, 07 검토 상태.
// 양식의 예시 입력은 먼저 지운다. 계산은 양식의 수식이 한다(열면 다시 계산) — FF 계산값은 쓰지 않는다.
// 계수 표: 양식이 값으로 가진 칸(사내 단가·월 환산 일수·공통 비율·PERT·변형·기본 Overall·VAT·벤치마크·MBD y)은 과제의 계수 표 값으로 쓰고,
// 그 밖의 표(KOSA·COCOMO·프리셋·공정·방식·AACE·T-shirt·ASIL·재사용)가 양식과 다르면 경고로 알린다(엑셀 결과가 FF와 다를 수 있음).
import { costCheckRate, type CostBasis, type CostCheckStatus, type CostLineInputs, type CostSettingsInput } from '@ff/contracts';
import type { PatchCell, PatchValue } from '../../../kernel/xlsx-patch';

export const SHEET = { settings: '02_프로젝트설정', fdb: '03_FeatureDB', basis: '05_기준값', check: '07_검토체크리스트', mbd: '12_MBD복잡도' } as const;

/** 03 줄 입력 열 — 엑셀 머리글(4행) 순서 */
export const LINE_COLS: Record<keyof Required<CostLineInputs>, string> = {
  qty: 'AF',
  changeType: 'AG',
  asil: 'AH',
  variants: 'AI',
  m: 'AJ',
  o: 'AK',
  p: 'AL',
  priority: 'AM',
  owned: 'AN',
  actual: 'AO',
  reviewStatus: 'AP',
  memo: 'AQ',
};
const MBD_ROWS = { first: 7, last: 206 } as const;
const CHECK_ROWS = { first: 7, last: 44 } as const;
const EXPENSE_FIRST_ROW = 62;

export interface ExportInput {
  basis: CostBasis;
  /** 양식에서 가져온 계수 표(v1.3 첫 판) — 다르면 경고 */
  templateBasis: CostBasis;
  project: { estId: string; name: string; target: string; createdBy: string; createdAt: string; basisVersion: string; settings: CostSettingsInput };
  lines: readonly { refId: string; featureAsil: string; inputs: CostLineInputs }[];
  mbd: readonly { refId: string; counts: readonly (number | null)[] }[];
  checks: ReadonlyMap<number, { status: CostCheckStatus; memo: string }>;
  /** 기준 행의 대표 ASIL — 적용 ASIL이 같으면 비워 둔다(엑셀의 빈칸 = 대표) */
  asilRep: ReadonlyMap<string, string>;
  /** 양식 03의 기준 ID → 행 번호, 02의 드라이버 이름 → 행 번호(양식에서 읽음) */
  fdbRows: ReadonlyMap<string, number>;
  driverRows: ReadonlyMap<string, number>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function exportCells(x: ExportInput): { cells: PatchCell[]; warnings: string[] } {
  const cells: PatchCell[] = [];
  const warnings: string[] = [];
  const put = (sheet: string, ref: string, value: PatchValue | undefined) => cells.push({ sheet, ref, value: value ?? null });
  const { basis, project } = x;
  const s = project.settings;

  // 02 — 1절 과제 정보·2절 방식·4절 드라이버·5절 공통 인력·6절 직접경비
  put(SHEET.settings, 'C6', project.name);
  put(SHEET.settings, 'C7', project.target);
  put(SHEET.settings, 'C8', project.createdBy);
  put(SHEET.settings, 'C9', project.createdAt.slice(0, 10));
  put(SHEET.settings, 'C10', s.aace);
  put(SHEET.settings, 'C11', s.confidence);
  put(SHEET.settings, 'C12', s.preset);
  put(SHEET.settings, 'C14', s.rateBasis);
  put(SHEET.settings, 'C15', s.method);
  put(SHEET.settings, 'D17', s.ohOverride);
  put(SHEET.settings, 'D18', s.feeOverride);
  for (const [driver, row] of x.driverRows) put(SHEET.settings, `D${row}`, s.drivers[driver] ?? 'N');
  put(SHEET.settings, 'C50', s.common.pm ? 'Y' : 'N');
  put(SHEET.settings, 'C51', s.common.scm ? 'Y' : 'N');
  put(SHEET.settings, 'C52', s.common.pi ? 'Y' : 'N');
  put(SHEET.settings, 'C53', s.common.qa ?? 0);
  put(SHEET.settings, 'C54', s.common.fs ?? 0);
  put(SHEET.settings, 'C55', s.common.cs ?? 0);
  put(SHEET.settings, 'C56', s.common.hil ?? 0);
  for (let i = 0; i < 8; i++) {
    const d = s.directExpenses[i];
    put(SHEET.settings, `C${EXPENSE_FIRST_ROW + i}`, d?.qty ?? 0);
    put(SHEET.settings, `E${EXPENSE_FIRST_ROW + i}`, d?.unitPrice ?? 0);
  }

  // 03 — 예시 입력을 지우고 기준 행마다 한 줄로 합친다(엑셀은 기준 ID당 한 행)
  for (const row of x.fdbRows.values()) for (const col of Object.values(LINE_COLS)) put(SHEET.fdb, `${col}${row}`, null);
  type Merged = Omit<CostLineInputs, 'asil'> & { asil?: string | null };
  const merged = new Map<string, Merged>();
  for (const l of x.lines) {
    const asil = l.inputs.asil ?? l.featureAsil;
    const eff: Merged = { ...l.inputs, asil: asil === x.asilRep.get(l.refId) ? null : asil };
    const prev = merged.get(l.refId);
    if (!prev) {
      merged.set(l.refId, eff);
      continue;
    }
    // 같은 기준 행이 두 Feature에서 왔다 — 수량은 더하고, 다른 입력이 서로 다르면 앞 줄을 쓰고 알린다
    prev.qty = (prev.qty ?? 0) + (eff.qty ?? 0);
    for (const k of Object.keys(LINE_COLS) as (keyof Merged)[]) {
      if (k === 'qty') continue;
      if (eff[k] != null && prev[k] != null && eff[k] !== prev[k]) warnings.push(`${l.refId}: 두 Feature의 ${k} 입력이 달라 앞 줄 값(${prev[k]})을 썼습니다`);
      if (prev[k] == null && eff[k] != null) (prev as Record<string, unknown>)[k] = eff[k];
    }
  }
  for (const [refId, inp] of merged) {
    const row = x.fdbRows.get(refId);
    if (!row) {
      warnings.push(`${refId}: 양식 03_FeatureDB에 없는 기준 행이라 내보내지 못했습니다(v1.3 뒤에 추가된 행)`);
      continue;
    }
    for (const [k, col] of Object.entries(LINE_COLS) as [keyof Merged, string][]) put(SHEET.fdb, `${col}${row}`, (inp[k] as PatchValue | undefined) ?? null);
  }

  // 12 — MBD 작업 행(B·D~H), 기준값 y·작업별 y
  for (let r = MBD_ROWS.first; r <= MBD_ROWS.last; r++) for (const col of ['B', 'D', 'E', 'F', 'G', 'H']) put(SHEET.mbd, `${col}${r}`, null);
  if (x.mbd.length > MBD_ROWS.last - MBD_ROWS.first + 1) warnings.push(`MBD 작업 행 ${x.mbd.length}개 중 양식 칸(200행)을 넘는 행은 내보내지 못했습니다`);
  x.mbd.slice(0, MBD_ROWS.last - MBD_ROWS.first + 1).forEach((m, i) => {
    const r = MBD_ROWS.first + i;
    put(SHEET.mbd, `B${r}`, m.refId);
    ['D', 'E', 'F', 'G', 'H'].forEach((col, k) => put(SHEET.mbd, `${col}${r}`, m.counts[k] ?? null));
  });
  put(SHEET.mbd, 'Q13', basis.mbd.baseY);
  basis.mbd.tasks.forEach((t, i) => put(SHEET.mbd, `S${17 + i}`, t.y));

  // 07 — 검토 상태·메모(번호 = B열 No, 7행부터)
  for (let r = CHECK_ROWS.first; r <= CHECK_ROWS.last; r++) {
    const no = r - CHECK_ROWS.first + 1;
    const c = x.checks.get(no);
    put(SHEET.check, `G${r}`, c?.status ?? '미확인');
    put(SHEET.check, `H${r}`, c?.memo || null);
  }

  // 계수 표 — 양식에 값으로 있는 칸은 쓴다
  basis.rates.roles.forEach((r, i) => put(SHEET.basis, `H${73 + i}`, r.inhouseMonthly));
  put(SHEET.basis, 'C83', basis.rates.daysPerMonth);
  put(SHEET.basis, 'C129', basis.commonPct.pm);
  put(SHEET.basis, 'C130', basis.commonPct.scm);
  put(SHEET.basis, 'C131', basis.commonPct.pi);
  put(SHEET.basis, 'C44', basis.pert.optimistic);
  put(SHEET.basis, 'C45', basis.pert.pessimisticSlope);
  put(SHEET.basis, 'C46', basis.variantCoef);
  put(SHEET.basis, 'C39', basis.overall.base);
  put(SHEET.settings, 'C19', basis.vat);
  put(SHEET.settings, 'C23', basis.benchmark.anchorEur);
  put(SHEET.settings, 'C24', basis.benchmark.euRate);
  put(SHEET.settings, 'C25', basis.benchmark.hoursPerPm);
  put(SHEET.settings, 'C26', basis.benchmark.fx);
  const t = x.templateBasis;
  const tables: [string, unknown, unknown][] = [
    ['KOSA 단가', basis.rates.kosa, t.rates.kosa],
    ['엔지니어링 노임단가', basis.rates.engineeringDaily, t.rates.engineeringDaily],
    ['역할·직무 대응', basis.rates.roles.map(({ inhouseMonthly: _, ...r }) => r), t.rates.roles.map(({ inhouseMonthly: _, ...r }) => r)],
    ['COCOMO 승수', basis.cocomo, t.cocomo],
    ['프리셋', basis.presets, t.presets],
    ['공정 비중', basis.phases, t.phases],
    ['역할 구성', basis.roleComposition, t.roleComposition],
    ['대가 방식', basis.methods, t.methods],
    ['AACE 범위', basis.aace, t.aace],
    ['T-shirt 포인트', basis.sizePoints, t.sizePoints],
    ['ASIL 계수', basis.asil, t.asil],
    ['재사용 계수', basis.reuse, t.reuse],
    ['신뢰수준', basis.confidence, t.confidence],
    ['Overall 계수', [basis.overall.lifecycle, basis.overall.quality], [t.overall.lifecycle, t.overall.quality]],
    ['MBD 승수', basis.mbd.multipliers, t.mbd.multipliers],
  ];
  for (const [label, a, b] of tables) if (!same(a, b)) warnings.push(`계수 표 ${project.basisVersion}의 ${label}이(가) 양식(v1.3)과 달라 엑셀이 다시 계산한 값이 FF 결과와 다를 수 있습니다`);
  return { cells, warnings };
}

/** 내보낸 검토 체크리스트 완료율(07 D5와 같은 식) — 시험·머리글용 */
export const exportedCheckRate = (checks: ReadonlyMap<number, { status: CostCheckStatus }>, total: number) =>
  costCheckRate(Array.from({ length: total }, (_, i) => checks.get(i + 1)?.status ?? '미확인'));
