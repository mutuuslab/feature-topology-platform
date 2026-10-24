// 모의 연계 표시 문구(출시 준비 RD-UX-04) — design ConnectionBadge·외부 연결 상태 패널·체험 구매·게시본 연계 호출.
// 실제 시스템에 연결되면(서버 /api/system/connections가 live) 표시가 사라진다.
export const connections = {
  label: { mock: '모의(연결 전)', disconnected: '연결 안 됨' } as Record<string, string>,
  hint: {
    mock: (system: string) => `${system}에 아직 연결되지 않았습니다. 여기 보이는 결과는 시험용 모의 응답이며 실제로 처리되지 않습니다.`,
    disconnected: (system: string) => `${system}이(가) 연결되지 않았습니다. 이 기능의 결과는 실제로 처리되지 않습니다.`,
  },
  system: { billing: '과금 시스템', ota: 'OTA 배포 시스템', datalake: 'Data Lake' } as Record<string, string>,
  use: { billing: '체험 → 구독·구매 결제', ota: '배포 캠페인 요청(IF-05)', datalake: '차량 데이터 적재' } as Record<string, string>,
  panel: {
    title: '외부 연결 상태',
    lead: '아직 실제 시스템에 연결되지 않은 연계입니다.',
    col: { system: '연결', use: '쓰는 곳', state: '상태' },
    live: '연결됨',
  },
  billing: { blocked: '과금 시스템이 연결되지 않아 구매를 처리할 수 없습니다' },
};
