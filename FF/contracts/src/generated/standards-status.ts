// tools/standards.ts가 만든다 — 손으로 고치지 않는다. 보고서 v1.1 플랫폼 규칙별 구현(@rule 표식)·시험 추적 상태.
export interface RuleTraceStatus {
  implemented: boolean;
  tested: boolean;
}
export const RULE_STATUS: Readonly<Record<string, RuleTraceStatus>> = {
  "FFG-ADS-002": {
    "implemented": true,
    "tested": true
  },
  "FFG-ADS-004": {
    "implemented": true,
    "tested": true
  },
  "FFG-ADS-007": {
    "implemented": false,
    "tested": false
  },
  "FFG-ADS-010": {
    "implemented": true,
    "tested": true
  },
  "FFG-CLS-001": {
    "implemented": true,
    "tested": true
  },
  "FFG-CLS-002": {
    "implemented": false,
    "tested": false
  },
  "FFG-CLS-004": {
    "implemented": true,
    "tested": true
  },
  "FFG-CLS-006": {
    "implemented": true,
    "tested": true
  },
  "FFG-CLS-007": {
    "implemented": false,
    "tested": false
  },
  "FFG-CLS-009": {
    "implemented": true,
    "tested": true
  },
  "FFG-CODE-020": {
    "implemented": true,
    "tested": true
  },
  "FFG-CODE-030": {
    "implemented": false,
    "tested": false
  },
  "FFG-DEAC-004": {
    "implemented": true,
    "tested": true
  },
  "FFG-DEAC-007": {
    "implemented": true,
    "tested": true
  },
  "FFG-DEAC-008": {
    "implemented": true,
    "tested": true
  },
  "FFG-DEAC-010": {
    "implemented": false,
    "tested": false
  },
  "FFG-DEAC-011": {
    "implemented": true,
    "tested": true
  },
  "FFG-DEAC-013": {
    "implemented": true,
    "tested": true
  },
  "FFG-GEN-001": {
    "implemented": false,
    "tested": false
  },
  "FFG-GEN-003": {
    "implemented": false,
    "tested": false
  },
  "FFG-LCY-001": {
    "implemented": false,
    "tested": false
  },
  "FFG-LCY-002": {
    "implemented": false,
    "tested": false
  },
  "FFG-LCY-003": {
    "implemented": false,
    "tested": false
  },
  "FFG-LCY-008": {
    "implemented": false,
    "tested": false
  },
  "FFG-LCY-009": {
    "implemented": false,
    "tested": false
  },
  "FFG-LCY-010": {
    "implemented": false,
    "tested": false
  },
  "FFG-OFT-001": {
    "implemented": true,
    "tested": true
  },
  "FFG-OFT-002": {
    "implemented": true,
    "tested": true
  },
  "FFG-OFT-003": {
    "implemented": true,
    "tested": true
  },
  "FFG-OFT-004": {
    "implemented": true,
    "tested": true
  },
  "FFG-OFT-005": {
    "implemented": true,
    "tested": true
  },
  "FFG-OFT-006": {
    "implemented": true,
    "tested": true
  },
  "FFG-OFT-007": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-001": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-002": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-003": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-004": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-005": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-006": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-007": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-008": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-009": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-010": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-011": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-012": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-013": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-014": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-015": {
    "implemented": true,
    "tested": true
  },
  "FFG-PLT-016": {
    "implemented": false,
    "tested": false
  },
  "FFG-PLT-017": {
    "implemented": true,
    "tested": true
  },
  "FFG-SBOM-002": {
    "implemented": false,
    "tested": false
  },
  "FFG-SBOM-003": {
    "implemented": false,
    "tested": false
  },
  "FFG-SBOM-007": {
    "implemented": false,
    "tested": false
  },
  "FFG-SEC-002": {
    "implemented": true,
    "tested": true
  },
  "FFG-SEC-003": {
    "implemented": true,
    "tested": true
  },
  "FFG-SEC-004": {
    "implemented": true,
    "tested": true
  },
  "FFG-SEC-006": {
    "implemented": false,
    "tested": false
  },
  "FFG-SEC-007": {
    "implemented": false,
    "tested": false
  },
  "FFG-SEC-008": {
    "implemented": true,
    "tested": true
  },
  "FFG-SOT-002": {
    "implemented": false,
    "tested": false
  },
  "FFG-SOT-003": {
    "implemented": true,
    "tested": true
  },
  "FFG-TEL-001": {
    "implemented": false,
    "tested": false
  },
  "FFG-TEL-003": {
    "implemented": true,
    "tested": true
  },
  "FFG-TEL-004": {
    "implemented": false,
    "tested": false
  },
  "FFG-TEL-005": {
    "implemented": true,
    "tested": true
  },
  "FFG-TEL-006": {
    "implemented": false,
    "tested": false
  },
  "FFG-TEL-008": {
    "implemented": false,
    "tested": false
  },
  "FFG-TEL-009": {
    "implemented": false,
    "tested": false
  },
  "FFG-TEL-010": {
    "implemented": false,
    "tested": false
  },
  "FFG-TST-003": {
    "implemented": true,
    "tested": true
  },
  "FFG-TST-009": {
    "implemented": true,
    "tested": true
  },
  "FFG-VEH-002": {
    "implemented": true,
    "tested": true
  },
  "FFG-VEH-006": {
    "implemented": false,
    "tested": false
  },
  "FFG-VEH-007": {
    "implemented": false,
    "tested": false
  },
  "FFG-VEH-013": {
    "implemented": true,
    "tested": true
  }
};
