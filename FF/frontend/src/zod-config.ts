// zod 4 설정 — 두 엔트리(main.tsx·twin-main.tsx)가 맨 먼저 불러온다.
// 배포 CSP는 script-src에 'unsafe-eval'이 없다(public/_headers). zod 4는 첫 검사 때 new Function으로 eval 가능 여부를 떠보는데,
// try/catch로 삼켜도 브라우저가 securitypolicyviolation을 남긴다(e2e csp.spec이 잡는다) → JIT 없이 같은 결과로 검사한다.
import { z } from 'zod';

z.config({ jitless: true });
