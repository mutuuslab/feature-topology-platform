// 분류 계층 역할(TX) — 경로 표(routes.ts)가 읽는 작은 모듈(첫 화면 묶음에 분류 규칙 함수가 끌려오지 않게)
import type { Role } from '../enums';

/** 노드 등록·수정·삭제 — Feature DB 관리자(분류·출처 관리, 30-95 §8.1) */
export const TAXONOMY_EDITOR_ROLES: Role[] = ['REFDB_ADMIN'];
/** Feature 배치 — Feature 작성자·Feature DB 관리자 */
export const TAXONOMY_PLACEMENT_ROLES: Role[] = ['FEATURE_AUTHOR', 'REFDB_ADMIN'];
