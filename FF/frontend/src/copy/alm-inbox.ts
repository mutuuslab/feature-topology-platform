import { localizedCopy } from '../locale/runtime';
// Shared inbox copy remains small; full ALM panels load with their screens.
import { EPIC_FIELD, type EpicFieldKey } from '@ff/contracts';

export const almInbox = /* @__PURE__ */ localizedCopy('alm-inbox.almInbox', {
  rejudgeDetail: (title: string, from: number, to: number, released: boolean) => `${title} v${from} → v${to}${released ? ' · 출시 버전' : ''}`,
  conflictField: (field: string) => field === 'status' ? '상태' : (EPIC_FIELD[field as EpicFieldKey]?.ko ?? field),
});
