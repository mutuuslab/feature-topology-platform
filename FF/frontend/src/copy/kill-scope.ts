// 긴급 차단 범위·해제·사건 범위 화면 문구(P11a) — 차단 콘솔에서 지연 적재되는 패널만 쓴다
export const killScope = {
  title: '차단 대상 범위',
  hint: '고르지 않으면 영향 범위 전체를 차단합니다. 고른 칸이 모두 맞는 차량만 남습니다',
  all: '전체',
  kinds: { countries: '적용 지역', vehicleModels: '차종', trims: '트림', upgVcs: 'Variant 조건(UPG-VC)', swVersions: 'SW 버전' } as Record<string, string>,
  variantRule: 'Feature의 Variant 조건',
  variantRuleText: (country: string, model: string, trim: string, upg: string, sw: string | null) =>
    `${country} · ${model} · ${trim} · UPG-VC ${upg || '조건 없음'} · 요구 SW ${sw ?? '조건 없음'}`,
  groups: '영향 차량 그룹',
  col: { scope: '범위', vehicles: '차량', verdict: 'Variant 판정' },
  verdict: { APPLICABLE: '적용', NOT_SUPPORTED: 'SW 미지원', NOT_APPLICABLE: '범위 밖', UNKNOWN: '판단 불가' } as Record<string, string>,
  parties: '관련 담당자',
  partyWho: '담당',
  partyCol: { owner: 'Feature Owner', requester: '요청자', approvers: '승인자', suppliers: '협력사' },
  supplierText: (supplier: string, sw: string, ver: string) => `${supplier} · ${sw} ${ver}`,
};
