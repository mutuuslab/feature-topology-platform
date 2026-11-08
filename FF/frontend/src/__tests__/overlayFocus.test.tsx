import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DangerConfirm, Drawer } from '../design/overlay';

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no layout. Preserve CSS-hidden/zero-size distinctions for focus tests.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    for (let el: HTMLElement | null = this; el; el = el.parentElement) if (el.hidden || getComputedStyle(el).display === 'none') return [] as unknown as DOMRectList;
    return [new DOMRect(0, 0, this.hasAttribute('data-zero') ? 0 : 100, 20)] as unknown as DOMRectList;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const settle = () => act(() => vi.runOnlyPendingTimers());
function Editor() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [nested, setNested] = useState(false);
  return <MemoryRouter><button onClick={() => setOpen(true)}>편집 열기</button>
    <Drawer open={open} title={<><span style={{display:'none'}}><button>숨은 규칙</button></span>편집</>} dirty={!!value} onClose={() => setOpen(false)}>
      <input aria-label="본문" value={value} onChange={(e) => setValue(e.target.value)} />
      <button onClick={() => setNested(true)}>중첩 열기</button>
      <button>마지막 작업</button>
      <input aria-label="음수 순서" tabIndex={-1}/><button data-zero>면적 없음</button>
      <fieldset disabled><input aria-label="비활성 상속"/></fieldset>
      <div {...{inert:''}}><button>inert 작업</button></div>
      <div hidden><button>숨은 작업</button></div>
      <div style={{visibility:'hidden'}}><button>보이지 않는 작업</button></div>
    </Drawer>
    <DangerConfirm open={nested} title="중첩 확인" body="확인 내용" confirmWord="확인" actionLabel="실행" onConfirm={() => {}} onClose={() => setNested(false)}/>
  </MemoryRouter>;
}
function openEditor() {
  render(<Editor/>);
  const opener=screen.getByRole('button',{name:'편집 열기'}); opener.focus(); fireEvent.click(opener); settle();
  return {opener, dialog:screen.getByRole('dialog'), first:screen.getByRole('button',{name:'닫기'}), last:screen.getByRole('button',{name:'마지막 작업'})};
}
it('숨은 제목 규칙 대신 표시된 컨트롤로 시작하고 비활성·inert·음수·면적0은 Tab 경계에서 제외한다',()=>{
  const {dialog,first,last}=openEditor();
  expect(first).toHaveFocus();
  const back=new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});
  fireEvent(first,back); expect(back.defaultPrevented).toBe(true); expect(last).toHaveFocus();
  const next=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
  fireEvent(last,next); expect(next.defaultPrevented).toBe(true); expect(first).toHaveFocus();
  expect(dialog.contains(document.activeElement)).toBe(true);
});
it('현재 초점이 밖에 있거나 순환 대상이 아니어도 Tab/Shift+Tab으로 내부를 회수한다',()=>{
  const {opener,first,last}=openEditor();
  opener.focus(); fireEvent.keyDown(document,{key:'Tab'}); expect(first).toHaveFocus();
  opener.focus(); fireEvent.keyDown(document,{key:'Tab',shiftKey:true}); expect(last).toHaveFocus();
  screen.getByLabelText('음수 순서').focus(); fireEvent.keyDown(document,{key:'Tab'}); expect(first).toHaveFocus();
});
it('표시된 순환 대상이 없으면 dialog 자체를 초점 대상으로 사용한다',()=>{
  render(<DangerConfirm open title="모두 비활성" body="대기" confirmWord="확인" actionLabel="실행" onClose={()=>{}} onConfirm={()=>{}}/>);
  const dialog=screen.getByRole('alertdialog');
  dialog.querySelectorAll('button,input').forEach((el)=>el.setAttribute('disabled',''));
  settle(); expect(dialog).toHaveFocus();
  const event=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
  fireEvent(dialog,event); expect(event.defaultPrevented).toBe(true); expect(dialog).toHaveFocus();
});
it('입력으로 콜백이 바뀌어도 초점을 다시 시작하지 않고 미저장 입력 보호·복귀를 유지한다',()=>{
  const {opener}=openEditor();
  const input=screen.getByLabelText('본문'); input.focus(); fireEvent.change(input,{target:{value:'초안'}}); settle();
  expect(input).toHaveFocus();
  fireEvent.keyDown(document,{key:'Escape'}); expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'계속 편집'})); expect(input).toHaveValue('초안');
  fireEvent.keyDown(document,{key:'Tab'}); expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document,{key:'Escape'}); fireEvent.click(screen.getByRole('button',{name:'버리고 닫기'}));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(opener).toHaveFocus();
});
it('중첩 창의 Escape는 맨 위만 닫고 그 창을 열었던 내부 버튼으로 돌아간다',()=>{
  const {dialog}=openEditor();
  const opener=within(dialog).getByRole('button',{name:'중첩 열기'}); opener.focus(); fireEvent.click(opener); settle();
  expect(screen.getByRole('alertdialog').contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(dialog).toBeInTheDocument(); expect(opener).toHaveFocus();
});
it.each(['닫기','바깥','Escape'])('%s로 닫으면 원래 버튼에 초점을 돌려준다',(how)=>{
  const {opener}=openEditor();
  if(how==='닫기') fireEvent.click(screen.getByRole('button',{name:'닫기'}));
  else if(how==='바깥') fireEvent.click(document.querySelector('.ds-scrim')!);
  else fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull(); expect(opener).toHaveFocus();
});
