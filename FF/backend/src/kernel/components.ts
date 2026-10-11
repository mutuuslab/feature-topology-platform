// 42 컴포넌트 런타임 등록 — 각 컴포넌트 서비스에 @PlatformComponent('D01-01')를 붙이면
// GET /api/components가 manifest와 실제 등록 여부를 합쳐 보여 주고, conformance 테스트가 누락·미상 ID를 잡는다.
import { Injectable, SetMetadata } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { COMPONENTS, type ComponentEntry } from '@ff/contracts';

export const COMPONENT_KEY = 'ff:component';
export const PlatformComponent = (id: string) => SetMetadata(COMPONENT_KEY, id);

export interface ComponentStatusView extends ComponentEntry {
  /** 이 프로세스에 해당 컴포넌트 서비스가 등록되어 있는가 */
  registered: boolean;
  providers: string[];
}

@Injectable()
export class ComponentRegistry {
  constructor(private readonly discovery: DiscoveryService) {}

  /** 등록된 컴포넌트 ID → 제공 클래스 이름 */
  registered(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const w of this.discovery.getProviders()) {
      const cls = w.metatype as (Function & { name: string }) | undefined;
      if (!cls || typeof cls !== 'function') continue;
      const id = Reflect.getMetadata(COMPONENT_KEY, cls) as string | undefined;
      if (id) map.set(id, [...(map.get(id) ?? []), cls.name]);
    }
    return map;
  }

  view(): ComponentStatusView[] {
    const reg = this.registered();
    return COMPONENTS.map((c) => ({ ...c, registered: reg.has(c.id), providers: reg.get(c.id) ?? [] }));
  }

  /** manifest에 없는 ID로 등록된 서비스 (오타·폐기 ID) */
  unknownIds(): string[] {
    const known = new Set(COMPONENTS.map((c) => c.id));
    return [...this.registered().keys()].filter((id) => !known.has(id));
  }
}
