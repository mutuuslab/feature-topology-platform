// 감사·이력 조회 보강(B4) — 기간 조건·민감 값 가림·변경 전후 값·CSV 파일 형식.
import { describe, expect, it } from 'vitest';
import { csvBody, csvCell, csvFile, exportSignedPayload, fieldChanges, LEGACY_MONEY_MASK, maskSensitive, parseExportFile, periodBounds, SENSITIVE_MASK } from './audit-export';

describe('기간 조건', () => {
  it('날짜는 화면 시각과 같은 한국 시간(UTC+9) — 시작일 0시부터 끝일 끝까지(다음 날 0시 미만), 시각은 그대로', () => {
    expect(periodBounds('2026-11-01', '2026-11-05')).toEqual({ from: '2026-10-31T15:00:00.000Z', to: '2026-11-05T15:00:00.000Z' });
    expect(periodBounds(undefined, '2026-11-05T10:00:00Z')).toEqual({ to: '2026-11-05T10:00:00.000Z' });
  });
  it('경계 — 화면에 2026-11-06 08:30(한국 시간)으로 보이는 기록은 11-06 하루 조건에 든다', () => {
    const p = periodBounds('2026-11-06', '2026-11-06');
    const shownAs0830 = '2026-11-05T23:30:00.000Z';
    const shownAsNext0830 = '2026-11-06T23:30:00.000Z';
    expect(shownAs0830 >= p.from! && shownAs0830 < p.to!).toBe(true);
    expect(shownAsNext0830 >= p.from! && shownAsNext0830 < p.to!).toBe(false);
  });
  it('읽을 수 없거나 거꾸로면 오류', () => {
    expect(periodBounds('2026-13-01').error).toBeTruthy();
    expect(periodBounds('어제').error).toBeTruthy();
    expect(periodBounds('2026-11-05', '2026-11-01').error).toBeTruthy();
  });
});

describe('민감 값 가림', () => {
  it('금액·벤치마크 키는 값 대신 가림 자리, 중첩·배열 안까지. 빈 값은 그대로', () => {
    expect(maskSensitive({ name: 'A', benchmarkEur: 1200, nested: { unitPrice: 3, label: 'x' }, list: [{ totalCost: 9 }], kearneyNote: '' })).toEqual({
      name: 'A',
      benchmarkEur: SENSITIVE_MASK,
      nested: { unitPrice: SENSITIVE_MASK, label: 'x' },
      list: [{ totalCost: SENSITIVE_MASK }],
      kearneyNote: '',
    });
  });
});

describe('변경 전후 값', () => {
  it('바뀐 필드만 점 경로로, 배열은 통째로', () => {
    expect(fieldChanges({ rollout: { mode: 'COHORT', basisPoints: 500 }, tags: ['a'] }, { rollout: { mode: 'COHORT', basisPoints: 2500 }, tags: ['a', 'b'] })).toEqual([
      { field: 'rollout.basisPoints', before: 500, after: 2500, masked: false },
      { field: 'tags', before: ['a'], after: ['a', 'b'], masked: false },
    ]);
  });
  it('민감 키·이미 가린 값은 바뀐 사실만(값은 가림)', () => {
    expect(fieldChanges({ benchmarkEur: 100 }, { benchmarkEur: 200 })).toEqual([{ field: 'benchmarkEur', before: SENSITIVE_MASK, after: SENSITIVE_MASK, masked: true }]);
    expect(fieldChanges({ note: LEGACY_MONEY_MASK }, { note: 'x' })[0].masked).toBe(true);
    expect(fieldChanges({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe('CSV 파일', () => {
  it('쉼표·따옴표·줄바꿈은 따옴표로, 수식 시작 글자는 작은따옴표를 붙인다', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    // 탭·CR로 시작해도 표 계산기가 수식으로 읽는다(OWASP CSV Injection)
    expect(csvCell('\t=1+1')).toBe("'\t=1+1");
    expect(csvCell('\r=1+1')).toBe(`"'\r=1+1"`);
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(null)).toBe('');
  });
  it('머리글 # 줄에 범위·행 수·SHA-256·서명, 그 뒤 데이터 줄(CRLF)', () => {
    const body = csvBody(['id', 'action'], [{ id: 1, action: 'POLICY_VIEW' }]);
    expect(body).toBe('id,action\r\n1,POLICY_VIEW\r\n');
    const f = csvFile({ kind: 'audit', generatedAt: 'T', generatedBy: 'usr-viewer', period: { from: 'F', to: null }, integrity: { rows: 1, sha256: 'h', chainFrom: 'p', chainTo: 'q', signature: { keyId: 'KEY-1', alg: 'Ed25519', payloadHash: 'x', signature: 's' } } }, body);
    expect(f.split('\r\n').filter((l) => l.startsWith('#'))).toEqual([
      '# Feature Flag Platform 감사 이력 내보내기',
      '# generatedAt=T generatedBy=usr-viewer',
      '# period=F.. rows=1',
      '# sha256=h (아래 데이터 줄 전체)',
      '# chain=p..q',
      '# signed={"filters":{},"generatedAt":"T","generatedBy":"usr-viewer","kind":"audit","period":{"from":"F","to":null},"rows":1,"sha256":"h"}',
      '# payloadHash=x',
      '# signature=Ed25519:KEY-1:s',
    ]);
    expect(f.endsWith(body)).toBe(true);
  });
});

describe('내보내기 서명 범위·파일 읽기(제3자 검증)', () => {
  const integrity = { rows: 1, sha256: 'a'.repeat(64), chainFrom: null, chainTo: null, signature: { keyId: 'KEY-EXP-1', alg: 'Ed25519', payloadHash: 'sha256:' + 'b'.repeat(64), signature: 'c2ln' } };
  const meta = { kind: 'audit' as const, generatedAt: '2026-11-06T01:00:00.000Z', generatedBy: 'usr-viewer', period: { from: '2026-11-05T15:00:00.000Z', to: null }, filters: { targetPrefix: 'POL-\r\n# 끼움' }, integrity };
  it('서명 대상에 내보낸 사람·조건이 들어간다 — 머리 줄만 바꿔 다른 사람·조건의 파일로 꾸미면 서명이 맞지 않는다', () => {
    const p = exportSignedPayload({ ...meta, rows: 1, sha256: integrity.sha256 });
    expect(p).toMatchObject({ generatedBy: 'usr-viewer', filters: { targetPrefix: 'POL-\r\n# 끼움' } });
  });
  it('CSV 머리 줄에서 서명 대상을 그대로 되살린다(조건 값의 줄바꿈이 머리 줄을 깨지 않는다)', () => {
    const body = csvBody(['id'], [{ id: 1 }]);
    const text = String.fromCharCode(0xfeff) + csvFile(meta, body);
    const parsed = parseExportFile(text);
    expect(parsed.format).toBe('csv');
    expect(parsed.data).toBe(body);
    expect(parsed.payload).toEqual(exportSignedPayload({ ...meta, rows: 1, sha256: integrity.sha256 }));
    expect(parsed.signature).toEqual({ alg: 'Ed25519', keyId: 'KEY-EXP-1', signature: 'c2ln' });
    expect(parsed.payloadHash).toBe(integrity.signature.payloadHash);
  });
  it('JSON 봉투에서 서명 대상·해시 대상(rows 정규 JSON)을 되살린다', () => {
    const env = { kind: 'validations', generatedAt: meta.generatedAt, generatedBy: 'usr-opslead', period: { from: null, to: null }, filters: {}, integrity, rows: [{ b: 2, a: 1 }] };
    const parsed = parseExportFile(JSON.stringify(env, null, 2));
    expect(parsed.format).toBe('json');
    expect(parsed.data).toBe('[{"a":1,"b":2}]');
    expect(parsed.rowCount).toBe(1);
    expect(parsed.payload).toMatchObject({ kind: 'validations', generatedBy: 'usr-opslead', filters: {} });
  });
  it('사람이 읽는 머리 줄만 바꾸면 서명 대상과 어긋난 곳으로 잡힌다', () => {
    const text = csvFile(meta, csvBody(['id'], [{ id: 1 }])).replace('generatedBy=usr-viewer', 'generatedBy=usr-auditor-2');
    expect(parseExportFile(text).mismatches).toEqual(['generatedAt·generatedBy 머리 줄이 서명 대상과 다릅니다']);
  });
  it('머리 줄이 빠진 파일은 읽지 않는다', () => {
    expect(() => parseExportFile('id\r\n1\r\n')).toThrow();
  });
});
