import { afterEach, describe, expect, it } from 'vitest';
import { changeUiLanguage, __resetLocaleForTest } from '../locale/runtime';
import { formatCount, formatExact } from '../design/format';
import { localTime, personOf, remaining } from '../data/people';
import { displayRoleLabel, permMatrix, roleKeyOf } from '../data/refdata';
import { money, moneyKey } from '../screens/cost/common';
import { fmtAt, relAgo } from '../design/freshness';

afterEach(() => __resetLocaleForTest());

describe('localized display preserves business values', () => {
  it('relative-time boundaries retain the same minute, hour and day calculations in either language', async () => {
    const now=Date.parse('2026-11-09T12:00:00Z');
    const ago=(ms:number)=>new Date(now-ms).toISOString();
    expect([0,60_000,3_600_000,172_800_000].map(ms=>relAgo(ago(ms),now))).toEqual(['방금','1분 전','1시간 전','2일 전']);
    const stamp=fmtAt(ago(3_600_000));
    await changeUiLanguage('en');
    expect([0,60_000,3_600_000,172_800_000].map(ms=>relAgo(ago(ms),now))).toEqual(['Just now','1 min ago','1 hr ago','2 days ago']);
    expect(fmtAt(ago(3_600_000))).toBe(stamp);
    expect(relAgo(null,now)).toBe('—');
  });
  it('uses English quantity and duration units while retaining exact values and deadline decisions', async () => {
    const due = '2026-11-09T10:20:00Z';
    const now = Date.parse('2026-11-09T09:00:00Z');
    const before = remaining(due, now)!;
    expect(before).toEqual({ text: '1시간 20분', ms: 4_800_000, overdue: false });
    expect(formatCount(12_000)).toBe('1.2만');
    expect(localTime(due)).toBe('2026-11-09 19:20');
    await changeUiLanguage('en');
    expect(formatCount(12_000)).toBe('12K');
    expect(formatExact(12_000)).toBe('12,000');
    expect(remaining(due, now)).toEqual({ ...before, text: '1h 20min' });
    expect(remaining(due, now + 5_000_000)).toMatchObject({ overdue: true, ms: -200_000 });
    expect(localTime(due)).toBe('2026-11-09 19:20 KST');
    expect(localTime('직접 입력한 날짜')).toBe('직접 입력한 날짜');
  });
  it('changes monetary captions without changing FX conversion, amounts, or currency', async () => {
    const before = { krw: money(2_500_000), usd: money(2_500_000, 'USD', 1250), key: moneyKey(2_500_000, 'USD', 1250) };
    expect(before).toEqual({ krw: '2,500,000원', usd: 'USD 2,000', key: { value: '2.0', unit: '천 USD' } });
    await changeUiLanguage('en');
    expect(money(2_500_000)).toBe('KRW 2,500,000');
    expect(money(2_500_000, 'USD', 1250)).toBe(before.usd);
    expect(moneyKey(2_500_000, 'USD', 1250)).toEqual({ value: before.key.value, unit: 'thousand USD' });
    expect(moneyKey(2_500_000)).toEqual({ value: '2.5', unit: 'million KRW' });
    expect(money(null)).toBe('—');
  });
  it('retains account names, role keys, and permissions while translating role captions', async () => {
    const person = personOf('usr-author');
    const policy = JSON.stringify(permMatrix);
    const key = roleKeyOf('author');
    await changeUiLanguage('en');
    expect(personOf('usr-author')).toMatchObject({ id: person.id, name: person.name, known: person.known });
    expect(personOf('한글 사용자 계정')).toMatchObject({ id: '한글 사용자 계정', name: '한글 사용자 계정' });
    expect(displayRoleLabel('author')).not.toMatch(/[가-힣]/);
    expect(roleKeyOf('author')).toBe(key);
    expect(JSON.stringify(permMatrix)).toBe(policy);
  });
});
