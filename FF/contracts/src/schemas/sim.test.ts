import { describe, expect, it } from 'vitest';
import { publicSimStatus, type SimStatus } from './sim';

describe('공개 정적 데모 가상검증 상태', () => {
  it('호스트·포트·실행기·Python 경로·탐침 사유를 싣지 않는다(빌드 PC 경로가 공개본에 남지 않게)', () => {
    const s: SimStatus = { available: false, mode: 'auto', simulator: 'CARLA', host: '127.0.0.1', port: 2100, server: null, runner: 'C:\\project\\FF\\backend\\test\\fixtures\\fake-carla\\ffcarla_cli.mjs', python: 'C:/x/.venv/Scripts/python.exe', reason: 'CARLA 검증 서버 127.0.0.1:2100 응답 없음', queue: { running: 1, waiting: 0 } };
    const p = publicSimStatus(s);
    expect(p).toEqual({ available: false, mode: 'auto', simulator: 'CARLA', server: null, reason: null, queue: { running: 0, waiting: 0 } });
    expect(JSON.stringify(p)).not.toMatch(/127\.0\.0\.1|2100|[A-Za-z]:[\\/]/);
  });
});
