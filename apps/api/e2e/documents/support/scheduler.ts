import { SchedulerRegistry } from '@nestjs/schedule';
import { SchedulerOrchestrator } from '@nestjs/schedule/dist/scheduler.orchestrator';
import { TestingModuleBuilder } from '@nestjs/testing';

/** Keep Nest discovery and shutdown, but never mount wall-clock business timers. */
export class SuppressedSchedulerOrchestrator extends SchedulerOrchestrator {
  readonly suppressedJobs: string[] = [];

  override onApplicationBootstrap(): void {
    // Stopping jobs after app.listen() leaves a window in which callbacks can fire.
    // Deliberately do not call the production bootstrap that mounts the timers.
  }

  override addCron(...args: Parameters<SchedulerOrchestrator['addCron']>): void {
    super.addCron(...args);
    this.suppressedJobs.push(args[1].name ?? '(unnamed cron)');
  }

  override addInterval(...args: Parameters<SchedulerOrchestrator['addInterval']>): void {
    super.addInterval(...args);
    this.suppressedJobs.push(`interval:${args[2] ?? '(unnamed)'}`);
  }

  override addTimeout(...args: Parameters<SchedulerOrchestrator['addTimeout']>): void {
    super.addTimeout(...args);
    this.suppressedJobs.push(`timeout:${args[2] ?? '(unnamed)'}`);
  }
}

export function suppressScheduledJobs(builder: TestingModuleBuilder): TestingModuleBuilder {
  return builder.overrideProvider(SchedulerOrchestrator).useFactory({
    factory: (registry: SchedulerRegistry) => new SuppressedSchedulerOrchestrator(registry),
    inject: [SchedulerRegistry],
  });
}
