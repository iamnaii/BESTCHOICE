import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics registry (T7-C12).
 *
 * Exposes:
 *   - Node defaults (event loop lag, memory, GC, etc.)
 *   - HTTP request duration histogram
 *   - Business counters: payments recorded, refunds requested,
 *     slip auto-approved, dunning escalated, AI calls
 *
 * Instrumented sparingly — new counters should have a named SLO attached or
 * they become noise. See docs/guides/SLO-RUNBOOK.md for the target SLOs.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry: Registry;

  readonly httpDuration: Histogram<string>;
  readonly paymentsRecorded: Counter<string>;
  readonly refundsRequested: Counter<string>;
  readonly slipAutoApproved: Counter<string>;
  readonly dunningEscalated: Counter<string>;
  readonly aiCalls: Counter<string>;
  readonly webhookAnomalies: Counter<string>;

  constructor() {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ app: 'bestchoice-api' });
    collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.paymentsRecorded = new Counter({
      name: 'payments_recorded_total',
      help: 'Count of payments recorded (successful and idempotent re-records)',
      labelNames: ['method', 'status'],
      registers: [this.registry],
    });

    this.refundsRequested = new Counter({
      name: 'refunds_requested_total',
      help: 'Count of refund requests created',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.slipAutoApproved = new Counter({
      name: 'slip_auto_approved_total',
      help: 'Slip evidences auto-approved based on OCR confidence (T4-C9)',
      registers: [this.registry],
    });

    this.dunningEscalated = new Counter({
      name: 'dunning_escalated_total',
      help: 'Dunning stage escalations',
      labelNames: ['stage', 'source'], // source: 'auto' | 'manual_approval'
      registers: [this.registry],
    });

    this.aiCalls = new Counter({
      name: 'ai_calls_total',
      help: 'Claude API calls by service',
      labelNames: ['service', 'status'],
      registers: [this.registry],
    });

    this.webhookAnomalies = new Counter({
      name: 'webhook_anomalies_total',
      help: 'Webhook signature anomalies captured by WebhookAnomalyService',
      labelNames: ['provider', 'reason'],
      registers: [this.registry],
    });
  }

  async collect(): Promise<string> {
    return this.registry.metrics();
  }
}
