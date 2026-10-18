// 안전 분류 규칙 — 보고서 v1.1 5장. 화면(안전 분류 탭의 판정 흐름·조합 검사)과 백엔드(Registry 저장·G1 판정·정책 게이트)가 같은 함수를 쓴다.
import type { DeactClass, FClass, RegClass } from '../schemas/safety';
import { fRank } from '../schemas/safety';
import type { SafetyProfile } from '../schemas/safety-profile';

/** 그림 2 판정 흐름의 질문 */
export interface ClassifyAnswers {
  /** Q1 법규 의무 기능이거나 안전기제인가(GSR·FMVSS, EDR) */
  mandatory: boolean;
  /** Q2 HARA상 안전 관련인가 — 아니면 F0/F1 */
  safetyRelevant: boolean;
  /** 안전 관련이면 참조 ASIL(산정하지 않고 HARA에서 가져온다) */
  asil: 'QM' | 'A' | 'B' | 'C' | 'D';
  /** Q3 작동 중 거동을 바꾸는가(종·횡방향 제어 등 운전자 인계가 필요한가) */
  changesActiveControl: boolean;
  /** Q4 형식승인 대상 거동에 닿는가 */
  typeApproval: boolean;
  /** ADS 기능인가 */
  ads: boolean;
}

/**
 * 판정 흐름 → 제안 등급. Safety Manager가 확정하기 전의 제안이며, 확정 값이 원천이다.
 * 보고서 FFG-CLS-005(적용: 법규 담당 — 플랫폼은 제안만): 의무 기능·안전기제는 DC4·R2(ADS는 DC4가 될 수 없음 — FFG-ADS-002)
 */
export function proposeClass(a: ClassifyAnswers): { fClass: FClass; deactClass: DeactClass; regClass: RegClass } {
  if (a.mandatory && !a.ads) return { fClass: 'F4', deactClass: 'DC4', regClass: 'R2' };
  if (!a.safetyRelevant) return { fClass: a.changesActiveControl ? 'F1' : 'F0', deactClass: a.changesActiveControl ? 'DC1' : 'DC0', regClass: a.typeApproval ? 'R1' : 'R0' };
  const fClass: FClass = a.ads ? 'F4' : a.asil === 'C' || a.asil === 'D' ? 'F3' : 'F2';
  const deactClass: DeactClass = a.changesActiveControl || a.ads ? 'DC2' : a.typeApproval ? 'DC3' : 'DC1';
  return { fClass, deactClass, regClass: a.typeApproval ? 'R1' : 'R0' };
}

export interface ClassFinding {
  rule: string;
  /** block = 확정·G1 차단 · warn = 표시만(만료일처럼 지어낼 수 없는 값은 담당자가 채운다) */
  severity: 'block' | 'warn';
  field: keyof SafetyProfile | null;
  message: string;
}

/**
 * 프로파일 조합 검사 — Registry 확정, 정책 게이트, Guard 초기화가 같은 조합을 검사한다.
 * @rule FFG-CLS-009 — DC0은 F0·F1만, 등급별 시간값 > 0, F2 이상 Safe State·FTTI, R1 이상 시장
 * @rule FFG-CLS-006 — F2 이상 Experiment Flag 금지
 * 보고서 FFG-CLS-008(적용: Feature Owner — 플랫폼은 누락 경고만): Release·Experiment는 만료일·Retirement 계획(만료 30일 전 알림은 WP2)
 * @rule FFG-ADS-002 — ADS Feature는 DC4가 아니고 ADSF 유형을 정한다(원격 경로 검사는 정책 게이트 WP3)
 */
export function checkProfile(p: SafetyProfile): ClassFinding[] {
  const out: ClassFinding[] = [];
  const need = (ok: boolean, rule: string, field: keyof SafetyProfile, message: string) => {
    if (!ok) out.push({ rule, severity: rule === 'FFG-CLS-008' ? 'warn' : 'block', field, message });
  };
  const f = fRank(p.fClass);
  const dc = p.deactClass;
  need(!(dc === 'DC0' && f >= 2), 'FFG-CLS-009', 'deactClass', `${p.fClass}에는 DC0(즉시 비활성화)을 지정할 수 없습니다`);
  if (dc === 'DC2') {
    need(p.takeoverMs > 0, 'FFG-CLS-009', 'takeoverMs', 'DC2는 인계 시간(takeover_ms)이 0보다 커야 합니다');
    need(p.rampMs > 0, 'FFG-CLS-009', 'rampMs', 'DC2는 효과 감소 시간(ramp_ms)이 0보다 커야 합니다');
  }
  if (f >= 2 && dc !== 'DC4') need(p.faultRampMs > 0, 'FFG-CLS-009', 'faultRampMs', 'F2 이상은 고장 램프 시간(fault_ramp_ms)이 0보다 커야 합니다');
  if (dc === 'DC1') need(p.maxPendingMs > 0, 'FFG-CLS-009', 'maxPendingMs', 'DC1은 비작동 대기 상한(max_pending_ms)이 0보다 커야 합니다');
  if (dc === 'DC1' || dc === 'DC2' || dc === 'DC3') need(p.maxCycleWaitMs > 0, 'FFG-CLS-009', 'maxCycleWaitMs', 'DC1~DC3은 다음 시동 대기 상한(max_cycle_wait_ms)이 0보다 커야 합니다');
  need(!(p.flagType === 'EXPERIMENT' && f >= 2), 'FFG-CLS-006', 'flagType', 'F2 이상에는 Experiment Flag를 쓰지 않습니다(Shadow Mode만)');
  if (p.adsFeature) {
    need(dc !== 'DC4', 'FFG-ADS-002', 'deactClass', 'ADS Feature는 DC4로 분류하지 않습니다 — 원격 종료가 가능해야 합니다');
    need(p.adsfType !== null, 'FFG-ADS-002', 'adsfType', 'ADS Feature는 ADSF-1(사용자 인계)·ADSF-2(운전자 없음)를 정합니다');
  }
  if (p.gsrMandatory || p.regClass === 'R2') need(dc === 'DC4', 'FFG-CLS-005', 'deactClass', '법규 의무 기능(R2·GSR)은 DC4입니다');
  if (f >= 2) {
    need(p.safeState !== null, 'FFG-CLS-009', 'safeState', 'F2 이상은 Safe State를 정합니다(보고서 5.7)');
    need(p.faultTolerantTimeMs > 0 || dc === 'DC4', 'FFG-CLS-009', 'faultTolerantTimeMs', 'F2 이상은 FTTI(fault_tolerant_time)를 정합니다');
  }
  if (p.regClass !== 'R0') need(p.markets.length > 0, 'FFG-CLS-009', 'markets', 'R1 이상은 승인 시장을 정합니다');
  if (p.flagType === 'RELEASE' || p.flagType === 'EXPERIMENT') need(!!p.expiresAt && !!p.retirementPlan, 'FFG-CLS-008', 'expiresAt', 'Release·Experiment Flag는 만료일과 Retirement 계획을 둡니다');
  return out;
}

/** 확정 뒤에는 등급·시간값·Safe State를 바꿀 수 없다 — 바꾸려면 새 Version(FFG-CLS-004) */
export const LOCKED_AFTER_CONFIRM: (keyof SafetyProfile)[] = ['fClass', 'deactClass', 'regClass', 'flagType', 'takeoverMs', 'rampMs', 'faultRampMs', 'faultTolerantTimeMs', 'maxPendingMs', 'maxCycleWaitMs', 'safeState', 'endState', 'adsFeature', 'adsfType', 'gsrMandatory'];

/** 데이터셋 값(ASIL·연결 SW 등급)으로 만든 초안 F 등급 — 높은 쪽을 택한다(과소평가 방지) */
export function inferFClass(asil: string, swClasses: string[]): FClass {
  const fromAsil: FClass = asil === 'C' || asil === 'D' ? 'F3' : asil === 'A' || asil === 'B' ? 'F2' : 'F1';
  const fromSw = swClasses.filter((c): c is FClass => /^F[0-4]$/.test(c));
  return [fromAsil, ...fromSw].reduce((a, b) => (fRank(b) > fRank(a) ? b : a));
}

/** 확정·G1을 막는 위반만 */
export const blocking = (f: ClassFinding[]) => f.filter((x) => x.severity === 'block');
