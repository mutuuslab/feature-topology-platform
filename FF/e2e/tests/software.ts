// List fixture created by real stream upload and package APIs. Synthetic JS only; no vehicle installation.
import { createHash, randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
export async function prepareSoftwareListFixture(request: APIRequestContext) {
  const api = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
  const feature = await request.get(`${api}/api/features/FEAT-00022/versions/1.0.0`);
  expect(feature.status(), await feature.text()).toBe(200);
  const f = (await feature.json()).feature;
  expect(f.swIds.length).toBeGreaterThan(0);
  const bytes = Buffer.from('// Synthetic E2E fixture. No vehicle installation.\nexport const installationPerformed = false;\n');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const actor = { 'X-Actor-Id': 'usr-integrator', 'X-Actor-Role': 'IMPLEMENTER' };
  const uploaded = await request.post(`${api}/api/software/uploads`, { headers: { ...actor, 'Content-Type': 'application/octet-stream', 'Idempotency-Key': randomUUID(), 'X-File-Name': 'e2e-synthetic-list.mjs', 'X-File-Type': 'text/javascript' }, data: bytes });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const file = await uploaded.json();
  expect(file).toMatchObject({ sha256, bytes: bytes.length });
  const saved = await request.post(`${api}/api/software/packages`, { headers: actor, data: { fileId: file.fileId, featureId: f.featureId, featureVersion: f.version, swId: f.swIds[0], sha256, source: 'EXECUTABLE_DEMO', reason: 'Explicit synthetic E2E list fixture; approval and installation not claimed' } });
  expect(saved.status(), await saved.text()).toBe(201);
  expect(await saved.json()).toMatchObject({ source: 'EXECUTABLE_DEMO', sha256, bytes: bytes.length, status: 'DRAFT' });
}
