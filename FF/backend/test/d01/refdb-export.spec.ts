// Feature DB 내보내기(30-95 §10, R-4) — xlsx는 엑셀 03_FeatureDB 마스터 열 위치(A~AE·BJ~BL·BO~BV) + 09_출처, 하네스 읽기(tools/xlsx readWorkbook)로 왕복.
// 벤치마크 열(O 금액·P·V·W, 금액에서 나오는 U)은 Feature DB 관리자만. 지난 발행 버전은 그 시점 기준 행으로 되돌려 내보내고, 해시가 발행 기록과 맞는다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { readWorkbook } from '../../../tools/xlsx';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const REVIEWER = actor('usr-approver', 'DOMAIN_REVIEWER');
const ADMIN = actor('usr-steward', 'REFDB_ADMIN');

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
/** 'O' → 14 */
const col = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

describe('Feature DB 내보내기', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;
  const http = () => ctx.http();
  beforeAll(async () => {
    ctx = await bootApp({ at: '2026-11-04T09:00:00.000Z' });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const xlsx = async (query: string, who: Record<string, string> = ADMIN) => {
    const r = await http().get(`/api/refdb/export?format=xlsx${query}`).set(who).buffer(true).parse(binary as never).expect(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="FeatureDB_v\d+\.\d+\.xlsx"/);
    return readWorkbook(r.body as Buffer);
  };

  it('xlsx — 03_FeatureDB·09_출처·14_개정이력·04_분류 시트, 머리글 행이 마스터 열 위치에, 기준 행 1,052개', async () => {
    const wb = await xlsx('');
    // 회귀(P5-11): 시트가 2개뿐이라 발행 정보·분류를 파일에서 알 수 없었다
    expect(wb.map((s) => s.name)).toEqual(['03_FeatureDB', '09_출처', '14_개정이력', '04_분류']);
    const rel = wb[2].rows;
    expect(rel[0].slice(0, 2)).toEqual(['내보낸 버전', 'v1.3']);
    expect(rel[2]).toEqual(['버전', '발행 시각', '발행자', '변경 요청', '전체 해시', '메모']);
    expect(rel[3][0]).toBe('v1.3');
    const tax = wb[3].rows;
    expect(tax[0]).toEqual(['노드 ID', '단계', '상위', '이름 (영문)', '이름 (한글)', '약어', '상태']);
    expect(tax.filter((r) => r[1] === '도메인')).toHaveLength(10);
    const [head, ...rows] = wb[0].rows;
    expect([head[col('A')], head[col('B')], head[col('G')], head[col('L')], head[col('S')], head[col('T')], head[col('Y')]]).toEqual(['ID', '도메인', '기능명', 'QM / ASIL (대표, 가정)', 'T-shirt 등급', '등급 포인트', '출처 ID']);
    expect([head[col('BJ')], head[col('BK')], head[col('BL')], head[col('BO')], head[col('BQ')], head[col('BV')]]).toEqual(['중복 점검 기준 ID', '규모 근거 등급', '선행 Feature ID', '등록 버전', '관리 상태', '과금 방식']);
    expect(head.slice(col('AF'), col('BI') + 1).every((h) => h === '')).toBe(true); // 과제 입력·자동 계산 열은 옮기지 않는다
    expect(rows).toHaveLength(1052);
    const brk = rows.find((r) => r[0] === 'CH-BRK-009')!;
    expect([brk[col('G')], brk[col('L')], brk[col('S')], brk[col('T')], brk[col('BQ')]]).toEqual(['오토 홀드', 'B', 'S', '3', '활성']);
    // 관리자는 벤치마크 열을 본다 — BC-BCM-001은 Kearney 평균 업체 개발비가 있는 행
    expect(head[col('O')]).toBe('Average Player (€, Kearney)');
    expect(rows.find((r) => r[0] === 'BC-BCM-001')![col('O')]).toBe('100000');
    const src = wb[1].rows;
    expect(src[0]).toEqual(['ID', '자료', '발행처·저자', '연도·버전', 'URL·식별자', '도구 내 사용처', '최종 확인일', '다음 점검일']);
    expect(src[1][0]).toBe('S01');
    expect(src.length - 1).toBe((await http().get('/api/refdb/sources').expect(200)).body.items.length);
  });

  it('관리자가 아니면 벤치마크 열(O·P·V·W)은 머리글까지 비우고, json에도 싣지 않는다 — U 명목 포인트는 벤치마크를 뺀 값으로 남긴다', async () => {
    const wb = await xlsx('', AUTHOR);
    const [head, ...rows] = wb[0].rows;
    for (const c of ['O', 'P', 'V', 'W']) expect(head[col(c)] ?? '', c).toBe('');
    // 회귀(P5-11): 금액이 아닌 U 열까지 머리글을 가렸다 — T-shirt로만 계산한 값(벤치마크 있는 행도 같은 규칙)
    expect(head[col('U')]).toBe('명목 포인트 (벤치마크 제외)');
    const bcm = rows.find((r) => r[0] === 'BC-BCM-001')!;
    expect(bcm[col('U')]).toBe(bcm[col('T')]);
    expect(wb.map((s) => s.name)).toContain('14_개정이력');
    expect(head.includes('Average Player (€, Kearney)')).toBe(false);
    expect(rows.find((r) => r[0] === 'BC-BCM-001')![col('O')] ?? '').toBe('');
    const anon = (await http().get('/api/refdb/export').expect(200)).body;
    expect(anon.format).toBe('json');
    expect(anon.refs.find((r: { refId: string }) => r.refId === 'BC-BCM-001')).not.toHaveProperty('benchmarkEur');
    const admin = (await http().get('/api/refdb/export').set(ADMIN).expect(200)).body;
    expect(admin.refs.find((r: { refId: string }) => r.refId === 'BC-BCM-001').benchmarkEur).toBe(100000);
  });

  it('지난 발행 버전 — 그 시점 기준 행으로 내보내고, 되돌린 내용의 해시가 발행 기록과 맞는다', async () => {
    const change = async (body: Record<string, unknown>) => {
      const c = (await http().post('/api/refdb/changes').set(AUTHOR).send(body).expect(201)).body;
      await http().post(`/api/refdb/changes/${c.changeId}/reviews`).set(REVIEWER).send({ opinion: 'AGREE', comment: '동의' }).expect(201);
      await http().post(`/api/refdb/changes/${c.changeId}/decision`).set(ADMIN).send({ decision: 'APPROVE', reason: '승인' }).expect(201);
      return (await http().post('/api/refdb/releases').set(ADMIN).send({}).expect(201)).body.release;
    };
    const v14 = await change({ kind: 'MODIFY', refId: 'CH-BRK-009', after: { nameKo: '오토 홀드 v1.4' }, reason: '명칭' });
    const v15 = await change({ kind: 'MODIFY', refId: 'CH-BRK-009', after: { nameKo: '오토 홀드 v1.5' }, reason: '명칭 다시' });
    const v16 = await change({ kind: 'ADD', after: { domain: 'Chassis & Vehicle Dynamics', cluster: 'Brake control', component: 'Brake control (ESC/ABS)', nameEn: 'Brake fade warning', nameKo: '제동력 저하 경고', tshirt: 'S', asilRep: 'A', sourceIds: ['S01'] }, reason: '새 기능' });
    expect([v14.release, v15.release, v16.release]).toEqual(['v1.4', 'v1.5', 'v1.6']);
    const nameAt = async (release: string) => (await xlsx(`&release=${release}`)).at(0)!.rows.find((r) => r[0] === 'CH-BRK-009')![col('G')];
    expect(await nameAt('v1.3')).toBe('오토 홀드');
    expect(await nameAt('v1.4')).toBe('오토 홀드 v1.4');
    expect(await nameAt('v1.6')).toBe('오토 홀드 v1.5');
    const rowsAt = async (release: string) => (await http().get(`/api/refdb/export?release=${release}`).set(ADMIN).expect(200)).body;
    expect((await rowsAt('v1.5')).refs).toHaveLength(1052); // v1.6 추가 행은 그 전 발행에 없다
    expect((await rowsAt('v1.6')).refs).toHaveLength(1053);
    for (const rel of [v14, v15, v16]) expect((await rowsAt(rel.release)).hash, rel.release).toBe(rel.hash);
  });

  it('없는 발행 버전은 404, 모르는 형식은 400', async () => {
    await http().get('/api/refdb/export?release=v9.9').expect(404);
    await http().get('/api/refdb/export?format=csv').expect(400);
  });
});
