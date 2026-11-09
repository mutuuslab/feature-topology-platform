import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { DraftDeleteAction } from '../screens/features/DraftDeleteAction';
const { mutate, reset, routes } = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn(), routes: [] as string[] }));
vi.mock('../api/hooks', async original => ({ ...await original<typeof import('../api/hooks')>(), useApiMutation: (name: string) => { routes.push(name); return { mutate, reset, isPending: false, error: null }; } }));
afterEach(() => { cleanup(); localStorage.clear(); mutate.mockReset(); reset.mockReset(); routes.length = 0; });
function mount(ui: React.ReactNode, role = 'author') { localStorage.setItem('fp.state.v2', JSON.stringify({ role })); return render(<QueryClientProvider client={new QueryClient()}><AppProvider><MemoryRouter>{ui}</MemoryRouter></AppProvider></QueryClientProvider>); }
it('reviews the exact draft, requires reason and confirmation, calls the actual feature delete route and navigates only on success', async () => {
  const deleted = vi.fn(); mount(<DraftDeleteAction entity="feature" id="FEAT-00022" version="0.1.0" lifecycle="PROPOSED" createdBy="usr-author" onDeleted={deleted} />);
  fireEvent.click(screen.getByRole('button', { name: '초안 Feature 삭제' })); const d = await screen.findByRole('dialog');
  expect(within(d).getByText('FEAT-00022@0.1.0')).toBeTruthy(); expect(within(d).getByRole('button', { name: '검토한 초안 삭제' })).toBeDisabled();
  fireEvent.change(within(d).getByLabelText('삭제 사유'), { target: { value: 'Mistaken local draft' } }); expect(within(d).getByRole('button', { name: '검토한 초안 삭제' })).toBeDisabled(); fireEvent.click(within(d).getByRole('checkbox'));
  fireEvent.click(within(d).getByRole('button', { name: '검토한 초안 삭제' })); expect(routes).toContain('deleteFeatureDraft'); expect(mutate.mock.calls[0][0]).toEqual({ params: { id: 'FEAT-00022', ver: '0.1.0' }, body: { reason: 'Mistaken local draft' } }); expect(deleted).not.toHaveBeenCalled(); mutate.mock.calls[0][1].onSuccess(); expect(deleted).toHaveBeenCalledOnce();
});
it('blocks other authors and read-only roles, hides non-drafts, and sends relation identity without a feature-version delete', async () => {
  const r = mount(<DraftDeleteAction entity="feature" id="FEAT-00022" version="0.1.0" lifecycle="PROPOSED" createdBy="usr-other" />); expect(screen.getByRole('button', { name: '초안 Feature 삭제' })).toBeDisabled(); r.unmount();
  const s = mount(<DraftDeleteAction entity="feature" id="FEAT-00022" lifecycle="RELEASED" />); expect(screen.queryByRole('button')).toBeNull(); s.unmount();
  mount(<DraftDeleteAction entity="relation" id="DEP-00001" lifecycle="PROPOSED" />, 'steward'); fireEvent.click(screen.getByRole('button', { name: '초안 관계 삭제' })); const d = await screen.findByRole('dialog'); fireEvent.change(within(d).getByLabelText('삭제 사유'), { target: { value: 'Mistaken relation' } }); fireEvent.click(within(d).getByRole('checkbox')); fireEvent.click(within(d).getByRole('button', { name: '검토한 초안 삭제' })); expect(routes).toContain('deleteRelationDraft'); expect(mutate.mock.calls[0][0]).toEqual({ params: { id: 'DEP-00001' }, body: { reason: 'Mistaken relation' } });
});
