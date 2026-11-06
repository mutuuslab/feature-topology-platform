// node tools/migrations-lock.ts --update — 낸 마이그레이션 잠금(harness/migrations.lock.json)에 새 항목을 더한다.
// 이미 잠근 항목의 SQL 해시가 바뀌었으면 갱신하지 않고 실패한다 — 고치지 말고 새 마이그레이션을 추가(backend/test/kernel/migration-upgrade.spec).
// 출시 준비 RD-OPS-10. migrations.ts는 다른 모듈을 가져오지 않는 SQL 배열이라 타입 스트리핑으로 바로 읽는다.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, readJson } from './lib.ts';

const PATH = join(FF, 'harness', 'migrations.lock.json');
const { MIGRATIONS } = (await import(new URL('../backend/src/kernel/migrations.ts', import.meta.url).href)) as { MIGRATIONS: { name: string; sql: string }[] };
type Lock = { note: string; migrations: Record<string, string> };
/** 잠금 파일 — 없으면 빈 잠금. 있는지 먼저 묻지 않고 바로 읽는다(검사·사용 사이 경쟁 없음) */
function readLock(): Lock {
  try {
    return readJson<Lock>(PATH);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { note: '', migrations: {} };
    throw e;
  }
}
const lock = readLock();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const changed = Object.entries(lock.migrations).filter(([n, h]) => sha(MIGRATIONS.find((m) => m.name === n)?.sql ?? '') !== h).map(([n]) => n);
if (changed.length) {
  console.error(`✕ 잠근 마이그레이션이 바뀌었거나 사라졌다: ${changed.join(', ')} — 되돌리고 새 마이그레이션을 추가하세요`);
  process.exit(1);
}
const added = MIGRATIONS.filter((m) => !(m.name in lock.migrations));
if (!process.argv.includes('--update')) {
  console.log(`migrations-lock: 잠금 ${Object.keys(lock.migrations).length} · 새 항목 ${added.map((m) => m.name).join(', ') || '없음'}`);
  process.exit(0);
}
const next = {
  note: '낸 마이그레이션 SQL 해시 잠금 — 바꾸지 말고 새 항목을 추가한다. 새 항목은 node tools/migrations-lock.ts --update로 잠근다(출시 준비 RD-OPS-10).',
  migrations: { ...lock.migrations, ...Object.fromEntries(added.map((m) => [m.name, sha(m.sql)])) },
};
writeFileSync(PATH, JSON.stringify(next, null, 2) + '\n');
console.log(`✓ 잠금 ${Object.keys(next.migrations).length}개 (${added.length}개 추가)`);
