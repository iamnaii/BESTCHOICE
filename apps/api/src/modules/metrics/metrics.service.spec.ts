import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();
    service = mod.get(MetricsService);
  });

  it('exposes a prometheus registry with default metrics', async () => {
    const output = await service.collect();
    expect(output).toContain('process_cpu_user_seconds_total');
    expect(output).toContain('nodejs_heap_size_used_bytes');
  });

  it('exposes custom BESTCHOICE counters', async () => {
    service.paymentsRecorded.inc({ method: 'CASH', status: 'success' });
    service.refundsRequested.inc({ status: 'REQUESTED' });
    service.slipAutoApproved.inc();
    const output = await service.collect();
    expect(output).toContain('payments_recorded_total');
    expect(output).toContain('refunds_requested_total');
    expect(output).toContain('slip_auto_approved_total');
  });

  it('sets the app default label', async () => {
    const output = await service.collect();
    expect(output).toContain('app="bestchoice-api"');
  });

  it('http_request_duration_seconds uses histogram buckets 0.05..10', async () => {
    service.httpDuration.observe({ method: 'GET', route: '/api/health', status_code: '200' }, 0.02);
    const output = await service.collect();
    expect(output).toContain('http_request_duration_seconds_bucket');
    expect(output).toContain('le="0.05"');
    expect(output).toContain('le="10"');
  });
});
