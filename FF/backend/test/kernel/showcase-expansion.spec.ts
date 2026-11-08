import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModuleRef } from '@nestjs/core';
import { showcaseScale } from '../../src/kernel/showcase-scale';
import { showcaseVehicleCount } from '../../src/kernel/showcase';
import { ShowcaseExpansion, SHOWCASE_EXPANSION_META } from '../../src/demo-activity/showcase-expansion';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { FeatureRepo, ProductRepo } from '../../src/domains/d01-policy/repos';
import { AdsOrderService } from '../../src/domains/d05-ext/billing/ads-orders.service';
import { bootApp } from '../helpers';

afterEach(() => vi.unstubAllEnvs());
describe('explicit second synthetic showcase cohort', () => {
  it('never scales production, empty customer seeds or historical replay; retains the fleet safety ceiling', () => {
    for (const guard of [{ FF_ENV: 'production' }, { FF_SEED: 'none' }, { FF_DATASET: 'ops5y' }]) expect(showcaseScale({ FF_SHOWCASE: '1', FF_SHOWCASE_SCALE: '2', ...guard })).toBe(1);
    expect(showcaseScale({ FF_SHOWCASE_SCALE: '2' })).toBe(1);
    expect(showcaseScale({ FF_SHOWCASE: '1' })).toBe(1);
    expect(showcaseVehicleCount({ FF_SHOWCASE: '1', FF_SHOWCASE_SCALE: '2', FF_SHOWCASE_VEHICLES: '480' }, 12)).toBe(960);
    expect(() => showcaseVehicleCount({ FF_SHOWCASE: '1', FF_SHOWCASE_SCALE: '2', FF_SHOWCASE_VEHICLES: '601' }, 12)).toThrow();
    for (const value of ['0', '3', '2.5', 'invalid']) expect(() => showcaseScale({ FF_SHOWCASE: '1', FF_SHOWCASE_SCALE: value })).toThrow();
  });

  it('creates linked products, orders, experiments and every process draft without changing existing examples; reruns are inert', async () => {
    vi.stubEnv('FF_SHOWCASE', '1'); vi.stubEnv('FF_SHOWCASE_SCALE', '2');
    vi.stubEnv('FF_SHOWCASE_VEHICLES', '480'); vi.stubEnv('FF_SYNTHETIC', '0'); vi.stubEnv('FF_SCHEDULER', 'manual');
    const b = await bootApp({ at: '2026-11-09T00:00:00.000Z', showcaseFill: false });
    try {
      const db = b.get<Db>(DB), products = b.get(ProductRepo), features = b.get(FeatureRepo);
      const before = products.all(), originalFeatures = features.all();
      const expansion = new ShowcaseExpansion(db, b.get(ModuleRef), b.get(Clock));
      expansion.run();
      expect(products.all()).toHaveLength(before.length * 2);
      for (const row of before) expect(products.get(row.catalogId, row.version)).toEqual(row);
      for (const row of originalFeatures) expect(features.get(row.featureId, row.version)).toEqual(row);
      expect(features.all()).toHaveLength(370);
      expect(db.get<{ n: number }>('SELECT count(*) n FROM policy')!.n).toBeGreaterThanOrEqual(94);
      expect(db.get<{ n: number }>('SELECT count(*) n FROM experiment')!.n).toBe(2);
      const cases = db.all<{ doc: string }>('SELECT doc FROM workflow_case').map(r => JSON.parse(r.doc));
      expect(cases).toHaveLength(36);
      expect(new Set(cases.map(c => c.processId)).size).toBe(18);
      expect(cases.every(c => c.artifacts.length > 0 && Object.keys(c.activities).length === 0 && c.handoffs.length === 0)).toBe(true);
      expect(cases.flatMap(c => c.artifacts).every(a => a.reason.includes('가상 시연') && a.references.every((r: string) => r.startsWith('FEAT-')))).toBe(true);
      const orders = b.get(AdsOrderService).list();
      expect(orders.total).toBe(24);
      expect(Object.values(orders.counts).reduce((a, n) => a + n, 0)).toBe(orders.total);
      expect(orders.items.every(o => o.simulated)).toBe(true);
      for (const o of orders.items) {
        expect(db.get('SELECT 1 FROM vehicle WHERE vin=?', o.vin)).toBeDefined();
        expect(db.get('SELECT 1 FROM product WHERE catalog_id=?', o.catalogId)).toBeDefined();
        if (o.entitlementId) expect(db.get('SELECT 1 FROM entitlement WHERE grant_id=? AND vin=? AND catalog_id=?', o.entitlementId, o.vin, o.catalogId)).toBeDefined();
      }
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      const marker = db.get<{ value: string }>('SELECT value FROM meta WHERE key=?', SHOWCASE_EXPANSION_META)!.value;
      const preservation = JSON.parse(marker).preservation;
      expect(preservation.feature_version.checked).toBe(originalFeatures.length);
      expect(preservation.product.checked).toBe(before.length);
      expect(Object.values(preservation).every((r: any) => !r.changed.length && !r.missing.length)).toBe(true);
      const ledger = db.get<{ n: number }>('SELECT count(*) n FROM audit')!.n;
      expansion.run();
      expect(db.get<{ n: number }>('SELECT count(*) n FROM audit')!.n).toBe(ledger);
      expect(db.get<{ value: string }>('SELECT value FROM meta WHERE key=?', SHOWCASE_EXPANSION_META)!.value).toBe(marker);
    } finally { await b.app.close(); }
  });
});
