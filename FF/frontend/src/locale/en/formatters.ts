export default {
  'formatters.system': 'System (automatic)', 'formatters.unknownPerson': 'Responsible person',
  'formatters.roleHolder': (role: string) => `${role} owner`,
  'formatters.days': (n: number) => `${n}d`,
  'formatters.hours': (h: number, m: number) => `${h}h${m ? ` ${m}min` : ''}`,
  'formatters.minutes': (n: number) => `${n}min`,
  'formatters.won': (amount: string) => `KRW ${amount}`,
  'formatters.millionWon': 'million KRW',
  'formatters.thousandCurrency': (currency: string) => `thousand ${currency}`,
  'formatters.vehicles': (n: number) => `${n.toLocaleString('en-US')} vehicles`,
};
