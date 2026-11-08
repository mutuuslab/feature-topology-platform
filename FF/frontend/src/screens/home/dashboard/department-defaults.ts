import type { DashboardDepartmentDefault, DashboardDepartmentDefaultBody, DashboardView } from '@ff/contracts';
import { ApiError, call, STATIC_MODE } from '../../../api/client';
import { isDepartment } from '../../../data/departments';
import { dashboardDepartment as T } from '../../../copy/dashboard-department';

export const DEPARTMENT_DEFAULTS_KEY = 'ff.dashboard.departmentDefaults.v1';
export function departmentDefaults(role: string, admin: boolean, departmentId: string, list: readonly DashboardView[]) {
  if (!isDepartment(departmentId)) throw new ApiError(400, 'VALIDATION', T.invalid);
  const read = (): Record<string, DashboardDepartmentDefault> => {
    try { return JSON.parse(localStorage.getItem(DEPARTMENT_DEFAULTS_KEY) ?? '{}'); } catch { return {}; }
  };
  return {
    get: async (): Promise<DashboardDepartmentDefault> => STATIC_MODE
      ? read()[departmentId] ?? { departmentId, mode: 'ROLE', dashboardId: null, version: 0 }
      : call('getDepartmentDashboardDefault', { role, params: { departmentId } }),
    put: async (body: DashboardDepartmentDefaultBody): Promise<DashboardDepartmentDefault> => {
      if (!STATIC_MODE) return call('setDepartmentDashboardDefault', { role, params: { departmentId }, body });
      if (!admin) throw new ApiError(403, 'FORBIDDEN', T.failed);
      const all = read(), current = all[departmentId];
      if ((current?.version ?? 0) !== body.version) throw new ApiError(412, 'PRECONDITION_FAILED', T.conflict);
      if (body.mode === 'DEPARTMENT' && !list.some((d) => d.id === body.dashboardId && d.departmentId === departmentId)) throw new ApiError(400, 'VALIDATION', T.invalid);
      const next: DashboardDepartmentDefault = { mode: body.mode, dashboardId: body.dashboardId ?? null, departmentId, version: body.version + 1 };
      localStorage.setItem(DEPARTMENT_DEFAULTS_KEY, JSON.stringify({ ...all, [departmentId]: next }));
      return next;
    },
  };
}
