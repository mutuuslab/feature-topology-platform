import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {AppProvider} from '../store';
import TraceLinksTab from '../screens/features/TraceLinksTab';
// Reproduce the published UI flag while keeping transport mocked.
vi.mock('../api/client',async original=>({...await original<typeof import('../api/client')>(),STATIC_MODE:true}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
it('published trace UI exposes registration, unlink and Evidence with required input checks',async()=>{
 localStorage.setItem('fp.state.v2',JSON.stringify({role:'quality'}));
 const kinds=['REQUIREMENT','ARCHITECTURE','INTERFACE','TEST_CASE','OTA'];
 const data={feature:{featureId:'FEAT-00022'},links:[{linkId:'TRL-1',kind:'TEST_CASE',elementId:'TC-1',elementType:'FUNCTIONAL',sourceSystem:'TMS',status:'ACTIVE',existence:'VERIFIED',required:true,linkedBy:'usr-author',linkedAt:'2026-11-01T00:00:00Z'}],groups:Object.fromEntries(kinds.map(k=>[k,{count:k==='TEST_CASE'?1:0,byType:{},bySource:{}}])),requirements:[],evidence:[],coverage:{requirement:{total:0,covered:0,ratio:null},test:{required:1,withEvidence:0,ratio:0,missing:['TC-1'],failing:[]},hasRequirementLink:false}};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})));
 const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<QueryClientProvider client={qc}><MemoryRouter><AppProvider><TraceLinksTab id="FEAT-00022"/></AppProvider></MemoryRouter></QueryClientProvider>);
 expect(await screen.findByRole('button',{name:'연결 등록'})).toBeTruthy();
 fireEvent.click(screen.getByRole('radio',{name:/검증\(Test Case\)/}));
 const table=await screen.findByRole('table',{name:'검증(Test Case)'});
 const row=within(table).getByText('TC-1').closest('tr')!;
 expect(within(row).getByRole('button',{name:'해제'})).toBeTruthy();
 fireEvent.click(within(row).getByRole('button',{name:'Evidence 등록'}));
 expect(within(row).getByLabelText('Evidence 식별자')).toBeTruthy();
 expect((within(row).getByRole('button',{name:'등록'}) as HTMLButtonElement).disabled).toBe(true);
});
