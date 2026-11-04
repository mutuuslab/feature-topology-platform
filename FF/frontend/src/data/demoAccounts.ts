// 데모 계정 목록 — 기준 9역할(SPEC_ROLES, 생성 파일)에 담당자 웨이브(2026-11-05 사용자 결정) 3계정을 더한다.
// 역할(플랫폼 IAM 역할)은 contracts DEMO_PERSONAS가 정본이고, 여기에는 화면에 보일 이름·라벨·소속만 둔다.
import type { SpecRoleInfo } from './specTypes';
import { SPEC_ROLES } from './specNav';

/** 기준 9역할 밖의 데모 계정 — 운영 리더·두 번째 Safety Manager·상품 Owner(고객 출시 승인) */
export const EXTRA_DEMO_ACCOUNTS: SpecRoleInfo[] = [
  { key: 'opslead', name: '강태윤', label: '운영 리더', id: 'usr-opslead', group: 'Feature 운영', scopes: ['LIGHT-KR', 'LIGHT-EU'] },
  { key: 'safety2', name: '오세린', label: '기능안전 담당', id: 'usr-safety2', group: '독립 검증', scopes: ['LIGHT-KR', 'LIGHT-EU'] },
  { key: 'productowner', name: '문하린', label: '고객 출시 승인', id: 'usr-productowner', group: '상품 운영', scopes: ['LIGHT-KR', 'LIGHT-EU'] },
];

/** 화면 역할 전환기·행위자 ID가 쓰는 전체 데모 계정(12) */
export const DEMO_ACCOUNTS: SpecRoleInfo[] = [...SPEC_ROLES, ...EXTRA_DEMO_ACCOUNTS];
