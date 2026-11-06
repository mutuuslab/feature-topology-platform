// npm run flaky -- <시험 파일> [--repeat N] [--parallel K] [--grep 이름] — 흔들리는 시험 찾기: 같은 시험을 N번(기본 10) 다시 돌려 한 번이라도 실패하면 실패.
//   · backend·contracts·frontend 시험(vitest)은 매번 새 프로세스로, --parallel K면 K개를 함께 돌려 부하가 큰 기계(CI·여러 작업 폴더의 verify)를 흉내 낸다
//   · e2e(Playwright)는 --repeat-each N 한 번(서버는 한 번 띄운다). static·oidc·firstrun 폴더는 그 설정 파일로
//   · tools/*.test.ts는 node --test
// 실패한 회차의 출력은 test-results/flaky/에 남는다. 예: npm run flaky -- backend/test/d04/ota-server.spec.ts --repeat 20 --parallel 3
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FF } from './lib.ts';

export interface Plan {
  cwd: string;
  /** node로 실행할 인자 — 셸을 거치지 않는다(인용·이스케이프 없음) */
  args: string[];
  /** 보여 주기용 */
  cmd: string;
  /** 한 번 실행에 반복이 들어 있다(Playwright --repeat-each) */
  selfRepeating: boolean;
}

const VITEST = join(FF, 'node_modules', 'vitest', 'vitest.mjs');
const PLAYWRIGHT = join(FF, 'node_modules', '@playwright', 'test', 'cli.js');
const plan = (cwd: string, args: string[], selfRepeating: boolean, shown: string[]): Plan => ({ cwd, args, selfRepeating, cmd: shown.join(' ') });

/** 시험 파일 → 실행 계획 */
export function planFor(file: string, repeat: number, grep?: string): Plan {
  const abs = resolve(FF, file);
  const r = relative(FF, abs).split(sep).join('/');
  const [ws, ...rest] = r.split('/');
  const inWs = rest.join('/');
  if (ws === 'e2e') {
    const sub = rest[0];
    const config = sub === 'static' ? 'playwright.static.config.ts' : sub === 'oidc' ? 'playwright.oidc.config.ts' : sub === 'firstrun' ? 'playwright.firstrun.config.ts' : 'playwright.config.ts';
    const a = ['test', '-c', config, inWs, '--repeat-each', String(repeat), '--retries', '0', ...(grep ? ['--grep', grep] : [])];
    return plan(join(FF, 'e2e'), [PLAYWRIGHT, ...a], true, ['playwright', ...a]);
  }
  if (ws === 'tools') {
    const a = ['--test', ...(grep ? [`--test-name-pattern=${grep}`] : []), r];
    return plan(FF, a, false, ['node', ...a]);
  }
  if (ws === 'backend' || ws === 'contracts' || ws === 'frontend') {
    const a = ['run', inWs, ...(grep ? ['-t', grep] : [])];
    return plan(join(FF, ws), [VITEST, ...a], false, ['vitest', ...a]);
  }
  throw new Error(`알 수 없는 시험 위치: ${r} — backend·contracts·frontend·e2e·tools 아래 파일을 주세요`);
}

function runOnce(p: Plan): Promise<{ ok: boolean; ms: number; out: string }> {
  return new Promise((done) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, p.args, { cwd: p.cwd, env: { ...process.env, FORCE_COLOR: '0', CI: process.env.CI ?? '' } });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => done({ ok: code === 0, ms: performance.now() - t0, out }));
  });
}

const arg = (name: string, d?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !['--repeat', '--parallel', '--grep'].includes(all[i - 1] ?? ''));
  if (!file) {
    console.error('사용: npm run flaky -- <시험 파일> [--repeat N] [--parallel K] [--grep 이름]');
    process.exit(2);
  }
  const repeat = Math.max(1, Number(arg('repeat', '10')));
  const parallel = Math.max(1, Number(arg('parallel', '1')));
  const plan = planFor(file, repeat, arg('grep'));
  const logs = join(FF, 'test-results', 'flaky');
  mkdirSync(logs, { recursive: true });
  console.log(`flaky — ${file} × ${repeat}${plan.selfRepeating ? ' (--repeat-each)' : ` · 동시 ${parallel}`}\n  ${plan.cmd}`);
  const results: { ok: boolean; ms: number }[] = [];
  const save = (i: number, out: string) => {
    const f = join(logs, `${basename(file).replace(/\W+/g, '_')}-${i}.log`);
    writeFileSync(f, out);
    return relative(FF, f);
  };
  if (plan.selfRepeating) {
    const r = await runOnce(plan);
    results.push(r);
    const failed = /(\d+) failed/.exec(r.out)?.[1];
    const flaky = /(\d+) flaky/.exec(r.out)?.[1];
    console.log(`  ${r.ok ? '✓' : '✕'} ${(r.ms / 1000).toFixed(1)}s${failed ? ` · 실패 ${failed}` : ''}${flaky ? ` · 흔들림 ${flaky}` : ''}${r.ok ? '' : ` → ${save(1, r.out)}`}`);
  } else {
    let next = 1;
    const worker = async () => {
      while (next <= repeat) {
        const i = next++;
        const r = await runOnce(plan);
        results.push(r);
        console.log(`  ${String(i).padStart(3)} ${r.ok ? '✓' : '✕'} ${(r.ms / 1000).toFixed(1)}s${r.ok ? '' : ` → ${save(i, r.out)}`}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, repeat) }, worker));
  }
  const bad = results.filter((r) => !r.ok).length;
  const runs = plan.selfRepeating ? `${repeat}회(한 실행)` : `${results.length}회`;
  console.log(bad ? `\n✕ ${runs} 중 실패 ${plan.selfRepeating ? '있음' : `${bad}회`} — 출력은 test-results/flaky/` : `\n✓ ${runs} 모두 통과`);
  process.exit(bad ? 1 : 0);
}
