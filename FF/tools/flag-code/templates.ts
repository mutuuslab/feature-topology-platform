// 차량 기능 앱 저장소 파일 템플릿(20-97 §5.2·§5.3) — 생성기가 Feature 상태로 파일 내용을 만든다. 순수 함수, 줄 끝 LF.
// Flag 상수·호출 뼈대(flags.ts·flag-guards.ts)는 계약의 flagScaffoldFiles 그대로 쓰고, 여기서는 기능 분기·시험·저장소 설정만 만든다.
import { createHash } from 'node:crypto';

export type ControlPoint = 'Flag' | 'Parameter' | 'Signal' | 'DTC';
export interface PlanFlag {
  flagKey: string;
  controlPoint: ControlPoint;
  ordinal: number;
}
export interface FeatureInfo {
  featureId: string;
  version: string;
  name: string;
  description: string;
  pkg: string;
  /** ASIL A~D(F2 이상) — 차량 로컬 Guard도 허용해야 켠다 */
  safetyRelated: boolean;
}
/** 기능 분기 렌더 입력 — removed: 호출을 지우고 기존 경로로 고정한 Flag(정리 커밋), dynamic: 동적 키 실험 함수 추가 */
export interface FeatureRender {
  info: FeatureInfo;
  flags: PlanFlag[];
  removed: ReadonlySet<string>;
  dynamic: boolean;
}

const HEADER = '// 시연용 생성 코드 — 고객 차량 SW가 아닙니다. Feature Platform 등록 데이터로 만든 예시 구현입니다.';
const RUNTIME = '../../../../runtime/src';
export const SDK_METHODS = ['getBooleanValue', 'getBooleanDetails', 'getStringValue', 'getNumberValue', 'getObjectValue', 'isEnabled', 'getVariant'] as const;
export const lines = (...xs: (string | false | null | undefined)[]) => xs.filter((x): x is string => typeof x === 'string').join('\n') + '\n';
const hash = (s: string) => createHash('sha256').update(s).digest();
/** 키마다 결정적인 작은 수 */
export const seeded = (key: string, mod: number, salt = '') => hash(salt + key).readUInt32BE(0) % mod;
const constName = (flagKey: string) => flagKey.toUpperCase();
const guardName = (flagKey: string) => {
  const [head, ...rest] = flagKey.split('_');
  return head + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') + 'Enabled';
};
/** 주석 한 줄 — 줄바꿈·주석 닫힘을 지운다 */
const oneLine = (s: string) => s.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim();
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** 제어점별 함수 이름·접미 — 같은 제어점이 둘 이상이면 순번을 붙인다 */
export function entryNames(f: PlanFlag) {
  const n = f.ordinal > 1 ? String(f.ordinal) : '';
  const base = { Flag: 'runFeature', Parameter: 'applyParameters', Signal: 'emitSignal', DTC: 'reportFault' }[f.controlPoint];
  return { fn: base + n, suffix: n ? `_${n}` : '' };
}
const paramOf = (key: string) => {
  const def = 10 + seeded(key, 40, 'param');
  return { def, min: Math.floor(def / 2), max: def * 3, next: def + 1 + seeded(key, def, 'next') };
};
const dtcOf = (key: string) => `${'BCPU'[seeded(key, 4, 'dtc')]}${String(1000 + seeded(key, 9000, 'code')).padStart(4, '0')}`;
const signalOf = (info: FeatureInfo, key: string) => `${info.featureId.toLowerCase()}.${key}`;

// ── 저장소 공통 파일 ─────────────────────────────────────
export function repoRootFiles(repo: { name: string; repository: string; displayName: string; showcase: boolean }): Record<string, string> {
  return {
    '.gitattributes': lines('* text=auto eol=lf'),
    '.gitignore': lines('node_modules/', '*.log', '.DS_Store'),
    'package.json': JSON.stringify({
      name: repo.name,
      private: true,
      description: `${repo.displayName} — Feature Flag로 켜고 끄는 차량 기능 예시(시연용 생성 코드)`,
      type: 'module',
      workspaces: ['packages/*'],
      engines: { node: '>=24' },
      scripts: { test: 'node --test "packages/**/*.test.ts"', typecheck: 'tsc -p tsconfig.json' },
      devDependencies: { '@types/node': '^24.0.0', typescript: '5.9.3' },
    }, null, 2) + '\n',
    'tsconfig.base.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true, verbatimModuleSyntax: true, types: ['node'] },
    }, null, 2) + '\n',
    'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json', include: ['packages/*/src/**/*.ts'] }, null, 2) + '\n',
    'ff-flags.config.json': JSON.stringify({
      repository: repo.repository,
      provider: 'GITHUB',
      defaultBranch: 'main',
      scanPaths: ['packages'],
      packages: ['adas', 'ivi', 'body', 'chassis', 'powertrain', 'safety', 'connectivity', 'platform'].map((name) => ({ name, path: `packages/${name}` })),
      sdkMethods: SDK_METHODS,
      flagConstants: 'packages/<패키지>/src/features/feat-NNNNN/flags.ts',
      generatedBy: 'Feature Platform tools/flag-code/generate-vehicle-apps.ts',
    }, null, 2) + '\n',
    '.github/workflows/ff-flag-check.yml': workflow(),
    'README.md': repoReadme(repo),
    ...runtimeFiles(),
  };
}

function repoReadme(repo: { name: string; repository: string; displayName: string; showcase: boolean }) {
  return lines(
    `# ${repo.name}`,
    '',
    `${repo.displayName}. Feature Platform(FF)에 등록된 Feature의 Flag를 실제 분기 코드로 구현한 차량 SW 예시 저장소입니다.`,
    repo.showcase ? '전시 차량군 Feature만 담습니다. FF의 전시 데이터가 켜져 있을 때만 연결합니다.' : '기준 데이터(v0.81)와 데모 활동 Feature를 담습니다.',
    '',
    '> 시연용 생성 코드입니다. 고객 차량 SW가 아니며, FF 생성기가 등록 데이터로 미리 만든 이력입니다.',
    '',
    '## 구조',
    '',
    '- `packages/runtime` — Flag 클라이언트(OpenFeature 형태), 로컬 Guard, 시간 초과·오류를 꺼짐으로 돌리는 `flagOn`, 시험 도구',
    '- `packages/<도메인>/src/features/feat-NNNNN/`',
    '  - `flags.ts` — Flag 키 상수(키 문자열의 유일한 위치, FF가 만든다)',
    '  - `flag-guards.ts` — 기본값 OFF 호출 뼈대(FF가 만든다)',
    '  - `feature.ts` — 제어점별 기능 분기(Flag·Parameter·Signal·DTC)',
    '  - `feature.test.ts` — 기본 OFF, 켜짐 분기, Guard 차단, 오류 시 OFF',
    '- `ff-flags.config.json` — FF 연결 정보(비밀 없음)',
    '- `.github/workflows/ff-flag-check.yml` — 시험·타입 검사, FF 연결 시 Flag 스캔 업로드',
    '',
    '## 흐름',
    '',
    '1. FF에서 Feature Version이 승인되면 FF Flag Bot이 `ff/flags/feat-nnnnn-<버전>` 브랜치에 상수·호출 뼈대를 커밋하고 PR을 연다.',
    '2. 도메인 구현 담당이 같은 PR에 기능 분기와 시험을 더한다. FF Flag 검사가 통과하면 병합한다.',
    '3. 기본 브랜치에 들어온 커밋마다 FF가 Flag 호출을 스캔·서명하고 등록 원장과 대사한다.',
    '',
    '## 실행',
    '',
    '```sh',
    'npm install',
    'npm test',
    'npm run typecheck',
    '```',
    '',
    'Node 24 이상이 TypeScript 파일을 바로 실행합니다.',
  );
}

function workflow() {
  return lines(
    '# FF Flag 검사 — 시험·타입 검사는 늘 돌고, FF 연결 변수가 있으면 Flag 스캔 결과를 OIDC로 FF에 올린다(GitHub App 모드에서는 FF Check Run이 대신한다)',
    'name: ff-flag-check',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    'permissions:',
    '  contents: read',
    '  id-token: write',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 24',
    '      - run: npm install --no-audit --no-fund',
    '      - run: npm test',
    '      - run: npm run typecheck',
    '  ff-scan:',
    "    if: ${{ vars.FF_BASE_URL != '' && vars.FF_SCANNER_PACKAGE != '' }}",
    '    needs: test',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 24',
    '      - name: Flag 스캔(v2)',
    '        run: npx --yes --package="${{ vars.FF_SCANNER_PACKAGE }}" ff-flag-scan --repo . --url "${{ github.server_url }}/${{ github.repository }}" --ref "${{ github.sha }}" --path packages --out manifest.json',
    '      - name: FF에 올리기(OIDC)',
    '        env:',
    '          FF_BASE_URL: ${{ vars.FF_BASE_URL }}',
    '        run: |',
    '          TOKEN=$(curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=ff-flag-scan" | jq -r .value)',
    '          jq -n --slurpfile m manifest.json --arg t "$TOKEN" \'{manifest: $m[0], oidcToken: $t}\' > body.json',
    '          curl -sS -f -X POST -H "Content-Type: application/json" --data @body.json "$FF_BASE_URL/api/flag-code/scans/upload"',
  );
}

function runtimeFiles(): Record<string, string> {
  const dir = 'packages/runtime';
  return {
    [`${dir}/package.json`]: JSON.stringify({ name: '@vehicle/runtime', private: true, type: 'module', version: '1.0.0' }, null, 2) + '\n',
    [`${dir}/README.md`]: lines(
      '# runtime',
      '',
      '모든 기능 패키지가 쓰는 Flag 클라이언트 경계입니다.',
      '',
      '- `FlagClient` — OpenFeature 형태. 차량에서는 서명 검증된 스냅샷을 읽는 클라이언트가 구현한다(`SignedSnapshotSource`).',
      '- `flagOn` — 오류·시간 초과는 꺼짐(false)으로 돌린다.',
      '- `LocalGuard` — 안전 관련 Feature(F2 이상)는 차량의 로컬 Guard가 허용해야 켠다.',
      '- `testing.ts` — 기능 시험용 가짜 클라이언트·신호·고장 코드 기록기.',
    ),
    [`${dir}/src/flag-client.ts`]: lines(
      HEADER,
      '// Flag 클라이언트 경계 — 기능 코드는 FF가 만든 flag-guards.ts로만 Flag를 읽고, 여기의 flagOn으로 오류·시간 초과를 꺼짐으로 돌린다.',
      '',
      '/** 평가 대상 — targetingKey는 VIN */',
      'export interface FlagContext {',
      '  targetingKey: string;',
      '}',
      '',
      '/** OpenFeature 형태의 최소 클라이언트 — 기본값은 늘 false(꺼짐)로 넘긴다 */',
      'export interface FlagClient {',
      '  getBooleanValue(flagKey: string, defaultValue: false, context: FlagContext): Promise<boolean>;',
      '}',
      '',
      '/** 차량 로컬 Guard — 운전 상태·고장 상태에서 켜면 안 되는 Flag를 막는다(서버 값과 무관) */',
      'export interface LocalGuard {',
      '  allows(flagKey: string, vin: string): boolean;',
      '}',
      '',
      '/** 서명 스냅샷 검증 연결점 — 차량 클라이언트가 FF 게시본 서명을 검증한 뒤 값을 읽는다 */',
      'export interface SignedSnapshotSource {',
      '  verifiedAt(): string | null;',
      '  revision(): number | null;',
      '}',
      '',
      '/** 신호 출력(차량 네트워크) */',
      'export interface SignalBus {',
      '  publish(signal: string, value: string): void;',
      '}',
      '',
      '/** 고장 코드 — report는 외부 보고, log는 내부 기록만 */',
      'export interface DtcSink {',
      '  report(code: string): void;',
      '  log(code: string): void;',
      '}',
      '',
      '/** 보정(calibration) 값 저장소 — 파라미터 묶음의 새 값 */',
      'export interface Calibration {',
      '  value(flagKey: string): number | undefined;',
      '}',
      '',
      '/** 기능 코드가 받는 차량 의존성 */',
      'export interface FeatureDeps {',
      '  client: FlagClient;',
      '  vin: string;',
      '  localGuard: LocalGuard;',
      '  signals: SignalBus;',
      '  dtc: DtcSink;',
      '  calibration: Calibration;',
      '  /** Flag 읽기 제한 시간(ms) — 넘으면 꺼짐 */',
      '  timeoutMs: number;',
      '}',
      '',
      'export const FLAG_TIMEOUT_MS = 50;',
      '',
      '/** Flag 읽기 결과 — 오류·시간 초과·true가 아닌 값은 모두 꺼짐 */',
      'export async function flagOn(read: () => Promise<boolean>, timeoutMs: number = FLAG_TIMEOUT_MS): Promise<boolean> {',
      '  let timer: ReturnType<typeof setTimeout> | undefined;',
      '  try {',
      '    const late = new Promise<boolean>((resolve) => {',
      '      timer = setTimeout(() => resolve(false), timeoutMs);',
      '    });',
      '    return (await Promise.race([read(), late])) === true;',
      '  } catch {',
      '    return false;',
      '  } finally {',
      '    if (timer !== undefined) clearTimeout(timer);',
      '  }',
      '}',
      '',
      '/** 로컬 Guard 확인 — Guard 오류도 막힘으로 본다 */',
      'export function guardAllows(guard: LocalGuard, flagKey: string, vin: string): boolean {',
      '  try {',
      '    return guard.allows(flagKey, vin) === true;',
      '  } catch {',
      '    return false;',
      '  }',
      '}',
    ),
    [`${dir}/src/testing.ts`]: lines(
      HEADER,
      '// 기능 시험 도구 — 가짜 Flag 클라이언트, 신호·고장 코드 기록기. 실제 Flag 키는 시험 파일이 상수로 넘긴다.',
      "import type { Calibration, DtcSink, FeatureDeps, FlagClient, LocalGuard, SignalBus } from './flag-client.ts';",
      '',
      'export const TEST_VIN = \'KMHTEST0000000001\';',
      '',
      '/** 주어진 키만 켜진 클라이언트 */',
      'export function fakeClient(on: readonly string[] = []): FlagClient {',
      '  const set = new Set(on);',
      '  return { getBooleanValue: async (flagKey: string) => set.has(flagKey) };',
      '}',
      '/** 늘 오류를 내는 클라이언트(연결 실패) */',
      'export const failingClient: FlagClient = {',
      '  getBooleanValue: async () => {',
      "    throw new Error('연결 실패');",
      '  },',
      '};',
      '/** 응답하지 않는 클라이언트(시간 초과) */',
      'export const hangingClient: FlagClient = { getBooleanValue: () => new Promise<boolean>(() => undefined) };',
      '',
      'export const allowAll: LocalGuard = { allows: () => true };',
      'export const denyAll: LocalGuard = { allows: () => false };',
      '',
      'export interface Recorded {',
      '  signals: { signal: string; value: string }[];',
      '  reported: string[];',
      '  logged: string[];',
      '}',
      '',
      '/** 시험용 차량 의존성 — 신호·고장 코드를 기록한다 */',
      'export function testDeps(client: FlagClient, opts: { guard?: LocalGuard; calibration?: Record<string, number>; timeoutMs?: number } = {}): FeatureDeps & { recorded: Recorded } {',
      '  const recorded: Recorded = { signals: [], reported: [], logged: [] };',
      '  const signals: SignalBus = { publish: (signal, value) => void recorded.signals.push({ signal, value }) };',
      '  const dtc: DtcSink = { report: (code) => void recorded.reported.push(code), log: (code) => void recorded.logged.push(code) };',
      '  const values = opts.calibration ?? {};',
      '  const calibration: Calibration = { value: (flagKey) => values[flagKey] };',
      '  return { client, vin: TEST_VIN, localGuard: opts.guard ?? allowAll, signals, dtc, calibration, timeoutMs: opts.timeoutMs ?? 20, recorded };',
      '}',
    ),
    [`${dir}/src/flag-client.test.ts`]: lines(
      HEADER,
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { flagOn, guardAllows } from './flag-client.ts';",
      '',
      "test('flagOn — true만 켜짐, 오류·시간 초과·다른 값은 꺼짐', async () => {",
      '  assert.equal(await flagOn(async () => true), true);',
      '  assert.equal(await flagOn(async () => false), false);',
      '  assert.equal(await flagOn(async () => {',
      "    throw new Error('실패');",
      '  }), false);',
      '  assert.equal(await flagOn(() => new Promise<boolean>(() => undefined), 5), false);',
      '  assert.equal(await flagOn(async () => 1 as unknown as boolean), false);',
      '});',
      '',
      "test('guardAllows — Guard 오류는 막힘', () => {",
      "  assert.equal(guardAllows({ allows: () => true }, 'x_00001_enable', 'VIN'), true);",
      "  assert.equal(guardAllows({ allows: () => {",
      "    throw new Error('고장');",
      "  } }, 'x_00001_enable', 'VIN'), false);",
      '});',
    ),
  };
}

// ── 도메인 패키지 ───────────────────────────────────────
const PKG_LABEL: Record<string, string> = {
  adas: '주행 보조·주차', ivi: '인포테인먼트·안내', body: '차체·편의', chassis: '섀시·주행 성능', powertrain: '전동화·동력', safety: '안전', connectivity: '연결·OTA', platform: '공통 플랫폼',
};
export function packageJson(pkg: string) {
  return JSON.stringify({ name: `@vehicle/${pkg}`, private: true, type: 'module', version: '1.0.0' }, null, 2) + '\n';
}
export function packageReadme(pkg: string, features: { featureId: string; version: string; name: string; flags: string[] }[]) {
  return lines(
    `# ${pkg}`,
    '',
    `${PKG_LABEL[pkg] ?? pkg} 도메인 기능입니다. 담당: ${pkg} 구현 담당.`,
    '',
    '| Feature | Version | 이름 | Flag |',
    '| --- | --- | --- | --- |',
    ...features.map((f) => `| ${f.featureId} | ${f.version} | ${f.name.replace(/\|/g, '/')} | ${f.flags.map((k) => `\`${k}\``).join(', ')} |`),
  );
}

// ── 기능 분기(feature.ts)·시험(feature.test.ts) ─────────────────
export function featureSource(r: FeatureRender): string {
  const { info, flags, removed } = r;
  const live = flags.filter((f) => !removed.has(f.flagKey));
  const usedConsts = flags.map((f) => constName(f.flagKey));
  const out: string[] = [
    HEADER,
    `// ${info.featureId} ${info.version} 「${oneLine(info.name)}」 — ${oneLine(info.description)}`,
    '// 모든 분기는 flag-guards.ts의 함수로만 Flag를 읽는다. 오류·시간 초과는 꺼짐(기존 경로)으로 간다.',
    `import { flagOn, guardAllows, type FeatureDeps } from '${RUNTIME}/flag-client.ts';`,
    `import { ${usedConsts.join(', ')} } from './flags.ts';`,
  ];
  if (live.length) out.push(`import { ${live.map((f) => guardName(f.flagKey)).join(', ')} } from './flag-guards.ts';`);
  out.push(
    '',
    `export const FEATURE = { featureId: ${q(info.featureId)}, version: ${q(info.version)}, name: ${q(info.name)}, safetyRelated: ${info.safetyRelated} } as const;`,
    '',
  );
  if (live.length) out.push(
    info.safetyRelated ? '/** 켜짐 판단 — 안전 관련 Feature(F2 이상)라 차량 로컬 Guard도 허용해야 켠다 */' : '/** 켜짐 판단 — QM Feature라 로컬 Guard는 보지 않는다 */',
    'async function enabled(d: FeatureDeps, flagKey: string, read: () => Promise<boolean>): Promise<boolean> {',
    '  if (!(await flagOn(read, d.timeoutMs))) return false;',
    info.safetyRelated ? '  return guardAllows(d.localGuard, flagKey, d.vin);' : '  return true;',
    '}',
    '',
  );
  for (const f of flags) {
    const { fn, suffix } = entryNames(f);
    const c = constName(f.flagKey);
    const isRemoved = removed.has(f.flagKey);
    const read = `enabled(d, ${c}, () => ${guardName(f.flagKey)}(d.client, { targetingKey: d.vin }))`;
    if (f.controlPoint === 'Flag') {
      out.push(
        isRemoved ? `/** Flag 제어점(${f.flagKey}) — 정리됨: 기존 경로로 고정 */` : `/** Flag 제어점(${f.flagKey}) — 켜지면 새 기능 경로, 꺼지면 기존 경로 */`,
        `export async function ${fn}(d: FeatureDeps): Promise<{ path: 'NEW' | 'LEGACY'; flagKey: string }> {`,
        isRemoved ? `  // 정리: 새 경로를 걷어내고 기존 경로로 고정했다(${c})` : `  const on = await ${read};`,
        isRemoved ? `  return { path: 'LEGACY', flagKey: ${c} };` : `  return { path: on ? 'NEW' : 'LEGACY', flagKey: ${c} };`,
        '}',
        '',
      );
    } else if (f.controlPoint === 'Parameter') {
      const p = paramOf(f.flagKey);
      out.push(
        `export const PARAM_DEFAULT${suffix} = ${p.def};`,
        `export const PARAM_RANGE${suffix} = { min: ${p.min}, max: ${p.max} } as const;`,
        isRemoved ? `/** Parameter 제어점(${f.flagKey}) — 정리됨: 기본 파라미터로 고정 */` : `/** Parameter 제어점(${f.flagKey}) — 켜지면 보정값의 새 파라미터 묶음(범위 밖이면 기본), 꺼지면 기본 파라미터 */`,
        `export async function ${fn}(d: FeatureDeps): Promise<{ value: number; source: 'DEFAULT' | 'CALIBRATION' }> {`,
        ...(isRemoved
          ? [`  // 정리: 기본 파라미터로 고정했다(${c})`]
          : [
            `  if (!(await ${read})) return { value: PARAM_DEFAULT${suffix}, source: 'DEFAULT' };`,
            `  const v = d.calibration.value(${c});`,
            `  if (typeof v !== 'number' || !Number.isFinite(v) || v < PARAM_RANGE${suffix}.min || v > PARAM_RANGE${suffix}.max) return { value: PARAM_DEFAULT${suffix}, source: 'DEFAULT' };`,
            `  return { value: v, source: 'CALIBRATION' };`,
          ]),
        ...(isRemoved ? [`  return { value: PARAM_DEFAULT${suffix}, source: 'DEFAULT' };`] : []),
        '}',
        '',
      );
    } else if (f.controlPoint === 'Signal') {
      out.push(
        `export const SIGNAL${suffix} = ${q(signalOf(info, f.flagKey))};`,
        isRemoved ? `/** Signal 제어점(${f.flagKey}) — 정리됨: 신호를 발행하지 않는다 */` : `/** Signal 제어점(${f.flagKey}) — 켜졌을 때만 신호를 발행한다 */`,
        `export async function ${fn}(d: FeatureDeps, value: string): Promise<boolean> {`,
        ...(isRemoved
          ? [`  // 정리: 신호 발행을 걷어냈다(${c})`, '  void d;', '  void value;', '  return false;']
          : [`  const on = await ${read};`, `  if (on) d.signals.publish(SIGNAL${suffix}, value);`, '  return on;']),
        '}',
        '',
      );
    } else {
      out.push(
        `export const DTC_CODE${suffix} = ${q(dtcOf(f.flagKey))};`,
        isRemoved ? `/** DTC 제어점(${f.flagKey}) — 정리됨: 내부 기록만 남긴다 */` : `/** DTC 제어점(${f.flagKey}) — 켜지면 고장 코드를 보고하고, 꺼지면 내부 기록만 남긴다 */`,
        `export async function ${fn}(d: FeatureDeps): Promise<'REPORTED' | 'LOGGED'> {`,
        ...(isRemoved
          ? [`  // 정리: 내부 기록만 남기도록 고정했다(${c})`, `  d.dtc.log(DTC_CODE${suffix});`, "  return 'LOGGED';"]
          : [
            `  if (await ${read}) {`,
            `    d.dtc.report(DTC_CODE${suffix});`,
            "    return 'REPORTED';",
            '  }',
            `  d.dtc.log(DTC_CODE${suffix});`,
            "  return 'LOGGED';",
          ]),
        '}',
        '',
      );
    }
  }
  if (r.dynamic) out.push(
    '/** 지역별 안내 배너 실험 — 지역 코드로 키를 조합한다 */',
    "export async function regionalBanner(d: FeatureDeps, region: 'kr' | 'eu'): Promise<{ banner: boolean; compact: boolean }> {",
    '  const ctx = { targetingKey: d.vin };',
    '  const banner = await flagOn(() => d.client.getBooleanValue(`ivi_${region}_banner`, false, ctx), d.timeoutMs);',
    '  const compact = await flagOn(() => d.client.getBooleanValue(`ivi_${region}_compact`, false, ctx), d.timeoutMs);',
    '  return { banner, compact };',
    '}',
    '',
  );
  return out.join('\n').replace(/\n+$/, '\n');
}

export function featureTest(r: FeatureRender): string {
  const { info, flags, removed } = r;
  const consts = flags.map((f) => constName(f.flagKey));
  const fns = flags.map((f) => entryNames(f).fn);
  const extra = new Set<string>();
  for (const f of flags) {
    const { suffix } = entryNames(f);
    if (f.controlPoint === 'Parameter') extra.add(`PARAM_DEFAULT${suffix}`).add(`PARAM_RANGE${suffix}`);
    if (f.controlPoint === 'Signal') extra.add(`SIGNAL${suffix}`);
    if (f.controlPoint === 'DTC') extra.add(`DTC_CODE${suffix}`);
  }
  if (r.dynamic) extra.add('regionalBanner');
  const name = `${info.featureId} ${oneLine(info.name)}`;
  /** 한 Flag의 기대 — on: 켜졌다고 볼 때 */
  const expectOf = (f: PlanFlag, on: boolean, indent = '  '): string[] => {
    const { fn, suffix } = entryNames(f);
    const live = on && !removed.has(f.flagKey);
    if (f.controlPoint === 'Flag') return [`${indent}assert.equal((await ${fn}(d)).path, '${live ? 'NEW' : 'LEGACY'}');`];
    if (f.controlPoint === 'Parameter') {
      const p = paramOf(f.flagKey);
      return [`${indent}assert.deepEqual(await ${fn}(d), ${live ? `{ value: ${p.next}, source: 'CALIBRATION' }` : `{ value: PARAM_DEFAULT${suffix}, source: 'DEFAULT' }`});`];
    }
    if (f.controlPoint === 'Signal') return [`${indent}assert.equal(await ${fn}(d, 'ON'), ${live});`];
    return [`${indent}assert.equal(await ${fn}(d), '${live ? 'REPORTED' : 'LOGGED'}');`];
  };
  const params = flags.filter((f) => f.controlPoint === 'Parameter');
  const calOpt = params.length ? `calibration: { ${params.map((f) => `[${constName(f.flagKey)}]: ${paramOf(f.flagKey).next}`).join(', ')} }` : '';
  const opts = (more: string[]) => {
    const all = [...more, ...(calOpt ? [calOpt] : [])];
    return all.length ? `, { ${all.join(', ')} }` : '';
  };
  const signals = flags.filter((f) => f.controlPoint === 'Signal');
  const dtcs = flags.filter((f) => f.controlPoint === 'DTC');
  const liveSignals = signals.filter((f) => !removed.has(f.flagKey)).length;
  const liveDtcs = dtcs.filter((f) => !removed.has(f.flagKey)).length;
  const out: string[] = [
    HEADER,
    `// ${info.featureId} 기능 분기 시험 — 기본 OFF, 켜짐 분기, Guard 차단, 오류·시간 초과 시 OFF`,
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    `import { denyAll, failingClient, fakeClient, hangingClient, testDeps } from '${RUNTIME}/testing.ts';`,
    `import { ${consts.join(', ')} } from './flags.ts';`,
    `import { FEATURE, ${[...fns, ...extra].join(', ')} } from './feature.ts';`,
    '',
    `const ALL = [${consts.join(', ')}];`,
    '',
    `test(${q(`${name} — 기본값 OFF(Flag 없음)는 기존 경로`)}, async () => {`,
    `  const d = testDeps(fakeClient([])${opts([])});`,
    ...flags.flatMap((f) => expectOf(f, false)),
    ...(signals.length ? ['  assert.equal(d.recorded.signals.length, 0);'] : []),
    ...(dtcs.length ? ['  assert.equal(d.recorded.reported.length, 0);'] : []),
    '});',
    '',
    `test(${q(`${name} — 켜지면 새 경로`)}, async () => {`,
    `  const d = testDeps(fakeClient(ALL)${opts([])});`,
    `  assert.equal(FEATURE.featureId, ${q(info.featureId)});`,
    ...flags.flatMap((f) => expectOf(f, true)),
    ...(signals.length ? [`  assert.equal(d.recorded.signals.length, ${liveSignals});`] : []),
    ...(dtcs.length ? [`  assert.equal(d.recorded.reported.length, ${liveDtcs});`] : []),
    '});',
    '',
    `test(${q(`${name} — ${info.safetyRelated ? '로컬 Guard가 막으면 꺼짐(F2 이상)' : 'QM이라 로컬 Guard와 무관'}`)}, async () => {`,
    `  const d = testDeps(fakeClient(ALL)${opts(['guard: denyAll'])});`,
    ...flags.flatMap((f) => expectOf(f, !info.safetyRelated)),
    '});',
    '',
    `test(${q(`${name} — 클라이언트 오류·시간 초과는 꺼짐`)}, async () => {`,
    '  for (const client of [failingClient, hangingClient]) {',
    `    const d = testDeps(client${opts(['timeoutMs: 5'])});`,
    ...flags.flatMap((f) => expectOf(f, false, '    ')),
    '  }',
    '});',
  ];
  for (const f of flags.filter((x) => x.controlPoint === 'Parameter' && !removed.has(x.flagKey))) {
    const { fn, suffix } = entryNames(f);
    out.push(
      '',
      `test(${q(`${name} — ${f.flagKey} 범위 밖 보정값은 기본 파라미터`)}, async () => {`,
      `  const d = testDeps(fakeClient([${constName(f.flagKey)}]), { calibration: { [${constName(f.flagKey)}]: PARAM_RANGE${suffix}.max + 1 } });`,
      `  assert.deepEqual(await ${fn}(d), { value: PARAM_DEFAULT${suffix}, source: 'DEFAULT' });`,
      '});',
    );
  }
  for (const f of signals.filter((x) => !removed.has(x.flagKey))) {
    const { fn, suffix } = entryNames(f);
    out.push(
      '',
      `test(${q(`${name} — ${f.flagKey} 꺼지면 신호 발행 0회`)}, async () => {`,
      '  const d = testDeps(fakeClient([]));',
      `  await ${fn}(d, 'ON');`,
      `  assert.deepEqual(d.recorded.signals.filter((s) => s.signal === SIGNAL${suffix}), []);`,
      '});',
    );
  }
  for (const f of dtcs.filter((x) => !removed.has(x.flagKey))) {
    const { fn, suffix } = entryNames(f);
    out.push(
      '',
      `test(${q(`${name} — ${f.flagKey} 꺼지면 고장 코드 보고 0회(내부 기록만)`)}, async () => {`,
      '  const d = testDeps(fakeClient([]));',
      `  await ${fn}(d);`,
      `  assert.deepEqual(d.recorded.reported, []);`,
      `  assert.deepEqual(d.recorded.logged, [DTC_CODE${suffix}]);`,
      '});',
    );
  }
  if (r.dynamic) out.push(
    '',
    `test(${q(`${name} — 지역 배너 실험은 기본 꺼짐`)}, async () => {`,
    "  const d = testDeps(fakeClient(['ivi_kr_banner']));",
    "  assert.deepEqual(await regionalBanner(d, 'kr'), { banner: true, compact: false });",
    "  assert.deepEqual(await regionalBanner(d, 'eu'), { banner: false, compact: false });",
    '});',
  );
  return out.join('\n') + '\n';
}

/** 등록 전 실험 스위치(구현 담당이 문자열로 직접 호출) — FF 대사에서 미등록 키로 잡힌다 */
export function experimentFiles(info: FeatureInfo, flagKey: string): Record<string, string> {
  return {
    'experiment.ts': lines(
      HEADER,
      `// ${info.featureId} 비교 실험 스위치 — 구현 담당이 추가했다.`,
      `import type { FlagClient } from '${RUNTIME}/flag-client.ts';`,
      '',
      `/** 실험 켜짐 여부 — 오류는 꺼짐 */`,
      'export async function experimentEnabled(client: FlagClient, vin: string): Promise<boolean> {',
      '  try {',
      `    return (await client.getBooleanValue(${q(flagKey)}, false, { targetingKey: vin })) === true;`,
      '  } catch {',
      '    return false;',
      '  }',
      '}',
    ),
    'experiment.test.ts': lines(
      HEADER,
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      `import { failingClient, fakeClient, TEST_VIN } from '${RUNTIME}/testing.ts';`,
      "import { experimentEnabled } from './experiment.ts';",
      '',
      `test(${q(`${info.featureId} 실험 스위치 — 기본 꺼짐, 오류도 꺼짐`)}, async () => {`,
      '  assert.equal(await experimentEnabled(fakeClient([]), TEST_VIN), false);',
      `  assert.equal(await experimentEnabled(fakeClient([${q(flagKey)}]), TEST_VIN), true);`,
      '  assert.equal(await experimentEnabled(failingClient, TEST_VIN), false);',
      '});',
    ),
  };
}
