// 공식 도메인(D-REF-9) — 엑셀 03_FeatureDB B열 도메인 10개와 ID의 도메인 약어, 그리고 ECU.domain 자유 문자열 → 공식 도메인 대응표(30-95 §4).
// ECU 표 자체는 1단계에서 바꾸지 않고 화면·필터가 이 표로 공식 도메인을 보여 준다. 대응이 없는 ECU.domain은 data:check가 경고한다.
// 대응 값은 data/fixtures/v0.81/ecuMaster.json의 ECU.domain(2026-11-04)과 흔한 줄임말에서 모았다.

/** 공식 도메인 10 — 엑셀 B열 순서(기준 행 ID 첫 칸 약어) */
export const OFFICIAL_DOMAINS = [
  { abbr: 'BC', name: 'Body & Comfort' },
  { abbr: 'CH', name: 'Chassis & Vehicle Dynamics' },
  { abbr: 'PC', name: 'Powertrain - Combustion' },
  { abbr: 'PE', name: 'Powertrain - Electrified' },
  { abbr: 'AD', name: 'ADAS & AD' },
  { abbr: 'SF', name: 'Safety' },
  { abbr: 'IN', name: 'Infotainment & HMI' },
  { abbr: 'CO', name: 'Connectivity & Telematics' },
  { abbr: 'PL', name: 'Vehicle Platform & Base SW' },
  { abbr: 'BE', name: 'Back-end & Cloud' },
] as const;
export type OfficialDomain = (typeof OFFICIAL_DOMAINS)[number]['name'];
export const OFFICIAL_DOMAIN_NAMES: readonly OfficialDomain[] = OFFICIAL_DOMAINS.map((d) => d.name);

export const domainAbbrOf = (name: string): string | undefined => OFFICIAL_DOMAINS.find((d) => d.name === name)?.abbr;
export const domainOfAbbr = (abbr: string): OfficialDomain | undefined => OFFICIAL_DOMAINS.find((d) => d.abbr === abbr)?.name;

/** ECU.domain 자유 문자열 → 공식 도메인. 열쇠는 소문자·공백 정리(normalizeDomainKey) */
export const ECU_DOMAIN_ALIAS: Record<string, OfficialDomain> = {
  // data/fixtures/v0.81 ECU.domain
  'adas dc': 'ADAS & AD', // ADAS Domain Controller
  'camera ecu': 'ADAS & AD',
  'cabin sensing': 'ADAS & AD', // 운전자 감시(DMS) — 엑셀 AD-DMS Driver and occupant monitoring
  body: 'Body & Comfort',
  ivi: 'Infotainment & HMI',
  vcu: 'Powertrain - Electrified', // 엑셀 PE-VCU
  'ev powertrain': 'Powertrain - Electrified',
  energy: 'Powertrain - Electrified', // BMS — 엑셀 PE-BMS
  powertrain: 'Powertrain - Electrified', // 지금 이 값을 쓰는 ECU는 VCU(39110-NX500) 하나 — 내연 ECU가 생기면 'Powertrain - Combustion'으로 다시 본다
  'central compute': 'Vehicle Platform & Base SW', // 엑셀 PL-HPC Vehicle HPC platform
  // 흔한 줄임말
  adas: 'ADAS & AD',
  ad: 'ADAS & AD',
  bcm: 'Body & Comfort',
  chassis: 'Chassis & Vehicle Dynamics',
  infotainment: 'Infotainment & HMI',
  hmi: 'Infotainment & HMI',
  cockpit: 'Infotainment & HMI',
  telematics: 'Connectivity & Telematics',
  connectivity: 'Connectivity & Telematics',
  tcu: 'Connectivity & Telematics',
  gateway: 'Vehicle Platform & Base SW',
  hpc: 'Vehicle Platform & Base SW',
  platform: 'Vehicle Platform & Base SW',
  cloud: 'Back-end & Cloud',
  'back-end': 'Back-end & Cloud',
  backend: 'Back-end & Cloud',
  ems: 'Powertrain - Combustion',
  bms: 'Powertrain - Electrified',
  acu: 'Safety',
  airbag: 'Safety',
};

export const normalizeDomainKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** ECU.domain → 공식 도메인. 이미 공식 이름이면 그대로, 대응이 없으면 null(data:check 경고 대상) */
export function officialDomainOf(ecuDomain: string | null | undefined): OfficialDomain | null {
  if (!ecuDomain?.trim()) return null;
  const key = normalizeDomainKey(ecuDomain);
  const official = OFFICIAL_DOMAINS.find((d) => normalizeDomainKey(d.name) === key);
  if (official) return official.name;
  return ECU_DOMAIN_ALIAS[key] ?? null;
}

/** 대응 안 되는 ECU.domain 값(중복 없이, 처음 나온 순) */
export function unmappedEcuDomains(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v?.trim()).filter((v) => !officialDomainOf(v)))];
}
