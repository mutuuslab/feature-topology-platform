// npm run dev:backend:ops5y — 5년 운영 재생 DB(.sim/ops5y.db)로 빌드된 백엔드를 띄운다(실제 시계, 시드 생략). 포트 9101(8000 금지).
// 재생 DB를 바로 쓰면 운영 중 변경이 재생 결과를 덮으므로 사본(.sim/ops5y.live.db)으로 띄운다 — 다시 시작하면 재생 직후 상태로 돌아간다.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from '../lib.ts';

const src = join(FF, '.sim', 'ops5y.db');
if (!existsSync(src)) {
  console.error('재생 DB가 없습니다 — 먼저 npm run ops5y:build');
  process.exit(1);
}
const live = join(FF, '.sim', 'ops5y.live.db');
for (const s of ['', '-wal', '-shm']) rmSync(`${live}${s}`, { force: true });
copyFileSync(src, live);
for (const s of ['-wal', '-shm']) if (existsSync(`${src}${s}`)) copyFileSync(`${src}${s}`, `${live}${s}`);
const child = spawn(process.execPath, [join(FF, 'backend', 'dist', 'main.js')], {
  env: { ...process.env, PORT: process.env.PORT ?? '9101', FF_DB: live, FF_SEED: 'none', FF_DATASET: 'ops5y', FF_BOOT_PUBLISH: '0', SIM_MODE: process.env.SIM_MODE ?? 'auto' },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
