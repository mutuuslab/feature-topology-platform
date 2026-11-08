// 입력 칸별 오류(출시 준비 RD-UX-01) — 서버 오류 상세에서 칸 이름 → 문장. 폼 화면만 쓰므로 첫 화면 묶음과 나눠 둔다.
//   · 요청 본문 검사(ZodPipe): details = [{ path: 'name' | 'tags.0', message }]
//   · 업무 검사: details.fields = ['country', …] (그 칸들 모두에 오류 문장)
//   · details.field = 'name'
// 경로 'tags.0'은 'tags.0'과 맨 앞 이름 'tags' 둘 다로 찾을 수 있다.
import { errors as E } from '../copy/errors';

export function fieldErrors(err: { message?: string; details?: unknown } | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!err) return out;
  const d = err.details as any;
  const fallback = err.message || E.validationFallback;
  const put = (path: string, message: string) => {
    if (!path) return;
    out[path] ??= message;
    out[path.split('.')[0]] ??= message;
  };
  if (Array.isArray(d)) for (const x of d) if (x && typeof x.path === 'string') put(x.path, String(x.message ?? fallback));
  if (d && !Array.isArray(d) && typeof d === 'object') {
    if (Array.isArray(d.fields)) for (const f of d.fields) if (typeof f === 'string') put(f, fallback);
    if (typeof d.field === 'string') put(d.field, fallback);
  }
  return out;
}
