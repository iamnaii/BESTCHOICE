import { Injectable } from '@nestjs/common';

/**
 * PresenceService — tracks which staff members are online.
 *
 * Uses an in-memory map of userId → Set<socketId>.
 * A staff member can have multiple tabs/devices connected simultaneously.
 */
@Injectable()
export class PresenceService {
  // userId → Set of socketIds (one user can have multiple tabs)
  private readonly onlineStaff = new Map<string, Set<string>>();

  setOnline(userId: string, socketId: string): void {
    if (!this.onlineStaff.has(userId)) {
      this.onlineStaff.set(userId, new Set());
    }
    this.onlineStaff.get(userId)!.add(socketId);
  }

  setOffline(userId: string, socketId: string): void {
    const sockets = this.onlineStaff.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.onlineStaff.delete(userId);
      }
    }
  }

  isOnline(userId: string): boolean {
    return this.onlineStaff.has(userId) && this.onlineStaff.get(userId)!.size > 0;
  }

  getOnlineStaffIds(): string[] {
    return Array.from(this.onlineStaff.keys());
  }

  getOnlineCount(): number {
    return this.onlineStaff.size;
  }
}
