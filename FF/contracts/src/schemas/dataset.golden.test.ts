// 골든 테스트 — DATASET v0.81 픽스처가 원본 엑셀의 사실과 일치하는지 고정한다.
import { describe, expect, it } from 'vitest';
import { loadDataset } from '../testing/fixtures';
import { DATASET_FILES } from './dataset';

const ds = loadDataset();

describe('DATASET v0.81 픽스처', () => {
  it('시트별 행 수가 원본과 같다', () => {
    expect({
      features: ds.features.length,
      bomItems: ds.bomItems.length,
      products: ds.products.length,
      dependencies: ds.dependencies.length,
      gateRecords: ds.gateRecords.length,
      featureFunctions: ds.featureFunctions.length,
      swMaster: ds.swMaster.length,
      ecuMaster: ds.ecuMaster.length,
      versionRationale: ds.versionRationale.length,
      precheckRules: ds.precheckRules.length,
      evidence: ds.evidence.length,
    }).toEqual({
      features: 80, bomItems: 67, products: 18, dependencies: 29, gateRecords: 477, featureFunctions: 122,
      swMaster: 47, ecuMaster: 15, versionRationale: 68, precheckRules: 16, evidence: 477,
    });
    expect(new Set(ds.features.map((f) => f.featureId)).size).toBe(68);
  });

  it('모든 행이 계약 스키마를 통과한다', () => {
    for (const [file, schema] of Object.entries(DATASET_FILES))
      for (const row of (ds as any)[file]) {
        const r = schema.safeParse(row);
        expect(r.success, `${file}: ${JSON.stringify(row).slice(0, 80)} ${r.success ? '' : r.error.message}`).toBe(true);
      }
  });

  it('FEAT-00022 전방 안전거리 3단계 (PoC 시나리오)', () => {
    const f = ds.features.find((x) => x.featureId === 'FEAT-00022')!;
    expect(f).toMatchObject({
      name: '전방 안전거리 3단계', version: '1.0.0', lifecycle: 'RELEASED', baselineId: 'BL-00028', asil: 'B',
      country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', requirementIds: ['REQ-CARE-2301'], upgVc: ['F111A114001'],
      swIds: ['SW-CARE-SDIST-APP', 'SW-CARE-SCC-ADP'], swVersions: ['1.2.1', '2.3.0'], controlPoints: ['Signal', 'Parameter'],
      dependencyIds: ['DEP-00013'], catalogIds: ['CAT-00013', 'CAT-00019'],
    });
    expect(f.functions.map((x) => x.functionId)).toEqual(['FUNC-000056', 'FUNC-000057']);
    expect(f.gateRecordIds).toHaveLength(9);

    const dep = ds.dependencies.find((d) => d.dependencyId === 'DEP-00013')!;
    expect(dep).toMatchObject({ type: 'REQUIRES', targetFeatureId: 'FEAT-00145', targetVersion: '5.4.2', verdict: 'PASS' });

    const gates = ds.gateRecords.filter((g) => g.featureId === 'FEAT-00022');
    expect(gates.map((g) => g.gate)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9']);
    expect(gates.every((g) => g.status === 'PASS' && g.evidenceRef)).toBe(true);
  });

  it('CAT-00019 1회 체험 상품 (PoC ③·⑤ 체험권)', () => {
    const p = ds.products.find((x) => x.catalogId === 'CAT-00019')!;
    expect(p).toMatchObject({
      saleType: '체험', type: 'PACKAGE', lifecycle: 'APPROVED', validFrom: '2026-10-01', validTo: '2026-10-31',
      baselineIds: ['BL-00028', 'BL-00029', 'BL-00030', 'BL-00163'],
    });
  });

  it('자리표시는 null·[]로 바꾸고 사유를 _missing에 남긴다', () => {
    const proposed = ds.features.filter((f) => f.lifecycle === 'PROPOSED');
    expect(proposed).toHaveLength(13);
    for (const f of proposed) {
      expect(f.baselineId).toBeNull();
      expect(f._missing.baselineId).toBe('미발급');
      expect(f.swIds).toEqual([]);
      expect(f._missing.swIds).toBe('미입력');
    }
    const noDeps = ds.features.filter((f) => !f.dependencyIds.length);
    expect(noDeps.every((f) => f._missing.dependencyIds === '의존 관계 없음')).toBe(true);
  });

  it('Gate 판정시각은 KST 오프셋을 가진 ISO 문자열이다', () => {
    expect(ds.gateRecords.every((g) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(g.judgedAt))).toBe(true);
  });
});
