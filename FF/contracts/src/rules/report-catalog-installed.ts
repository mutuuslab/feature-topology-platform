// 보고서 규칙·시험 카탈로그 설치 — contracts 입구(index.ts: 백엔드·도구·시험)는 읽자마자 설치한다.
// 화면 입구(web.ts)는 이 모듈을 거치지 않고 design/rule-catalog.ts가 필요할 때 따로 설치한다.
import { REPORT_RULES, REPORT_TESTS } from '../generated/report-catalog';
import { installReportCatalog } from './standards';

installReportCatalog(REPORT_RULES, REPORT_TESTS);

export { REPORT_RULES, REPORT_TESTS };
