/** A high compatibility count cannot turn a failed test process or setup hook into PASS. */
export function pgResultPassed(exitCode: number | null, report: {
  success?: boolean;
  numFailedTests: number;
  testResults: { status: string; message?: string; assertionResults: { status: string }[] }[];
}): boolean {
  return exitCode === 0 && report.success !== false && report.numFailedTests === 0 && !report.testResults.some(file => file.status === 'failed');
}
