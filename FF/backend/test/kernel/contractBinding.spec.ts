// A workspace test must exercise the same contract instances as its transformed Nest endpoints.
import { expect, it } from 'vitest';
import { CreatePolicyBody, UpdatePolicyBody } from '@ff/contracts';
import { PolicyController } from '../../src/domains/d01-policy/policy-store/policy.controller';

it('binds create and patch request pipes to this worktree contract',()=>{
  for(const [method,schema] of [['create',CreatePolicyBody],['update',UpdatePolicyBody]] as const){
    const metadata=Reflect.getMetadata('__routeArguments__',PolicyController,method);
    const pipes=Object.values(metadata??{}).flatMap((value:any)=>value.pipes??[]);
    expect(pipes).toHaveLength(1);
    expect((pipes[0] as any).schema).toBe(schema);
  }
});
