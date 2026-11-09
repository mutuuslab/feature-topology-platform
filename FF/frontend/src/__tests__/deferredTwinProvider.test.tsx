import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { DeferredTwinProvider } from '../state/DeferredTwinProvider';
import { ROUTES } from '../routes';
const count = vi.hoisted(() => ({ loads: 0, mounts: 0 }));
vi.mock('../state/twinStore', async () => {
  count.loads++;
  const React = await import('react');
  return { TwinProvider: ({ children }: { children: React.ReactNode }) => { const [state, set] = React.useState(0); React.useEffect(() => { count.mounts++; }, []); return <><button onClick={() => set(n => n + 1)}>step mock Twin</button><output data-testid="mock-state">{state}</output>{children}</>; } };
});
afterEach(cleanup);
function Page() { const nav = useNavigate(), loc = useLocation(); return <><span data-testid="path">{loc.pathname}</span>{['/features', '/twin/impact', '/twin/simulation', '/twin/fleet', '/twin/vehicle/DEMO-VIN', '/twin/incident'].map(path => <button key={path} onClick={() => nav(path)}>{path}</button>)}</>; }
it('loads no mock Twin on normal screens, covers every consuming route and retains the same state across leaving and returning', async () => {
  render(<MemoryRouter initialEntries={['/features']}><DeferredTwinProvider><Page /></DeferredTwinProvider></MemoryRouter>);
  expect(count.loads).toBe(0); expect(screen.queryByTestId('mock-state')).toBeNull();
  expect(ROUTES.filter(r => r.twin).map(r => r.path)).toEqual(['/twin/impact', '/twin/simulation', '/twin/fleet', '/twin/vehicle/:vin', '/twin/incident']);
  fireEvent.click(screen.getByRole('button', { name: '/twin/impact', exact: true })); await screen.findByTestId('mock-state'); fireEvent.click(screen.getByRole('button', { name: 'step mock Twin' })); expect(screen.getByTestId('mock-state')).toHaveTextContent('1');
  for (const path of ['/features', '/twin/simulation', '/twin/fleet', '/twin/vehicle/DEMO-VIN', '/twin/incident', '/features', '/twin/impact']) { fireEvent.click(screen.getByRole('button', { name: path, exact: true })); await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(path)); expect(screen.getByTestId('mock-state')).toHaveTextContent('1'); }
  expect(count.loads).toBe(1); expect(count.mounts).toBe(1);
});
