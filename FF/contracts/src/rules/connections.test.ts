// readiness: RD-UX-04 — 모의 연계는 설정으로 상태가 정해지고, 실제 어댑터 없이 live를 고르면 live가 되지 않는다.
import { describe, expect, it } from 'vitest';
import { CONNECTION_KEYS, connectionLabel, connectionStatuses } from './connections';

const byKey = (env: Record<string, string | undefined>) => Object.fromEntries(connectionStatuses(env).map((s) => [s.key, s.mode]));

describe('외부 연결 상태 (RD-UX-04)', () => {
  it('기본 — 메일·과금·OTA는 모의, Data Lake는 연결 없음', () => {
    expect(byKey({})).toEqual({ mail: 'mock', billing: 'mock', ota: 'mock', datalake: 'off' });
    expect(connectionStatuses({}).map((s) => s.key)).toEqual([...CONNECTION_KEYS]);
  });

  it('실제 어댑터가 없으면 FF_CONN_*=live여도 live가 아니다 — 모의를 실제처럼 보이지 않게', () => {
    expect(byKey({ FF_CONN_MAIL: 'live', FF_CONN_BILLING: 'live', FF_CONN_DATALAKE: 'live' })).toEqual({ mail: 'mock', billing: 'mock', ota: 'mock', datalake: 'off' });
  });

  it('끄기 — FF_CONN_*=off, OTA는 IF_MODE_05=off도 따른다', () => {
    expect(byKey({ FF_CONN_MAIL: 'off', IF_MODE_05: 'off' })).toMatchObject({ mail: 'off', ota: 'off' });
  });

  it('표시 — live는 표시 없음, 데모는 모의(연결 전), 운영·꺼짐은 연결 안 됨', () => {
    expect(connectionLabel({ mode: 'live' }, 'production')).toBe('none');
    expect(connectionLabel({ mode: 'mock' }, 'demo')).toBe('mock');
    expect(connectionLabel({ mode: 'mock' }, 'production')).toBe('disconnected');
    expect(connectionLabel({ mode: 'off' }, 'demo')).toBe('disconnected');
    // 상태를 못 읽으면(정적 데모 스냅샷 없음) 모의로 본다 — 실제처럼 보이지 않게
    expect(connectionLabel(null, null)).toBe('mock');
  });
});
