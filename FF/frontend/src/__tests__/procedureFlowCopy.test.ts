// 업무 절차 흐름도 문구의 절차 수 — 손으로 쓴 "13개 절차"가 FPW.14(Feature DB 운영)를 더한 뒤에도 남았다(하네스 리뷰 C8, 2026-11-04).
// 수는 업무 절차 모델(WORKFLOWS.processes)에서 받는다 — 화면은 doc.processes.length를 넘긴다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { procedureFlow as F } from '../copy/procedureFlow';

describe('업무 절차 흐름도 문구 — 절차 수', () => {
  const n = WORKFLOWS.processes.length;

  it('담당자·내 업무·전체업무흐름 안내는 모델의 절차 수를 말한다', () => {
    expect(n).toBeGreaterThan(13);
    for (const text of [F.roles.hint('기능안전 담당', n), F.mine.hint('Feature 설계', n), F.chain.hint(n)]) expect(text).toContain(`${n}개 절차`);
  });

  it('문구 원본에 절차 수를 손으로 쓰지 않는다', () => {
    const src = readFileSync(join(__dirname, '..', 'copy', 'procedureFlow.ts'), 'utf8');
    expect(src.match(/\d+개 (?:업무 )?절차/g) ?? []).toEqual([]);
  });
});
