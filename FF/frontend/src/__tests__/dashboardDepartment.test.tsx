import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { HomeScreen } from '../screens/home/Inbox';
import { localBackend } from '../screens/home/dashboard/store';
import { emptyBoard } from '../screens/home/dashboard/layout';

let rows: any[];
let defaults: { departmentId: string; mode: string; dashboardId: string | null; version: number };
let puts: any[];
beforeEach(() => {
  rows=[]; puts=[]; localStorage.clear(); defaults={departmentId:'DEP-PDP',mode:'ROLE',dashboardId:null,version:0};
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url=String(input), method=init?.method ?? 'GET';
    const headers=init?.headers as Record<string,string> ?? {};
    const id=headers['X-Actor-Id'] ?? 'anonymous';
    const body=init?.body ? JSON.parse(String(init.body)) : {};
    let data: unknown={items:[]};
    if (url.startsWith('/api/dashboard-departments/')) {
      if (method==='PUT') { puts.push(body); defaults={...defaults,...body,version:defaults.version+1}; }
      data=defaults;
    } else if (url.startsWith('/api/dashboards')) {
      if (method==='POST') rows.push({id:`DSH-${rows.length+1}`,ownerId:id,...body,version:1,createdAt:'2026-11-08',updatedAt:'2026-11-08',favourite:false,mine:true});
      data=method==='POST' ? rows.at(-1) : {items:rows.map(d=>({...d,mine:d.ownerId===id}))};
    }
    return new Response(JSON.stringify(data),{status:method==='POST'?201:200,headers:{'Content-Type':'application/json'}});
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function mount(role: string, department='ALL', path='/?dashboard=department') {
  localStorage.setItem('fp.state.v2',JSON.stringify({role,department}));
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}><AppProvider><HomeScreen/></AppProvider></MemoryRouter></QueryClientProvider>);
}

describe('부서 공통판·역할판·개인판 전환',()=>{
  it('관리자가 현재 판을 부서 공통판으로 저장하고 기본 배정을 서버에 남긴다',async()=>{
    mount('sysadmin');
    fireEvent.click(await screen.findByText('부서 기본판 관리'));
    fireEvent.click(screen.getByRole('button',{name:'현재 구성을 부서 공통판으로 저장'}));
    await waitFor(()=>expect(rows[0]).toMatchObject({departmentId:'DEP-PDP',sharedRoles:[]}));
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'부서의 기본 대시보드'})).toHaveValue('DSH-1'));
    fireEvent.click(screen.getByRole('button',{name:'부서 기본판 배정 저장'}));
    await waitFor(()=>expect(puts.at(-1)).toMatchObject({mode:'DEPARTMENT',dashboardId:'DSH-1',version:0}));
  });
  it('구성원은 배정된 공통판을 열고 역할 기본판·개인 사본으로 전환한다',async()=>{
    rows=[{id:'DSH-TEAM',ownerId:'usr-sysadmin',name:'팀 공동 현황',departmentId:'DEP-PDP',sharedRoles:[],board:emptyBoard('1'),version:1,favourite:false,createdAt:'',updatedAt:''}];
    defaults={...defaults,mode:'DEPARTMENT',dashboardId:'DSH-TEAM',version:1};
    mount('author','DEP-PDP');
    await waitFor(()=>expect(screen.getByRole('heading',{level:1})).toHaveTextContent('팀 공동 현황'));
    expect(screen.queryByText('부서 기본판 관리')).toBeNull();
    fireEvent.click(screen.getByRole('link',{name:'역할 기본판'}));
    await waitFor(()=>expect(screen.getByRole('heading',{level:1})).toHaveTextContent('내 대시보드'));
    fireEvent.click(screen.getByRole('button',{name:'내 개인판 만들기'}));
    await waitFor(()=>expect(rows.at(-1)).toMatchObject({ownerId:'usr-author',sharedRoles:[]}));
    expect(rows.at(-1).departmentId).toBeUndefined();
    expect(defaults.dashboardId).toBe('DSH-TEAM');
    const name=rows.at(-1).name;
    await waitFor(()=>expect(screen.getByRole('heading',{level:1})).toHaveTextContent(name));
    cleanup();
    mount('author','DEP-PDP','/?dashboard=personal');
    await waitFor(()=>expect(screen.getByRole('heading',{level:1})).toHaveTextContent(name));
  });
  it('정적 저장도 부서 경계·관리자만 편집·기본판 삭제 제한을 유지한다',async()=>{
    const admin=localBackend({id:'usr-sysadmin',roles:['SYSTEM_ADMIN']});
    const doc=await admin.create({name:'팀 현황',board:emptyBoard('1'),sharedRoles:[],departmentId:'DEP-PDP'});
    const member=localBackend({id:'usr-author',roles:['FEATURE_AUTHOR'],departmentId:'DEP-PDP'});
    expect((await member.list())[0]).toMatchObject({id:doc.id,mine:false});
    expect(await localBackend({id:'usr-operator',roles:['OPERATOR'],departmentId:'DEP-OPS'}).list()).toEqual([]);
    await expect(member.update(doc.id,1,{name:'가로채기'})).rejects.toMatchObject({status:403});
    localStorage.setItem('ff.dashboard.departmentDefaults.v1',JSON.stringify({'DEP-PDP':{dashboardId:doc.id,mode:'DEPARTMENT',version:1}}));
    await expect(admin.remove(doc.id,1)).rejects.toMatchObject({status:409});
  });
});
