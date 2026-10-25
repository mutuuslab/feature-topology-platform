// 커널 모듈 — 모든 도메인 모듈이 공유하는 Db·감사·이벤트·역할 가드·멱등성·오류 봉투.
import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { RolesGuard } from './actor';
import { AuditService } from './audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { Clock } from './clock';
import { ComponentRegistry } from './components';
import { DB, migrate, type Db } from './db';
import { applySeed, openDb } from './db-open';
import { DomainErrorFilter } from './errors';
import { EventService } from './event.service';
import { HousekeepingService } from './housekeeping.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { InstanceLease, leaseAtBoot, releaseBootLease } from './instance-lease';
import { KernelController } from './kernel.controller';
import { LakeErasureClient } from './lake-erasure';
import { PrivacyController, PrivacyService } from './privacy.service';
import { SecretVault, vaultFromEnv } from './kms/key-protection';
import { sealSecrets } from './kms/secret-columns';
import { MIGRATIONS } from './migrations';
import { Metrics } from './observability';
import { Scheduler } from './scheduler';
import { DbSharedState, SHARED_STATE } from './shared-state';
import { VehicleAuthService } from './vehicle-auth';

@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [KernelController, AuthController, PrivacyController],
  providers: [
    {
      provide: DB,
      // FF_DB 기본 = 메모리 DB(데모·테스트). 파일 경로를 주면 재시작 후에도 유지된다. 운영 모드는 파일 필수·시드 기본 none(runtime-config).
      // 마이그레이션·시드는 공급자 생성 시점에 끝낸다 — 어떤 모듈의 onModuleInit이 먼저 돌아도 표가 있다.
      // 저장 비밀(개인키·차량 루트)은 시작 때 봉인·KEK 교체·확인까지 끝낸다(RD-SEC-06) — 잘못된 KEK면 여기서 멈춘다
      useFactory: (vault: SecretVault) => {
        const db = openDb(); // FF_DB_URL=postgres://… 이면 PostgreSQL(미리보기, 20-92)
        try {
          // 단일 인스턴스 임대(RD-OPS-14) — 살아 있는 다른 인스턴스가 이 DB를 쓰면 여기서 부팅을 멈춘다
          leaseAtBoot(db);
          migrate(db, MIGRATIONS);
          leaseAtBoot(db);
        } catch (e) {
          releaseBootLease(db);
          db.close();
          throw e;
        }
        try {
          applySeed(db);
          sealSecrets(db, vault);
        } catch (e) {
          releaseBootLease(db);
          db.close(); // 시작을 멈출 때 파일 잠금을 남기지 않는다
          throw e;
        }
        return db;
      },
      inject: [SecretVault],
    },
    // 키 암호화 키(KEK) — FF_KEK·FF_KEK_FILE(운영 필수). 고객 KMS/HSM 어댑터는 이 공급자를 바꿔 끼운다
    { provide: SecretVault, useFactory: () => vaultFromEnv() },
    // 공유 상태(멱등 예약·요청 빈도 창) — 같은 DB를 쓰는 인스턴스가 함께 본다(RD-OPS-14 1단계)
    { provide: SHARED_STATE, useFactory: (db: Db) => new DbSharedState(db), inject: [DB] },
    Clock,
    Metrics,
    Scheduler,
    InstanceLease,
    AuditService,
    AuthService,
    EventService,
    HousekeepingService,
    LakeErasureClient,
    PrivacyService,
    ComponentRegistry,
    VehicleAuthService,
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
  exports: [DB, SHARED_STATE, SecretVault, Clock, Metrics, Scheduler, AuditService, AuthService, EventService, ComponentRegistry, VehicleAuthService, PrivacyService],
})
export class KernelModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  onApplicationShutdown() {
    this.db.close();
  }
}
