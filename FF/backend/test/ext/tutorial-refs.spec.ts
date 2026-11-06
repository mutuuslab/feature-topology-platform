// 따라하기 시나리오가 가리키는 예시 데이터 ID가 데모 시드(v0.81 + 데모 활동·개발비 데모 — 데모 서버·정적 스냅샷과 같은 구성)에 실제로 있는지.
// 문구·경로 속 ID가 refs에 빠짐없이 적혔는지는 contracts 시험(tutorial.test.ts)이 본다. 여기서는 refs·경로의 ID를 API로 찾는다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TUTORIALS } from '@ff/contracts';
import { actor, bootApp } from '../helpers';

const AUDITOR = actor('usr-viewer', 'AUDITOR');
const SECURITY = actor('usr-integrator', 'SECURITY_OFFICER');

/** 경로의 /features/FEAT-00022/1.0.0 → FEAT-00022@1.0.0 */
const routeIds = (route: string) => [...route.matchAll(/\/features\/(FEAT-\d{5})\/(\d+\.\d+\.\d+)/g)].map((m) => `${m[1]}@${m[2]}`);

describe('따라하기 시나리오 — 참조 ID가 데모 시드에 있다', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ demoActivity: true, costDemo: true, showcaseFill: false })));
  afterAll(() => app.close());

  /** 목록 응답 본문에 ID가 있는가 — 같은 목록은 한 번만 받는다 */
  const lists = new Map<string, string>();
  const listHas = async (path: string, id: string, who = AUDITOR) => {
    if (!lists.has(path)) lists.set(path, JSON.stringify((await http().get(path).set(who)).body));
    return lists.get(path)!.includes(id);
  };
  const exists = async (id: string): Promise<boolean> => {
    const feat = id.match(/^(FEAT-\d{5})@(\d+\.\d+\.\d+)$/);
    if (feat) return (await http().get(`/api/features/${feat[1]}/versions/${feat[2]}`).set(AUDITOR)).status === 200;
    const one: [RegExp, (x: string) => string][] = [
      [/^POL-\d{5}$/, (x) => `/api/policies/${x}`],
      [/^KILL-\d{5}$/, (x) => `/api/kill-requests/${x}`],
      [/^ANM-\d{5}$/, (x) => `/api/anomalies/${x}`],
      [/^PUB-\d{5}$/, (x) => `/api/publications/${x}`],
    ];
    for (const [re, url] of one) if (re.test(id)) return (await http().get(url(id)).set(AUDITOR)).status === 200;
    if (/^(ENT|CAT)-\d{5}$/.test(id)) return listHas('/api/entitlements', id);
    if (/^RH-\d{5}$/.test(id)) return listHas('/api/rehara-requests', id);
    if (/^RET-\d{5}$/.test(id)) return listHas('/api/flag-retirements', id);
    if (/^INC-\d{5}$/.test(id)) return listHas('/api/incidents', id);
    if (/^CVE-/.test(id)) return listHas('/api/vex', id, SECURITY);
    if (/^SCN-/.test(id)) return listHas('/api/virtual-validations/scenarios?featureId=FEAT-00022', id);
    if (/^(care|ivi)_\d{5}_[a-z]+$/.test(id)) return listHas('/api/policies', id);
    if (/^(KMH|HMA|TMA)-|^(ego|lead)-\d{2}$/.test(id)) return listHas('/api/vehicles', id);
    throw new Error(`판정 방법이 없는 ID 형식: ${id}`);
  };

  it('refs·경로의 ID는 모두 있고, 단계가 만드는 ID는 아직 없다', async () => {
    const missing: string[] = [];
    const premade: string[] = [];
    for (const t of TUTORIALS) {
      const made = new Set(t.steps.flatMap((s) => s.creates ?? []));
      for (const s of t.steps) {
        for (const id of new Set([...(s.refs ?? []), ...routeIds(s.route)])) if (!made.has(id) && !(await exists(id))) missing.push(`${t.id}/${s.id}: ${id}`);
        for (const id of s.creates ?? []) if (await exists(id)) premade.push(`${t.id}/${s.id}: ${id}`);
      }
    }
    expect(missing).toEqual([]);
    expect(premade).toEqual([]);
    // 대조 — 없는 ID는 없다고 판정한다(판정 방법이 늘 참이 되지 않게)
    for (const id of ['FEAT-00022@9.9.9', 'KMH-NX4-9999', 'CVE-2026-00000', 'POL-99999', 'ENT-99999', 'care_99999_none']) expect(await exists(id), id).toBe(false);
  });

  it('시나리오가 기대는 시드 상태 — 확정·초안 분류와 대상 차량', async () => {
    const prof = async (f: string, v: string) => (await http().get(`/api/features/${f}/versions/${v}/safety`).set(AUDITOR)).body.profile;
    // CLASSIFY-GATE·CS-01: 확정(잠김), CS-07·CS-10: 초안이라 고칠 수 있다
    expect((await prof('FEAT-00022', '1.0.0')).status).toBe('CONFIRMED');
    expect(await prof('FEAT-00015', '1.2.0')).toMatchObject({ status: 'DRAFT', deactClass: 'DC2', gsrMandatory: false });
    expect(await prof('FEAT-00001', '2.2.0')).toMatchObject({ status: 'DRAFT', adsFeature: false });
    // KILL-DC2: FEAT-00022 차단 대상에 KMH-NX4-0004, 걸린 차단 없음. 복원 게이트(BOM Baseline·SBOM 참조)를 통과할 수 있는 Feature
    const pv = (await http().get('/api/kill-requests/preview').query({ featureId: 'FEAT-00022', featureVersion: '1.0.0', reasonCategory: 'SAFETY' }).set(actor('usr-operator', 'OPERATOR'))).body;
    expect(pv.vehicles.map((v: { vin: string }) => v.vin)).toContain('KMH-NX4-0004');
    expect(pv.activeKill).toBeNull();
    expect((await prof('FEAT-00022', '1.0.0')).sbomRef).toBeTruthy();
    expect((await http().get('/api/features/FEAT-00022/versions/1.0.0').set(AUDITOR)).body.feature.baselineId).toBeTruthy();
    // CS-06: 미국 Feature FEAT-00028에 걸린 차단이 없다
    const us = (await http().get('/api/kill-requests/preview').query({ featureId: 'FEAT-00028', featureVersion: '1.0.0', reasonCategory: 'SAFETY' }).set(actor('usr-operator', 'OPERATOR'))).body;
    expect(us.activeKill).toBeNull();
  });
});
