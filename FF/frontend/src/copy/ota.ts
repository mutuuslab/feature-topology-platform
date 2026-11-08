// OTA 서버 전달(IF-05, 채널 ota) 문구 — 게시본 상세의 'OTA 전달' 패널. 규격 docs/80-integration/80-45-ota-server-if05.md
export const ota = {
  title: 'OTA 전달',
  codes: 'IF-05 · OTA 서버',
  state: {
    QUEUED: '제출 대기',
    SUBMITTED: 'OTA 서버 접수',
    RETRY_WAIT: '전달 실패(재시도 가능)',
    FAILED: '전달 실패 — 다시 제출 필요',
    EXPIRED: '기한 지남(전달 안 됨)',
    CANCELLED: '취소됨',
    COMPLETED: '전달 끝',
  } as Record<string, string>,
  // OTA 서버 자신의 사실만(80-45 §7.1) — 적용·거부는 차량 결과(차량 → Lake → FF)로만 알 수 있다
  outcome: {
    DELIVERING: '전송 중',
    DELIVERED: '차량에 넘김',
    NO_RESPONSE: '기한까지 닿지 못함',
    CANCELLED: '취소',
    NOT_ELIGIBLE: '보낼 수 없음',
  } as Record<string, string>,
  row: {
    job: '작업',
    otaJob: 'OTA 서버 작업',
    serverState: 'OTA 서버 상태',
    attempts: '제출 시도',
    next: '다음 자동 재시도',
    error: '마지막 오류',
    targets: '대상 차량',
  },
  col: { vin: '차량', outcome: '결과', detail: '사유', at: '시각' },
  vehicles: '차량별 전달 사실(OTA 서버 통보 — 적용 확인은 차량 결과로)',
  noVehicles: 'OTA 서버가 아직 차량별 전달 사실을 알리지 않았습니다.',
  kept: '게시본은 서명된 채 남아 있습니다. 전달만 다시 하면 됩니다.',
  retry: '다시 제출',
  retryBody: '같은 작업 ID(멱등 키)로 다시 보냅니다 — OTA 서버가 이미 받았다면 같은 작업을 돌려주므로 차량에 두 번 가지 않습니다.',
  cancel: '작업 취소',
  cancelBody: '아직 전달하지 않은 차량만 취소합니다. 이미 적용한 차량은 복원·이전 상태 복구로 되돌리세요.',
};
