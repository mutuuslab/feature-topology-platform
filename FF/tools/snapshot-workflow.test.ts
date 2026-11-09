import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotWorkflow } from './snapshot-workflow.ts';
import { snapshotServerEnv } from './snapshot-api.ts';

test('exports each real workflow detail and source once with the existing administrator read permission', async () => {
  const calls: { name: string; params: unknown; headers: unknown }[] = [];
  const cases = [{ caseId: 'WFC-one' }, { caseId: 'WFC-two' }];
  await snapshotWorkflow(async (name, params, _query, headers) => {
    calls.push({ name, params, headers });
    return name === 'workflowCases' ? { items: cases } : { item: cases.find(c => c.caseId === params?.id) };
  });
  assert.deepEqual(calls.map(c => [c.name, c.params]), [['workflowCases', {}], ['workflowCase', { id: 'WFC-one' }], ['workflowCaseSources', { id: 'WFC-one' }], ['workflowCase', { id: 'WFC-two' }], ['workflowCaseSources', { id: 'WFC-two' }]]);
  assert.ok(calls.every(c => JSON.stringify(c.headers) === JSON.stringify({ 'X-Actor-Id': 'usr-sysadmin', 'X-Actor-Role': 'SYSTEM_ADMIN' })));
});

test('forwards the explicit synthetic scale while excluding customer DB, credentials and real external endpoints', () => {
  const env = snapshotServerEnv({ FF_SHOWCASE: '1', FF_SHOWCASE_SCALE: '2', FF_SHOWCASE_VEHICLES: '480', FF_SYNTHETIC: '24000', FF_DB: 'customer.db', FF_DB_URL: 'postgres://private', FF_AUTH: 'oidc', OIDC_CLIENT_SECRET: 'private', UNLEASH_URL: 'https://private.invalid', UNLEASH_ADMIN_TOKEN: 'private' }, 9559, { SIM_MODE: 'auto' });
  assert.equal(env.FF_SHOWCASE_SCALE, '2'); assert.equal(env.FF_DB, ':memory:');
  assert.equal(env.FF_SHOWCASE, '1'); assert.equal(env.FF_SHOWCASE_VEHICLES, '480'); assert.equal(env.FF_SYNTHETIC, '24000');
  assert.equal(env.FF_SCHEDULER, 'manual');
  for (const key of ['FF_DB_URL', 'FF_AUTH', 'OIDC_CLIENT_SECRET', 'UNLEASH_URL', 'UNLEASH_ADMIN_TOKEN']) assert.equal(env[key], undefined);
});

test('freezes only the isolated synthetic capture scheduler, regardless of inherited or injected timer mode', () => {
  const env = snapshotServerEnv({ FF_SCHEDULER: 'auto', FF_DB: 'customer.db' }, 9559, { SIM_MODE: 'auto', FF_SCHEDULER: 'auto' });
  assert.equal(env.FF_SCHEDULER, 'manual');
  assert.equal(env.SIM_MODE, 'auto');
  assert.equal(env.FF_DB, ':memory:');
});
