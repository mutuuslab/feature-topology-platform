// 분류·메시지 v2 열거형이 보고서 v1.1 스키마(harness/guide 복사본)와 같은지 — 스키마가 바뀌면 여기서 먼저 깨진다.
import { describe, expect, it } from 'vitest';
import { loadGuide } from '../testing/fixtures';
import * as S from './safety';

const kill = loadGuide('schema/kill_command.v2.schema.json');
const status = loadGuide('schema/status_report.v2.schema.json');

describe('메시지 스키마 v2 열거형', () => {
  it('kill_command: 요청 유형·사유·승인 역할·F/DC 등급', () => {
    expect([...S.KILL_REQUESTS]).toEqual(kill.properties.request.enum);
    expect([...S.REASON_CATEGORIES]).toEqual(kill.properties.reason.properties.category.enum);
    expect([...S.APPROVER_ROLES]).toEqual(kill.properties.approvals.items.properties.role.enum);
    expect([...S.F_CLASSES]).toEqual(kill.properties.feature.properties.f_class.enum);
    expect([...S.DEACT_CLASSES]).toEqual(kill.properties.feature.properties.deact_class.enum);
  });
  it('status_report: 상태·결과·거부 코드·HMI·EDR·시각·영속·출처', () => {
    const p = status.properties;
    expect([...S.GUARD_STATES]).toEqual(p.state.enum);
    expect([...S.REQUEST_RESULTS]).toEqual(p.request_result.enum);
    expect([...S.REJECT_CODES]).toEqual(p.reject_code.enum);
    expect([...S.HMI_STATES]).toEqual(p.hmi.enum);
    expect([...S.EDR_STATES]).toEqual(p.edr_aligned_state.enum);
    expect([...S.TIME_SYNC]).toEqual(p.time_sync.enum);
    expect([...S.PERSISTENCE]).toEqual(p.persistence.enum);
    expect([...S.REPORT_SOURCES]).toEqual(p.reason.properties.source.enum);
  });
  it('SAFE_DEFAULT·SAFE_STOP은 v2 상태가 아니다 — 모르면 UNKNOWN', () => {
    expect(S.GUARD_STATES as readonly string[]).not.toContain('SAFE_DEFAULT');
    expect(S.GUARD_STATES as readonly string[]).not.toContain('SAFE_STOP');
    expect(S.GUARD_STATES).toContain('UNKNOWN');
  });
  it('F2 이상이 안전 관련', () => {
    expect(S.F_CLASSES.filter(S.isSafetyRelevant)).toEqual(['F2', 'F3', 'F4']);
  });
});
