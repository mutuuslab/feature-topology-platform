// 모든 래칫 지표를 다시 측정한다. --update 를 주면 개선된 값을 기준으로 잠근다.
import { spawnSync } from 'node:child_process';
import { FF } from './lib.ts';

let ok = true;
// 래칫을 쓰는 검사 — 새 래칫 검사를 만들면 여기에 넣는다(빠지면 --update로 잠글 수 없다)
for (const t of ['tools/lint-tokens.ts', 'tools/lint-copy.ts', 'tools/lint-spacing.ts', 'tools/conformance.ts', 'tools/standards.ts', 'tools/requirements.ts', 'tools/readiness.ts', 'tools/test-hygiene.ts']) {
  const r = spawnSync(process.execPath, [t, ...process.argv.slice(2)], { cwd: FF, stdio: 'inherit' });
  ok = ok && r.status === 0;
}
process.exit(ok ? 0 : 1);
