import { localizedCopy } from '../locale/runtime';
export const PRD_BODY_LIMIT = 2000;
export const PRD_SECTIONS = /* @__PURE__ */ localizedCopy('propose-prd.PRD_SECTIONS', ['[배경과 문제]', '[기대 동작]', '[완료 조건]', '[범위와 제약]']);
const observedOutlines = new Map<string, string[]>();
export function prdTemplate() {
  const headings = [...PRD_SECTIONS];
  const template = `${headings.join('\n\n')}\n`;
  observedOutlines.set(template.trim(), headings);
  return template;
}
/** Captured default for existing callers; the editor reads the current-language template. */
export const PRD_TEMPLATE = prdTemplate();
export function hasPrdOutline(description: string) {
  prdTemplate();
  return [...observedOutlines.values()].some((headings) => headings.every((heading) => description.includes(heading)));
}
export function isPrdTemplate(description: string) {
  prdTemplate();
  if (observedOutlines.has(description.trim())) return true;
  const lines = description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 4 && lines.every((line) => /^\[[^\]\r\n]+\]$/.test(line));
}
export const proposePrd = /* @__PURE__ */ localizedCopy('propose-prd.proposePrd', {
  key: 'Feature DB의 기준을 선택하고 적용하면 작성을 시작합니다',
  lead: 'Feature DB의 기준을 먼저 선택한 뒤, 가져온 정보와 적용 대상을 확인해 초안으로 등록합니다.',
  document: 'Feature 문서',
  draft: '미등록 초안',
  lifecycle: '초안 등록 후 내용 검토·정의 승인이 이어집니다. 차량 배포는 별도 절차입니다.',
  metadata: '담당·적용 대상·연결',
  metadataLandmark: 'Feature 문서 속성',
  chooseRefs: '기준 Feature 선택',
  manageRefs: '연결 편집',
  referenceTitle: '기준 정보와 참고 연결',
  referenceEmpty: '기본 정보를 가져올 기준 Feature 1개가 필요합니다.',
  referenceHint: '직접 작성한 내용은 유지합니다. 선택한 기준은 적용 전에 확인합니다.',
  reviewTop: '등록 전 확인',
  editorModes: '문서 보기 방식',
  edit: '편집',
  preview: '미리 보기',
  previewTitle: '작성한 문서 미리 보기',
  untitled: '이름을 입력하지 않은 Feature',
  emptyBody: '배경과 기대 동작을 작성하세요.',
  template: 'PRD 목차 추가',
  templateExists: '문서에 PRD 목차가 있습니다',
  templateLimit: '목차를 추가하면 2,000자를 넘습니다',
  templateFill: '목차 아래에 실제 배경과 동작을 작성하세요',
  bodyHint: '문서 전체가 기능 설명으로 저장됩니다. 최대 2,000자입니다.',
  bodyCount: (length: number) => `${length.toLocaleString('ko-KR')} / 2,000자`,
  bodyTooLong: '기능 설명은 2,000자 이내로 작성하세요',
});
