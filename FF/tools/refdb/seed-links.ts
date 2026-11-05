// 데모·시드 Feature ↔ Feature DB 기준 행 대응표 (30-95 §9·§5.3) — node tools/refdb/seed-links.ts [--check]
// data/fixtures/v0.81/features.json의 Feature(68개, 버전 여러 개는 하나로)를 기능명 기준으로 기준 행에 잇는다.
// 대응은 사람이 기능명·설명·태그·ASIL과 기준 행 한/영 기능명·별칭·컴포넌트를 대조해 정한 표(SEED_MAP)다 — 자동 유사도로 정하지 않는다.
// 맞는 행이 없거나 불확실하면 _missing에 후보와 함께 남긴다(사용자 확인 → 기준 행 추가 요청 D-REF-7 또는 후보 확정).
// 시드 ASIL ≠ 대표 행 대표 ASIL이면 같은 ASIL의 같은 기능 행으로 대표를 다시 고르고, 그런 행이 없으면 asilDeviationReason에 사유를 남긴다(2026-11-04 사용자 결정 — 억지 대응 금지).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FF } from '../lib.ts';
import { RELEASE, serialize } from './import-lib.ts';

export const FEATURES = join(FF, 'data', 'fixtures', 'v0.81', 'features.json');
export const OUT = join(FF, 'data', 'reference', 'feature-db', 'seed-links.json');
export const REFS = join(FF, 'data', 'reference', 'feature-db', RELEASE, 'refs.json');

type Confidence = 'high' | 'medium';
/** asilDeviationReason — 시드 ASIL이 대표 행 대표 ASIL과 다를 때만(같은 ASIL의 같은 기능 행이 없어 대표를 그대로 둔 경우). 시드가 버전 doc.asilDeviation으로 넣는다 */
interface Mapped { primary: string; included?: string[]; confidence: Confidence; note: string; asilDeviationReason?: string }
interface Missing { candidates: string[]; note: string }

/** 시드 기능명 → 기준 행. 같은 이름의 Feature(차종·국가별 버전)는 같은 대응을 쓴다 */
export const SEED_MAP: Record<string, Mapped | Missing> = {
  '원격 스마트 주차 보조': { primary: 'AD-PRK-007', confidence: 'high', note: '원격 주차(RCP) — 차량 밖에서 전·후진 주차 제어, ASIL B 같음' },
  '주차 충돌방지 보조': { primary: 'AD-LON-016', included: ['AD-PRK-001'], confidence: 'medium', note: '주차 중 장애물 제동 지원 → 후진 자동 긴급 제동 + 초음파 거리 경고. 시드 ASIL C ≠ 기준 B(사유 기록)',
    asilDeviationReason: 'v0.81 데이터셋 HARA 결과(ASIL C) 유지 — 기준 행 후진 자동 긴급 제동(AD-LON-016) 대표 ASIL B보다 높음. ASIL C 행은 주행 중 AEB(AD-LON-010~015·017)뿐이라 주차 중 장애물 제동 지원과 범위가 다름' },
  '서라운드 뷰 모니터': { primary: 'AD-PRK-004', confidence: 'high', note: '서라운드 뷰 모니터(360°)' },
  '고속도로 주행 보조 2': { primary: 'AD-LAT-011', included: ['AD-LAT-005'], confidence: 'high', note: '고속도로 주행 보조(L2 통합) + 자동 차로 변경(차선변경 보조)' },
  '스마트 크루즈 컨트롤': { primary: 'AD-LON-002', confidence: 'high', note: '적응형 순항 제어(ACC). 시드 ASIL C ≠ 기준 B(사유 기록)',
    asilDeviationReason: 'v0.81 데이터셋 HARA 결과(ASIL C) 유지 — 기준 행 ACC(AD-LON-002) 대표 ASIL B보다 높음. 순항 제어 행(CC·ACC·정차·재출발 ACC·CACC)이 모두 B라 같은 ASIL의 같은 기능 행 없음' },
  '실외 V2L 전원 공급': { primary: 'PE-CHG-007', confidence: 'high', note: 'V2L 외부 전력 공급' },
  '운전자 모니터링 시스템': { primary: 'AD-DMS-003', included: ['AD-DMS-001', 'AD-DMS-002', 'AD-DMS-005'], confidence: 'high', note: 'DMS 카메라 + 졸음·주의분산 경고 + 시선 추정. 시드 ASIL C ≠ 기준 A(사유 기록)',
    asilDeviationReason: 'v0.81 데이터셋 HARA 결과(ASIL C) 유지 — 기준 행 DMS 카메라(AD-DMS-003) 대표 ASIL A보다 높음. 운전자 모니터링 행 중 가장 높은 운전자 이상 감지(AD-DMS-004)도 B라 같은 ASIL 행 없음' },
  '스마트폰 디지털 키': { primary: 'CO-DKY-005', included: ['CO-DKY-004', 'CO-DKY-001'], confidence: 'high', note: 'UWB 보안 거리측정 출입 + BLE 근접 인식 + 소유자 페어링' },
  '전자식 차동 제한 제어': { primary: 'CH-VMC-005', confidence: 'high', note: '전자식 차동 제한(eLSD), ASIL B 같음' },
  '예측 공조': { primary: 'BC-HVX-012', confidence: 'medium', note: '예약 공조(프리컨디셔닝)에 가장 가깝다 — 일정·날씨 기반 "제안"은 기준 행 범위 밖일 수 있음' },
  '증강현실 HUD 내비게이션': { primary: 'IN-CLU-012', confidence: 'high', note: '증강현실 HUD(AR-HUD). 시드 QM ≠ 기준 A(사유 기록)',
    asilDeviationReason: 'v0.81 데이터셋 HARA 결과(QM) 유지 — 기준 행 AR-HUD(IN-CLU-012) 대표 ASIL A보다 낮음(시드는 전방 영상·지도 정합 안내 표시만). HUD 행(IN-CLU-011)도 A, 내비게이션 QM 행은 HUD 표시가 아니라 같은 기능 행 없음 — G2 검토' },
  '지능형 속도 제한 보조': { primary: 'AD-LON-005', included: ['AD-LON-006'], confidence: 'high', note: '지능형 속도 보조(ISA) + 교통 표지 인식. 시드 ASIL C ≠ 기준 QM(사유 기록)',
    asilDeviationReason: 'v0.81 데이터셋 HARA 결과(ASIL C) 유지 — 기준 행 ISA(AD-LON-005) 대표 QM보다 높음(시드는 경고에 더해 속도 제어 포함). 속도 제한 장치(AD-LON-004)도 B라 같은 ASIL 행 없음' },
  '후석 엔터테인먼트 Gen1': { primary: 'IN-HMI-016', confidence: 'high', note: '뒷좌석 엔터테인먼트' },
  '레거시 원격 시동 Gen1': { primary: 'BC-HVAC-006', confidence: 'medium', note: '원격 공조 제어·시동(Remote control/start) — 3G 텔레매틱스 경로는 CO-TCU 쪽이라 포함 행 검토 필요' },
  '스노우 주행 모드': { primary: 'CH-VMC-008', included: ['CH-BRK-003'], confidence: 'medium', note: '험로 주행 모드(Terrain modes) + 구동력 제어(TCS). 회생제동 연계는 기준 행에 없음' },
  '배터리 급속충전 예열': { primary: 'PE-BMS-012', confidence: 'high', note: '급속 충전 전 배터리 예열' },
  '차로 유지 보조': { primary: 'AD-LAT-002', confidence: 'high', note: '차로 유지 보조(LKA). 시드 ASIL C ≠ 기준 B(사유 기록)',
    asilDeviationReason: 'v0.81 데이터셋 HARA 결과(ASIL C) 유지 — 기준 행 LKA(AD-LAT-002) 대표 ASIL B보다 높음. ASIL C인 차로 중앙 유지(AD-LAT-004)는 상시 중앙 유지라 시드 설명(차선 이탈 감지 후 조향 보조)과 다름' },
  'IC·JC 경로 사전안내': { primary: 'IN-NAV-009', confidence: 'medium', note: '차로 단위 안내 — IC·JC 진입·진출 방향과 필요 차로 안내' },
  '고속도로 IC·JC 상세 안내': { primary: 'IN-NAV-009', included: ['IN-NAV-004'], confidence: 'medium', note: '차로 단위 안내 + 확대·3D 지도 보기' },
  '전방 안전거리 3단계': { candidates: ['AD-LON-009', 'AD-LON-002'], note: '거리 3단계 판정·안내 기능 — 전방 충돌 경고(FCW)·ACC와 범위가 다르다(데모 vECU 기능). 기준 행 추가 요청 또는 후보 확정 필요' },
  '전방 안전거리 확대': { candidates: ['AD-LON-002', 'AD-LON-009'], note: '목표 차간거리 확대 유지 — ACC 설정 거리 변경인지 별도 기능인지 확인 필요' },
  '급가속 억제': { candidates: ['PE-VCU-008', 'PE-VCU-001'], note: '페달 급조작 가속 완화 — 기준 행 PE-VCU-008은 중국(GB) 전용 페달 오조작 억제라 권역이 다름' },
};

const isMapped = (m: Mapped | Missing): m is Mapped => 'primary' in m;

type Asil = 'QM' | 'A' | 'B' | 'C' | 'D';

/** refs: 기준 행 대표 ASIL(refs.json) — 시드 ASIL과 대조해 asilDeviation(from 대표 ASIL → to 시드 ASIL)을 만든다 */
export function buildSeedLinks(features: { featureId: string; name: string; asil: Asil }[], refs: { refId: string; asilRep: Asil }[]) {
  const byId = new Map<string, string>();
  for (const f of features) if (!byId.has(f.featureId)) byId.set(f.featureId, f.name);
  const asilRep = new Map(refs.map((r) => [r.refId, r.asilRep]));
  const links: Record<string, { refId: string; role: 'PRIMARY' | 'INCLUDED'; refVersion: string }[]> = {};
  const confidence: Record<string, Confidence> = {};
  const asilDeviation: Record<string, { from: Asil; to: Asil; reason: string }> = {};
  const missing: Record<string, { name: string; featureRefs: string; candidates: string[] }> = {};
  for (const fid of [...byId.keys()].sort()) {
    const name = byId.get(fid)!;
    const m = SEED_MAP[name];
    if (m && isMapped(m)) {
      links[fid] = [
        { refId: m.primary, role: 'PRIMARY', refVersion: RELEASE },
        ...(m.included ?? []).map((refId) => ({ refId, role: 'INCLUDED' as const, refVersion: RELEASE })),
      ];
      confidence[fid] = m.confidence;
      // 버전마다 ASIL이 다를 수 있다 — 대표 행과 다른 ASIL이 하나뿐이어야 사유 하나(from·to)로 적는다
      const from = asilRep.get(m.primary);
      if (!from) throw new Error(`${name}: 대표 기준 행 ${m.primary}가 refs.json에 없음`);
      const off = [...new Set(features.filter((f) => f.featureId === fid && f.asil !== from).map((f) => f.asil))];
      if (off.length > 1) throw new Error(`${name}(${fid}): 버전별 ASIL ${off.join('·')}가 대표 행 ${m.primary} ${from}과 다름 — 사유 하나로 적을 수 없음`);
      if (off.length && !m.asilDeviationReason) throw new Error(`${name}(${fid}): 시드 ASIL ${off[0]} ≠ ${m.primary} 대표 ASIL ${from} — 같은 ASIL의 같은 기능 행으로 대표를 다시 고르거나 asilDeviationReason`);
      if (off.length) asilDeviation[fid] = { from, to: off[0], reason: m.asilDeviationReason! };
    } else {
      missing[fid] = { name, featureRefs: m ? m.note : '대응표에 없는 기능명 — SEED_MAP에 추가', candidates: m ? m.candidates : [] };
    }
  }
  // ASIL이 같은데 사유가 남아 있으면 실패한다 — 남기면 G2에 거짓 검토 표시가 뜬다(feature-refs asilDeviationFor와 같은 규칙)
  for (const [name, m] of Object.entries(SEED_MAP))
    if (isMapped(m) && m.asilDeviationReason && ![...byId].some(([fid, n]) => n === name && asilDeviation[fid])) throw new Error(`${name}: 시드 ASIL이 대표 행과 같은데 asilDeviationReason이 있음 — 지울 것`);
  const basis = Object.fromEntries(Object.entries(SEED_MAP).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    _method:
      '시드 Feature(data/fixtures/v0.81/features.json, featureId별 1건)의 기능명·설명·태그·ASIL을 Feature DB v1.3 기준 행의 한/영 기능명·별칭·컴포넌트와 사람이 대조해 정한 표(tools/refdb/seed-links.ts SEED_MAP). ' +
      '같은 기능명은 같은 대응. confidence high = 기능 범위가 같음, medium = 가장 가까운 행(범위 차이는 note). 불확실·없음은 _missing(후보 포함) — 사용자 확인 대상. ' +
      'ASIL이 대표 행 대표 ASIL과 다르면 asilDeviation(from 대표 ASIL·to 시드 ASIL·reason)에 사유를 둔다 — 같은 ASIL의 같은 기능 행이 없어 대표를 그대로 둔 경우뿐이고, 시드가 그 버전 doc.asilDeviation으로 넣는다(30-95 §6.3, 2026-11-04 사용자 결정).',
    refVersion: RELEASE,
    counts: { features: byId.size, linked: Object.keys(links).length, missing: Object.keys(missing).length, asilDeviation: Object.keys(asilDeviation).length },
    links,
    confidence,
    asilDeviation,
    basis,
    _missing: missing,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const features = JSON.parse(readFileSync(FEATURES, 'utf8'));
  const text = serialize(buildSeedLinks(features, JSON.parse(readFileSync(REFS, 'utf8'))));
  if (process.argv.includes('--check')) {
    const same = existsSync(OUT) && readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') === text;
    console.log(same ? '  ✓ seed-links.json 최신' : '  ✕ seed-links.json이 SEED_MAP 결과와 다름 — node tools/refdb/seed-links.ts');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, text);
  const r = JSON.parse(text);
  console.log(`seed-links.json — Feature ${r.counts.features}개 · 연결 ${r.counts.linked} · 미연결 ${r.counts.missing} · ASIL 사유 ${r.counts.asilDeviation}`);
}
