import { ChatSalesAttributionService } from './chat-sales-attribution.service';
import { ChatAnalyticsController } from './chat-analytics.controller';
import { ChatAnalyticsV2Service } from './chat-analytics-v2.service';
describe('Legacy analytics cannot bypass scoped v2', () => {
  it.each(['getOverview', 'getChannelVolume', 'getStaffPerformance', 'getResponseTime'] as const)(
    'retires unscoped %s without querying data',
    async (method) => {
      const read = jest.fn().mockResolvedValue({ globalData: true });
      const old = {
        getOverview: read,
        getChannelVolume: read,
        getStaffPerformance: read,
        getAvgFirstResponseTime: read,
      } as unknown as ChatAnalyticsV2Service;
      const controller = new ChatAnalyticsController(old, {} as ChatSalesAttributionService);
      await expect(controller[method]()).rejects.toThrow('ใช้รายงาน v2');
      expect(read).not.toHaveBeenCalled();
    },
  );
});
