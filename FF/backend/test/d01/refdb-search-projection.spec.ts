import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { REF_MONEY_FIELDS } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { RefdbRepository } from '../../src/domains/d01-policy/refdb/refdb.repository';
import { RefdbReadService } from '../../src/domains/d01-policy/refdb/refdb-read.service';
import { bootApp } from '../helpers';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { dialectContextOf, translate } from '../../src/kernel/pg-dialect';

describe('reference search scalar Feature-name projection', () => {
  let b: Awaited<ReturnType<typeof bootApp>>, db: Db, repo: RefdbRepository, service: RefdbReadService;
  const shared = '성능 회귀 공유키 Ω';
  const refs = ['BC-BCM-001', 'CH-BRK-009'];
  const ids = (q: Record<string, string> = {}) => service.list({ q: '성능회귀공유키', ...q }, 'FEATURE_AUTHOR').items.map((r) => r.refId);
  beforeAll(async () => {
    b = await bootApp(); db = b.get<Db>(DB); repo = b.get(RefdbRepository); service = b.get(RefdbReadService);
    const template = JSON.parse(db.get<{ doc: string }>('SELECT doc FROM feature_version ORDER BY feature_id, version LIMIT 1')!.doc);
    db.tx(() => {
      for (let i = 0; i < 250; i++) {
        const featureId = `FEAT-${80000 + i}`, refId = refs[i % refs.length];
        const doc = { ...template, featureId, version: '1.0.0', name: shared, description: '본문전용성능회귀문구'.repeat(1024), baselineId: null, featureRefs: [{ refId, role: 'PRIMARY', refVersion: 'v1.3' }] };
        db.run('INSERT INTO feature_version (feature_id, version, lifecycle, baseline_id, doc) VALUES (?, ?, ?, ?, ?)', featureId, '1.0.0', template.lifecycle, null, JSON.stringify(doc));
        repo.replaceLinks(featureId, '1.0.0', doc.featureRefs as any);
      }
      const doc = { ...template, featureId: 'FEAT-89999', version: '1.0.0', name: '회귀 단독 "따옴표" \\ Ω', baselineId: null, featureRefs: [{ refId: 'AD-ADS-004', role: 'PRIMARY', refVersion: 'v1.3' }] };
      db.run('INSERT INTO feature_version (feature_id, version, lifecycle, baseline_id, doc) VALUES (?, ?, ?, ?, ?)', doc.featureId, doc.version, template.lifecycle, null, JSON.stringify(doc));
      repo.replaceLinks(doc.featureId, doc.version, doc.featureRefs as any);
    });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => b.app.close());

  it('avoids transferring unrelated large Feature documents for a scalar name lookup', () => {
    const spy = vi.spyOn(db, 'all');
    const names = repo.linkedFeatureNames();
    expect(names.get(refs[0])?.filter((name) => name === shared)).toHaveLength(1);
    expect(names.get('AD-ADS-004')).toContain('회귀 단독 "따옴표" \\ Ω');
    const calls = spy.mock.calls.map((args, i) => ({ sql: args[0], result: spy.mock.results[i].value as unknown[] }));
    const lookup = calls.filter((call) => /JOIN\s+feature_version/i.test(call.sql));
    expect(lookup).toHaveLength(1); // no per-Feature/N+1 query
    expect(Buffer.byteLength(JSON.stringify(lookup[0].result))).toBeLessThan(150_000);
    expect(JSON.stringify(lookup[0].result)).not.toContain('본문전용성능회귀문구');
    const translated = translate(lookup[0].sql, dialectContextOf(MIGRATIONS)).text;
    expect(translated).toContain("((f.doc)::jsonb #>> '{name}')");
    expect(translated).not.toContain('json_extract');
  });

  it('preserves normalized linked-name matching, deterministic rank/ID order and facets', () => {
    for (const q of ['성능회귀공유키', '성능 회귀 공유키', '성능회귀공유키 Ω']) expect(ids({ q })).toEqual(refs);
    expect(ids({ q: '본문전용성능회귀문구' })).toEqual([]);
    const result = service.list({ q: '성능회귀공유키', limit: '1', offset: '1' }, 'FEATURE_AUTHOR');
    expect(result.total).toBe(2); expect(result.items.map((r) => r.refId)).toEqual([refs[1]]);
    expect(Object.values(result.facets.domain).reduce((a, n) => a + n, 0)).toBe(2);
    const row = repo.getRef(refs[0])!;
    expect(ids({ domain: row.domain, component: row.component, status: row.status })).toEqual([refs[0]]);
    const source = row.sourceIds[0];
    expect(ids({ source })).toEqual(refs.filter((id) => repo.getRef(id)!.sourceIds.includes(source)));
  });

  it('still searches native names, aliases, internal glossary and exact reference IDs', () => {
    expect(ids({ q: '오토 홀드' })).toContain('CH-BRK-009');
    expect(ids({ q: 'power SEAT' })).toContain('BC-SEAT-001');
    expect(ids({ q: 'SCC' })).toContain('AD-LON-002');
    expect(ids({ q: refs[1] })[0]).toBe(refs[1]);
  });

  it('applies role-specific money masking separately to every response', () => {
    const plain = service.list({ q: '성능회귀공유키' }, 'FEATURE_AUTHOR').items.find((r) => r.refId === refs[0])!;
    const admin = service.list({ q: '성능회귀공유키' }, 'REFDB_ADMIN').items.find((r) => r.refId === refs[0])!;
    expect(REF_MONEY_FIELDS.every((key) => !(key in plain))).toBe(true);
    expect(admin.benchmarkEur).toBe(100000);
    expect(REF_MONEY_FIELDS.every((key) => key in admin)).toBe(true);
    expect(REF_MONEY_FIELDS.every((key) => !(key in service.list({ q: '성능회귀공유키' }, 'AUDITOR').items[0]))).toBe(true);
  });

  it('reflects Feature rename and link replacement immediately, including transaction rollback', () => {
    expect(ids({ q: '따옴표' })).toEqual(['AD-ADS-004']);
    const changed = new Error('rollback fixture');
    expect(() => db.tx(() => {
      const doc = JSON.parse(db.get<{ doc: string }>('SELECT doc FROM feature_version WHERE feature_id = ? AND version = ?', 'FEAT-89999', '1.0.0')!.doc);
      db.run('UPDATE feature_version SET doc = ? WHERE feature_id = ? AND version = ?', JSON.stringify({ ...doc, name: '회귀 단독 이름변경' }), 'FEAT-89999', '1.0.0');
      repo.replaceLinks('FEAT-89999', '1.0.0', [{ refId: refs[0], role: 'PRIMARY', refVersion: 'v1.3' }]);
      expect(ids({ q: '따옴표' })).toEqual([]);
      expect(ids({ q: '단독이름변경' })).toEqual([refs[0]]);
      throw changed;
    })).toThrow(changed);
    expect(ids({ q: '따옴표' })).toEqual(['AD-ADS-004']);
    expect(ids({ q: '단독이름변경' })).toEqual([]);
  });

  it('reflects reference status and publication metadata changes without a stale cached search', () => {
    const changed = new Error('rollback fixture');
    expect(() => db.tx(() => {
      const row = repo.getRef(refs[0])!;
      repo.updateRef({ ...row, status: 'RETIRED' }, '2026-11-05T00:00:00Z');
      expect(ids({ status: 'ACTIVE' })).toEqual([refs[1]]);
      expect(ids({ status: 'RETIRED' })).toEqual([refs[0]]);
      const release = repo.latestRelease()!;
      repo.insertRelease({ ...release, release: 'v9.9', publishedAt: '2026-11-05T00:00:00Z' });
      expect(service.list({ q: '성능회귀공유키' }, 'FEATURE_AUTHOR').release).toBe('v9.9');
      throw changed;
    })).toThrow(changed);
    expect(ids({ status: 'ACTIVE' })).toEqual(refs);
    expect(service.list({ q: '성능회귀공유키' }, 'FEATURE_AUTHOR').release).toBe('v1.3');
  });
});
