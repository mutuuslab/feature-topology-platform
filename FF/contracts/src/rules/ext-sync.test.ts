import { describe, expect, it } from 'vitest';
import { LIFECYCLE } from '../enums';
import { EXT_SYSTEMS, JIRA_EPIC_STATUS, lifecycleOfEpicStatus, parseRefs, SYNC_OWNERSHIP } from './ext-sync';

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
