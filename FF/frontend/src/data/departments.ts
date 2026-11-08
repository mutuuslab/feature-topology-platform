// 부서 보기 — 부서 목록(생성 모듈, 첫 화면에 실리는 작은 표). 앱 상태(store)가 쓰므로 화면·라우트를 가져오지 않는다.
// 부서 메뉴 계산은 shell/departmentMenu.ts(라우트를 읽는다).
import type { DepartmentSummary } from '@ff/contracts';
import { DEPARTMENTS } from '../../../contracts/src/generated/departments';

export { DEPARTMENTS };

/** 전체 보기 — 부서 모드가 아니다(MENU 2.0 8그룹) */
export const ALL_DEPARTMENTS = 'ALL';
/** Display metadata only; department identity and RACI remain the source IDs. */
export const departmentLabel = (department: Pick<DepartmentSummary, 'id' | 'name' | 'en'>, language = 'ko') => language === 'en' ? department.id === 'DEP-ITSEC' ? 'Feature Control Center' : department.en : department.name;

export const departmentById = (id: string): DepartmentSummary | undefined => DEPARTMENTS.departments.find((d) => d.id === id);

export const isDepartment = (id: unknown): id is string => typeof id === 'string' && id !== ALL_DEPARTMENTS && !!departmentById(id);
