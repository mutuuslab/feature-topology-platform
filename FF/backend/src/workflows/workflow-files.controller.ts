import { Controller, Get, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { HUMAN_ROLES } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../kernel/actor';
import { DomainError } from '../kernel/errors';
import { WorkflowExecutionService } from './workflow-execution.service';
import { NoReplayStore } from '../kernel/idempotency.interceptor';

@Controller('api/workflow/cases/:id')
export class WorkflowFilesController {
  constructor(private readonly service: WorkflowExecutionService) {}
  // JSON replay hashing cannot see a raw stream. BinaryStore verifies the actual repeated bytes and current domain authorization.
  @Post('activities/:activityId/uploads') @Roles(...HUMAN_ROLES) @AuditAction('WORKFLOW_FILE_UPLOAD') @NoReplayStore()
  upload(@CurrentActor() actor: Actor,@Param('id') id:string,@Param('activityId') activity:string,@Req() req:Request) {
    if(req.headers['content-type']?.split(';')[0]!=='application/octet-stream')throw new DomainError('VALIDATION','파일은 application/octet-stream 본문으로 보내세요.');
    const expected=Number(String(req.headers['if-match']??'').replace(/^"|"$/g,''));
    let name:string;
    try{name=decodeURIComponent(String(req.headers['x-file-name']??''));}catch{throw new DomainError('VALIDATION','파일 이름 형식을 확인하세요.');}
    return this.service.uploadFile(actor,id,activity,expected,{name,mediaType:String(req.headers['x-file-type']??'application/octet-stream'),requestKey:String(req.headers['idempotency-key']??'')},req);
  }
  @Get('files/:fileId')
  download(@CurrentActor() actor:Actor,@Param('id') id:string,@Param('fileId') fileId:string,@Res({passthrough:true}) res:Response) {
    const {row,stream}=this.service.downloadFile(actor,id,fileId);
    res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Length',row.bytes);
    res.setHeader('Content-Disposition',`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/'/g,'%27')}`);
    res.setHeader('X-Content-SHA256',row.sha256);res.setHeader('Cache-Control','private, no-store');
    return new StreamableFile(stream);
  }
}
