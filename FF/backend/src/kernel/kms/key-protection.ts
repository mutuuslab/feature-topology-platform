// 저장 비밀 봉투 암호화(출시 준비 RD-SEC-06) — 개인키·차량 루트 비밀을 DB에 평문으로 두지 않는다.
//  · 레코드마다 새 데이터 키(DEK, 32바이트)로 AES-256-GCM 암호화하고, DEK는 키 암호화 키(KEK)로 감싼다(봉투 암호화).
//  · AAD = "<표>.<열>|<레코드 ID>" — 암호문을 다른 행으로 옮겨 붙이면 복호화가 실패한다.
//  · KEK는 DB 밖에서 온다: FF_KEK(base64 32바이트) 또는 FF_KEK_FILE(파일 경로). 운영 모드는 둘 중 하나가 필수(runtime-config).
//  · KEK 교체: 새 키를 FF_KEK, 옛 키를 FF_KEK_PREVIOUS(또는 _FILE)로 주고 시작하면 DEK만 새 KEK로 다시 감싼다(암호문은 그대로).
//  · KekProvider 인터페이스 뒤에 숨긴다 — 고객 KMS/HSM(AWS KMS·Azure Key Vault·PKCS#11)은 wrap/unwrap만 구현하면 바꿔 끼울 수 있다.
// 한계: 지금 구현은 프로세스 메모리에 KEK를 올리는 소프트웨어 KEK다(HSM 안에서만 키를 쓰는 것이 아니다). 서명 연산 때 개인키는 잠시 메모리에 풀린다.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

type Env = Record<string, string | undefined>;

/** 키 암호화 키 제공자 — 로컬 KEK, 나중에 고객 KMS/HSM 어댑터 */
export interface KekProvider {
  /** 감싼 DEK에 같이 저장하는 KEK 식별자 — 교체·잘못된 키 판별에 쓴다(비밀 아님) */
  readonly id: string;
  wrap(dek: Buffer): Buffer;
  unwrap(wrapped: Buffer): Buffer;
}

const KEK_ID_INFO = 'ff-kek-id-v1';
const DEK_AAD = Buffer.from('ff-dek-wrap-v1');

/** 로컬 KEK — AES-256-GCM 키 감싸기(무작위 12바이트 IV, 16바이트 태그) */
export class LocalKek implements KekProvider {
  readonly id: string;
  constructor(
    private readonly key: Buffer,
    label = 'local',
  ) {
    if (key.length !== 32) throw new Error('KEK는 32바이트여야 합니다');
    this.id = `${label}-${createHash('sha256').update(Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), Buffer.from(KEK_ID_INFO), 32))).digest('hex').slice(0, 12)}`;
  }

  wrap(dek: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(DEK_AAD);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Buffer.concat([iv, ct, c.getAuthTag()]);
  }

  unwrap(wrapped: Buffer): Buffer {
    const d = createDecipheriv('aes-256-gcm', this.key, wrapped.subarray(0, 12));
    d.setAAD(DEK_AAD);
    d.setAuthTag(wrapped.subarray(wrapped.length - 16));
    return Buffer.concat([d.update(wrapped.subarray(12, wrapped.length - 16)), d.final()]);
  }
}

/** 키 보호 오류 — 메시지에 비밀값은 넣지 않는다 */
export class KeyProtectionError extends Error {
  constructor(
    message: string,
    readonly code: 'KEK_MISMATCH' | 'DECRYPT_FAILED' | 'NOT_SEALED' | 'MALFORMED',
  ) {
    super(message);
    this.name = 'KeyProtectionError';
  }
}

const PREFIX = 'ffenc1';
const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

export const isSealed = (v: string) => v.startsWith(`${PREFIX}.`);

/**
 * 봉인 형식: ffenc1.<kekId>.<감싼 DEK>.<IV>.<암호문>.<태그> (base64url)
 * current로 봉인하고, previous의 KEK로 감싼 레코드는 열 수 있다(교체 중).
 */
export class SecretVault {
  private readonly byId: Map<string, KekProvider>;
  constructor(
    readonly current: KekProvider,
    readonly previous: KekProvider[] = [],
    /** 개발·데모용 고정 KEK인가 — 운영 모드는 이 값을 허용하지 않는다(runtime-config) */
    readonly insecureDev = false,
  ) {
    this.byId = new Map([...previous, current].map((k) => [k.id, k]));
  }

  seal(plain: string, aad: string): string {
    const dek = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', dek, iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    const out = [PREFIX, this.current.id, b64(this.current.wrap(dek)), b64(iv), b64(ct), b64(c.getAuthTag())].join('.');
    dek.fill(0);
    return out;
  }

  private parts(sealed: string) {
    if (!isSealed(sealed)) throw new KeyProtectionError('저장된 비밀이 봉인(암호화)되어 있지 않습니다 — 시작 때 변환이 끝나지 않았습니다', 'NOT_SEALED');
    const p = sealed.split('.');
    if (p.length !== 6) throw new KeyProtectionError('봉인된 비밀의 형식이 맞지 않습니다', 'MALFORMED');
    const [, kekId, wrapped, iv, ct, tag] = p;
    return { kekId, wrapped: unb64(wrapped), iv: unb64(iv), ct: unb64(ct), tag: unb64(tag) };
  }

  private kek(kekId: string): KekProvider {
    const k = this.byId.get(kekId);
    if (!k)
      throw new KeyProtectionError(
        `저장된 비밀이 다른 키 암호화 키(KEK ${kekId})로 감싸져 있습니다 — 지금 KEK는 ${this.current.id}입니다. FF_KEK(또는 FF_KEK_FILE)가 이 설치의 키인지 확인하고, 키를 교체하는 중이면 이전 키를 FF_KEK_PREVIOUS(또는 FF_KEK_PREVIOUS_FILE)로 함께 주세요.`,
        'KEK_MISMATCH',
      );
    return k;
  }

  private dek(kekId: string, wrapped: Buffer): Buffer {
    try {
      return this.kek(kekId).unwrap(wrapped);
    } catch (e) {
      if (e instanceof KeyProtectionError) throw e;
      throw new KeyProtectionError(`데이터 키를 풀 수 없습니다(KEK ${kekId}) — 키가 틀렸거나 레코드가 변조되었습니다`, 'DECRYPT_FAILED');
    }
  }

  open(sealed: string, aad: string): string {
    const p = this.parts(sealed);
    const dek = this.dek(p.kekId, p.wrapped);
    try {
      const d = createDecipheriv('aes-256-gcm', dek, p.iv);
      d.setAAD(Buffer.from(aad));
      d.setAuthTag(p.tag);
      return Buffer.concat([d.update(p.ct), d.final()]).toString('utf8');
    } catch {
      throw new KeyProtectionError(`봉인된 비밀을 열 수 없습니다(${aad.split('|')[0]}) — 레코드가 변조되었거나 다른 행에서 옮겨 왔습니다`, 'DECRYPT_FAILED');
    } finally {
      dek.fill(0);
    }
  }

  /** 지금 KEK로 감쌌는가 */
  isCurrent(sealed: string): boolean {
    return isSealed(sealed) && this.parts(sealed).kekId === this.current.id;
  }

  /** 교체 — DEK만 지금 KEK로 다시 감싼다(암호문·IV·태그는 그대로) */
  rewrap(sealed: string): string {
    const p = this.parts(sealed);
    if (p.kekId === this.current.id) return sealed;
    const dek = this.dek(p.kekId, p.wrapped);
    const out = [PREFIX, this.current.id, b64(this.current.wrap(dek)), b64(p.iv), b64(p.ct), b64(p.tag)].join('.');
    dek.fill(0);
    return out;
  }
}

// ── 설정 ─────────────────────────────────────────────

/** 개발·데모(운영 모드가 아닐 때) KEK가 없으면 쓰는 고정 키 — 공개된 값이라 보호가 아니다. 운영 모드는 거부한다 */
const DEV_KEK = createHash('sha256').update('ff-dev-kek|not-a-secret|demo-only').digest();

function readKeyMaterial(env: Env, name: 'FF_KEK' | 'FF_KEK_PREVIOUS'): { key: Buffer | null; problem: string | null } {
  const inline = env[name]?.trim();
  const file = env[`${name}_FILE`]?.trim();
  if (inline && file) return { key: null, problem: `${name}와 ${name}_FILE을 함께 줄 수 없습니다 — 하나만 쓰세요` };
  let text: string | undefined = inline;
  if (file) {
    if (!existsSync(file)) return { key: null, problem: `${name}_FILE이 가리키는 파일이 없습니다` };
    try {
      const raw = readFileSync(file);
      if (raw.length === 32) return { key: raw, problem: null };
      text = raw.toString('utf8').trim();
    } catch {
      return { key: null, problem: `${name}_FILE을 읽을 수 없습니다(권한 확인)` };
    }
  }
  if (!text) return { key: null, problem: null };
  const key = Buffer.from(text, 'base64');
  if (key.length !== 32 || !/^[A-Za-z0-9+/]{43}=?$/.test(text))
    return { key: null, problem: `${name}는 base64로 쓴 32바이트 키여야 합니다(예: openssl rand -base64 32)` };
  return { key, problem: null };
}

/** KEK 설정 문제 — 운영 모드는 KEK 필수. 값은 메시지에 넣지 않는다 */
export function kekConfigProblems(env: Env, production: boolean): string[] {
  const out: string[] = [];
  const cur = readKeyMaterial(env, 'FF_KEK');
  const prev = readKeyMaterial(env, 'FF_KEK_PREVIOUS');
  if (cur.problem) out.push(cur.problem);
  if (prev.problem) out.push(prev.problem);
  if (production && !cur.key && !cur.problem) out.push('FF_KEK(또는 FF_KEK_FILE)가 없습니다 — 개인키·차량 루트 비밀을 감싸는 키 암호화 키를 DB 밖에서 주세요(예: openssl rand -base64 32)');
  if (cur.key && prev.key && cur.key.equals(prev.key)) out.push('FF_KEK_PREVIOUS가 FF_KEK와 같습니다 — 교체할 때는 새 키를 FF_KEK에, 옛 키를 FF_KEK_PREVIOUS에 주세요');
  return out;
}

/** 환경에서 금고를 만든다 — 설정이 틀리면 던진다(시작 검사가 먼저 걸러 주지만 시험·도구 경로도 같은 규칙) */
export function vaultFromEnv(env: Env = process.env): SecretVault {
  const production = env.FF_ENV === 'production';
  const problems = kekConfigProblems(env, production);
  if (problems.length) throw new Error(`키 암호화 키(KEK) 설정 오류:\n  - ${problems.join('\n  - ')}`);
  const cur = readKeyMaterial(env, 'FF_KEK').key;
  const prev = readKeyMaterial(env, 'FF_KEK_PREVIOUS').key;
  const previous = prev ? [new LocalKek(prev)] : [];
  // 개발·데모 DB 파일에 FF_KEK를 새로 주면 고정 개발 키로 감싼 레코드를 넘겨받는다(운영 모드는 제외 — 운영 DB에 개발 키 레코드가 있으면 거부)
  if (cur) return new SecretVault(new LocalKek(cur), production ? previous : [...previous, new LocalKek(DEV_KEK, 'dev')]);
  return new SecretVault(new LocalKek(DEV_KEK, 'dev'), previous, true);
}
