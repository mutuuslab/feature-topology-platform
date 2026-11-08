import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateWorkflowCaseBody, HUMAN_ROLES, WorkflowActivityReviewBody, WorkflowActivitySubmitBody, WorkflowArtifactBody, WorkflowHandoffBody, WorkflowHandoffReceiveBody, WorkflowRoleGrantBody } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../kernel/actor';
import { ZodPipe } from '../kernel/zod.pipe';
import { WorkflowExecutionService } from './workflow-execution.service';

@Controller('api/workflow')
export class WorkflowExecutionController {
  constructor(private readonly service:WorkflowExecutionService) {}
  @Get('identity') identity(@CurrentActor() actor:Actor) { return this.service.identity(actor); }
  @Get('accounts') @Roles('SYSTEM_ADMIN') accounts(@CurrentActor() actor:Actor) { return this.service.assignableAccounts(actor); }
  @Get('roles') grants(@CurrentActor() actor:Actor) { return {items:this.service.grants(actor)}; }
  @Post('roles') @Roles('SYSTEM_ADMIN') @AuditAction('WORKFLOW_ROLE_GRANT') grant(@CurrentActor() actor:Actor,@Body(new ZodPipe(WorkflowRoleGrantBody)) body:WorkflowRoleGrantBody) { return {items:this.service.setGrant(actor,body)}; }
  @Get('cases') list(@CurrentActor() actor:Actor) { return this.service.list(actor); }
  @Get('cases/:id') detail(@CurrentActor() actor:Actor,@Param('id') id:string) { return this.service.detail(actor,id); }
  @Get('cases/:id/sources') sources(@CurrentActor() actor:Actor,@Param('id') id:string) { return this.service.sources(actor,id); }
  @Post('cases') @Roles(...HUMAN_ROLES) @AuditAction('WORKFLOW_CASE_CREATE') create(@CurrentActor() actor:Actor,@Body(new ZodPipe(CreateWorkflowCaseBody)) body:CreateWorkflowCaseBody) { return this.service.create(actor,body); }
  @Post('cases/:id/artifacts') @Roles(...HUMAN_ROLES) @AuditAction('WORKFLOW_ARTIFACT_CREATE') artifact(@CurrentActor() actor:Actor,@Param('id') id:string,@Body(new ZodPipe(WorkflowArtifactBody)) body:WorkflowArtifactBody) { return this.service.artifact(actor,id,body); }
  @Post('cases/:id/activities/:activityId/submit') @Roles(...HUMAN_ROLES) @AuditAction('WORKFLOW_ACTIVITY_SUBMIT') submit(@CurrentActor() actor:Actor,@Param('id') id:string,@Param('activityId') activityId:string,@Body(new ZodPipe(WorkflowActivitySubmitBody)) body:WorkflowActivitySubmitBody) { return this.service.submit(actor,id,activityId,body); }
  @Post('cases/:id/activities/:activityId/review') @Roles(...HUMAN_ROLES) @AuditAction('WORKFLOW_ACTIVITY_REVIEW') review(@CurrentActor() actor:Actor,@Param('id') id:string,@Param('activityId') activityId:string,@Body(new ZodPipe(WorkflowActivityReviewBody)) body:WorkflowActivityReviewBody) { return this.service.review(actor,id,activityId,body); }
  @Post('cases/:id/handoffs') @Roles(...HUMAN_ROLES) @AuditAction('WORKFLOW_HANDOFF_OFFER') offer(@CurrentActor() actor:Actor,@Param('id') id:string,@Body(new ZodPipe(WorkflowHandoffBody)) body:WorkflowHandoffBody) { return this.service.offer(actor,id,body); }
  @Post('cases/:id/handoffs/:handoffId/receive') @Roles(...HUMAN_ROLES) @AuditAction('WORKFLOW_HANDOFF_RECEIVE') receive(@CurrentActor() actor:Actor,@Param('id') id:string,@Param('handoffId') handoffId:string,@Body(new ZodPipe(WorkflowHandoffReceiveBody)) body:WorkflowHandoffReceiveBody) { return this.service.receive(actor,id,handoffId,body); }
}
