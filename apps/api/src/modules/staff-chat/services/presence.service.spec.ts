import { Test, TestingModule } from '@nestjs/testing';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  let service: PresenceService;

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [PresenceService],
    }).compile();
    service = mod.get(PresenceService);
  });

  describe('setOnline / isOnline', () => {
    it('marks a user online on first connect', () => {
      service.setOnline('u-1', 'sock-a');
      expect(service.isOnline('u-1')).toBe(true);
    });

    it('unknown user is offline', () => {
      expect(service.isOnline('unknown')).toBe(false);
    });

    it('tracks multiple tabs per user', () => {
      service.setOnline('u-1', 'sock-a');
      service.setOnline('u-1', 'sock-b');
      service.setOnline('u-1', 'sock-c');
      expect(service.isOnline('u-1')).toBe(true);
      expect(service.getOnlineCount()).toBe(1);
    });
  });

  describe('setOffline', () => {
    it('removes one tab but keeps user online if others remain', () => {
      service.setOnline('u-1', 'sock-a');
      service.setOnline('u-1', 'sock-b');
      service.setOffline('u-1', 'sock-a');
      expect(service.isOnline('u-1')).toBe(true);
    });

    it('removes user entirely when last tab disconnects', () => {
      service.setOnline('u-1', 'sock-a');
      service.setOffline('u-1', 'sock-a');
      expect(service.isOnline('u-1')).toBe(false);
      expect(service.getOnlineCount()).toBe(0);
    });

    it('is no-op for unknown user', () => {
      expect(() => service.setOffline('nowhere', 'sock-a')).not.toThrow();
    });

    it('is no-op for unknown socket on known user', () => {
      service.setOnline('u-1', 'sock-a');
      service.setOffline('u-1', 'sock-ghost');
      expect(service.isOnline('u-1')).toBe(true);
    });
  });

  describe('getOnlineStaffIds / getOnlineCount', () => {
    it('returns empty when no one online', () => {
      expect(service.getOnlineStaffIds()).toEqual([]);
      expect(service.getOnlineCount()).toBe(0);
    });

    it('counts unique users, not sockets', () => {
      service.setOnline('u-1', 'sock-a');
      service.setOnline('u-1', 'sock-b'); // same user, second tab
      service.setOnline('u-2', 'sock-c');
      expect(service.getOnlineCount()).toBe(2);
      expect(service.getOnlineStaffIds().sort()).toEqual(['u-1', 'u-2']);
    });
  });
});
