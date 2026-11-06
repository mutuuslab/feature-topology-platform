// 정적 데모 스냅샷 파일 이름 충돌(하네스 리뷰 H10, 2026-11-04) — snapshotFile은 URL의 영숫자 밖 글자를 '_'로 바꿔
// 다른 요청이 같은 파일이 될 수 있다. tools/snapshot-api.ts save()는 장부(claimSnapshotFile)로 그런 덮어쓰기를 멈춘다.
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { routeUrl, snapshotFile } from '@ff/contracts';
// 도구 공용 유틸(lib.ts)은 import.meta.url로 FF 경로를 찾는다 — jsdom 시험 환경에서는 그 경로만 준다(스냅샷 백엔드는 직접 실행할 때만 뜬다)
vi.mock('../../../tools/lib.ts', () => ({ FF: join(__dirname, '..', '..', '..') }));
const { claimSnapshotFile, startDeadlineMs, staticAuditCursor } = await import('../../../tools/snapshot-api');

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

// 회귀(2026-11-06): 기동 대기가 60초(0.5초 × 120)라 전시 시드(기동 45~50초)·동시 빌드에서 스냅샷 생성이 멈췄다
describe('스냅샷 백엔드 기동 대기', () => {
  it('기본 300초, 환경 변수로 늘리고 180초 밑으로는 줄이지 않는다', () => {
    expect(startDeadlineMs({})).toBe(300_000);
    expect(startDeadlineMs({ SNAPSHOT_START_TIMEOUT_MS: '600000' })).toBe(600_000);
    // hygiene-ok: 순수 함수의 하한(180초) 확인 — 실제로 1초를 기다리지 않는다
    expect(startDeadlineMs({ SNAPSHOT_START_TIMEOUT_MS: '1000' })).toBe(180_000);
    expect(startDeadlineMs({ SNAPSHOT_START_TIMEOUT_MS: 'x' })).toBe(300_000);
  });
});

// 회귀(2026-11-06 하네스 리뷰 시드 결정성): 감사 다음 쪽 파일 이름이 서버 커서(마지막 id — 그때까지 쌓인 감사 건수)를 담아 배포마다 바뀌었다
describe('감사 다음 쪽 — 쪽 순번 커서', () => {
  it('파일 이름은 쪽 순번만으로 정해진다(건수·시각과 무관)', () => {
    expect(staticAuditCursor(2)).toBe('page-2');
    expect(snapshotFile(routeUrl('audit', {}, { limit: 500, cursor: staticAuditCursor(3) }))).toBe('api-snapshot/audit_limit_500_cursor_page-3.json');
    // 화면 '더 불러오기'의 질의 모양({ ...query, cursor })과 같은 이름
    const query = { limit: 500 };
    expect(snapshotFile(routeUrl('audit', {}, { ...query, cursor: staticAuditCursor(2) }))).toBe('api-snapshot/audit_limit_500_cursor_page-2.json');
  });
});
