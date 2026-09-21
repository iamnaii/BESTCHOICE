import { Injectable } from '@nestjs/common';
import { Cron, Interval, ScheduleModule, SchedulerRegistry, Timeout } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { SchedulerOrchestrator } from '@nestjs/schedule/dist/scheduler.orchestrator';
import { suppressScheduledJobs, SuppressedSchedulerOrchestrator } from './support/scheduler';

describe('documents harness scheduler boundary', () => {
  async function observe(suppressed: boolean) {
    const calls = { cron: 0, interval: 0, timeout: 0 };
    @Injectable()
    class Probe {
      @Cron('* * * * * *', { name: 'proof-cron' })
      cron() {
        calls.cron++;
      }

      @Interval('proof-interval', 15)
      interval() {
        calls.interval++;
      }

      @Timeout('proof-timeout', 0)
      timeout() {
        calls.timeout++;
      }
    }
    let builder = Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [Probe],
    });
    if (suppressed) builder = suppressScheduledJobs(builder);
    const moduleRef = await builder.compile();
    const registry = moduleRef.get(SchedulerRegistry);
    const mounted = () => ({
      cron: registry.getCronJobs().size,
      interval: registry.getIntervals().length,
      timeout: registry.getTimeouts().length,
    });
    try {
      await moduleRef.init();
      const orchestrator = moduleRef.get(SchedulerOrchestrator);
      if (suppressed) {
        expect(orchestrator).toBeInstanceOf(SuppressedSchedulerOrchestrator);
        expect((orchestrator as SuppressedSchedulerOrchestrator).suppressedJobs.sort()).toEqual([
          'interval:proof-interval',
          'proof-cron',
          'timeout:proof-timeout',
        ]);
        expect(mounted()).toEqual({ cron: 0, interval: 0, timeout: 0 });
      } else {
        expect(mounted()).toEqual({ cron: 1, interval: 1, timeout: 1 });
      }
      await new Promise((resolve) => setTimeout(resolve, 1300));
      if (suppressed) expect(calls).toEqual({ cron: 0, interval: 0, timeout: 0 });
      else for (const count of Object.values(calls)) expect(count).toBeGreaterThan(0);
    } finally {
      await moduleRef.close();
    }
    const afterClose = { ...calls };
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toEqual(afterClose);
    expect(mounted()).toEqual({ cron: 0, interval: 0, timeout: 0 });
  }

  it('proves that real scheduled callbacks fire in the unmodified control', async () => {
    await observe(false);
  });

  it('discovers jobs but never mounts timers before bootstrap, and shuts down cleanly', async () => {
    await observe(true);
  });
});
