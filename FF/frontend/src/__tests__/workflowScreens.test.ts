// 업무 절차(docs/65-workflows)의 활동 화면·앵커·필드 매핑이 실제 화면 코드에 있는지 —
// 화면 경로·data-tour·name/data-ui를 바꾸면 절차 모델도 고쳐야 한다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { ROUTES } from '../routes';

/** src/screens·src/shell의 TSX를 한 번에 읽는다 — 앵커·필드 이름은 코드에만 있다 */
function screenSource(): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(n)) files.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(__dirname, '..', 'screens'));
  walk(join(__dirname, '..', 'shell'));
  return files.join('\n');
}

describe('업무 절차 화면 ↔ 프론트 화면 경로', () => {
  it('모든 활동 화면이 화면 경로(패턴)에 있다', () => {
    const paths = new Set(ROUTES.map((r) => r.path));
    const missing = WORKFLOWS.processes.flatMap((p) =>
      p.activities.flatMap((a) => a.platform.screens.filter((s) => !paths.has(s)).map((s) => `${a.id} ${s}`)),
    );
    expect(missing).toEqual([]);
  });
});

describe('업무 절차 앵커·필드 매핑 ↔ 화면 코드', () => {
  const src = screenSource();
  const all = WORKFLOWS.processes.flatMap((p) => p.activities);

  it('platform.anchor는 모두 data-tour·tour·tours로 화면에 있다 (C4 표준 따라하기)', () => {
    const bad = all
      .filter((a) => a.platform.anchor && !new RegExp(`(data-tour|tours?)=[^\\n]*["']${a.platform.anchor}["']`).test(src))
      .map((a) => `${a.id} → ${a.platform.anchor}`);
    expect(bad).toEqual([]);
  });

  it('platform.ui.fields는 실제 name=으로, buttons는 data-ui=로 화면에 있다', () => {
    const missing = all.flatMap((a) => [
      ...a.platform.ui.fields.filter((f) => !new RegExp(`name=["']${f}["']`).test(src)).map((f) => `${a.id} field ${f}`),
      ...a.platform.ui.buttons.filter((b) => !new RegExp(`data-ui=["']${b}["']`).test(src)).map((b) => `${a.id} button ${b}`),
    ]);
    expect(missing).toEqual([]);
  });
});
