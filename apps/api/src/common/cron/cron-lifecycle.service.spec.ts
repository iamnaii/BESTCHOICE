import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Cron, Interval, ScheduleModule, SchedulerRegistry, Timeout } from '@nestjs/schedule';
import { scheduleModuleOptions } from './cron-enabled';
import { CronLifecycleService } from './cron-lifecycle.service';

const events: string[] = [];
let release: (() => void) | undefined;

@Injectable()
class SlowCron {
  runs = 0;

  @Cron('0 0 1 1 *', { name: 'slow-cron' })
  async tick(): Promise<void> {
    this.runs++;
    events.push('cron:start');
    await new Promise<void>((resolve) => (release = resolve));
    events.push('cron:end');
  }

  @Interval('test-interval', 60_000)
  interval(): void {}

  @Timeout('test-timeout', 60_000)
  timeout(): void {}
}

/** stand-in for PrismaService: disconnects in onApplicationShutdown */
@Injectable()
class FakeDb implements OnApplicationShutdown {
  onApplicationShutdown(): void {
    events.push('db:disconnect');
  }
}

async function build(env: string | undefined) {
  const prev = process.env.CRON_ENABLED;
  if (env === undefined) delete process.env.CRON_ENABLED;
  else process.env.CRON_ENABLED = env;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRootAsync({ useFactory: () => scheduleModuleOptions() })],
      providers: [SlowCron, FakeDb, CronLifecycleService],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    app.get(CronLifecycleService).instrumentJobs();
    return app;
  } finally {
    if (prev === undefined) delete process.env.CRON_ENABLED;
    else process.env.CRON_ENABLED = prev;
  }
}

describe('CronLifecycleService', () => {
  beforeEach(() => {
    events.length = 0;
    release = undefined;
    delete process.env.CRON_SHUTDOWN_GRACE_MS;
  });

  it('registers cron/interval/timeout when CRON_ENABLED is unset (default = previous behaviour)', async () => {
    const app = await build(undefined);
    const registry = app.get(SchedulerRegistry);
    expect([...registry.getCronJobs().keys()]).toEqual(['slow-cron']);
    expect(registry.getIntervals()).toEqual(['test-interval']);
    expect(registry.getTimeouts()).toEqual(['test-timeout']);
    await app.close();
  });

  it('registers nothing when CRON_ENABLED=false', async () => {
    const app = await build('false');
    const registry = app.get(SchedulerRegistry);
    expect(registry.getCronJobs().size).toBe(0);
    expect(registry.getIntervals()).toEqual([]);
    expect(registry.getTimeouts()).toEqual([]);
    await app.close();
  });

  it('fails boot on an invalid CRON_ENABLED value', async () => {
    await expect(build('flase')).rejects.toThrow(/Invalid CRON_ENABLED/);
  });

  it('instrumentJobs is idempotent', async () => {
    const app = await build('true');
    const svc = app.get(CronLifecycleService);
    expect(svc.instrumentJobs()).toBe(1);
    expect(svc.instrumentJobs()).toBe(1);
    const job = app.get(SchedulerRegistry).getCronJob('slow-cron');
    void job.fireOnTick();
    await Promise.resolve();
    expect(app.get(SlowCron).runs).toBe(1); // wrapped once, not twice
    release?.();
    await app.close();
  });

  it('stops jobs and waits for in-flight runs BEFORE the DB disconnects', async () => {
    const app = await build('true');
    const svc = app.get(CronLifecycleService);
    const job = app.get(SchedulerRegistry).getCronJob('slow-cron');

    void job.fireOnTick();
    await new Promise((r) => setImmediate(r));
    expect(svc.inFlightCount).toBe(1);

    const closing = app.close();
    await new Promise((r) => setImmediate(r));
    expect(job.isActive).toBe(false);
    expect(events).toEqual(['cron:start']); // DB still connected while cron runs

    release?.();
    await closing;
    expect(events).toEqual(['cron:start', 'cron:end', 'db:disconnect']);
  });

  it('skips ticks that fire after shutdown started', async () => {
    const app = await build('true');
    const svc = app.get(CronLifecycleService);
    const job = app.get(SchedulerRegistry).getCronJob('slow-cron');
    await svc.beforeApplicationShutdown('SIGTERM');
    expect(svc.isShuttingDown).toBe(true);
    await job.fireOnTick();
    expect(app.get(SlowCron).runs).toBe(0);
    await app.close();
  });

  it('gives up waiting after CRON_SHUTDOWN_GRACE_MS', async () => {
    process.env.CRON_SHUTDOWN_GRACE_MS = '20';
    const app = await build('true');
    const job = app.get(SchedulerRegistry).getCronJob('slow-cron');
    void job.fireOnTick();
    await new Promise((r) => setImmediate(r));
    await app.close(); // must not hang even though the run never finishes
    expect(events).toEqual(['cron:start', 'db:disconnect']);
    release?.();
  });
});
