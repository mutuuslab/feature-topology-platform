// zod 4 이행 회귀 — 배포 CSP(eval 금지) 아래에서 zod가 new Function으로 eval 가능 여부를 떠봐 화면마다 CSP 위반이 남던 문제.
// 엔트리 두 곳이 zod 설정을 맨 먼저 불러오고, 설정은 JIT 없음이다(브라우저 확인은 e2e csp.spec).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import '../zod-config';

describe('zod 설정 (CSP)', () => {
  it('JIT 없음 — eval 가능 여부를 떠보지 않는다', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('두 엔트리가 다른 모듈보다 먼저 zod 설정을 불러온다', () => {
    for (const entry of ['main.tsx', 'twin-main.tsx']) {
      const src = readFileSync(join(__dirname, '..', entry), 'utf8');
      const imports = [...src.matchAll(/^import .*$/gm)].map((m) => m[0]);
      expect(imports[0], entry).toContain("'./zod-config'");
    }
  });
});
