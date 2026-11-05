import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { canonicalJson } from '@ff/contracts';
import type { Subscription } from 'rxjs';
import { EventService } from '../../../kernel/event.service';
import { PolicyRepo } from '../policy-repos';
import { UnleashSyncService } from './unleash-sync.service';
import { DB, type Db } from '../../../kernel/db';
import { SecureDeployService } from '../../d06-qsec/secure-deploy/secure-deploy.service';
import { PublicationRepo } from '../../d06-qsec/secure-deploy/publication.repo';
import { TopologyRepo } from '../repos';

/** FF changes publish to the replica; manual upstream edits are not silently imported or periodically overwritten. */
@Injectable()
export class UnleashAutoSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private subscription?: Subscription;
  private pending = Promise.resolve();
  private running = false;
  private readonly dirty = new Map<string, { sign: boolean; correlationId: string }>();
  private readonly log = new Logger(UnleashAutoSyncService.name);
  private closed = false;
  constructor(private readonly events: EventService, private readonly policies: PolicyRepo, private readonly sync: UnleashSyncService, private readonly secureDeploy: SecureDeployService, @Inject(DB) private readonly db: Db, private readonly publications: PublicationRepo, private readonly topology: TopologyRepo) {}
  async onApplicationBootstrap() {
    if (process.env.UNLEASH_MODE !== 'live' || process.env.UNLEASH_AUTO_SYNC === '0') return;
    this.subscription = this.events.stream(['policy.deployed', 'rollout.staged', 'publication.signed']).subscribe((e) => {
      if (e.type === 'publication.signed' && (e.payload as { kind?: string }).kind !== 'POLICY') return;
      const p = e.type === 'publication.signed' ? this.publications.get(e.aggregate)?.payload.policy : this.policies.get(e.aggregate);
      if (p) this.enqueue(p.flagKey, e.type === 'rollout.staged', e.correlationId ?? 'unleash-event');
      // A new target flag also changes existing REQUIRES definitions. Refresh those
      // dependents without rescanning unrelated policies for every signed publication.
      if (p && e.type === 'policy.deployed') for (const edge of this.topology.incoming(p.featureId)) {
        if (edge.type !== 'REQUIRES') continue;
        for (const dependent of this.policies.forFeature(edge.sourceFeatureId, edge.sourceVersion)) {
          if (dependent.status === 'DEPLOYED') this.enqueue(dependent.flagKey, false, e.correlationId ?? 'unleash-dependency');
        }
      }
    });
    // Bootstrap and live events share one writer. Events arriving while an Admin call awaits
    // coalesce by flag rather than appending repeated full-policy snapshots to a long backlog.
    for (const p of this.policies.all()) if (p.status === 'DEPLOYED') this.enqueue(p.flagKey, false, 'unleash-bootstrap');
    await this.whenIdle();
  }

  private enqueue(flagKey: string, sign: boolean, correlationId: string) {
    if (this.closed) return;
    this.dirty.set(flagKey, { sign: sign || (this.dirty.get(flagKey)?.sign ?? false), correlationId });
    this.start();
  }

  private start() {
    if (this.running) return;
    this.running = true;
    // Defer the first write so all bootstrap flags enter the same queue before draining.
    this.pending = Promise.resolve().then(() => this.drain()).finally(() => {
      this.running = false;
      // An event can arrive in the microtask between drain completion and this callback.
      if (!this.closed && this.dirty.size) this.start();
    });
  }

  private async drain() {
    while (!this.closed && this.dirty.size) {
      const [flagKey, work] = this.dirty.entries().next().value!;
      this.dirty.delete(flagKey);
      // A policy may have been replaced/retired while the previous flag was awaiting I/O.
      // Resolve the current deployed policy now, never use an event's captured old policy.
      const p = this.policies.deployed(flagKey);
      if (!p) continue;
      try {
        if (work.sign) this.db.tx(() => this.secureDeploy.publishPolicy(p, { id: 'system:unleash-replication', role: 'SYSTEM', correlationId: work.correlationId }));
        // sync records FAILED/BLOCKED in IF-04/audit. Idle does not mean a healthy replica.
        const result = await this.sync.sync({ id: 'system:unleash-replication', role: 'SYSTEM', correlationId: `unleash:${p.policyId}:${p.revision}` }, p.policyId);
        const latest = this.policies.deployed(flagKey);
        if (latest && canonicalJson(latest) !== canonicalJson(p)) this.enqueue(flagKey, false, work.correlationId);
        // Our rollout signing emits publication.signed synchronously. A successful write
        // already covers that exact policy; retain a newer rollout's request to sign again.
        else if (result.outcome === 'SYNCED' && !this.dirty.get(flagKey)?.sign) this.dirty.delete(flagKey);
      } catch (err) {
        // An unexpected failure on one flag must not discard the rest of the queue.
        // Do not log adapter messages, which may contain connection credentials.
        this.log.error(`Unleash replication failed for ${p.policyId} (${err instanceof Error ? err.name : 'Error'})`);
      }
    }
  }

  /** Current FF work only; callers must still inspect sync/view drift before admitting vehicles. */
  async whenIdle() { while (this.running) await this.pending; }

  async onModuleDestroy() { this.closed = true; this.subscription?.unsubscribe(); this.dirty.clear(); await this.pending; }
}
