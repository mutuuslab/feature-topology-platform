// IF-08 연락처 원본 조회 — 미설정/실제 원격 응답만 제공한다. Bootstrap 때 외부 요청을 보내지 않는다.
import { Controller, Get, Header, Injectable, Module, Query } from '@nestjs/common';
import { z } from 'zod';
import { HUMAN_ROLES, type SupplierDirectoryEntry } from '@ff/contracts';
import { Roles } from '../../../kernel/actor';
import { DomainError } from '../../../kernel/errors';
import { PlatformComponent } from '../../../kernel/components';

const DirectoryContact = z.object({ contactId: z.string().trim().min(2).max(80), name: z.string().trim().min(1).max(120), duty: z.enum(['QUALITY', 'TECHNICAL', 'SECURITY', 'FIELD']), email: z.string().trim().email().max(254), phone: z.string().trim().min(2).max(60), urgent: z.boolean() }).strict();
const DirectoryBody = z.object({ items: z.array(z.object({ supplier: z.string().trim().min(2).max(60), displayName: z.string().trim().min(1).max(120), contacts: z.array(DirectoryContact).max(50).refine((a) => new Set(a.map((c) => c.contactId)).size === a.length, '담당자 ID 중복') }).strict()).max(500) }).strict().refine((a) => new Set(a.items.map((s) => s.supplier)).size === a.items.length, '공급사 중복');
export interface SupplierDirectoryResult {
  mode: 'UNCONFIGURED' | 'LIVE' | 'UNAVAILABLE';
  source: 'UNCONFIRMED' | 'REMOTE';
  items: SupplierDirectoryEntry[];
  reason: string | null;
}

/** 연락처는 서버가 설정한 원본에서만 받는다. 미확보 원본이나 가상 인물로 운영 연락처를 채우지 않는다. */
@Injectable()
@PlatformComponent('D05-01')
export class SupplierDirectoryService {
  async read(): Promise<SupplierDirectoryResult> {
    const mode = process.env.FF_SUPPLIER_DIRECTORY_MODE ?? 'off';
    if (mode === 'off') return { mode: 'UNCONFIGURED', source: 'UNCONFIRMED', items: [], reason: '협력사 연락처 원본이 연결되지 않았습니다.' };
    const invalid = () => new DomainError('PRECONDITION_FAILED', '협력사 디렉터리의 서버 설정을 확인하세요. 실제 HTTPS 원본을 설정해야 합니다.', { reason: 'CONFIGURATION' });
    if (mode !== 'live') throw invalid();
    const configured = process.env.FF_SUPPLIER_DIRECTORY_URL ?? '';
    let url: URL;
    try { url = new URL(configured); } catch { throw invalid(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw invalid();
    const rawTimeout = process.env.FF_SUPPLIER_DIRECTORY_TIMEOUT_MS ?? '5000';
    const timeoutMs = Number(rawTimeout);
    if (!/^\d+$/.test(rawTimeout) || !Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000) throw invalid();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new DomainError('PRECONDITION_FAILED', '협력사 연락처 조회 시간이 초과되었습니다. 원본 연결을 확인하고 다시 읽으세요.', { reason: 'TIMEOUT' }));
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.load(configured, controller.signal), deadline]);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('PRECONDITION_FAILED', '협력사 연락처 원본을 확인하지 못했습니다. 원본 연결과 인증을 확인하고 다시 읽으세요.', { reason: 'REMOTE_UNAVAILABLE' });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  }
  private async load(url: string, signal: AbortSignal): Promise<SupplierDirectoryResult> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = process.env.FF_SUPPLIER_DIRECTORY_TOKEN;
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(url, { headers, signal, redirect: 'error' });
    if (!response.ok) throw new DomainError('PRECONDITION_FAILED', '협력사 디렉터리가 정상 응답하지 않았습니다. 원본 상태를 확인하세요.', { reason: 'UPSTREAM_STATUS' });
    const invalid = () => new DomainError('PRECONDITION_FAILED', '협력사 연락처 원본의 응답 형식을 확인하지 못했습니다.', { reason: 'INVALID_RESPONSE' });
    if (!/^(application\/json|application\/[a-z0-9.!#$&^_+-]+\+json)(\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')) throw invalid();
    const reader = response.body?.getReader();
    if (!reader) throw invalid();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1_000_000) { await reader.cancel(); throw invalid(); }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid(); }
    const parsed = DirectoryBody.safeParse(value);
    if (!parsed.success) throw invalid();
    return { mode: 'LIVE', source: 'REMOTE', items: parsed.data.items, reason: null };
  }
}

@Controller('api')
export class SupplierDirectoryController {
  constructor(private readonly directory: SupplierDirectoryService) {}
  @Get('supplier-directory')
  @Header('Cache-Control', 'no-store')
  @Roles(...HUMAN_ROLES)
  read(@Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new DomainError('VALIDATION', '디렉터리 조회 주소와 인증은 서버 설정으로만 지정합니다. 조회 매개변수는 사용할 수 없습니다.');
    return this.directory.read();
  }
}

@Module({ providers: [SupplierDirectoryService], controllers: [SupplierDirectoryController], exports: [SupplierDirectoryService] })
export class SupplierDirectoryModule {}
