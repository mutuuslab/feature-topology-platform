import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createHash,generateKeyPairSync,sign,webcrypto } from 'node:crypto';
import { canonicalJson } from '@ff/contracts';
import { downloadSoftware,softwareTraceTone,verifySoftwareManifest,type SoftwareVerdict } from '../api/software';

const bytes=new TextEncoder().encode('export const software = "real bytes";\n');
const sha=createHash('sha256').update(bytes).digest('hex');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
function verdict():SoftwareVerdict {
 const pkg={packageId:'SWP-test',featureId:'FEAT-00022',featureVersion:'1.0.0',swId:'SW-1',fileId:'file',name:'software.mjs',bytes:bytes.length,sha256:sha,mediaType:'text/javascript',source:'EXECUTABLE_DEMO' as const,status:'APPROVED' as const,revision:2,createdBy:'usr-dev',createdAt:'2026-11-09T00:00:00Z',reviewedBy:'usr-rm'};
 const manifest={schema:'ff.software.v1',packageId:pkg.packageId,featureId:pkg.featureId,featureVersion:pkg.featureVersion,swId:pkg.swId,name:pkg.name,bytes:pkg.bytes,sha256:pkg.sha256,source:pkg.source};
 const hash='sha256:'+createHash('sha256').update(canonicalJson(manifest)).digest('hex');
 return {allowed:true,blocked:null,vin:'VIN-1',flagKey:'care_00022_signal',package:pkg,manifest,signature:{keyId:'KEY-test',payloadHash:hash,signature:sign(null,Buffer.from(hash),privateKey).toString('base64')},publicKey:{pem:publicKey.export({type:'spki',format:'pem'}).toString(),purpose:'policy',notAfter:new Date(Date.now()+3600000).toISOString()},policy:{policyId:'POL-00001',revision:1},evaluation:{value:true,reason:'POLICY_MATCH'}};
}
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);vi.stubEnv('VITE_DATA_MODE','live');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('SW client signature and original bytes',()=>{
 it.each([['KILL','FALSE','pass'],['KILL','TRUE','blocked'],['ENTITLEMENT','FALSE','blocked'],['DECIDE','UNKNOWN','unknown']])('shows %s=%s as %s', (step,result,tone)=>{expect(softwareTraceTone({step,result})).toBe(tone);});
 it('independently verifies the signed manifest with Ed25519',async()=>{expect(await verifySoftwareManifest(verdict())).toBe(true);});
 it('rejects altered visible metadata, signature, expired key and wrong key purpose',async()=>{
   const changed=verdict();changed.package.sha256='0'.repeat(64);expect(await verifySoftwareManifest(changed)).toBe(false);
   const damaged=verdict();damaged.signature!.signature=Buffer.alloc(64).toString('base64');expect(await verifySoftwareManifest(damaged)).toBe(false);
   for(const time of ['2020-01-01T00:00:00Z','invalid']){const old=verdict();old.publicKey!.notAfter=time;expect(await verifySoftwareManifest(old)).toBe(false);}
   const wrong=verdict();wrong.publicKey!.purpose='kill';expect(await verifySoftwareManifest(wrong)).toBe(false);
 });
 it('downloads actual bytes with the selected actor and checks original SHA',async()=>{
   const fetch=vi.fn(async()=>({ok:true,status:200,headers:new Headers(),blob:async()=>new globalThis.Blob([bytes])}));vi.stubGlobal('fetch',fetch);
   // jsdom Blob does not implement arrayBuffer; a standards-compliant blob stands in for browser transport.
   const {Blob}=await import('node:buffer');fetch.mockImplementation(async()=>({ok:true,status:200,headers:new Headers(),blob:async()=>new Blob([bytes]) as unknown as globalThis.Blob}));
   const blob=await downloadSoftware(verdict(),'integrator');expect(blob.size).toBe(bytes.length);
   const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(url).toContain('vin=VIN-1');expect(url).toContain('flagKey=care_00022_signal');expect((init.headers as Record<string,string>)['X-Actor-Role']).toBe('IMPLEMENTER');
 });
 it('never releases corrupt or truncated bytes as a successful download',async()=>{
   const {Blob}=await import('node:buffer');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,headers:new Headers(),blob:async()=>new Blob(['corrupt'])})));
   await expect(downloadSoftware(verdict(),'integrator')).rejects.toThrow('SOFTWARE_INTEGRITY');
 });
 it('does not request original bytes when the manifest is not authorized',async()=>{
   const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const no=verdict();no.allowed=false;
   await expect(downloadSoftware(no,'integrator')).rejects.toThrow('SOFTWARE_INTEGRITY');expect(fetch).not.toHaveBeenCalled();
 });
});
