import { localizedCopy } from '../locale/runtime';

export const formatters = /* @__PURE__ */ localizedCopy('formatters.formatters', {
  system: '시스템(자동)',
  unknownPerson: '담당자',
  roleHolder: (role: string) => `${role} 담당`,
  days: (n: number) => `${n}일`,
  hours: (h: number, m: number) => `${h}시간${m ? ` ${m}분` : ''}`,
  minutes: (n: number) => `${n}분`,
  won: (amount: string) => `${amount}원`,
  millionWon: '백만원',
  thousandCurrency: (currency: string) => `천 ${currency}`,
});
