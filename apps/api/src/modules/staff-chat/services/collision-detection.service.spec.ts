import { Test, TestingModule } from '@nestjs/testing';
import { CollisionDetectionService } from './collision-detection.service';

describe('CollisionDetectionService', () => {
  let service: CollisionDetectionService;

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [CollisionDetectionService],
    }).compile();
    service = mod.get(CollisionDetectionService);
  });

  describe('addViewer / getViewers', () => {
    it('tracks a single viewer with name + since timestamp', () => {
      service.addViewer('s-1', 'u-1', 'Staff A');
      const viewers = service.getViewers('s-1');
      expect(viewers).toHaveLength(1);
      expect(viewers[0]).toMatchObject({ userId: 'u-1', userName: 'Staff A' });
      expect(viewers[0].since).toBeInstanceOf(Date);
    });

    it('returns empty array for unknown session', () => {
      expect(service.getViewers('nowhere')).toEqual([]);
    });

    it('tracks multiple viewers on same session', () => {
      service.addViewer('s-1', 'u-1', 'Staff A');
      service.addViewer('s-1', 'u-2', 'Staff B');
      expect(service.getViewers('s-1')).toHaveLength(2);
    });

    it('idempotent — re-adding same user does not duplicate or refresh since', async () => {
      service.addViewer('s-1', 'u-1', 'Staff A');
      const first = service.getViewers('s-1')[0].since;
      await new Promise((r) => setTimeout(r, 10));
      service.addViewer('s-1', 'u-1', 'Staff A (rename ignored)');
      const second = service.getViewers('s-1')[0];
      expect(second.since).toEqual(first);
      expect(service.getViewers('s-1')).toHaveLength(1);
    });
  });

  describe('removeViewer', () => {
    it('removes a single viewer', () => {
      service.addViewer('s-1', 'u-1', 'A');
      service.addViewer('s-1', 'u-2', 'B');
      service.removeViewer('s-1', 'u-1');
      expect(service.getViewers('s-1').map((v) => v.userId)).toEqual(['u-2']);
    });

    it('cleans up empty session map', () => {
      service.addViewer('s-1', 'u-1', 'A');
      service.removeViewer('s-1', 'u-1');
      expect(service.getViewers('s-1')).toEqual([]);
    });

    it('is a no-op for unknown session', () => {
      expect(() => service.removeViewer('nowhere', 'u-1')).not.toThrow();
    });
  });

  describe('removeViewerFromAll', () => {
    it('removes user from every session', () => {
      service.addViewer('s-1', 'u-1', 'A');
      service.addViewer('s-2', 'u-1', 'A');
      service.addViewer('s-2', 'u-2', 'B');
      service.removeViewerFromAll('u-1');
      expect(service.getViewers('s-1')).toEqual([]);
      expect(service.getViewers('s-2').map((v) => v.userId)).toEqual(['u-2']);
    });
  });

  describe('isCollision', () => {
    it('false when no one is viewing', () => {
      expect(service.isCollision('s-1', 'u-1')).toBe(false);
    });

    it('false when only the excluded user is viewing', () => {
      service.addViewer('s-1', 'u-1', 'A');
      expect(service.isCollision('s-1', 'u-1')).toBe(false);
    });

    it('true when another user is viewing', () => {
      service.addViewer('s-1', 'u-1', 'A');
      service.addViewer('s-1', 'u-2', 'B');
      expect(service.isCollision('s-1', 'u-1')).toBe(true);
    });

    it('true when OTHER is viewing but excludedUser is not in session', () => {
      service.addViewer('s-1', 'u-2', 'B');
      expect(service.isCollision('s-1', 'u-1')).toBe(true);
    });
  });
});
