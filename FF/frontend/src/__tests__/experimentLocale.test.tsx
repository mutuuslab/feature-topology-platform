import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { changeUiLanguage, __resetLocaleForTest } from '../locale/runtime';
import { p10 } from '../copy/p10';
import { experimentAnalysis as A } from '../copy/experiment-analysis';
import { ExperimentMethods, ExperimentResultCharts } from '../screens/ext/ExperimentAnalysis';

afterEach(() => { cleanup(); localStorage.clear(); __resetLocaleForTest(); });
it('shows English test guidance, numeric evidence and missing baseline without translating business identifiers', async () => {
  expect(await changeUiLanguage('en')).toBe(true);
  render(<><ExperimentMethods /><ExperimentResultCharts type="SHADOW" minSamples={1200} result={{days:3,control:.98,treatment:.99,diff:.01,ci95:[0,.02],enough:true,significant:false,verdict:'INSUFFICIENT',fleet:{deployedPolicyId:null,vehicles:10,comparableVehicles:0,comparisonStatus:'NO_BASELINE',agreement:0,diverged:[]}}} /></>);
  expect(screen.getByText('Plan and review tests')).toBeTruthy();
  expect(screen.getByText('There is no deployed policy to compare. Agreement cannot be established.')).toBeTruthy();
  expect(screen.getByText('At least 1,200 samples per group')).toBeTruthy();
  expect(screen.queryByRole('progressbar', {name:'Agreement'})).toBeNull();
  expect(p10.experiment.fleetSummary(1000, '99.5%', 'POL-00002')).toContain('1,000 vehicles');
  expect(p10.experiment.fleetSummary(1000, '99.5%', 'POL-00002')).toContain('POL-00002');
  expect(p10.field.submitted('INC-00001')).toBe('Submitted as INC-00001');
  expect(A.intervalText(-.01,.02)).toBe('-1.00 to 2.00 pp');
  await changeUiLanguage('ko');
  expect(p10.experiment.title).toBe('A/B 및 Shadow 테스트');
});
