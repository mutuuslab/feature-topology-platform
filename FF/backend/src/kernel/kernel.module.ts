// 커널 모듈 — 모든 도메인 모듈이 공유하는 Db·감사·이벤트·역할 가드·멱등성·오류 봉투.
import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { RolesGuard } from './actor';
import { AuditService } from './audit.service';
import { Clock } from './clock';
import { ComponentRegistry } from './components';
import { DB, SqliteDb, migrate, type Db } from './db';
import { DomainErrorFilter } from './errors';
import { EventService } from './event.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { KernelController } from './kernel.controller';
import { MIGRATIONS } from './migrations';
import { Metrics } from './observability';
import { seedOf } from './runtime-config';
import { Scheduler } from './scheduler';
import { loadFixtures, seedDataset, seedDemo } from './seed';

@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [KernelController],
  providers: [
    {
      provide: DB,
      // FF_DB 기본 = 메모리 DB(데모·테스트). 파일 경로를 주면 재시작 후에도 유지된다. 운영 모드는 파일 필수·시드 기본 none(runtime-config).
      // 마이그레이션·시드는 공급자 생성 시점에 끝낸다 — 어떤 모듈의 onModuleInit이 먼저 돌아도 표가 있다.
      useFactory: () => {
        const db = new SqliteDb(process.env.FF_DB ?? ':memory:');
        migrate(db, MIGRATIONS);
        const seed = seedOf();
        if (seed !== 'none') {
          seedDataset(db, loadFixtures(), seed);
          seedDemo(db);
        }
        return db;
      },
    },
    Clock,
    Metrics,
    Scheduler,
    AuditService,
    EventService,
    ComponentRegistry,
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
  exports: [DB, Clock, Metrics, Scheduler, AuditService, EventService, ComponentRegistry],
})
export class KernelModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  onApplicationShutdown() {
    this.db.close();
  }
}
