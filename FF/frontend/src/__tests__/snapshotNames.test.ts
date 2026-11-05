// 정적 데모 스냅샷 파일 이름 충돌(하네스 리뷰 H10, 2026-11-04) — snapshotFile은 URL의 영숫자 밖 글자를 '_'로 바꿔
// 다른 요청이 같은 파일이 될 수 있다. tools/snapshot-api.ts save()는 장부(claimSnapshotFile)로 그런 덮어쓰기를 멈춘다.
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { routeUrl, snapshotFile } from '@ff/contracts';
// 도구 공용 유틸(lib.ts)은 import.meta.url로 FF 경로를 찾는다 — jsdom 시험 환경에서는 그 경로만 준다(스냅샷 백엔드는 직접 실행할 때만 뜬다)
vi.mock('../../../tools/lib.ts', () => ({ FF: join(__dirname, '..', '..', '..') }));
const { claimSnapshotFile } = await import('../../../tools/snapshot-api');

describe('스냅샷 파일 이름 장부', () => {
  it('다른 URL이 같은 파일 이름이 되면 멈추고, 같은 URL을 다시 찍는 것은 괜찮다', () => {
    // 'a&b'는 a%26b로 인코딩돼 'a_26b'가 되고, 글자 그대로 'a_26b'인 검색어도 같은 파일이 된다
    const a = routeUrl('listRefs', {}, { q: 'a&b' });
    const b = routeUrl('listRefs', {}, { q: 'a_26b' });
    expect(a).not.toBe(b);
    expect(snapshotFile(a)).toBe(snapshotFile(b));
    const written = new Map<string, string>();
    claimSnapshotFile(written, snapshotFile(a), a);
    claimSnapshotFile(written, snapshotFile(a), a);
    expect(() => claimSnapshotFile(written, snapshotFile(b), b)).toThrow(/스냅샷 파일 이름 충돌/);
  });
});
