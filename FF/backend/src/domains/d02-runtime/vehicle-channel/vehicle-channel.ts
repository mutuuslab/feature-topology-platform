// 차량 전달 채널(출시 준비 RD-OPS-04, IF-07) — 서명된 게시본·차단 봉투를 차량에 보내는 길을 어댑터 뒤로 숨긴다.
//  · sim  — 내부 차량 시뮬레이터(데모·시험 기본). 운영 모드에서는 쓸 수 없다(runtime-config가 거부).
//  · pull — 차량 당겨받기 HTTPS(운영 기본): 차량이 서명한 요청으로 전달함을 받아 가고 서명한 확인을 보낸다(pull-channel.service.ts).
//  · 고객 텔레매틱스 게이트웨이 — VehicleDeliveryAdapter를 구현해 이 레지스트리에 register하고 FF_VEHICLE_CHANNEL=<이름>으로 고른다.
// GLEO 실연동 차량(GLEO_MODE=ws)은 GLEO 어댑터가 따로 맡는다(영상 키트).
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Publication } from '@ff/contracts';
import { vehicleChannelOf } from '../../../kernel/vehicle-auth-config';

export interface VehicleDeliveryAdapter {
  /** FF_VEHICLE_CHANNEL로 고르는 이름 */
  readonly id: string;
  /** 화면·상태 점검에 보이는 설명 */
  readonly description: string;
  /**
   * 게시본을 차량들에 보낸다 — 게시본을 만든 트랜잭션 안에서 불린다(전달함 기록도 같이 커밋).
   * 돌려주는 ackOnly는 회신 의무가 없는(받았다는 확인만 하는) 차량 — 회신 집계 분모에서 뺀다.
   */
  deliver(pub: Publication, vins: string[]): { ackOnly: string[] };
  /** 상태 점검 — 대기 중 전달 수 등(선택) */
  status?(): Record<string, unknown>;
}

@Injectable()
export class VehicleChannelRegistry implements OnModuleInit {
  private readonly adapters = new Map<string, VehicleDeliveryAdapter>();
  readonly active = vehicleChannelOf();

  register(a: VehicleDeliveryAdapter) {
    if (this.adapters.has(a.id)) throw new Error(`차량 전달 채널 ${a.id}가 이미 등록되어 있습니다`);
    this.adapters.set(a.id, a);
  }

  /**
   * 시작 때 — 고른 채널의 어댑터가 없으면 멈춘다(설정 오타로 차량에 아무것도 가지 않는 일을 막는다).
   * 어댑터는 생성자에서 register한다 — Nest는 모든 공급자를 만든 뒤 초기화 훅을 부르므로 여기서는 모두 등록돼 있다(부팅 동기화 배포보다 먼저).
   */
  onModuleInit() {
    if (!this.adapters.has(this.active)) throw new Error(`FF_VEHICLE_CHANNEL=${this.active} — 등록된 차량 전달 어댑터가 아닙니다(등록됨: ${[...this.adapters.keys()].join(', ')})`);
  }

  current(): VehicleDeliveryAdapter {
    const a = this.adapters.get(this.active);
    if (!a) throw new Error(`차량 전달 어댑터 ${this.active}가 등록되지 않았습니다`);
    return a;
  }

  view() {
    return {
      active: this.active,
      adapters: [...this.adapters.values()].map((a) => ({ id: a.id, description: a.description, active: a.id === this.active, ...(a.status ? { status: a.status() } : {}) })),
    };
  }
}
