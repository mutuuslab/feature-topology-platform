// 시장별 Compliance Profile (보고서 v1.1 2.3 · FFG-GEN-001·GEN-003) — 시장마다 적용 법규·필수 Evidence·게이트 파라미터를 담은 버전 관리 데이터.
// 값은 보고서 2.3 표(초기 Profile) 그대로이고, 법규 담당이 원문을 확인해 갱신하면 Version을 올린다(같은 Version 내용은 바꾸지 않는다).
// 상태가 '확인(CONFIRMED)'이 아닌 시장에서는 F2 이상 활성화·복원을 막고, 비활성화는 막지 않는다(위험을 줄이는 조치까지 막지 않게).
// 명령 와이어(kill_command v2)는 보고서 JSON Schema와 같아 Profile 필드가 없다 — Profile 버전은 게이트 기록(감사·원장 이벤트)에 남긴다.
import type { Market } from '../schemas/wire';

export type ProfileStatus = 'CONFIRMED' | 'VERIFY_REQUIRED';
export const PROFILE_STATUS_LABEL: Record<ProfileStatus | 'UNKNOWN', string> = { CONFIRMED: '확인', VERIFY_REQUIRED: '검증 필요', UNKNOWN: 'Profile 없음' };

export interface ComplianceProfile {
  profileId: string;
  version: string;
  /** 명령 target.market 값 */
  markets: Market[];
  countries: string;
  obligations: string;
  settings: string;
  status: ProfileStatus;
}

/** 보고서 2.3 초기 Profile — ADS Profile(시장별 확인)은 시장 코드가 아니라 ADS Feature에 붙는다 */
export const COMPLIANCE_PROFILES: ComplianceProfile[] = [
  { profileId: 'GLOBAL-UNECE', version: '1.0.0', markets: ['UNECE'], countries: 'EU·EEA, 일본, 기타 1958 협정 체약국', obligations: 'UN R155·R156, RXSWIN, ADAS 관련 UN 규정, R185(발효 후)', settings: 'R156 영향 평가 ID 필수, RXSWIN 호환 검사, 사용자 고지, ADS 원격 종료 요구', status: 'CONFIRMED' },
  { profileId: 'UK', version: '1.0.0', markets: ['UK'], countries: '영국', obligations: 'GB 형식승인 사이버보안·SW 업데이트 요건(신규 형식 2026-06-01, 전 차량 2027-06-01)', settings: 'GLOBAL-UNECE + 영국 적용일', status: 'CONFIRMED' },
  { profileId: 'EU', version: '1.0.0', markets: ['EU'], countries: 'EU·EEA', obligations: 'GSR 의무 기능, Data Act, GDPR·ePrivacy, PLD, CRA, NIS2', settings: 'DC4 목록(GSR), 텔레메트리 동의·접근권, 가명화', status: 'CONFIRMED' },
  { profileId: 'CN', version: '1.0.0', markets: ['CN'], countries: '중국', obligations: 'GB 44495·44496, MIIT·SAMR OTA 신고·허가, 공개 베타 금지, 데이터 규정', settings: '신고·허가 ID 필수, 차량 내 사용자 확인, 데이터 현지 처리', status: 'CONFIRMED' },
  { profileId: 'NA-US', version: '1.0.0', markets: ['US'], countries: '미국', obligations: 'Part 573 리콜(5영업일), SGO 사고 보고, FMVSS 127, BIS Connected Vehicle, 49 CFR Part 563 EDR', settings: '안전 Kill과 리콜 연계, AEB는 DC4, SW 원산지 관리, EDR·SGO 정합 텔레메트리', status: 'CONFIRMED' },
  { profileId: 'NA-CA', version: '1.0.0', markets: ['CA'], countries: '캐나다', obligations: 'Motor Vehicle Safety Act(결함 통지), CMVSS', settings: '리콜은 MVSA 절차, 사이버보안은 R155 수준', status: 'VERIFY_REQUIRED' },
  { profileId: 'LATAM', version: '1.0.0', markets: ['BR', 'MX'], countries: '브라질, 멕시코', obligations: '시장별 의무 ADAS, 개인정보(LGPD)', settings: 'DC4 목록에 시장별 의무 기능 반영', status: 'VERIFY_REQUIRED' },
  { profileId: 'KR', version: '1.0.0', markets: ['KR'], countries: '한국', obligations: '자동차관리법(CSMS 인증, SW 업데이트 확인·고지, 제작결함 시정), 개인정보 보호법', settings: 'KR Profile(국내 인증·고지 요건)', status: 'CONFIRMED' },
  { profileId: 'JP', version: '1.0.0', markets: ['JP'], countries: '일본', obligations: '도로운송차량법, R155·R156', settings: 'GLOBAL-UNECE 준용', status: 'CONFIRMED' },
  { profileId: 'ADS', version: '1.0.0', markets: [], countries: 'ADS 운행 국가', obligations: 'UN GTR No. 26 국가 법제화 또는 R185 승인, 국가별 ADS 운행 허가', settings: '시장별 원격 종료 권한·발동 사유, 사건 보고 기한, DSSAD 접근 방식', status: 'VERIFY_REQUIRED' },
];

export const profileOf = (market: string, profiles: ComplianceProfile[] = COMPLIANCE_PROFILES): ComplianceProfile | null => profiles.find((p) => (p.markets as string[]).includes(market)) ?? null;

export interface ProfileFinding {
  rule: 'FFG-GEN-003';
  ok: boolean;
  detail: string;
  /** 명령에 기록할 Profile(FFG-GEN-001) — 시장 Profile, ADS Feature면 ADS Profile도 */
  profiles: { profileId: string; version: string; status: ProfileStatus }[];
}

/**
 * 미확인 시장의 F2 이상 활성화·복원 차단. ADS Feature는 ADS Profile도 확인이어야 한다.
 * @rule FFG-GEN-001, FFG-GEN-003 — Profile 데이터와 버전 기록·게이트 판정. 법규 원문 확인·Profile 갱신(GEN-004)은 법규 담당
 */
export function profileFinding(i: { market: string; request: string; fClass: string | null; adsFeature: boolean }, profiles: ComplianceProfile[] = COMPLIANCE_PROFILES): ProfileFinding {
  const m = profileOf(i.market, profiles);
  const ads = i.adsFeature ? (profiles.find((p) => p.profileId === 'ADS') ?? null) : null;
  const used = [m, ads].filter((p): p is ComplianceProfile => !!p).map((p) => ({ profileId: p.profileId, version: p.version, status: p.status }));
  const widening = i.request === 'activate' || i.request === 'restore';
  const safety = i.fClass == null || i.fClass >= 'F2';
  const unconfirmed = [...(m ? (m.status === 'CONFIRMED' ? [] : [`${m.profileId} ${PROFILE_STATUS_LABEL[m.status]}`]) : [`${i.market} ${PROFILE_STATUS_LABEL.UNKNOWN}`]), ...(ads && ads.status !== 'CONFIRMED' ? [`ADS ${PROFILE_STATUS_LABEL[ads.status]}`] : [])];
  if (!widening || !safety || !unconfirmed.length)
    return { rule: 'FFG-GEN-003', ok: true, detail: !widening ? `${i.request}: 시장 Profile 상태와 무관하게 허용(비활성화는 막지 않는다)` : `${used.map((p) => `${p.profileId} ${p.version}`).join(', ') || i.market} 확인`, profiles: used };
  return { rule: 'FFG-GEN-003', ok: false, detail: `${i.request}: ${unconfirmed.join(', ')} — F2 이상 활성화·복원 차단(원문 확인 뒤 Profile 갱신 필요)`, profiles: used };
}
