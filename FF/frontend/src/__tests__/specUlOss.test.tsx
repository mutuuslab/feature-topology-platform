/**
 * UL-OSS-R1 — Unleash OSS 통합 검토 정본 데이터 계층의 계약 검증.
 *
 * 정본: `FP_Unleash_OSS_Integration_Review_v1_0.html` · QC-UL-01~07 · 26 항목 감사 JSON.
 * 이 파일이 고정하는 것은 **값의 출처와 미실행 경계**다.
 *   · 계약 UL-OSS-01~14 ↔ FR-ULOSS-001~014 ↔ IF-FF-01~07 1:1 (QC-UL-04)
 *   · 무료 에디션 한계마다 보상 책임 Core 와 검증 증적이 붙는다 (QC-UL-06)
 *   · NOT_RUN · NOT_RECORDED 는 완료가 아니다 (QC-UL-05)
 *   · 승인·발행·Flag 전환은 도구 UI 가 아니라 FP 정본에서만 일어난다 (QC-UL-07)
 */
import { describe, it, expect } from 'vitest';
import {
  DEPENDENCY_SOT_COMPENSATION,
  OSS_COMPARISON_URL,
  SOURCE_PROVENANCE,
  ULOSS_BASELINE,
  ULOSS_REVISION,
  ULOSS_REVISION_DATE,
  ULOSS_ROLE,
  UL_AUDIT_CHECK_COUNT,
  UL_CONTRACTS,
  UL_CRITERIA,
  UL_DECISIONS,
  UL_FORBIDDEN_IN_UI,
  UL_GAP_REF,
  UL_INTERFACE_BY_ID,
  UL_INTERFACES,
  UL_LIMITS,
  UL_SCREEN_BOUNDARIES,
  UL_SUMMARY,
  UL_UNRUN_NOTICE,
  UL_USAGE,
  UL_VERIFICATION,
  UL_LINKED_DOCS,
  UL_DIAGRAMS,
  UL_WEBHOOK_USED,
  UL_COLLECTION_OWNER,
  ulSummary,
  ulVerificationComplete,
} from '../data/unleashOss';
import { SPEC_REFERENCE_SET } from '../data/specNav';

describe('UL-OSS-R1 개정 식별', () => {
  it('버전 번호를 올리지 않고 개정 ID 로만 얹는다 (QC-UL-01)', () => {
    expect(ULOSS_REVISION).toBe('UL-OSS-R1');
    expect(ULOSS_REVISION_DATE).toBe('2026-09-13');
    expect(ULOSS_BASELINE).toBe('AR 4.5 · SW 4.6 · UI UX 4.6 · XLSX 1.0');
    expect(UL_CRITERIA.find(c => c.id === 'QC-UL-01')!.condition).toContain('버전 번호를 올리지 않고');
  });

  it('내비게이션(개정 식별자)과 데이터 계층의 개정 표기가 일치한다', () => {
    const ref = SPEC_REFERENCE_SET.find(r => r.key === 'unleashOss')!;
    expect(ref.value).toBe(`${ULOSS_REVISION} / ${ULOSS_REVISION_DATE}`);
    // 검토 정본 문서 자체도 연결 문서 목록에 남는다 — 개정 ID 만 적고 출처를 끊지 않는다.
    expect(UL_LINKED_DOCS.some(d => d.value.includes('FP_Unleash_OSS_Integration_Review_v1_0.html'))).toBe(true);
    expect(UL_DIAGRAMS.map(d => d.file)).toContain('appendices/diagrams/UNLEASH_OSS_Deployment_Integration.svg');
  });
});

describe('출처 정본 (QC-UL-02)', () => {
  it('저장소·태그·커밋·아카이브 해시·라이선스·SDK 를 실측값으로 고정한다', () => {
    const byKo = new Map(SOURCE_PROVENANCE.map(r => [r.ko, r.value]));
    expect(SOURCE_PROVENANCE).toHaveLength(11);
    expect(byKo.get('저장소')).toBe('https://github.com/Unleash/unleash');
    expect(byKo.get('태그')).toBe('v8.2.0');
    expect(byKo.get('커밋')).toMatch(/^[0-9a-f]{40}$/);
    expect(byKo.get('아카이브 sha256')).toMatch(/^[0-9a-f]{64}$/);
    expect(byKo.get('라이선스')).toBe('AGPL-3.0-or-later');
    expect(byKo.get('SDK')).toContain('6.12.1');
  });

  it('무료·Enterprise 기능 차이 주장에는 공식 비교표 근거를 함께 표기한다 (QC-UL-03)', () => {
    expect(OSS_COMPARISON_URL).toBe('https://docs.getunleash.io/support/oss-comparison');
    expect(UL_CRITERIA.find(c => c.id === 'QC-UL-03')!.condition).toContain(OSS_COMPARISON_URL.replace('https://', ''));
  });

  it('라이선스 고지 의무는 법무 승인 미기록으로 남는다 — 승인으로 쓰지 않는다', () => {
    const legal = SOURCE_PROVENANCE.find(r => r.ko === '법무 승인')!;
    expect(legal.value).toBe('NOT_RECORDED');
    expect(UL_VERIFICATION.find(v => v.item === 'legalApproval')!.state).toBe('NOT_RECORDED');
  });
});

describe('역할 경계 (QC-UL-07)', () => {
  it('도구는 보관소·평가값 제공자이고 정본은 FP 다', () => {
    expect(ULOSS_ROLE.tool).toContain('보관소');
    expect(ULOSS_ROLE.platform).toContain('정본');
    expect(ULOSS_ROLE.evaluationSoT).toContain('C17');
    expect(ULOSS_ROLE.displayValueRule).toContain('판정 근거가 아니다');
  });

  it('변경 통보 경로는 도구에서 오지 않는다 — 수집 어댑터 폴링이 담당한다', () => {
    expect(UL_WEBHOOK_USED).toBe(false);
    expect(UL_COLLECTION_OWNER).toContain('C33');
    const webhook = UL_INTERFACES.find(i => i.id === 'IF-FF-04')!;
    expect(webhook.unused).toBe(true);
    expect(webhook.auth).toBe('사용하지 않음');
    expect(UL_USAGE.find(u => u.feature === 'Webhook')!.verdict).toBe('미사용');
  });

  it('화면에서 금지되는 조작이 문장으로 고정되어 있다', () => {
    expect(UL_FORBIDDEN_IN_UI).toHaveLength(4);
    expect(UL_FORBIDDEN_IN_UI.join(' ')).toContain('승인·발행·Flag 전환');
    expect(UL_FORBIDDEN_IN_UI.join(' ')).toContain('표시값');
    expect(UL_FORBIDDEN_IN_UI.join(' ')).toContain('parent 관계를 Feature Topology 관계로 승격하지 않는다');
    expect(UL_SCREEN_BOUNDARIES.map(b => b.screenId)).toEqual(['UI18-S02', 'UI30-S04']);
  });
});

describe('계약 · 요구 · 인터페이스 1:1 (QC-UL-04)', () => {
  it('계약 UL-OSS-01~14 가 순서대로 있고 요구 ID 와 1:1 로 대응한다', () => {
    expect(UL_CONTRACTS).toHaveLength(14);
    expect(UL_CONTRACTS.map(c => c.id)).toEqual(
      Array.from({ length: 14 }, (_, i) => `UL-OSS-${String(i + 1).padStart(2, '0')}`),
    );
    expect(UL_CONTRACTS.map(c => c.fr)).toEqual(
      Array.from({ length: 14 }, (_, i) => `FR-ULOSS-${String(i + 1).padStart(3, '0')}`),
    );
    expect(new Set(UL_CONTRACTS.map(c => c.fr)).size).toBe(14);
    for (const c of UL_CONTRACTS) {
      expect(c.title, `${c.id} 제목`).toBeTruthy();
      expect(c.core, `${c.id} 책임 Core`).toMatch(/^C\d{2}$/);
      expect(c.coreName, `${c.id} Core 이름`).toBeTruthy();
      expect(c.requirement.length, `${c.id} 요구 문장`).toBeGreaterThan(40);
      expect(c.verify, `${c.id} 검증 방법`).toBeTruthy();
    }
  });

  it('인터페이스 IF-FF-01~07 이 순서대로 있고 하나만 미사용으로 확정되어 있다', () => {
    expect(UL_INTERFACES).toHaveLength(7);
    expect(UL_INTERFACES.map(i => i.id)).toEqual(
      Array.from({ length: 7 }, (_, i) => `IF-FF-${String(i + 1).padStart(2, '0')}`),
    );
    expect(UL_INTERFACE_BY_ID.size).toBe(7);
    expect(UL_INTERFACES.filter(i => i.unused).map(i => i.id)).toEqual(['IF-FF-04']);
    for (const i of UL_INTERFACES) {
      expect(i.auth, `${i.id} 인증`).toBeTruthy();
      expect(i.freshness, `${i.id} 신선도`).toBeTruthy();
      expect(i.errorIdem, `${i.id} 오류·멱등`).toBeTruthy();
    }
  });

  it('도구 정의 수집은 Admin API 이고 발행 정본이 아니다', () => {
    const collect = UL_INTERFACES.find(i => i.id === 'IF-FF-01')!;
    expect(collect.name).toContain('정의 수집');
    expect(collect.direction).toBe('Unleash → FP');
    expect(UL_CONTRACTS.find(c => c.id === 'UL-OSS-04')!.core).toBe('C33');
    expect(UL_USAGE.find(u => u.feature === 'Admin API')!.verdict).toBe('조건부 사용');
  });
});

describe('무료 에디션 한계와 보상 책임 (QC-UL-06)', () => {
  it('한계 12건 각각에 보상 책임 Core 와 검증 증적이 붙는다', () => {
    expect(UL_LIMITS).toHaveLength(12);
    for (const l of UL_LIMITS) {
      expect(l.limit, '한계').toBeTruthy();
      expect(l.impact, `${l.limit} 영향`).toBeTruthy();
      expect(l.compensates, `${l.limit} 보상 책임`).toMatch(/C\d{2}/);
      expect(l.compensates, `${l.limit} 보상 책임`).not.toContain('Unleash');
      expect(l.evidence, `${l.limit} 검증 증적`).toBeTruthy();
    }
  });

  it('의존성 판정 부재의 보상 책임이 C03·C14 로 고정된다 — 도구가 정본이 아니다', () => {
    const dep = UL_LIMITS.find(l => l.limit.includes('Flag·Variant 의존성 없음'))!;
    expect(dep.compensates).toContain('C03');
    expect(dep.compensates).toContain('C14');
    expect(dep.evidence).toContain('FP 정본');
    expect(DEPENDENCY_SOT_COMPENSATION).toContain('C03 BOM');
    expect(DEPENDENCY_SOT_COMPENSATION).toContain('C14');
  });

  it('미사용 · 조건부 기능에는 대체 소유 Core 또는 이유가 있다', () => {
    expect(UL_USAGE).toHaveLength(10);
    const unused = UL_USAGE.filter(u => u.verdict.startsWith('미사용'));
    expect(unused).toHaveLength(5);
    for (const u of unused) expect(u.replacedBy, `${u.feature} 대체 소유`).toBeTruthy();
    for (const u of UL_USAGE) expect(u.reason, `${u.feature} 이유`).toBeTruthy();
  });
});

describe('미실행 경계 (QC-UL-05 · GAP-16)', () => {
  it('이미지 빌드·기동·차량 적용·제품 서버 반입·사용자 인수가 NOT_RUN 이다', () => {
    expect(UL_VERIFICATION).toHaveLength(6);
    expect(UL_VERIFICATION.map(v => v.item)).toEqual([
      'imageBuild', 'dockerRun', 'vehicleApply', 'productServerIntake', 'userAcceptance', 'legalApproval',
    ]);
    expect(UL_VERIFICATION.filter(v => v.state === 'NOT_RUN')).toHaveLength(5);
    expect(ulVerificationComplete()).toBe(false);
    expect(UL_GAP_REF).toContain('GAP-16');
    expect(UL_DECISIONS).toEqual(['BD-19', 'BD-20', 'BD-21']);
  });

  it('NOT_RUN 을 완료로 읽지 말라는 문장이 데이터와 함께 있다', () => {
    expect(UL_UNRUN_NOTICE).toContain('완료 표기가 아니라');
    expect(UL_CRITERIA.find(c => c.id === 'QC-UL-05')!.condition).toContain('완료로 쓰지 않는다');
  });
});

describe('리뷰 집계는 파생값이다', () => {
  it('UL_SUMMARY 가 원본 배열에서 계산되며 하드코딩된 수치가 아니다', () => {
    const fresh = ulSummary();
    expect(UL_SUMMARY).toEqual(fresh);
    expect(UL_SUMMARY.contracts).toBe(UL_CONTRACTS.length);
    expect(UL_SUMMARY.interfaces).toBe(UL_INTERFACES.length);
    expect(UL_SUMMARY.unusedInterfaces).toBe(1);
    expect(UL_SUMMARY.limits).toBe(UL_LIMITS.length);
    expect(UL_SUMMARY.usageRows).toBe(UL_USAGE.length);
    expect(UL_SUMMARY.unusedUsage).toBe(5);
    expect(UL_SUMMARY.notRun).toBe(5);
    expect(UL_SUMMARY.notRecorded).toBe(1);
    expect(UL_SUMMARY.criteria).toBe(7);
    expect(UL_SUMMARY.compensationCores.length).toBeGreaterThan(5);
    expect(UL_SUMMARY.compensationCores).toContain('C03 BOM·구성·의존관계 관리');
    // Core 이름 안의 `·` 로 쪼갠 조각이 섞이지 않는다 — 모든 항목이 Core 코드로 시작한다.
    for (const c of UL_SUMMARY.compensationCores) expect(c, `${c} 보상 책임 Core 표기`).toMatch(/^C\d{2}\s/);
  });

  it('감사 항목 수는 26 으로 고정되어 있다', () => {
    expect(UL_AUDIT_CHECK_COUNT).toBe(26);
    expect(UL_CRITERIA).toHaveLength(7);
    expect(UL_CRITERIA.map(c => c.id)).toEqual(
      Array.from({ length: 7 }, (_, i) => `QC-UL-${String(i + 1).padStart(2, '0')}`),
    );
  });
});
