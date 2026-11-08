import { afterEach,describe,expect,it,vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { FlagRepository } from '@ff/contracts';
import { GithubAdapter } from '../../src/domains/d01-policy/flag-code/github.adapter';
const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
const repo={repository:'https://github.com/mutuuslab/vehicle-demo',installationId:42,mode:'GITHUB_APP'} as FlagRepository;
const env={FF_GITHUB_APP_ID:'123',FF_GITHUB_APP_PRIVATE_KEY:key,FF_GITHUB_API_URL:'https://github.demo.test'};
const token=(value:string)=>({token:value,expires_at:new Date(Date.now()+3600000).toISOString()});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
afterEach(()=>vi.unstubAllGlobals());
describe('GitHub transport correctness',()=>{
 it.each([{}, {token:'',expires_at:'2099-01-01T00:00:00Z'},{token:'demo',expires_at:'invalid'},{token:'demo',expires_at:'2000-01-01T00:00:00Z'}])('rejects invalid installation token metadata %j',async response=>{
   const fetch=vi.fn(async()=>json(response));vi.stubGlobal('fetch',fetch);
   await expect(new GithubAdapter().port(repo,env)!.headOf(repo,'main')).rejects.toThrow('설치 토큰');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('refreshes a revoked cached token once and retries the rejected request',async()=>{
   let tokens=0;const auth:string[]=[];const fetch=vi.fn(async(url:string,init:RequestInit)=>{
     if(url.endsWith('/access_tokens'))return json(token(`token-${++tokens}`));
     auth.push((init.headers as Record<string,string>).authorization);
     return auth.length===2?json({message:'expired'},401):json({object:{sha:'a'.repeat(40)}});
   });vi.stubGlobal('fetch',fetch);const port=new GithubAdapter().port(repo,env)!;
   expect(await port.headOf(repo,'main')).toBe('a'.repeat(40));expect(await port.headOf(repo,'main')).toBe('a'.repeat(40));
   expect(tokens).toBe(2);expect(auth).toEqual(['token token-1','token token-1','token token-2']);
 });
 it('never includes a remote error body in product errors and forbids credential redirects',async()=>{
   const fetch=vi.fn(async(url:string)=>url.endsWith('/access_tokens')?json(token('demo')):json({message:'sensitive remote body'},403));vi.stubGlobal('fetch',fetch);
   await expect(new GithubAdapter().port(repo,env)!.headOf(repo,'main')).rejects.not.toThrow('sensitive remote body');
   for(const call of fetch.mock.calls)expect((call as unknown as [string,RequestInit])[1].redirect).toBe('error');
 });
});
