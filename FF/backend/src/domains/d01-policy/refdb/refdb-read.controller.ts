// Feature DB 읽기 API(D01-01 확장) — 경로는 contracts ROUTES(listRefs·refDetail·refTaxonomy·refSources·refQuality·refReleases·refSubfunctions·exportRefdb).
// 읽기는 모든 역할(헤더 없으면 감사 조회자). 역할은 응답 범위만 정한다 — 벤치마크 필드는 산정 역할만(read-view.ts).
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentActor, type Actor } from '../../../kernel/actor';
import { REF_MULTI_QUERY, RefdbReadService } from './refdb-read.service';

@Controller('api/refdb')
export class RefdbReadController {
  constructor(private readonly read: RefdbReadService) {}

  @Get('refs')
  list(@CurrentActor() actor: Actor, @Query() all: Record<string, unknown>) {
    const { q, domain, component, status, offset, limit, source } = all;
    // 다중 선택(쉼표 목록)은 정해진 이름만 넘긴다
    const multi = Object.fromEntries(REF_MULTI_QUERY.map((k) => [k, all[k]]));
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
