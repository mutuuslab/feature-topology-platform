// JIRA Epic의 Feature DB 기준 ID 읽기(30-95 §7, D-REF-16) — JIRA 안의 FF 앱이 쓰는 사용자 필드가 기준, 필드가 비었을 때만 라벨
import { afterEach, describe, expect, it } from 'vitest';
import { epicRefIds } from '../../src/domains/d05-ext/api-gateway/ext-sync/normalize';

const saved = process.env.JIRA_FIELD_FEATURE_DB;
afterEach(() => {
  if (saved === undefined) delete process.env.JIRA_FIELD_FEATURE_DB;
  else process.env.JIRA_FIELD_FEATURE_DB = saved;
});

describe('Epic 기준 ID', () => {
  it('필드 값이 있으면 필드만 쓴다 — 첫 값이 대표, 라벨은 무시', () => {
    // 회귀: 라벨 ref-primary:가 필드보다 앞서 대표가 되어, FF 앱이 고른 대표와 다른 기준 행이 연결됐다(2026-11-04 병합 정리)
    process.env.JIRA_FIELD_FEATURE_DB = 'customfield_10071';
    expect(epicRefIds({ customfield_10071: 'ch-brk-009; CH-BRK-006, CH-BRK-009', labels: ['ref-primary:PL-AP-001', 'ref:PL-AP-002'] })).toEqual(['CH-BRK-009', 'CH-BRK-006']);
    expect(epicRefIds({ customfield_10071: [{ value: 'BC-BCM-001' }, 'BC-BCM-002'] })).toEqual(['BC-BCM-001', 'BC-BCM-002']);
  });

  it('필드가 비었으면 라벨 — ref-primary: 대표 먼저, ref: 포함', () => {
    process.env.JIRA_FIELD_FEATURE_DB = 'customfield_10071';
    expect(epicRefIds({ customfield_10071: '', labels: ['ref:CH-BRK-006', 'ref-primary:CH-BRK-009'] })).toEqual(['CH-BRK-009', 'CH-BRK-006']);
    expect(epicRefIds({ labels: ['other'] })).toEqual([]);
  });

  it('설정이 없으면 모의 서버 기본 필드(ffFeatureDb)를 읽는다', () => {
    delete process.env.JIRA_FIELD_FEATURE_DB;
    expect(epicRefIds({ ffFeatureDb: 'SF-AIS-001', labels: ['ref-primary:CH-BRK-009'] })).toEqual(['SF-AIS-001']);
  });
});
