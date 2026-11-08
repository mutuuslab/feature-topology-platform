import { Body, Controller, Get, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request,Response } from 'express';
import { SoftwarePackageBody,SoftwarePackageDecisionBody,SoftwareDownloadCheckBody } from '@ff/contracts';
import { CurrentActor,Roles,VehicleEndpoint,type Actor } from '../kernel/actor';
import { NoReplayStore } from '../kernel/idempotency.interceptor';
import { DomainError } from '../kernel/errors';
import { ZodPipe } from '../kernel/zod.pipe';
import { SoftwareDeliveryService } from './software-delivery.service';

function fileResponse(result:Awaited<ReturnType<SoftwareDeliveryService['download']>>,res:Response){
  const {row,stream}=result;res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Length',row.bytes);
  res.setHeader('Content-Disposition',`attachment; filename="software"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/'/g,'%27')}`);
  res.setHeader('X-Content-SHA256',row.sha256);res.setHeader('X-Download-Id',result.downloadId);res.setHeader('Cache-Control','private, no-store');
  return new StreamableFile(stream);
}
function query(vin:string,flagKey:string){const result=SoftwareDownloadCheckBody.safeParse({vin,flagKey});if(!result.success)throw new DomainError('VALIDATION','차량 VIN과 Flag 키가 필요합니다.');return result.data;}
@Controller('api/software')
export class SoftwareDeliveryController {
  constructor(private readonly s:SoftwareDeliveryService){}
  @Get('packages') list(){return this.s.list();}
  @Get('packages/:id') get(@Param('id') id:string){return this.s.get(id);}
  @Post('uploads') @Roles('IMPLEMENTER','RELEASE_MANAGER') @NoReplayStore()
  upload(@CurrentActor() actor:Actor,@Req() req:Request){
    if(req.headers['content-type']?.split(';')[0]!=='application/octet-stream')throw new DomainError('VALIDATION','application/octet-stream 본문이 필요합니다.');
    let name:string;try{name=decodeURIComponent(String(req.headers['x-file-name']??''));}catch{throw new DomainError('VALIDATION','파일 이름 인코딩을 확인하세요.');}
    return this.s.upload(actor,{name,mediaType:String(req.headers['x-file-type']??'application/octet-stream'),requestKey:String(req.headers['idempotency-key']??'')},req);
  }
  @Post('packages') @Roles('IMPLEMENTER','RELEASE_MANAGER') create(@CurrentActor() actor:Actor,@Body(new ZodPipe(SoftwarePackageBody)) body:SoftwarePackageBody){return this.s.create(actor,body);}
  @Post('packages/:id/review') @Roles('RELEASE_MANAGER') review(@CurrentActor() actor:Actor,@Param('id') id:string,@Body(new ZodPipe(SoftwarePackageDecisionBody)) body:SoftwarePackageDecisionBody){return this.s.review(actor,id,body);}
  @Post('packages/:id/check') @Roles('IMPLEMENTER','RELEASE_MANAGER','OPERATOR','AUDITOR') @NoReplayStore()
  check(@Param('id') id:string,@Body(new ZodPipe(SoftwareDownloadCheckBody)) body:SoftwareDownloadCheckBody){return this.s.check(id,body.vin,body.flagKey);}
  @Get('packages/:id/download') @Roles('IMPLEMENTER','RELEASE_MANAGER','OPERATOR')
  async download(@CurrentActor() actor:Actor,@Param('id') id:string,@Query('vin') vin:string,@Query('flagKey') flagKey:string,@Res({passthrough:true}) res:Response){
    const body=query(vin,flagKey);return fileResponse(await this.s.download(actor,id,body.vin,body.flagKey),res);
  }
  @Get('packages/:id/history') history(@Param('id') id:string){return this.s.history(id);}
}
@Controller('vehicle/v1/:vin/software') @VehicleEndpoint()
export class VehicleSoftwareController {
  constructor(private readonly s:SoftwareDeliveryService){}
  @Get(':id/manifest') @Roles('VEHICLE')
  manifest(@CurrentActor() actor:Actor,@Param('id') id:string,@Param('vin') vin:string,@Query('flagKey') flagKey:string){const body=query(vin,flagKey);return this.s.vehicleManifest(actor,id,body.vin,body.flagKey);}
  @Get(':id/download') @Roles('VEHICLE')
  async download(@CurrentActor() actor:Actor,@Param('id') id:string,@Param('vin') vin:string,@Query('flagKey') flagKey:string,@Res({passthrough:true}) res:Response){
    const body=query(vin,flagKey);return fileResponse(await this.s.download(actor,id,body.vin,body.flagKey),res);
  }
}
