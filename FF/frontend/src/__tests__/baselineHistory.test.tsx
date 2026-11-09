import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { routeUrl, ROUTES } from '@ff/contracts';
import { AppProvider } from '../store';
import { BaselineHistory } from '../screens/features/LifecyclePanels';

const id='FEAT-NEW',options=[{baselineId:'BL-00001',featureId:'FEAT-NATIVE',version:'1.0.0'},{baselineId:'BL-00002',featureId:'FEAT-NATIVE',version:'2.0.0'}];
let qc: QueryClient,comparisons:URL[],mine:any[],answer:Promise<Response>|undefined;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{
 localStorage.clear();comparisons=[];mine=[];answer=undefined;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  const u=new URL(url,'http://localhost');
  if(u.pathname===routeUrl('featureBaselines',{id}))return json({items:mine});
  if(u.pathname===routeUrl('baselines'))return json({items:options});
  if(u.pathname===routeUrl('baselineChangesets'))return json({items:[]});
  if(u.pathname===ROUTES.find(r=>r.name==='compareBaselines')!.path){comparisons.push(u);return answer??json({items:[],summary:{type:{ADDED:0,REMOVED:0,MODIFIED:0}}});}
  throw new Error('Unexpected test source '+url);
 }));
 qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
});
afterEach(()=>{cleanup();qc.clear();vi.unstubAllGlobals();localStorage.clear();});
function mount(){return render(<QueryClientProvider client={qc}><MemoryRouter><AppProvider><BaselineHistory featureId={id}/></AppProvider></MemoryRouter></QueryClientProvider>);}
async function selectors(){await screen.findAllByRole('option',{name:/BL-00001/});return [screen.getByRole('combobox',{name:'기준'}),screen.getByRole('combobox',{name:'비교 대상'})];}

it('shows an unselected guide and honest empty select values, with no phantom loading/query for a new Feature',async()=>{
 const view=mount();const [left,right]=await selectors();expect((left as HTMLSelectElement).value).toBe('');expect((right as HTMLSelectElement).value).toBe('');
 await waitFor(()=>expect(view.container.querySelectorAll('[data-state="loading"]')).toHaveLength(0));expect(comparisons).toHaveLength(0);expect(screen.queryByText('두 Baseline의 내용이 같습니다.')).toBeNull();
});
it('does not compare one selected ID and shows actual loading only after both IDs are selected',async()=>{
 let finish!:(r:Response)=>void;answer=new Promise(r=>finish=r);const view=mount();const [left,right]=await selectors();
 fireEvent.change(left,{target:{value:'BL-00001'}});await waitFor(()=>expect(view.container.querySelectorAll('[data-state="loading"]')).toHaveLength(0));expect(comparisons).toHaveLength(0);
 fireEvent.change(right,{target:{value:'BL-00002'}});await screen.findByRole('progressbar');await waitFor(()=>expect(comparisons).toHaveLength(1));expect(comparisons[0].searchParams.get('left')).toBe('BL-00001');expect(comparisons[0].searchParams.get('right')).toBe('BL-00002');
 finish(json({items:[],summary:{type:{ADDED:0,REMOVED:0,MODIFIED:0}}}));expect(await screen.findByText('두 Baseline의 내용이 같습니다.')).toBeTruthy();expect(screen.queryByRole('progressbar')).toBeNull();
});
it('retains real comparison errors and clears their display when selection is removed without inventing an equal result',async()=>{
 answer=Promise.resolve(json({error:{code:'GUARD_FAILED',message:'Synthetic comparison source missing'}},422));mount();const [left,right]=await selectors();fireEvent.change(left,{target:{value:'BL-00001'}});fireEvent.change(right,{target:{value:'BL-00002'}});
 expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic comparison source missing');fireEvent.change(right,{target:{value:''}});expect((right as HTMLSelectElement).value).toBe('');expect(screen.queryByRole('alert')).toBeNull();expect(screen.queryByRole('progressbar')).toBeNull();expect(screen.queryByText('두 Baseline의 내용이 같습니다.')).toBeNull();expect(comparisons).toHaveLength(1);
});
it('keeps the existing automatic comparison for two actual Feature baselines and allows explicit deselection',async()=>{
 mine=options.map(o=>({...o,featureId:id,approvedBy:'demo',approvedAt:null,verified:true}));mount();const [left,right]=await selectors();await screen.findByText('두 Baseline의 내용이 같습니다.');expect((left as HTMLSelectElement).value).toBe('BL-00001');expect((right as HTMLSelectElement).value).toBe('BL-00002');fireEvent.change(right,{target:{value:''}});expect((right as HTMLSelectElement).value).toBe('');expect(screen.queryByText('두 Baseline의 내용이 같습니다.')).toBeNull();expect(screen.queryByRole('progressbar')).toBeNull();
});
