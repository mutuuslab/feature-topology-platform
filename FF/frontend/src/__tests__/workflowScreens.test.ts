// 업무 절차(docs/65-workflows)의 활동 화면이 실제 메뉴·화면 경로에 있는지 — 화면 경로를 바꾸면 절차 모델도 고쳐야 한다.
import { describe, expect, it } from 'vitest';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { ROUTES } from '../routes';

describe('업무 절차 화면 ↔ 프론트 화면 경로', () => {
  it('모든 활동 화면이 화면 경로(패턴)에 있다', () => {
    const paths = new Set(ROUTES.map((r) => r.path));
    const missing = WORKFLOWS.processes.flatMap((p) =>
      p.activities.flatMap((a) => a.platform.screens.filter((s) => !paths.has(s)).map((s) => `${a.id} ${s}`)),
    );
    expect(missing).toEqual([]);
  });
});
