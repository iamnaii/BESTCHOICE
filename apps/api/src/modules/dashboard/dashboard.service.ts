import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { StructuredLoggerService } from '../../common/logger';
import { DashboardOverviewService } from './services/dashboard-overview.service';
import { DashboardCollectionsService } from './services/dashboard-collections.service';
import { DashboardOpsService } from './services/dashboard-ops.service';

@Injectable()
export class DashboardService {
  private readonly structuredLogger = new StructuredLoggerService(DashboardService.name);
  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private overview: DashboardOverviewService,
    private collections: DashboardCollectionsService,
    private ops: DashboardOpsService,
  ) {}

  /**
   * Cache helper: get from cache or compute and store.
   *
   * Cache is a nice-to-have here, never the source of truth. If Redis is
   * offline or wedged, compute directly and skip the write — the dashboard
   * should always render rather than 500. Log the failure once per call so
   * observability still sees the degraded state.
   */
  private async cached<T>(key: string, ttl: number, compute: () => Promise<T>): Promise<T> {
    let cached: T | null | undefined;
    try {
      cached = await this.cache.get<T>(key);
    } catch (err) {
      this.structuredLogger.warn('dashboard.cache.get_failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (cached !== undefined && cached !== null) return cached;

    const start = Date.now();
    const result = await compute();

    try {
      await this.cache.set(key, result, ttl);
    } catch (err) {
      this.structuredLogger.warn('dashboard.cache.set_failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.structuredLogger.debug('dashboard.cache.miss', { key, computeMs: Date.now() - start });
    return result;
  }

  /**
   * Get main dashboard KPIs
   */
  async getKPIs(branchId?: string) {
    const cacheKey = `dashboard:kpis:${branchId || 'all'}`;
    return this.cached(cacheKey, 60, () => this.overview.computeKPIs(branchId)); // 60s cache
  }

  /**
   * Monthly trend: new contracts vs payments received (last 12 months)
   */
  async getMonthlyTrend(branchId?: string) {
    return this.overview.getMonthlyTrend(branchId);
  }

  /**
   * Top 10 overdue customers
   */
  async getTopOverdue(branchId?: string) {
    return this.collections.getTopOverdue(branchId);
  }

  /**
   * Contract status distribution
   */
  async getStatusDistribution(branchId?: string) {
    return this.overview.getStatusDistribution(branchId);
  }

  /**
   * Branch comparison summary
   */
  async getBranchComparison() {
    return this.overview.getBranchComparison();
  }

  /**
   * Monthly revenue summary for current month
   */
  async getMonthlyRevenue(branchId?: string) {
    return this.overview.getMonthlyRevenue(branchId);
  }

  /**
   * Aging summary: overdue payments grouped by age buckets
   */
  async getAgingSummary(branchId?: string) {
    return this.collections.getAgingSummary(branchId);
  }

  /**
   * SLA metrics: contract approval time + pending approvals > 20 min
   */
  async getSlaMetrics(branchId?: string) {
    return this.ops.getSlaMetrics(branchId);
  }

  /**
   * Smart Dashboard Alerts: KPI alerts across overdue, stock, contracts, payments
   */
  async getAlerts(branchId?: string) {
    const cacheKey = `dashboard:alerts:${branchId || 'all'}`;
    return this.cached(cacheKey, 30, () => this.ops.computeAlerts(branchId)); // 30s cache
  }

  /**
   * Staff performance: sales metrics (current month) + recent activity (last 7 days)
   */
  async getStaffPerformance(branchId?: string) {
    return this.ops.getStaffPerformance(branchId);
  }

  /**
   * Collection Dashboard metrics:
   * - Aging buckets (6 buckets)
   * - Collection rate (current & last month MoM)
   * - Collected this month (total + count)
   * - Top 10 delinquent customers
   * - Channel effectiveness (dunning actions → payment within 7 days)
   */
  async getCollectionMetrics(branchId?: string) {
    const cacheKey = `dashboard:collection-metrics:${branchId || 'all'}`;
    return this.cached(cacheKey, 60, () => this.collections.computeCollectionMetrics(branchId)); // 60s cache
  }

  async getWatchList(branchId?: string) {
    const cacheKey = `dashboard:watch-list:${branchId || 'all'}`;
    return this.cached(cacheKey, 120, () => this.collections.computeWatchList(branchId)); // 2min cache
  }
}
