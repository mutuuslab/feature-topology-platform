import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pgResultPassed } from './pg-test-result.ts';

test('a failed setup with skipped assertions is a failure even when failed-test count is zero', () => {
  assert.equal(pgResultPassed(1, { success: false, numFailedTests: 0, testResults: [{ status: 'failed', message: '', assertionResults: [{ status: 'skipped' }] }] }), false);
});
test('intentional skips in a successful process remain distinct from setup failure', () => {
  assert.equal(pgResultPassed(0, { success: true, numFailedTests: 0, testResults: [{ status: 'passed', assertionResults: [{ status: 'skipped' }] }] }), true);
});
test('process crashes and assertion failures cannot be hidden by a high pass count', () => {
  for (const code of [null, 1]) assert.equal(pgResultPassed(code, { success: true, numFailedTests: 0, testResults: [] }), false);
  assert.equal(pgResultPassed(0, { success: true, numFailedTests: 1, testResults: [{ status: 'failed', assertionResults: [{ status: 'failed' }] }] }), false);
});
