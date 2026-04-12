import { Injectable, Logger } from '@nestjs/common';

/**
 * CollisionDetectionService — tracks which staff members are viewing each chat session.
 *
 * Uses an in-memory map to detect when multiple staff are looking at the same session,
 * preventing duplicate replies and wasted effort.
 */
@Injectable()
export class CollisionDetectionService {
  private readonly logger = new Logger(CollisionDetectionService.name);

  // sessionId → Map<userId, { userName, since }>
  private viewerMap = new Map<string, Map<string, { userName: string; since: Date }>>();

  addViewer(sessionId: string, userId: string, userName: string): void {
    if (!this.viewerMap.has(sessionId)) {
      this.viewerMap.set(sessionId, new Map());
    }
    const sessionViewers = this.viewerMap.get(sessionId)!;
    if (!sessionViewers.has(userId)) {
      sessionViewers.set(userId, { userName, since: new Date() });
      this.logger.debug(`[Collision] ${userName} (${userId}) now viewing session ${sessionId}`);
    }
  }

  removeViewer(sessionId: string, userId: string): void {
    const sessionViewers = this.viewerMap.get(sessionId);
    if (!sessionViewers) return;

    sessionViewers.delete(userId);
    if (sessionViewers.size === 0) {
      this.viewerMap.delete(sessionId);
    }
    this.logger.debug(`[Collision] ${userId} left session ${sessionId}`);
  }

  /** Remove a user from ALL sessions (e.g. on disconnect) */
  removeViewerFromAll(userId: string): void {
    for (const [sessionId, viewers] of this.viewerMap.entries()) {
      viewers.delete(userId);
      if (viewers.size === 0) {
        this.viewerMap.delete(sessionId);
      }
    }
  }

  getViewers(sessionId: string): Array<{ userId: string; userName: string; since: Date }> {
    const sessionViewers = this.viewerMap.get(sessionId);
    if (!sessionViewers) return [];

    return Array.from(sessionViewers.entries()).map(([userId, data]) => ({
      userId,
      userName: data.userName,
      since: data.since,
    }));
  }

  /** Returns true if someone OTHER than excludeUserId is viewing this session */
  isCollision(sessionId: string, excludeUserId: string): boolean {
    const sessionViewers = this.viewerMap.get(sessionId);
    if (!sessionViewers) return false;

    for (const userId of sessionViewers.keys()) {
      if (userId !== excludeUserId) return true;
    }
    return false;
  }
}
