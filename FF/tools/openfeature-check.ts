// OpenFeature 규율 검사 (verify) — 보고서 11장
//   FFG-OFT-007: @openfeature/* Version을 정확히 고정(범위 기호 금지)하고, 설치본이 contracts OPENFEATURE_PINS와 같은가. Experimental 기능(Tracking·Multi-Provider)을 쓰지 않는가.
//   FFG-OFT-002: 코드의 평가 호출 기본값이 Safe State(false 리터럴)인가 — getBooleanValue/Details(key, <기본값>)
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF, readJson, rel, walk } from './lib.ts';

const require = createRequire(import.meta.url);
const { OPENFEATURE_PINS } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');

const errors: string[] = [];
const pins = OPENFEATURE_PINS.sdks as Record<string, string>;

// 1) 고정 — package.json 범위 기호 금지 + 설치본 일치
for (const ws of ['backend', 'frontend']) {
  const pkg = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(join(FF, ws, 'package.json'));
  for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([n]) => n.startsWith('@openfeature/'))) {
    if (!/^\d+\.\d+\.\d+$/.test(range)) errors.push(`${ws}/package.json ${name} "${range}" — 범위 지정 금지, 정확한 Version으로 (FFG-OFT-007)`);
    if (pins[name] && pins[name] !== range) errors.push(`${ws}/package.json ${name} ${range} ≠ OPENFEATURE_PINS ${pins[name]}`);
  }
}
for (const [name, version] of Object.entries(pins)) {
  const p = join(FF, 'node_modules', ...name.split('/'), 'package.json');
  if (existsSync(p) && readJson<{ version: string }>(p).version !== version) errors.push(`설치본 ${name} ${readJson<{ version: string }>(p).version} ≠ 고정 ${version}`);
}

// 2) Experimental 기능·기본값 규율 — 백엔드·프론트 소스
const EXPERIMENTAL = [/\bMultiProvider\b/, /\bclient\.track\(/, /\.track\(\s*['"`]/];
const CALL = /get(?:Boolean)(?:Value|Details)\(\s*[^,()]+,\s*([^,)]+)/g;
let calls = 0;
for (const f of [...walk(join(FF, 'frontend', 'src'), ['.ts', '.tsx']), ...walk(join(FF, 'backend', 'src'), ['.ts'])]) {
  const text = readFileSync(f, 'utf8');
  if (!/@openfeature\//.test(text)) continue;
  for (const re of EXPERIMENTAL) if (re.test(text)) errors.push(`${rel(f)} — Experimental 기능 사용(${re.source}) — 양산 판단에 쓰지 않는다 (FFG-OFT-007)`);
  for (const m of text.matchAll(CALL)) {
    calls++;
    if (m[1].trim() !== 'false') errors.push(`${rel(f)} — 평가 기본값 "${m[1].trim()}" — Safe State(false) 리터럴이어야 한다 (FFG-OFT-002)`);
  }
}

if (errors.length) {
  console.error(`openfeature:check ✗ ${errors.length}건\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`openfeature:check ✓ SDK ${Object.keys(pins).length}개 정확 고정 · Experimental 0건 · 평가 호출 ${calls}건 기본값 false`);
