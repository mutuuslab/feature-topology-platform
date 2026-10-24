// 단일 인스턴스 임대(출시 준비 RD-OPS-14, docs/20-architecture/20-92 §3).
// SSE 이벤트 버스·예약 작업(Scheduler)·출처별 요청 제한은 아직 프로세스 메모리다 — 같은 DB에 인스턴스를 둘 띄우면
// 한쪽이 쓴 변경을 다른 쪽 화면이 실시간으로 못 받고, 예약 작업이 두 번 돈다. 그래서 v1은 한 DB에 한 인스턴스만 돈다:
//   · 부팅할 때 instance_lease 행을 잡는다(원자적 삽입). 살아 있는 다른 주인이 있으면 부팅을 멈춘다(두 번째 인스턴스 거부)
//   · 주기적으로 기한을 늘리고(비동기 Db — 2단계 인터페이스의 첫 사용처), 종료할 때 놓는다
//   · 주인이 죽으면(종료 처리 없이) 기한(FF_INSTANCE_LEASE_SEC, 기본 20초)이 지난 뒤 새 인스턴스가 잡는다.
//     같은 호스트에서 주인 프로세스가 이미 없으면(재시작한 컨테이너·서비스) 기다리지 않고 바로 잡는다
//   · 부팅 중(마이그레이션·시드·봉인)에는 갱신 타이머가 돌 수 없으니 잡을 때 기한을 BOOT_GRACE_MS로 길게 두고, 부팅이 끝나면 줄인다
// :memory: DB는 다른 프로세스가 볼 수 없으니 잡지 않는다. FF_INSTANCE_LOCK=off는 다중 인스턴스 검증용(운영 모드 거부).
import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { hostname } from 'node:os';
import { asyncDbOf, type AsyncDb } from './async-db';
import { DB, type Db } from './db';
import { dbKindOf } from './db-open';
import { newHolder } from './shared-state';

type Env = Record<string, string | undefined>;
const NAME = 'app';

export const leaseTtlMs = (env: Env = process.env) => Math.max(5, Number(env.FF_INSTANCE_LEASE_SEC) || 20) * 1000;
export const leaseEnabled = (env: Env = process.env) => (env.FF_INSTANCE_LOCK ?? '').trim().toLowerCase() !== 'off' && dbKindOf(env) !== 'sqlite-memory';

/** 부팅 중 기한 — 부팅이 이보다 길면 다른 인스턴스가 잡을 수 있다(그 전에 부팅 끝 갱신) */
export const BOOT_GRACE_MS = 120_000;

export class InstanceLeaseHeld extends Error {}

/** 이 프로세스에서 지금 임대를 쥔 주인들(한 프로세스에 앱이 둘인 시험 포함) */
const liveHolders = new Set<string>();

/** 주인이 이 호스트의 이미 끝난 프로세스인가 — 같은 PID인데 이 프로세스의 주인이 아니면 재시작 전의 나다 */
function deadOnThisHost(holder: string): boolean {
  if (liveHolders.has(holder)) return false;
  const parts = holder.split(':');
  if (parts.length < 3) return false;
  const pid = Number(parts[parts.length - 2]);
  const host = parts.slice(0, -2).join(':');
  if (host !== hostname() || !Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/** 임대 잡기 — 살아 있는 다른 주인이 있으면 InstanceLeaseHeld. 동기(부팅 전에 끝낸다) */
export function acquireLease(db: Db, holder: string, ttlMs: number, now = Date.now()): void {
  db.run('DELETE FROM instance_lease WHERE name = ? AND expires_at <= ?', NAME, now);
  const stale = db.get<{ holder: string }>('SELECT holder FROM instance_lease WHERE name = ?', NAME);
  if (stale && stale.holder !== holder && deadOnThisHost(stale.holder)) db.run('DELETE FROM instance_lease WHERE name = ? AND holder = ?', NAME, stale.holder);
  const iso = new Date(now).toISOString();
  const ins = db.run('INSERT OR IGNORE INTO instance_lease (name, holder, acquired_at, renewed_at, expires_at) VALUES (?, ?, ?, ?, ?)', NAME, holder, iso, iso, now + ttlMs);
  if (ins.changes === 1) return;
  const cur = db.get<{ holder: string; renewed_at: string; expires_at: number }>('SELECT holder, renewed_at, expires_at FROM instance_lease WHERE name = ?', NAME);
  if (!cur) return acquireLease(db, holder, ttlMs, now);
  throw new InstanceLeaseHeld(
    `다른 인스턴스(${cur.holder})가 이 DB를 쓰고 있습니다 — v1은 한 DB에 인스턴스 하나만 실행합니다(RD-OPS-14). ` +
      `앞 인스턴스를 멈추거나, 비정상 종료였다면 ${Math.ceil((Number(cur.expires_at) - now) / 1000)}초 뒤 다시 시작하세요(마지막 갱신 ${cur.renewed_at}).`,
  );
}

const bootHolders = new WeakMap<Db, string>();

/**
 * 부팅 때 DB를 연 곳(커널 DB 공급자)에서 부른다 — 마이그레이션 전후 두 번. 표가 아직 없으면(첫 설치·075 전) 마이그레이션 뒤에 잡는다.
 * 마이그레이션 전에 잡으면 앞 인스턴스가 도는 동안 새 판 마이그레이션이 같은 DB에 적용되는 일을 막는다.
 */
export function leaseAtBoot(db: Db, env: Env = process.env): void {
  if (!leaseEnabled(env) || bootHolders.has(db)) return;
  const holder = newHolder();
  try {
    acquireLease(db, holder, Math.max(BOOT_GRACE_MS, leaseTtlMs(env)));
  } catch (e) {
    if (e instanceof InstanceLeaseHeld) throw e;
    return; // 표가 아직 없다 — 마이그레이션 뒤 두 번째 호출에서
  }
  bootHolders.set(db, holder);
  liveHolders.add(holder);
}

/** 부팅이 실패했을 때(DB 공급자 안) — 잡은 임대를 놓는다 */
export function releaseBootLease(db: Db): void {
  const holder = bootHolders.get(db);
  if (!holder) return;
  bootHolders.delete(db);
  liveHolders.delete(holder);
  try {
    db.run('DELETE FROM instance_lease WHERE name = ? AND holder = ?', NAME, holder);
  } catch {
    /* 기한이 지나면 풀린다 */
  }
}

@Injectable()
export class InstanceLease implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger('InstanceLease');
  readonly holder: string | null;
  readonly enabled: boolean;
  private readonly ttl = leaseTtlMs();
  private timer: NodeJS.Timeout | null = null;
  private async: AsyncDb | null = null;
  private renewing: Promise<unknown> = Promise.resolve();
  /** 마지막 갱신 결과 — 상태 점검에 쓴다 */
  lost = false;

  constructor(@Inject(DB) private readonly db: Db) {
    // 임대는 DB 공급자가 마이그레이션 전후에 이미 잡았다(leaseAtBoot) — 여기서는 갱신·반납만
    this.holder = bootHolders.get(db) ?? null;
    this.enabled = this.holder !== null;
  }

  /** 부팅 끝 — 부팅 중 긴 기한을 보통 기한으로 줄이고 갱신을 시작한다 */
  onApplicationBootstrap() {
    if (!this.enabled) return;
    const now = Date.now();
    if (this.db.run('UPDATE instance_lease SET renewed_at = ?, expires_at = ? WHERE name = ? AND holder = ?', new Date(now).toISOString(), now + this.ttl, NAME, this.holder).changes !== 1) {
      this.lost = true;
      this.log.error('부팅 중 단일 인스턴스 임대를 잃었습니다(부팅이 너무 길었다) — 다른 인스턴스가 같은 DB를 잡았을 수 있습니다(RD-OPS-14)');
    }
    this.async = asyncDbOf(this.db, dbKindOf() === 'sqlite-file' ? process.env.FF_DB : undefined);
    this.timer = setInterval(() => (this.renewing = this.renew()), Math.max(1000, Math.floor(this.ttl / 3)));
    this.timer.unref?.();
  }

  /** 기한 늘리기 — 내 행이 아니면(기한이 지나 남이 잡았다) 잃은 것으로 표시하고 알린다 */
  async renew(now = Date.now()) {
    if (!this.async) return;
    try {
      const r = await this.async.run('UPDATE instance_lease SET renewed_at = ?, expires_at = ? WHERE name = ? AND holder = ?', new Date(now).toISOString(), now + this.ttl, NAME, this.holder);
      if (r.changes !== 1 && !this.lost) this.log.error('단일 인스턴스 임대를 잃었습니다 — 다른 인스턴스가 같은 DB를 잡았을 수 있습니다(RD-OPS-14)');
      this.lost = r.changes !== 1;
    } catch (e) {
      this.log.warn(`임대 갱신 실패: ${(e as Error).message}`);
    }
  }

  async beforeApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.renewing.catch(() => undefined);
    if (this.enabled) {
      try {
        this.db.run('DELETE FROM instance_lease WHERE name = ? AND holder = ?', NAME, this.holder);
        liveHolders.delete(this.holder!);
      } catch {
        /* 이미 닫힌 DB — 기한이 지나면 풀린다 */
      }
    }
    await this.async?.close().catch(() => undefined);
    this.async = null;
  }
}
