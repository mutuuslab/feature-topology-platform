// Epic = Feature(80-50 §4) — 필드 ID 표·작업 중 버전·FF 기대값
import { describe, expect, it } from 'vitest';
import { missingLiveEnv } from '../ext-sync';
import { epicDesired, epicFieldDiff, epicSummary, epicVersions, nameOfEpicSummary, parseJiraFields, type EpicVersionInput } from './epic';

const v = (version: string, lifecycle: EpicVersionInput['lifecycle'], over: Partial<EpicVersionInput> = {}): EpicVersionInput => ({
  featureId: 'FEAT-00012',
  version,
  name: '오토 홀드',
  lifecycle,
  country: 'KR',
  vehicleModel: 'NX4 PE',
  trim: 'Premium',
  asil: 'B',
  ownerId: '샤시상품기획팀',
  featureRefs: [
    { refId: 'CH-BRK-006', role: 'INCLUDED' },
    { refId: 'CH-BRK-009', role: 'PRIMARY' },
  ],
  ...over,
});

describe('JIRA Epic 필드 ID(JIRA_FIELDS)', () => {
  it('JSON 표 > 옛 변수 > 모의 기본값, live면 모의 기본값을 쓰지 않는다', () => {
    const env: Record<string, string> = { JIRA_FIELDS: '{"country":"customfield_10010","featureId":"customfield_10016"}', JIRA_FIELD_TRIM: 'customfield_10012' };
    const r = parseJiraFields((k) => env[k], false);
    expect('ids' in r && r.ids).toMatchObject({ country: 'customfield_10010', trim: 'customfield_10012', featureId: 'customfield_10016', asil: 'ffAsil', ffLink: 'ffLink' });
    const live = parseJiraFields((k) => env[k], true);
    expect('ids' in live && live.ids).toEqual({ country: 'customfield_10010', trim: 'customfield_10012', featureId: 'customfield_10016' });
  });
  it('live 필수 변수 — JIRA_FIELDS 표에 있는 키는 옛 JIRA_FIELD_* 없이도 된다', () => {
    const base: Record<string, string> = { JIRA_URL: 'https://j', JIRA_TOKEN: 't', JIRA_EPIC_PROJECT: 'FFE', JIRA_CR_PROJECT: 'FFCR', JIRA_DEFECT_PROJECT: 'FFD', JIRA_WEBHOOK_SECRET: 's' };
    expect(missingLiveEnv('JIRA', (k) => base[k])).toContain('JIRA_FIELD_COUNTRY');
    const env = { ...base, JIRA_FIELDS: JSON.stringify({ country: 'cf_1', vehicleModel: 'cf_2', trim: 'cf_3', asil: 'cf_4', ownerId: 'cf_5', featureDb: 'cf_6' }) };
    expect(missingLiveEnv('JIRA', (k) => env[k as keyof typeof env])).toEqual([]);
  });
  it('형식이 틀리거나 모르는 키·빈 값·같은 ID를 두 필드가 쓰면 오류', () => {
    expect(parseJiraFields(() => '[1]', false)).toMatchObject({ error: expect.stringContaining('JSON 객체') });
    expect(parseJiraFields((k) => (k === 'JIRA_FIELDS' ? '{"colour":"cf"}' : undefined), false)).toMatchObject({ error: expect.stringContaining("'colour'") });
    expect(parseJiraFields((k) => (k === 'JIRA_FIELDS' ? '{"trim":" "}' : undefined), false)).toMatchObject({ error: expect.stringContaining('trim') });
    expect(parseJiraFields((k) => (k === 'JIRA_FIELDS' ? '{"trim":"cf_1","asil":"cf_1"}' : undefined), false)).toMatchObject({ error: expect.stringContaining('cf_1') });
  });
});

describe('Epic이 따르는 버전(A-1 기본값)', () => {
  it('작업 중 버전 = 가장 높은 출시 전 버전, 출시 버전은 따로', () => {
    const r = epicVersions([v('1.2.0', 'RELEASED'), v('1.3.0', 'PROPOSED'), v('1.0.0', 'DEPRECATED')]);
    expect(r.epic?.version).toBe('1.3.0');
    expect(r.working?.version).toBe('1.3.0');
    expect(r.released?.version).toBe('1.2.0');
  });
  it('작업 중 버전이 없으면 최신 출시 버전(10.0.0 > 9.0.0 — 숫자 순서)', () => {
    const r = epicVersions([v('9.0.0', 'RELEASED'), v('10.0.0', 'DEPRECATED')]);
    expect(r.working).toBeNull();
    expect(r.epic?.version).toBe('10.0.0');
    expect(r.released?.version).toBe('9.0.0');
    expect(epicVersions([v('1.0.0', 'RETIRED')]).epic?.version).toBe('1.0.0');
    expect(epicVersions([]).epic).toBeNull();
  });
});

describe('FF 기대값', () => {
  it('제목·범위·대표 먼저인 Feature DB·읽기 전용 칸', () => {
    const d = epicDesired([v('1.2.0', 'RELEASED'), v('1.3.0', 'DEVELOPING', { name: '오토 홀드 2' })], { gates: { G1: 'PASS', G2: 'PASS' }, link: '/features/FEAT-00012/1.3.0' })!;
    expect(d).toMatchObject({ version: '1.3.0', lifecycle: 'DEVELOPING', summary: '[FF] 오토 홀드 2 — KR/NX4 PE/Premium' });
    expect(d.fields).toMatchObject({ featureDb: ['CH-BRK-009', 'CH-BRK-006'], workingVersion: '1.3.0', releaseVersion: '1.2.0', featureId: 'FEAT-00012', ffLink: '/features/FEAT-00012/1.3.0' });
    expect(d.fields.gates).toBe('G1 PASS · G2 PASS · G3 — · G4 — · G5 — · G6 — · G7 — · G8 — · G9 —');
  });
  it('다른 값만 고른다 — 원격에 실린 키만, 목록 대소문자·빈 값은 같게', () => {
    const d = epicDesired([v('1.0.0', 'PROPOSED')])!;
    expect(epicFieldDiff(d, { country: 'KR', featureDb: 'ch-brk-009,ch-brk-006'.split(','), workingVersion: '1.0.0' })).toEqual([]);
    expect(epicFieldDiff(d, { country: 'US', releaseVersion: '', gates: 'x' })).toEqual(['country', 'gates']);
  });
  it('제목에서 이름 — FF 형식이 아니면 제목 그대로', () => {
    expect(nameOfEpicSummary(epicSummary({ name: '오토 홀드 — 개선', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }))).toBe('오토 홀드 — 개선');
    expect(nameOfEpicSummary('JIRA에서 만든 Epic')).toBe('JIRA에서 만든 Epic');
  });
});
