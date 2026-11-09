import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalFile } from '../file-routing';
import { SimError, simUnhandled } from '../api/sim/engine';
import type { SimWriteContext } from '../api/sim/types';

vi.mock('../file-routing', async original => ({ ...await original<typeof import('../file-routing')>(), isLocalFile: vi.fn() }));
beforeEach(() => vi.mocked(isLocalFile).mockReset());

function request() {
  const audit = vi.fn();
  const denial = vi.fn();
  const body = { featureId: 'FEAT-00022', supplier: 'DEMO', supplierFunctionId: 'REF-1', name: '참조 연결' };
  const context = {
    req: { name: 'createSupplierMapping', params: {}, body, route: { path: '/api/suppliers/mappings', component: 'D05-04' } },
    iso: () => '2026-11-09T00:00:00.000Z', audit,
    fail(code: string, message: string, details: unknown, evidence: unknown): never { denial(evidence); throw new SimError(code, message, details); },
  } as unknown as SimWriteContext;
  return { context, audit, denial, body };
}

describe('unsupported offline operations', () => {
  it('does not return ACCEPTED or record completion for an unimplemented Supplier write', () => {
    vi.mocked(isLocalFile).mockReturnValue(true);
    const r = request();
    let rejected: unknown;
    try { simUnhandled(r.context); } catch (error) { rejected = error; }
    expect(rejected).toBeInstanceOf(SimError);
    expect(rejected).toMatchObject({ code: 'NOT_IMPLEMENTED', details: { operation: 'createSupplierMapping', mode: 'OFFLINE_REPLAY' } });
    expect(r.audit).not.toHaveBeenCalled();
    expect(r.denial).toHaveBeenCalledWith(expect.objectContaining({ action: 'createSupplierMapping', result: 'DENIED' }));
    expect(r.body).toEqual({ featureId: 'FEAT-00022', supplier: 'DEMO', supplierFunctionId: 'REF-1', name: '참조 연결' });
  });
  it('leaves the existing HTTP demo fallback behavior unchanged', () => {
    vi.mocked(isLocalFile).mockReturnValue(false);
    const r = request();
    expect(simUnhandled(r.context)).toMatchObject({ ok: true, status: 'ACCEPTED' });
    expect(r.audit).toHaveBeenCalledTimes(1);
    expect(r.denial).not.toHaveBeenCalled();
  });
});
