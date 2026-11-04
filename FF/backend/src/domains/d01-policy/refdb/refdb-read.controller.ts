// Feature DB 읽기 API(D01-01 확장) — 경로는 contracts ROUTES(listRefs·refDetail·refTaxonomy·refSources·refQuality·refReleases·refSubfunctions·exportRefdb).
// 읽기는 모든 역할(헤더 없으면 감사 조회자). 역할은 응답 범위만 정한다 — 벤치마크 필드는 산정 역할만(read-view.ts).
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentActor, type Actor } from '../../../kernel/actor';
import { RefdbReadService } from './refdb-read.service';

@Controller('api/refdb')
export class RefdbReadController {
  constructor(private readonly read: RefdbReadService) {}

  @Get('refs')
  list(@CurrentActor() actor: Actor, @Query('q') q?: unknown, @Query('domain') domain?: unknown, @Query('component') component?: unknown, @Query('status') status?: unknown, @Query('offset') offset?: unknown, @Query('limit') limit?: unknown) {
    return this.read.list({ q, domain, component, status, offset, limit }, actor.role);
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
