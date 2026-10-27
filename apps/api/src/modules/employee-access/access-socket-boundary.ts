import { PrismaService } from '../../prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AccessSnapshotService } from './access-snapshot.service';
/** Fail-closed staging boundary until Task4 supplies per-event source resolution,
 * query scoping and payload redaction. Re-check both commands AND each recipient;
 * a stale subscription cannot continue receiving after migration/disablement. */
@Injectable()
export class AccessSocketBoundary {
  constructor(private readonly snapshots: AccessSnapshotService, private readonly prisma: PrismaService) {}
  async allowLegacy(client: any): Promise<boolean> {
    try {
      const userId = client.data?.staffUserId;
      if (!userId || (client.data.staffTokenExpiresAt && Date.now() >= client.data.staffTokenExpiresAt)) throw new Error('Staff identity required');
      const snapshot = await this.snapshots.forUser(userId);
      if (snapshot.managed) throw new Error('Scoped socket integration required');
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, branchId: true } });
      if (!user || (client.data.staffRole && (client.data.staffRole !== user.role || client.data.staffBranchId !== user.branchId))) throw new Error('Subscription identity changed');
      client.data.staffRole = user.role;
      client.data.staffBranchId = user.branchId;
      return true;
    } catch {
      client.disconnect(true);
      return false;
    }
  }
  emit(server: any, room: string, event: string, data: unknown, exceptId?: string): void {
    if (!server) return;
    void this.deliver(server, room, event, data, exceptId).catch(() => { /* fail closed */ });
  }
  private async deliver(server: any, room: string, event: string, data: unknown, exceptId?: string) {
    const clients = await server.in(room).fetchSockets();
    await Promise.all(clients.map(async (client: any) => {
      if (client.id !== exceptId && await this.allowLegacy(client)) client.emit(event, data);
    }));
  }
}
