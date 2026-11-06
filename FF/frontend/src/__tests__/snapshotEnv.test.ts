// 정적 데모 스냅샷 백엔드 환경(2026-11-06 로컬 의존 점검) — 빌드 PC 환경(외부 연계 URL·토큰·실 Unleash·DB·CARLA Python)이
// 공개 스냅샷에 섞이지 않게 허용 목록만 넘기고, 스냅샷에 필요한 값(모의 Unleash·내부 GLEO·메모리 DB·v0.81 시드)은 강제한다.
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../tools/lib.ts', () => ({ FF: join(__dirname, '..', '..', '..') }));
const { snapshotServerEnv } = await import('../../../tools/snapshot-api');

describe('스냅샷 백엔드 환경', () => {
  const build = {
    PATH: '/usr/bin', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp',
    FF_SHOWCASE: '1', FF_SHOWCASE_VEHICLES: '480', FF_SYNTHETIC: '24000',
    UNLEASH_MODE: 'live', UNLEASH_URL: 'http://127.0.0.1:4242', UNLEASH_ADMIN_TOKEN: 'secret', GLEO_MODE: 'ws', GLEO_URL: 'ws://192.168.0.5:8765',
    FF_DB: 'C:/data/ff.db', FF_DB_URL: 'postgres://u:p@10.0.0.4/ff', FF_SEED: 'none', JIRA_URL: 'https://jira.corp', GITLAB_TOKEN: 't',
    CARLA_PYTHON: 'C:/project/2026-10-17_Carlra/.venv/Scripts/python.exe', CARLA_HOST: '10.1.2.3', FF_ENV: 'production', SIM_MODE: 'off', TZ: 'Asia/Seoul',
  };
  const env = snapshotServerEnv(build, 9300, { SIM_MODE: 'auto', FF_EVIDENCE_DIR: '/x' });

  it('외부 연계·DB·실 서비스·운영 모드·CARLA 설정은 넘기지 않는다', () => {
    for (const k of ['UNLEASH_URL', 'UNLEASH_ADMIN_TOKEN', 'GLEO_URL', 'FF_DB_URL', 'JIRA_URL', 'GITLAB_TOKEN', 'CARLA_PYTHON', 'CARLA_HOST', 'FF_ENV']) expect(env[k], k).toBeUndefined();
  });

  it('스냅샷에 필요한 값은 강제한다 — 빌드 PC가 다른 값을 줘도', () => {
    expect(env).toMatchObject({ UNLEASH_MODE: 'mock', GLEO_MODE: 'internal', FF_DB: ':memory:', FF_SEED: 'v0.81', PORT: '9300', SIM_MODE: 'auto', FF_EVIDENCE_DIR: '/x', TZ: 'UTC' });
  });

  it('OS 기본값과 배포 시드(cloudflare.yml의 전시 시드)는 넘긴다', () => {
    expect(env).toMatchObject({ PATH: '/usr/bin', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', FF_SHOWCASE: '1', FF_SHOWCASE_VEHICLES: '480', FF_SYNTHETIC: '24000' });
  });
});
