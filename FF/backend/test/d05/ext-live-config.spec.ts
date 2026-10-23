// 실제 연결 시작 검사 — IF_MODE_xx=live인데 필수 환경 변수가 빠지면 백엔드가 빠진 이름을 알려 주며 시작하지 않는다.
// JIRA 워크플로 상태 이름 덮어쓰기(JIRA_EPIC_STATUS·JIRA_CR_STATUS)는 시작 때 contracts 상태 표에 반영되고, 잘못된 값이면 역시 멈춘다.
import { afterEach, describe, expect, it } from 'vitest';
import { JIRA_CR_STATUS, JIRA_EPIC_STATUS } from '@ff/contracts';
import { applyExtLiveConfig, extLiveConfigProblems } from '../../src/domains/d05-ext/api-gateway/ext-sync/live-config';
import { bootApp } from '../helpers';

const KEYS = ['IF_MODE_01', 'IF_MODE_13', 'IF_MODE_14', 'JIRA_URL', 'JIRA_TOKEN', 'JIRA_EPIC_STATUS', 'JIRA_CR_STATUS'];
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  applyExtLiveConfig({});
});

const JIRA_OK = {
  IF_MODE_14: 'live',
  JIRA_URL: 'https://jira.corp.example',
  JIRA_TOKEN: 'secret-pat-123',
  JIRA_EPIC_PROJECT: 'FFE',
  JIRA_CR_PROJECT: 'FFCR',
  JIRA_DEFECT_PROJECT: 'FFD',
  JIRA_WEBHOOK_SECRET: 'whsec-456',
  JIRA_FIELD_COUNTRY: 'customfield_10101',
  JIRA_FIELD_VEHICLE_MODEL: 'customfield_10102',
  JIRA_FIELD_TRIM: 'customfield_10103',
  JIRA_FIELD_ASIL: 'customfield_10104',
  JIRA_FIELD_OWNER: 'customfield_10105',
};

describe('외부 연계 실제 연결 — 시작 검사', () => {
  it('mock(기본)이면 아무것도 요구하지 않는다', () => {
    expect(extLiveConfigProblems({})).toEqual([]);
  });

  it('live인데 빠진 필수 변수를 이름으로 알려 주고, 값(토큰)은 메시지에 넣지 않는다', () => {
    expect(extLiveConfigProblems(JIRA_OK)).toEqual([]);
    const { JIRA_WEBHOOK_SECRET: _w, JIRA_FIELD_TRIM: _t, ...partial } = JIRA_OK;
    const p = extLiveConfigProblems(partial);
    expect(p).toEqual(['IF_MODE_14=live인데 JIRA_WEBHOOK_SECRET, JIRA_FIELD_TRIM가 없습니다']);
    expect(() => applyExtLiveConfig(partial)).toThrow(/JIRA_WEBHOOK_SECRET, JIRA_FIELD_TRIM[\s\S]*npm run ext:check/);
    expect(extLiveConfigProblems({ IF_MODE_13: 'live', GITLAB_URL: 'https://gitlab.corp.example' })).toEqual(['IF_MODE_13=live인데 GITLAB_TOKEN, GITLAB_PROJECT, GITLAB_WEBHOOK_TOKEN가 없습니다']);
    expect(extLiveConfigProblems({ IF_MODE_01: 'live' })[0]).toMatch(/^IF_MODE_01=live인데 CODEBEAMER_URL/);
    let msg = '';
    try {
      applyExtLiveConfig(partial);
    } catch (e) {
      msg = String(e);
    }
    expect(msg).toMatch(/JIRA_WEBHOOK_SECRET/);
    expect(msg).not.toContain('secret-pat-123');
  });

  it('상태 이름 덮어쓰기 — 바꾼 것만 반영, 다시 시작하면 기본값 위에 다시 깐다, 잘못된 값이면 멈춘다', () => {
    applyExtLiveConfig({ JIRA_EPIC_STATUS: '{"PROPOSED":"Idea","DEVELOPING":"In Development"}', JIRA_CR_STATUS: '{"DEPLOYED":"Done"}' });
    expect(JIRA_EPIC_STATUS.PROPOSED).toBe('Idea');
    expect(JIRA_EPIC_STATUS.DEVELOPING).toBe('In Development');
    expect(JIRA_EPIC_STATUS.RELEASED).toBe('Released');
    expect(JIRA_CR_STATUS.DEPLOYED).toBe('Done');
    applyExtLiveConfig({});
    expect(JIRA_EPIC_STATUS.PROPOSED).toBe('Proposed');
    expect(JIRA_CR_STATUS.DEPLOYED).toBe('Deployed');
    expect(() => applyExtLiveConfig({ JIRA_EPIC_STATUS: '{"BACKLOG":"Idea"}' })).toThrow(/BACKLOG/);
  });

  it('앱 시작 — IF_MODE_14=live에 설정이 없으면 부팅이 빠진 변수 이름과 함께 실패한다', async () => {
    Object.assign(process.env, { IF_MODE_14: 'live', JIRA_URL: 'https://jira.corp.example' });
    await expect(bootApp()).rejects.toThrow(/IF_MODE_14=live인데 JIRA_TOKEN, JIRA_EPIC_PROJECT/);
  });
});
