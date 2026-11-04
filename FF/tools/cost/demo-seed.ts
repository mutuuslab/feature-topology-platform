// npm run cost:demo-seed — 엑셀 산정 도구 v1.3 예시 과제(BCM, 46줄)를 데모 시드 픽스처로(C3 사용자 결정 "컴포넌트별 새 FF Feature 몇 개").
// 기준값 s0(data/golden/cost/s0-bcm-example.json)의 줄 입력·과제 설정 + Feature DB 기준 행의 컴포넌트 → data/fixtures/demo/cost-demo.json.
// Feature 한 개 = 컴포넌트 하나(첫 행이 대표, 나머지는 포함). Feature ASIL은 대표 행의 대표 ASIL이고, 다른 대표 ASIL을 가진 포함 행은
// 줄 입력에 그 ASIL을 적는다 — 엑셀의 '빈칸 = 그 행의 대표 ASIL'과 같은 계산이 되게(FF는 빈칸 = Feature ASIL, 20-94 §5).
// --check: 커밋된 픽스처가 지금 만든 것과 같은지(data:check가 부른다)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from '../lib.ts';

export const DEMO_FILE = join(FF, 'data', 'fixtures', 'demo', 'cost-demo.json');

/** 컴포넌트 → 데모 Feature 이름(구매 화면에서 읽히는 업무 이름) */
const NAMES: Record<string, string> = {
  'Lighting control': 'BCM 실내·외 조명 제어',
  'Body controller': 'BCM 바디 제어 기본 기능',
  'Access and locking': 'BCM 출입·잠금 제어',
  'Diagnostic services (UDS)': 'BCM 진단 서비스(UDS)',
  'Wiper and washer': 'BCM 와이퍼·워셔 제어',
  'Windows and roof': 'BCM 윈도·루프 제어',
  Mirrors: 'BCM 아웃사이드 미러 제어',
  'Low-voltage power management': 'BCM 저전압 전원 관리',
  'Bootloader and software update': 'BCM 부트로더·SW 업데이트',
  'Cybersecurity controls': 'BCM 사이버보안 제어',
};
/** 승인 예시 과제에 담는 컴포넌트 */
const APPROVED = ['Lighting control', 'Wiper and washer', 'Mirrors'];

export function buildDemo() {
  const g = JSON.parse(readFileSync(join(FF, 'data', 'golden', 'cost', 's0-bcm-example.json'), 'utf8'));
  const refs = new Map<string, { component: string; asilRep: string; nameKo: string }>(
    (JSON.parse(readFileSync(join(FF, 'data', 'reference', 'feature-db', 'v1.3', 'refs.json'), 'utf8')) as any[]).map((r) => [r.refId, r]),
  );
  const groups = new Map<string, string[]>();
  for (const l of g.lines as { refId: string }[]) {
    const c = refs.get(l.refId)?.component;
    if (!c || !NAMES[c]) throw new Error(`${l.refId}: 데모 이름이 없는 컴포넌트 ${c}`);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(l.refId);
  }
  const features = [...groups].map(([component, ids]) => ({
    key: component,
    name: NAMES[component],
    description: `엑셀 산정 도구 예시 과제(BCM 신규 개발)의 ${component} 기준 행 ${ids.length}개`,
    asil: refs.get(ids[0])!.asilRep,
    refs: ids.map((refId, i) => ({ refId, role: i === 0 ? 'PRIMARY' : 'INCLUDED' })),
  }));
  const featureAsil = new Map(features.flatMap((f) => f.refs.map((r) => [r.refId, f.asil] as const)));
  const lines = Object.fromEntries(
    (g.lines as { refId: string; inputs: Record<string, unknown> }[]).map((l) => {
      const inputs = Object.fromEntries(Object.entries(l.inputs).filter(([, v]) => v != null));
      const rep = refs.get(l.refId)!.asilRep;
      if (inputs.asil == null && rep !== featureAsil.get(l.refId)) inputs.asil = rep;
      return [l.refId, inputs];
    }),
  );
  const st = g.settings;
  const com = st.common as { input: unknown }[];
  const settings = {
    aace: st.aace,
    confidence: st.confidence,
    preset: st.preset,
    drivers: Object.fromEntries(Object.entries(st.drivers as Record<string, { direct: string | null }>).map(([k, v]) => [k, v.direct])),
    rateBasis: st.rateBasis,
    method: st.method,
    ohOverride: st.ohOverride,
    feeOverride: st.feeOverride,
    common: { pm: com[0].input === 'Y', scm: com[1].input === 'Y', pi: com[2].input === 'Y', qa: com[3].input, fs: com[4].input, cs: com[5].input, hil: com[6].input },
    directExpenses: [],
  };
  return {
    note: '데모 시드 — 엑셀 산정 도구 v1.3 예시 과제(BCM). tools/cost/demo-seed.ts가 만든다(손으로 고치지 않음). 데모 시드가 켜진 빈 DB에만 들어간다.',
    /** 엑셀 01_대시보드 F27 총개발비 — 시드 과제의 계산이 이 값과 1원 안에서 같아야 한다 */
    excelTotalCost: g.excel.dashboard.F27 as number,
    actors: { author: 'usr-author', estimator: 'usr-viewer', approver: 'usr-approver' },
    features,
    projects: [
      { name: 'BCM(바디 제어기) 신규 개발 — 예시', target: 'BCM / 신규 차종 1종, 사양 변형 2종', features: features.map((f) => f.key), settings, approve: null, checks: [] },
      {
        name: 'BCM 조명·와이퍼·미러 파생 — 1차 견적',
        target: 'BCM / 기존 차종 파생 1종',
        features: APPROVED,
        settings,
        approve: { submit: '구매 검토 요청', approve: '협력사 견적 비교 전 기준 금액으로 확정' },
        checks: [
          { no: 1, status: '확인', memo: '조명·와이퍼·미러 3개 Feature로 범위 확정' },
          { no: 9, status: '확인', memo: '' },
          { no: 10, status: '확인', memo: '' },
          { no: 18, status: '보완 필요', memo: '기능안전 관리 공수 미입력' },
        ],
      },
    ],
    lines,
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMain) {
  const text = JSON.stringify(buildDemo(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const now = readFileSync(DEMO_FILE, 'utf8').replace(/\r\n/g, '\n');
    if (now !== text) {
      console.error('cost:demo-seed — data/fixtures/demo/cost-demo.json이 최신이 아닙니다(npm run cost:demo-seed)');
      process.exit(1);
    }
    console.log('cost:demo-seed ✓ 최신');
  } else {
    writeFileSync(DEMO_FILE, text);
    const d = buildDemo();
    console.log(`cost:demo-seed → data/fixtures/demo/cost-demo.json · Feature ${d.features.length} · 줄 ${Object.keys(d.lines).length} · 과제 ${d.projects.length}`);
  }
}
