// Exercise an already running immutable build and isolated API. Never auto-start a fallback server.
import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from './playwright.config';

function port(name: string) {
  const value=Number(process.env[name]);
  if (!Number.isInteger(value) || value<1024 || value>65535 || value===8000) throw new Error(`${name} must name the existing isolated test service`);
  return value;
}
const web=port('E2E_WEB_PORT');
port('E2E_API_PORT');
export default defineConfig({
  ...base,
  testDir:resolve(__dirname,'tests'),
  outputDir:resolve(__dirname,'test-results/live'),
  webServer:undefined,
  globalSetup:resolve(__dirname,'live-ready.ts'),
  use:{...base.use,baseURL:`http://localhost:${web}`,storageState:{cookies:[],origins:[{origin:`http://localhost:${web}`,localStorage:[{name:'ff.auth',value:'1'}]}]}},
});
