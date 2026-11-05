// JIRA Epic의 Feature DB 기준 ID 읽기(30-95 §7, D-REF-16, 80-50 §4) — JIRA 안의 FF 앱이 쓰는 사용자 필드가 기준.
// 실제 연결(IF_MODE_14=live)은 필드만 읽고, 모의·데모만 필드가 비었을 때 라벨(ref-primary:·ref:)을 읽는다.
import { afterEach, describe, expect, it } from 'vitest';
import { epicRefIds } from '../../src/domains/d05-ext/api-gateway/ext-sync/normalize';
import { EPIC_REF_HINT } from '../../src/domains/d05-ext/api-gateway/ext-sync/ext-sync.service';

const saved = { field: process.env.JIRA_FIELD_FEATURE_DB, mode: process.env.IF_MODE_14 };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
afterEach(() => {
  restore('JIRA_FIELD_FEATURE_DB', saved.field);
  restore('IF_MODE_14', saved.mode);
});

describe('Epic 기준 ID', () => {
  it('필드 값이 있으면 필드만 쓴다 — 첫 값이 대표, 라벨은 무시', () => {
    // 회귀: 라벨 ref-primary:가 필드보다 앞서 대표가 되어, FF 앱이 고른 대표와 다른 기준 행이 연결됐다(2026-11-04 병합 정리)
    process.env.JIRA_FIELD_FEATURE_DB = 'customfield_10071';
    expect(epicRefIds({ customfield_10071: 'ch-brk-009; CH-BRK-006, CH-BRK-009', labels: ['ref-primary:PL-AP-001', 'ref:PL-AP-002'] })).toEqual(['CH-BRK-009', 'CH-BRK-006']);
    expect(epicRefIds({ customfield_10071: [{ value: 'BC-BCM-001' }, 'BC-BCM-002'] })).toEqual(['BC-BCM-001', 'BC-BCM-002']);
  });

  it('모의·데모(IF_MODE_14≠live)는 필드가 비었으면 라벨 — ref-primary: 대표 먼저, ref: 포함', () => {
    process.env.JIRA_FIELD_FEATURE_DB = 'customfield_10071';
    for (const mode of [undefined, 'mock']) {
      restore('IF_MODE_14', mode);
      expect(epicRefIds({ customfield_10071: '', labels: ['ref:CH-BRK-006', 'ref-primary:CH-BRK-009'] })).toEqual(['CH-BRK-009', 'CH-BRK-006']);
      expect(epicRefIds({ labels: ['other'] })).toEqual([]);
    }
  });

  it('실제 연결(IF_MODE_14=live)은 필드만 — 필드가 비면 라벨이 있어도 빈 값(등록 거부·댓글, 80-50 §4)', () => {
    // 회귀: live에서도 라벨 폴백이 살아 있어 FF 앱을 거치지 않은 라벨로 Feature가 등록됐다(하네스 리뷰 M3)
    process.env.JIRA_FIELD_FEATURE_DB = 'customfield_10071';
    process.env.IF_MODE_14 = 'live';
    expect(epicRefIds({ customfield_10071: '', labels: ['ref-primary:CH-BRK-009', 'ref:CH-BRK-006'] })).toEqual([]);
    expect(epicRefIds({ labels: ['ref-primary:CH-BRK-009'] })).toEqual([]);
    expect(epicRefIds({ customfield_10071: 'CH-BRK-009', labels: ['ref-primary:PL-AP-001'] })).toEqual(['CH-BRK-009']);
    // 호출자가 명시하면 그 값을 따른다
    expect(epicRefIds({ labels: ['ref-primary:CH-BRK-009'] }, true)).toEqual(['CH-BRK-009']);
  });

  it('설정이 없으면 모의 서버 기본 필드(ffFeatureDb)를 읽는다', () => {
    delete process.env.JIRA_FIELD_FEATURE_DB;
    expect(epicRefIds({ ffFeatureDb: 'SF-AIS-001', labels: ['ref-primary:CH-BRK-009'] })).toEqual(['SF-AIS-001']);
  });

  it('거부 댓글은 FF 패널에서 Feature DB를 고르라고 안내한다 — 라벨을 안내하지 않는다(80-50 §4, C12)', () => {
    expect(EPIC_REF_HINT).toMatch(/Feature DB/);
    expect(EPIC_REF_HINT).toMatch(/패널/);
    expect(EPIC_REF_HINT).not.toMatch(/ref-primary:|ref:/);
  });
});
