import { Module } from '@nestjs/common';
import { GRAPH_PORT } from './domain/graph.port';
import { InMemoryGraphRepository } from './domain/in-memory-graph.repository';
import { EnginesService } from './engines/engines.service';
import { ConsistencyService } from './rules/consistency.service';
import { ReadinessService } from './gates/readiness.service';
import { FeatureController } from './api/feature.controller';

// GraphPort 기본 구현 = InMemory. PostgreSQL+AGE 어댑터로 교체하려면 useClass 만 변경.
@Module({
  controllers: [FeatureController],
  providers: [
    { provide: GRAPH_PORT, useClass: InMemoryGraphRepository },
    EnginesService,
    ConsistencyService,
    ReadinessService,
  ],
})
export class AppModule {}
