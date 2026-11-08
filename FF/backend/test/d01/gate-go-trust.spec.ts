// P10 Go/No-Go는 상태값과 서명된 판정 기록을 함께 본다(FFG-LCY-001).
// 원본 상태/서명 진단은 보존하고, 사용할 수 없는 PASS·N/A는 최종 집계에서 판정 대기로 둔다.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { GateRepo } from '../../src/domains/d01-policy/repos';
import { bootApp } from '../helpers';

describe('Gate Go/No-Go 판정 근거 신뢰도', () => {
  let app: INestApplication;
  let http: () => any;
  const read = async () => (await http().get('/api/features/FEAT-00022/versions/1.0.0/gates').expect(200)).body;

  beforeAll(async () => { ({ app, http } = await bootApp({ at: '2026-10-18T01:00:00.000Z' })); });
  afterAll(async () => app?.close());

  it('봉인된 이관 PASS 9개는 Go로 집계한다', async () => {
    const view = await read();
    expect(view.goNoGo).toMatchObject({ result: 'GO', open: [], failed: [] });
    expect(view.gates.every((g: any) => g.decision.state === 'IMPORTED')).toBe(true);
  });

  it('PASS 기록의 Evidence가 변조되면 raw PASS와 INVALID 진단은 남고 집계는 판정 대기다', async () => {
    const db = app.get<Db>(DB);
    const record = app.get(GateRepo).latest('FEAT-00022', '1.0.0').G1!;
    try {
      db.run('UPDATE gate_record SET doc = ? WHERE gate_record_id = ?', JSON.stringify({ ...record, evidenceRef: 'EV-P10-TAMPERED' }), record.gateRecordId);
      const view = await read();
      expect(view.gates.find((g: any) => g.gate === 'G1')).toMatchObject({ status: 'PASS', decision: { state: 'INVALID' } });
      expect(view.goNoGo).toMatchObject({ result: 'PENDING', open: ['G1'] });
      expect(view.goNoGo.passed).not.toContain('G1');
    } finally {
      db.run('UPDATE gate_record SET doc = ? WHERE gate_record_id = ?', JSON.stringify(record), record.gateRecordId);
    }
  });

  it('서명과 다른 N/A 기록은 필수 Gate 제외 근거로 쓰지 않는다', async () => {
    const db = app.get<Db>(DB);
    const record = app.get(GateRepo).latest('FEAT-00022', '1.0.0').G3!;
    try {
      db.run('UPDATE gate_record SET doc = ? WHERE gate_record_id = ?', JSON.stringify({ ...record, inputResult: 'N/A', status: 'N/A' }), record.gateRecordId);
      const view = await read();
      expect(view.gates.find((g: any) => g.gate === 'G3')).toMatchObject({ status: 'N/A', decision: { state: 'INVALID' } });
      expect(view.goNoGo).toMatchObject({ result: 'PENDING', open: ['G3'] });
      expect(view.goNoGo.required).toContain('G3');
      expect(view.goNoGo.notApplicable).not.toContain('G3');
    } finally {
      db.run('UPDATE gate_record SET doc = ? WHERE gate_record_id = ?', JSON.stringify(record), record.gateRecordId);
    }
  });

  it('결정 기록 없이 추가된 PASS도 Go 근거에서 제외한다', async () => {
    const repo = app.get(GateRepo);
    const record = repo.latest('FEAT-00022', '1.0.0').G1!;
    repo.insert({ ...record, gateRecordId: repo.nextId('G1'), rationale: '서명된 판정 없이 추가된 기록' });
    const view = await read();
    expect(view.gates.find((g: any) => g.gate === 'G1')).toMatchObject({ status: 'PASS', decision: { state: 'MISSING' } });
    expect(view.goNoGo).toMatchObject({ result: 'PENDING', open: ['G1'] });
    expect(view.goNoGo.passed).not.toContain('G1');
  });
});
