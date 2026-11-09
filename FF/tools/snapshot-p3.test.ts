import assert from 'node:assert/strict';
import {test} from 'node:test';
import {snapshotP3} from './snapshot-p3.ts';

test('trace writes capture the exact native ALL query while retaining the default list',async()=>{
  const calls:unknown[][]=[];
  await snapshotP3(async(...args)=>{calls.push(args);return {items:[]};},{features:[{featureId:'FEAT-00022',version:'1.0.0'}]});
  assert.deepEqual(calls.filter(c=>c[0]==='traceLinks'),[['traceLinks'],['traceLinks',{}, {status:'ALL'}]]);
  assert.deepEqual(calls.filter(c=>c[0]==='featureTrace'),[['featureTrace',{id:'FEAT-00022'}]]);
});
