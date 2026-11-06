// Feature DB 읽기 API(D01-01 확장) — 경로는 contracts ROUTES(listRefs·refDetail·refTaxonomy·refSources·refQuality·refReleases·refSubfunctions·exportRefdb).
// 읽기는 모든 역할(헤더 없으면 감사 조회자). 역할은 응답 범위만 정한다 — 벤치마크 필드는 산정 역할만(read-view.ts).
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentActor, type Actor } from '../../../kernel/actor';
import { RefdbReadService } from './refdb-read.service';

@Controller('api/refdb')
export class RefdbReadController {
  constructor(private readonly read: RefdbReadService) {}

  @Get('refs')
  // 다중 선택(쉼표 목록, REF_MULTI_QUERY)도 이름을 하나씩 받는다 — 하네스(refdb-harness.spec)가 처리기 질의 이름 = routes.ts query를 맞춰 본다
  list(@CurrentActor() actor: Actor, @Query('q') q?: unknown, @Query('domain') domain?: unknown, @Query('component') component?: unknown, @Query('status') status?: unknown, @Query('offset') offset?: unknown, @Query('limit') limit?: unknown, @Query('source') source?: unknown,
    @Query('statuses') statuses?: unknown, @Query('asils') asils?: unknown, @Query('lifecycles') lifecycles?: unknown, @Query('swStacks') swStacks?: unknown, @Query('tshirts') tshirts?: unknown, @Query('vehicleTypes') vehicleTypes?: unknown, @Query('regions') regions?: unknown) {
    const multi: Record<string, unknown> = { statuses, asils, lifecycles, swStacks, tshirts, vehicleTypes, regions };
    return this.read.list({ q, domain, component, status, offset, limit, source, multi }, actor.role);
  }

  @Get('refs/:refId')
  detail(@CurrentActor() actor: Actor, @Param('refId') refId: string) {
    return this.read.detail(refId, actor.role);
  }

  @Get('taxonomy')
  taxonomy() {
    return this.read.taxonomy();
  }

  @Get('sources')
  sources() {
    return this.read.sources();
  }

  @Get('quality')
  quality() {
    return this.read.quality();
  }

  @Get('releases')
  releases() {
    return this.read.releases();
  }

  @Get('subfunctions')
  subfunctions(@Query('component') component?: unknown) {
    return this.read.subfunctions(component);
  }

  @Get('export')
  export(@CurrentActor() actor: Actor, @Query('format') format?: unknown, @Query('release') release?: unknown) {
    return this.read.export(format, release, actor.role);
  }
}
