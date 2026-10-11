// 시트 → 픽스처 열 매핑. 헤더 문자열은 원본 엑셀 4행 그대로(줄바꿈 포함).
export type Kind =
  | 'str' // 문자열 (자리표시면 null)
  | 'lines' // 셀 안 줄바꿈 목록
  | 'comma' // 쉼표 목록 (Tag)
  | 'funcs' // "FUNC-000001 | 이름" 줄 목록
  | 'date' // 엑셀 날짜 일련번호 → YYYY-MM-DD
  | 'kst' // 'YYYY-MM-DD HH:MM KST' → ISO +09:00
  | 'int';

export interface Col {
  header: string;
  field: string;
  kind: Kind;
}

export interface SheetSpec {
  file: string;
  sheet: string;
  cols: Col[];
  key: (r: Record<string, any>) => string;
  /** 시트 이름에서 파생되는 고정 필드 (Evidence_Gn → gate) */
  extra?: Record<string, unknown>;
}

const c = (header: string, field: string, kind: Kind = 'str'): Col => ({ header, field, kind });

/** semver를 정렬 가능한 키로 */
export const semKey = (v: string | null) => (v ?? '').split('.').map((n) => n.padStart(5, '0')).join('.');

const FEATURE_COLS = [
  c('Feature ID', 'featureId'),
  c('Feature 명칭', 'name'),
  c('Feature 설명', 'description'),
  c('Requirement ID', 'requirementIds', 'lines'),
  c('국가', 'country'),
  c('차종', 'vehicleModel'),
  c('트림', 'trim'),
  c('Feature 버전', 'version'),
  c('BOM Baseline ID', 'baselineId'),
  c('Lifecycle 상태', 'lifecycle'),
  c('Owner', 'ownerId'),
  c('Feature Tag', 'tags', 'comma'),
  c('ASIL', 'asil'),
  c('UPG-VC', 'upgVc', 'lines'),
  c('Function', 'functions', 'funcs'),
  c('SW ID', 'swIds', 'lines'),
  c('SW 버전', 'swVersions', 'lines'),
  c('제어기 P/No', 'ecuPnos', 'lines'),
  c('Control Point', 'controlPoints', 'lines'),
  c('Feature 간 의존관계', 'dependencyIds', 'lines'),
  c('(정보 참고용)\nCatalog ID', 'catalogIds', 'lines'),
  c('(정보 참고용) Gate Record ID', 'gateRecordIds', 'lines'),
];

const EVIDENCE_COLS = [
  c('Evidence Ref', 'evidenceRef'),
  c('Gate Record ID', 'gateRecordId'),
  c('Feature ID', 'featureId'),
  c('Feature Version', 'featureVersion'),
  c('Feature 명칭', 'featureName'),
  c('Feature 설명', 'featureDescription'),
  c('국가 · 차종 · 트림', 'scope'),
  c('Feature Owner', 'owner'),
  c('Lifecycle', 'lifecycle'),
  c('입력 검사 결과', 'inputResult'),
  c('검사 결과와 사유', 'resultReason'),
  c('추가 필요 증빙', 'additionalEvidence'),
];

export const SHEETS: SheetSpec[] = [
  {
    file: 'features',
    sheet: 'Feature Registry',
    cols: FEATURE_COLS,
    key: (r) => `${r.featureId}@${semKey(r.version)}`,
  },
  {
    file: 'bomItems',
    sheet: 'BOM_Item',
    cols: [
      c('Baseline ID', 'baselineId'),
      c('Feature ID', 'featureId'),
      c('Feature 명칭', 'name'),
      c('Feature 설명', 'description'),
      c('Requirement ID', 'requirementIds', 'lines'),
      c('버전', 'version'),
      c('Lifecycle 상태', 'lifecycle'),
      c('Owner', 'ownerId'),
      c('Feature Tag', 'tags', 'comma'),
      c('ASIL', 'asil'),
      c('UPG-VC', 'upgVc', 'lines'),
      c('국가', 'country'),
      c('차종', 'vehicleModel'),
      c('트림', 'trim'),
      c('Function', 'functions', 'funcs'),
      c('SW ID', 'swIds', 'lines'),
      c('SW 버전', 'swVersions', 'lines'),
      c('제어기 P/No', 'ecuPnos', 'lines'),
      c('Control Point', 'controlPoints', 'lines'),
      c('Feature 간 의존관계', 'dependencyIds', 'lines'),
    ],
    key: (r) => r.baselineId,
  },
  {
    file: 'products',
    sheet: 'Feature_Catalog',
    cols: [
      c('Catalog ID', 'catalogId'),
      c('상품명', 'name'),
      c('상품 설명', 'description'),
      c('국가', 'country'),
      c('차종', 'vehicleModel'),
      c('트림', 'trim'),
      c('Catalog 버전', 'version'),
      c('상품 Tag', 'tags', 'comma'),
      c('판매 유형', 'saleType'),
      c('구성 Baseline ID', 'baselineIds', 'lines'),
      c('유효 시작일', 'validFrom', 'date'),
      c('유효 종료일', 'validTo', 'date'),
      c('Owner', 'ownerId'),
      c('Lifecycle 상태', 'lifecycle'),
      c('Catalog Type', 'type'),
    ],
    key: (r) => `${r.catalogId}@${semKey(r.version)}`,
  },
  {
    file: 'dependencies',
    sheet: 'Topology_의존관계',
    cols: [
      c('의존관계 ID', 'dependencyId'),
      c('관계 유형', 'type'),
      c('원천 Feature ID', 'sourceFeatureId'),
      c('원천 Version', 'sourceVersion'),
      c('대상 Feature ID', 'targetFeatureId'),
      c('대상 Version', 'targetVersion'),
      c('국가', 'country'),
      c('차종', 'vehicleModel'),
      c('트림', 'trim'),
      c('대상 버전 확인', 'targetVersionCheck'),
      c('판정 결과', 'verdict'),
      c('Rule Version', 'ruleVersion'),
      c('판정 근거', 'rationale'),
    ],
    key: (r) => r.dependencyId,
  },
  {
    file: 'gateRecords',
    sheet: 'Topology_Gate Record',
    cols: [
      c('Gate Record ID', 'gateRecordId'),
      c('Feature ID', 'featureId'),
      c('Feature Version', 'featureVersion'),
      c('국가', 'country'),
      c('Gate', 'gate'),
      c('Gate 명칭', 'gateName'),
      c('입력 검사 결과', 'inputResult'),
      c('판정 근거', 'rationale'),
      c('Evidence Ref', 'evidenceRef'),
      c('판정자 역할', 'judgeRole'),
      c('판정시각 (KST)', 'judgedAt', 'kst'),
      c('판정 상태', 'status'),
      c('Gate 단계 Lifecycle', 'gateStageLifecycle'),
      c('현재 Feature Lifecycle', 'currentLifecycle'),
      c('판정 결과 반영·전이 조건', 'transitionNote'),
    ],
    key: (r) => r.gateRecordId,
  },
  {
    file: 'featureFunctions',
    sheet: '(참고용)Feature_Function',
    cols: [
      c('Function ID', 'functionId'),
      c('Feature ID', 'featureId'),
      c('Feature Ver.', 'featureVersion'),
      c('Function 명칭', 'name'),
      c('Function 설명', 'description'),
      c('Function Type', 'type'),
      c('Sequence', 'sequence', 'int'),
      c('SW ID', 'swId'),
      c('SW Version', 'swVersion'),
      c('제어기 P/No.', 'ecuPno'),
      c('상태', 'status'),
    ],
    key: (r) => `${r.featureId}@${semKey(r.featureVersion)}#${r.functionId}`,
  },
  {
    file: 'swMaster',
    sheet: '(참고용)SW_Master',
    cols: [
      c('SW ID', 'swId'),
      c('SW명', 'name'),
      c('SW Version', 'version'),
      c('Artifact ID', 'artifactId'),
      c('목적', 'purpose'),
      c('상세 설명', 'description'),
      c('SW 유형', 'swType'),
      c('Execution Unit', 'executionUnit'),
      c('배포 Package', 'package'),
      c('제어기 P/No.', 'ecuPno'),
      c('Runtime', 'runtime'),
      c('Owner', 'owner'),
      c('Supplier', 'supplier'),
      c('Repository', 'repository'),
      c('Safety Class', 'safetyClass'),
      c('Security Class', 'securityClass'),
      c('Lifecycle', 'lifecycle'),
      c('Checksum', 'checksum'),
      c('Requirement ID', 'requirementId'),
      c('Test Evidence', 'testEvidence'),
    ],
    key: (r) => `${r.swId}@${semKey(r.version)}#${r.ecuPno}`,
  },
  {
    file: 'ecuMaster',
    sheet: '(참고용)ECU_Master',
    cols: [
      c('제어기 P/No.', 'ecuPno'),
      c('제어기명', 'name'),
      c('배치 Domain', 'domain'),
      c('Vehicle Platform', 'vehiclePlatform'),
      c('HW Revision', 'hwRevision'),
      c('OS·Runtime', 'osRuntime'),
      c('Network', 'network'),
      c('Supplier', 'supplier'),
      c('ASIL', 'asil'),
      c('Owner', 'owner'),
      c('Lifecycle', 'lifecycle'),
    ],
    key: (r) => r.ecuPno,
  },
  {
    file: 'versionRationale',
    sheet: 'Feature_버전변경근거',
    cols: [
      c('Feature ID', 'featureId'),
      c('기존 버전', 'fromVersion'),
      c('후속 버전', 'toVersion'),
      c('후속 BL ID', 'toBaselineId'),
      c('기존 Feature 설명', 'fromDescription'),
      c('후속 Feature 설명', 'toDescription'),
      c('후속 Feature Tag', 'toTags', 'comma'),
      c('후속 ATOMIC Function ID', 'toAtomicFunctionId'),
      c('변경 근거와 구현 영향', 'rationale'),
      c('기존 핵심 SW 버전', 'fromCoreSwVersion'),
      c('후속 핵심 SW 버전', 'toCoreSwVersion'),
    ],
    key: (r) => r.featureId,
  },
  {
    file: 'precheckRules',
    sheet: 'DATA-PRECHECK',
    cols: [
      c('규칙 ID', 'ruleId'),
      c('점검 기준', 'criterion'),
      c('판정 조건', 'condition'),
      c('판정 결과(예시)', 'exampleResult'),
      c('판정 결과 사유(예시)', 'exampleReason'),
    ],
    key: (r) => r.ruleId,
  },
  ...['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'].map(
    (g): SheetSpec => ({
      file: 'evidence',
      sheet: `Evidence_${g}`,
      cols: EVIDENCE_COLS,
      key: (r) => r.gateRecordId,
      extra: { gate: g },
    }),
  ),
];
