// Feature DB 이전 점검 (30-95 §9) — npm run refdb:check, npm run data:check가 함께 부른다.
//   1,052행 · ID 유일·형식 · 필수 정보(도메인·클러스터·컴포넌트·영/한 기능명·T-shirt·대표 ASIL) 누락 0 · 상태 수 995/53/4 ·
//   출처 ID가 모두 sources.json에 있음 · 도메인 10·컴포넌트 69 · 03b 정의 Feature ID 존재(상위·제외 참조 포함) ·
//   파생 값 T·U(규칙 contracts/src/rules/refdb/size.ts)와 BW(엑셀 과제 설정값으로)가 엑셀 저장값과 일치 · manifest 해시·행 수 일치 ·
//   분류 노드 ID 유일·상위/클러스터 참조 실재 · seed-links.json의 기준 ID 존재.
// 원본 엑셀은 저장소 밖에 있으므로 다시 가져오기 비교는 하지 않는다(가져오기 재현은 refdb:import가 다른 내용을 거부하는 것으로 지킨다).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FF } from '../lib.ts';
import { asilFactor, nominalPoints, sizePoints } from '../../contracts/src/rules/refdb/size.ts';
import { DATA_FILES, DERIVED_FILE, RELEASE, sha256 } from './import-lib.ts';

export const REFDB_ROOT = join(FF, 'data', 'reference', 'feature-db');
export const REFDB_DIR = join(REFDB_ROOT, RELEASE);
export const SEED_LINKS = join(REFDB_ROOT, 'seed-links.json');
const SEED_FEATURES = join(FF, 'data', 'fixtures', 'v0.81', 'features.json');

/** 엑셀 v1.3 이전 기대값(30-95 §4·§5.2·§9) */
export const EXPECT_V13 = { rows: 1052, domains: 10, components: 69, status: { ACTIVE: 995, REVIEW: 53, DEPRECATED: 4, RETIRED: 0, PENDING: 0 } } as const;

const REQUIRED = ['domain', 'cluster', 'component', 'nameEn', 'nameKo', 'tshirt', 'asilRep'] as const;
const ID_RE = /^[A-Z]{2}-[A-Z0-9]{2,5}-\d{3}$/;
const lf = (s: string) => s.replace(/\r\n/g, '\n');

export interface RefdbCheck {
  errors: string[];
  summary: string;
}

/** dir: 발행 폴더(기본 data/reference/feature-db/v1.3), seedLinks: 시드 대응표(없으면 건너뜀) */
export function checkRefdb(dir: string = REFDB_DIR, seedLinks: string | null = SEED_LINKS): RefdbCheck {
  const errors: string[] = [];
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return { errors: [`Feature DB ${dir}/manifest.json 없음 — npm run refdb:import -- <xlsx>`], summary: '' };
  const manifest = JSON.parse(lf(readFileSync(manifestPath, 'utf8')));

  // manifest — 파일 해시·행 수
  const data: Record<string, any> = {};
  for (const name of [...DATA_FILES, DERIVED_FILE]) {
    const p = join(dir, `${name}.json`);
    const meta = manifest.files?.[name];
    if (!existsSync(p)) { errors.push(`Feature DB ${name}.json 없음`); continue; }
    const text = lf(readFileSync(p, 'utf8'));
    data[name] = JSON.parse(text);
    if (!meta) { errors.push(`Feature DB manifest에 ${name} 항목 없음`); continue; }
    if (sha256(text) !== meta.sha256) errors.push(`Feature DB ${name}.json 해시가 manifest와 다름(손으로 고치지 않는다 — 변경 요청으로 새 발행)`);
    const rows = Array.isArray(data[name]) ? data[name].length : Object.keys(data[name].rows ?? {}).length;
    if (rows !== meta.rows) errors.push(`Feature DB ${name}.json 행 수 ${rows} ≠ manifest ${meta.rows}`);
  }
  const refs: any[] = data.refs ?? [];
  const sources: any[] = data.sources ?? [];
  const taxonomy: any[] = data.taxonomy ?? [];
  const derived = data[DERIVED_FILE] ?? { rows: {}, excelSettings: {} };

  // 행 수·ID
  if (refs.length !== EXPECT_V13.rows) errors.push(`Feature DB 기준 행 ${refs.length}행 ≠ ${EXPECT_V13.rows}행`);
  const ids = new Set<string>();
  for (const r of refs) {
    if (!ID_RE.test(r.refId ?? '')) errors.push(`Feature DB ${r.refId}: ID 형식이 '도메인약어-컴포넌트약어-일련번호'가 아님`);
    if (ids.has(r.refId)) errors.push(`Feature DB ${r.refId}: ID 중복`);
    ids.add(r.refId);
  }
  // 필수 정보
  for (const r of refs) for (const k of REQUIRED) if (typeof r[k] !== 'string' || !r[k].trim()) errors.push(`Feature DB ${r.refId}: 필수 정보 ${k} 비어 있음`);
  // 상태 수
  const counts: Record<string, number> = { ACTIVE: 0, REVIEW: 0, DEPRECATED: 0, RETIRED: 0, PENDING: 0 };
  for (const r of refs) {
    if (!(r.status in counts)) errors.push(`Feature DB ${r.refId}: 상태 '${r.status}'는 ACTIVE·REVIEW·DEPRECATED·RETIRED·PENDING이 아님`);
    else counts[r.status]++;
  }
  for (const [k, v] of Object.entries(EXPECT_V13.status)) if (counts[k] !== v) errors.push(`Feature DB 상태 ${k} ${counts[k]}행 ≠ 엑셀 ${v}행`);
  for (const [k, v] of Object.entries(manifest.statusCounts ?? {})) if (counts[k] !== v) errors.push(`Feature DB 상태 ${k} ${counts[k]}행 ≠ manifest ${v}행`);
  // 출처·관계
  const sourceIds = new Set(sources.map((s) => s.sourceId));
  for (const r of refs) {
    if (!r.sourceIds?.length) errors.push(`Feature DB ${r.refId}: 출처 ID 없음`);
    for (const s of r.sourceIds ?? []) if (!sourceIds.has(s)) errors.push(`Feature DB ${r.refId}: 출처 ${s}가 sources.json에 없음`);
    for (const q of r.requires ?? []) if (!ids.has(q)) errors.push(`Feature DB ${r.refId}: 선행 ${q}가 없는 기준 행`);
    for (const q of r.excludes ?? []) if (!ids.has(q)) errors.push(`Feature DB ${r.refId}: 배타 ${q}가 없는 기준 행`);
    if (r.duplicateOf && !ids.has(r.duplicateOf)) errors.push(`Feature DB ${r.refId}: 중복 점검 기준 ${r.duplicateOf}가 없는 기준 행`);
    if (r.replacedBy && !ids.has(r.replacedBy)) errors.push(`Feature DB ${r.refId}: 대체 행 ${r.replacedBy}가 없는 기준 행`);
  }
  // 분류 — 기준 행 값과 분류 표가 같은 수
  const domains = new Set(refs.map((r) => r.domain));
  const components = new Set(refs.map((r) => `${r.domain}|${r.component}`));
  if (domains.size !== EXPECT_V13.domains) errors.push(`Feature DB 도메인 ${domains.size}개 ≠ ${EXPECT_V13.domains}개`);
  if (components.size !== EXPECT_V13.components) errors.push(`Feature DB 컴포넌트 ${components.size}개 ≠ ${EXPECT_V13.components}개`);
  const tax = (level: string) => taxonomy.filter((n) => n.level === level);
  if (tax('DOMAIN').length !== domains.size) errors.push(`Feature DB 분류 표 도메인 ${tax('DOMAIN').length}개 ≠ 기준 행 ${domains.size}개`);
  if (tax('COMPONENT').length !== components.size) errors.push(`Feature DB 분류 표 컴포넌트 ${tax('COMPONENT').length}개 ≠ 기준 행 ${components.size}개`);
  // 노드 ID 유일 — 수준이 달라도 겹치면 안 된다(클러스터·컴포넌트 이름이 같은 쌍 — DB 기본 키 taxonomy_node.node_id)
  const nodeIds = new Set<string>();
  for (const n of taxonomy) {
    if (nodeIds.has(n.nodeId)) errors.push(`Feature DB 분류 ${n.nodeId}: 노드 ID 중복(${n.level}) — 수준마다 구분자가 다른 ID(도메인 'BC'·클러스터 'BC:이름'·컴포넌트 'BC/이름')`);
    nodeIds.add(n.nodeId);
  }
  for (const n of taxonomy) for (const c of n.clusterIds ?? []) if (!taxonomy.some((x) => x.nodeId === c && x.level === 'CLUSTER')) errors.push(`Feature DB 분류 ${n.nodeId}: 클러스터 ${c} 없음`);
  for (const n of taxonomy) if (n.parentId != null && !nodeIds.has(n.parentId)) errors.push(`Feature DB 분류 ${n.nodeId}: 상위 ${n.parentId} 없음`);
  // 03b 정의 — manifest에 적힌 Feature ID가 모두 정의를 가진 기준 행으로 있고, 상위·제외 참조가 실재
  const defIds: string[] = manifest.definitions?.refIds ?? [];
  const withDef = new Set(refs.filter((r) => r.definition).map((r) => r.refId));
  for (const id of defIds) if (!withDef.has(id)) errors.push(`Feature DB 03b 정의 ${id}가 기준 행에 없음`);
  if (withDef.size !== defIds.length) errors.push(`Feature DB 정의가 붙은 기준 행 ${withDef.size}개 ≠ 03b ${defIds.length}개`);
  for (const r of refs.filter((x) => x.definition)) {
    for (const q of [...(r.definition.parentRefIds ?? []), ...(r.definition.scopeOutRefs ?? [])]) if (!ids.has(q)) errors.push(`Feature DB ${r.refId}: 03b 참조 ${q}가 없는 기준 행`);
  }
  // 파생 값 — 규칙으로 다시 계산해 엑셀 저장값과 같아야 한다
  let derivedChecked = 0;
  const anchorEur = derived.excelSettings?.anchorEur ?? undefined;
  const { eurPerHour, hoursPerPm } = derived.excelSettings ?? {};
  const mmPerPt = anchorEur && eurPerHour && hoursPerPm ? anchorEur / (eurPerHour * hoursPerPm) : null;
  for (const r of refs) {
    const x = derived.rows?.[r.refId];
    if (!x) { errors.push(`Feature DB ${r.refId}: 엑셀 파생 값 없음(_excel-derived.json)`); continue; }
    const t = sizePoints(r.tshirt);
    const u = nominalPoints(r, anchorEur);
    if (t !== x.points) errors.push(`Feature DB ${r.refId}: 등급 포인트 T 재계산 ${t} ≠ 엑셀 ${x.points}`);
    if (u !== x.nominalPoints) errors.push(`Feature DB ${r.refId}: 명목 포인트 U 재계산 ${u} ≠ 엑셀 ${x.nominalPoints}`);
    if (asilFactor(r.asilRep) !== x.asilFactor) errors.push(`Feature DB ${r.refId}: 대표 ASIL 계수 BH 재계산 ≠ 엑셀 ${x.asilFactor}`);
    // BW = U × MM_PER_PT × BH (MM_PER_PT는 과제 설정값 — 엑셀 v1.3 설정으로 재계산)
    const bw = u != null && mmPerPt != null ? u * mmPerPt * asilFactor(r.asilRep)! : null;
    if (bw == null || x.baseEffortMm == null || Math.abs(bw - x.baseEffortMm) > 1e-9 * Math.max(1, Math.abs(x.baseEffortMm))) errors.push(`Feature DB ${r.refId}: 신규 개발 기준 공수 BW 재계산 ${bw} ≠ 엑셀 ${x.baseEffortMm}`);
    derivedChecked++;
  }
  // 시드 대응표 — 기준 ID 실재, Feature마다 대표 정확히 1
  let seedSummary = '';
  if (seedLinks && existsSync(seedLinks)) {
    const sl = JSON.parse(lf(readFileSync(seedLinks, 'utf8')));
    let linked = 0;
    for (const [fid, links] of Object.entries<any[]>(sl.links ?? {})) {
      if (links.filter((l) => l.role === 'PRIMARY').length !== 1) errors.push(`Feature DB seed-links ${fid}: 대표(PRIMARY)가 정확히 1개가 아님`);
      if (new Set(links.map((l) => l.refId)).size !== links.length) errors.push(`Feature DB seed-links ${fid}: 같은 기준 행 중복`);
      for (const l of links) if (!ids.has(l.refId)) errors.push(`Feature DB seed-links ${fid}: ${l.refId}가 없는 기준 행`);
      linked++;
    }
    for (const [fid, m] of Object.entries<any>(sl._missing ?? {})) for (const c of m.candidates ?? []) if (!ids.has(c)) errors.push(`Feature DB seed-links _missing ${fid}: 후보 ${c}가 없는 기준 행`);
    // 시드 Feature는 예외 없이 대응표(연결 또는 _missing)에 있어야 한다(§9)
    if (existsSync(SEED_FEATURES)) {
      const covered = new Set([...Object.keys(sl.links ?? {}), ...Object.keys(sl._missing ?? {})]);
      for (const f of JSON.parse(readFileSync(SEED_FEATURES, 'utf8')) as { featureId: string }[]) {
        if (!covered.has(f.featureId)) { errors.push(`Feature DB seed-links: 시드 ${f.featureId}가 대응표에 없음 — node tools/refdb/seed-links.ts`); covered.add(f.featureId); }
      }
    }
    seedSummary = ` · 시드 연결 ${linked}개(미연결 ${Object.keys(sl._missing ?? {}).length}개)`;
  }

  const summary = `Feature DB ${manifest.release} ${refs.length}행 · 상태 ${counts.ACTIVE}/${counts.REVIEW}/${counts.DEPRECATED} · 출처 ${sources.length} · 도메인 ${domains.size}·컴포넌트 ${components.size} · 03b 정의 ${withDef.size} · 파생 값 T·U·BW ${derivedChecked}행 일치${seedSummary}`;
  return { errors, summary };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { errors, summary } = checkRefdb();
  console.log('refdb:check');
  if (errors.length) {
    for (const e of errors.slice(0, 50)) console.error('  ✕ ' + e);
    if (errors.length > 50) console.error(`  … 외 ${errors.length - 50}건`);
    process.exit(1);
  }
  console.log('  ✓ ' + summary);
}
