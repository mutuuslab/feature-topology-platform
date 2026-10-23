import { describe, expect, it } from 'vitest';
import { LIFECYCLE } from '../enums';
import { EXT_LIVE_ENV, EXT_SYSTEMS, JIRA_EPIC_STATUS, lifecycleOfEpicStatus, missingLiveEnv, parseJiraStatusMap, parseRefs, SYNC_OWNERSHIP } from './ext-sync';

describe('양방향 연계 — 주인 규칙', () => {
  it('모든 Lifecycle이 서로 다른 Epic 상태로 가고 되돌아온다', () => {
    const names = LIFECYCLE.map((l) => JIRA_EPIC_STATUS[l]);
    expect(new Set(names).size).toBe(LIFECYCLE.length);
    for (const l of LIFECYCLE) expect(lifecycleOfEpicStatus(JIRA_EPIC_STATUS[l])).toBe(l);
    expect(lifecycleOfEpicStatus(' in progress ')).toBe('DEVELOPING');
    expect(lifecycleOfEpicStatus('Backlog')).toBeNull();
  });

  it('외부 3종이 각자 주인인 사실이 있고, Lifecycle·정책은 플랫폼이 주인', () => {
    for (const s of EXT_SYSTEMS) expect(SYNC_OWNERSHIP.some((r) => r.owner === s)).toBe(true);
    expect(SYNC_OWNERSHIP.find((r) => r.fact === 'Feature Lifecycle')?.owner).toBe('PLATFORM');
    expect(SYNC_OWNERSHIP.find((r) => r.fact.startsWith('정책'))?.owner).toBe('PLATFORM');
  });

  it('커밋·MR 본문에서 Feature 버전과 CR 키를 찾는다', () => {
    expect(parseRefs('fix(FEAT-00022@1.1.0): radar bias — FFCR-123')).toEqual({ featureId: 'FEAT-00022', version: '1.1.0', crKey: 'FFCR-123' });
    expect(parseRefs('feature/FEAT-00001-guide')).toEqual({ featureId: 'FEAT-00001' });
    expect(parseRefs('no refs here')).toEqual({});
  });
});

describe('실제 연결 설정 — 상태 이름 덮어쓰기·필수 환경 변수', () => {
  it('JIRA 상태 이름은 바꿀 것만 JSON으로, 플랫폼 상태가 아닌 키·빈 값·겹치는 이름은 거부', () => {
    expect(parseJiraStatusMap('EPIC', undefined)).toEqual({ map: {} });
    expect(parseJiraStatusMap('EPIC', '{"PROPOSED":" Idea "}')).toEqual({ map: { PROPOSED: 'Idea' } });
    expect(parseJiraStatusMap('EPIC', 'PROPOSED=Idea')).toHaveProperty('error');
    expect((parseJiraStatusMap('EPIC', '{"BACKLOG":"Idea"}') as { error: string }).error).toMatch(/플랫폼 상태가 아닙니다/);
    expect(parseJiraStatusMap('EPIC', '{"PROPOSED":""}')).toHaveProperty('error');
    expect((parseJiraStatusMap('EPIC', '{"PROPOSED":"In Progress"}') as { error: string }).error).toMatch(/PROPOSED와 DEVELOPING/);
    expect(parseJiraStatusMap('CR', '{"DEPLOYED":"Done","CLOSED":"Done"}')).toEqual({ map: { DEPLOYED: 'Done', CLOSED: 'Done' } });
    expect((parseJiraStatusMap('CR', '{"REJECTED":"Approved"}') as { error: string }).error).toMatch(/APPROVED와 REJECTED/);
  });

  it('live 필수 환경 변수 — 토큰·프로젝트·webhook 비밀값, Epic 필드는 자동 등록이 켜졌을 때만', () => {
    const env = (o: Record<string, string>) => (k: string) => o[k];
    expect(missingLiveEnv('GITLAB', env({ GITLAB_URL: 'https://g', GITLAB_TOKEN: 't' }))).toEqual(['GITLAB_PROJECT', 'GITLAB_WEBHOOK_TOKEN']);
    const jira = { JIRA_URL: 'https://j', JIRA_TOKEN: 't', JIRA_EPIC_PROJECT: 'A', JIRA_CR_PROJECT: 'A', JIRA_DEFECT_PROJECT: 'A', JIRA_WEBHOOK_SECRET: 's' };
    expect(missingLiveEnv('JIRA', env(jira))).toEqual(['JIRA_FIELD_COUNTRY', 'JIRA_FIELD_VEHICLE_MODEL', 'JIRA_FIELD_TRIM', 'JIRA_FIELD_ASIL', 'JIRA_FIELD_OWNER']);
    expect(missingLiveEnv('JIRA', env({ ...jira, FF_EPIC_AUTOCREATE: 'off' }))).toEqual([]);
    for (const s of EXT_SYSTEMS) expect(EXT_LIVE_ENV[s].filter((e) => /TOKEN|SECRET/.test(e.key)).every((e) => e.secret)).toBe(true);
  });
});
