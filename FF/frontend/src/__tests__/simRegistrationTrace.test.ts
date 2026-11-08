import { describe, expect, it, vi } from 'vitest';
import { registrationTrace, type MockItem } from '../api/sim/handlers/ext-mock';
import type { SimReadContext } from '../api/sim/types';

const feature = { row: { featureId: 'FEAT-99999', version: '0.1.0', lifecycle: 'PROPOSED', requirementIds: ['REQ-FOUND', 'REQ-MISSING'] } };
function context({ exists = true, base = null, items = [], links = {} }: { exists?: boolean; base?: unknown; items?: MockItem[]; links?: Record<string, unknown> } = {}) {
  return { req: { params: { id: 'FEAT-99999', ver: '0.1.0' } }, get: vi.fn(() => exists ? feature : undefined), list: vi.fn(() => items), overlay: { data: { extMockLinks: links } }, snapshot: vi.fn(async (name?: string) => name === 'mockExtItems' ? { items: [] } : base) } as unknown as SimReadContext;
}
const item = (overrides: Partial<MockItem>): MockItem => ({ system: 'CODEBEAMER', key: 'CB-90001', kind: 'REQUIREMENT', title: '관측된 요구', body: '', status: 'Draft', revision: 2, updatedAt: '2026-11-09T00:00:00Z', updatedBy: 'jung.req', comments: [], fields: { reqId: 'REQ-FOUND' }, ...overrides });

describe('new registration external trace', () => {
  it('does not replace existing snapshot traces or invent unknown Features', async () => {
    expect(await registrationTrace(context({ base: { epic: { key: 'FFE-1' } } }))).toBeUndefined();
    expect(await registrationTrace(context({ exists: false }))).toBeUndefined();
  });
  it('new drafts show missing requirements and no manufactured Epic, approval or code', async () => {
    const result = await registrationTrace(context());
    expect(result).toMatchObject({ featureId: 'FEAT-99999', version: '0.1.0', lifecycle: 'PROPOSED', epicStatusExpected: 'Proposed', epic: null, requirements: [], missingRequirements: ['REQ-FOUND', 'REQ-MISSING'], mergeRequests: [], policies: [] });
  });
  it('shows actual observed codeBeamer requirements and only the Epic linked to this exact Version', async () => {
    const req = item({});
    const epic = item({ system: 'JIRA', kind: 'EPIC', key: 'FFE-90001', title: '역방향 등록 Epic', status: 'Proposed', fields: {} });
    const unrelated = item({ system: 'JIRA', kind: 'EPIC', key: 'FFE-90002', fields: {} });
    const result = await registrationTrace(context({ items: [req, epic, unrelated], links: { 'JIRA:FFE-90001': { FEATURE: 'FEAT-99999@0.1.0' }, 'JIRA:FFE-90002': { FEATURE: 'FEAT-99999@0.2.0' } } }));
    expect(result?.epic).toMatchObject({ key: 'FFE-90001', revision: 2 });
    expect(result?.requirements).toHaveLength(1);
    expect(result?.requirements[0]).toMatchObject({ key: 'CB-90001', status: 'Draft', extra: { reqId: 'REQ-FOUND' } });
    expect(result?.missingRequirements).toEqual(['REQ-MISSING']);
  });
});
