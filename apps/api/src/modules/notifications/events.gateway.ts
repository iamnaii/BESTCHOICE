import { AccessSocketBoundary } from '../employee-access/access-socket-boundary';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
  branchId?: string | null;
}

/**
 * WebSocket gateway for real-time notifications.
 * Clients connect with JWT token for authentication.
 *
 * Events emitted to clients:
 * - payment:received — new payment recorded
 * - contract:created — new contract created
 * - notification:new — new notification
 * - dashboard:update — dashboard KPIs changed
 * - overdue:alert — overdue payment alert
 */
@WebSocketGateway({
  // Share the same HTTP port (required for Cloud Run which only allows 1 port)
  // Socket.IO will upgrade HTTP connections to WebSocket on the same port
  cors: {
    origin: (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(s => s.trim()),
    credentials: true,
  },
  namespace: '/events',
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private connectedUsers = new Map<string, Set<string>>(); // userId → socketIds

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private accessBoundary: AccessSocketBoundary,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if ((payload.aud && payload.aud !== 'admin') || payload.role === 'CUSTOMER') throw new Error('Staff token required');
      client.data.staffUserId = payload.sub;
      client.data.staffTokenExpiresAt = payload.exp ? payload.exp * 1000 : undefined;
      if (!await this.accessBoundary.allowLegacy(client)) return;
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { role: true, branchId: true } });
      if (!user) throw new Error('Staff required');
      payload.role = user.role;
      payload.branchId = user.branchId;
      client.userId = payload.sub;
      client.userRole = payload.role;
      client.branchId = payload.branchId;

      // Join room based on role and branch
      client.join(`user:${payload.sub}`);
      client.join(`role:${payload.role}`);
      if (payload.branchId) client.join(`branch:${payload.branchId}`);
      client.join('all'); // broadcast room

      // Track connection
      if (!this.connectedUsers.has(payload.sub)) {
        this.connectedUsers.set(payload.sub, new Set());
      }
      this.connectedUsers.get(payload.sub)!.add(client.id);

      this.logger.debug(`Client connected: ${payload.sub} (${payload.role})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      const sockets = this.connectedUsers.get(client.userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) this.connectedUsers.delete(client.userId);
      }
    }
  }

  /** Emit event to all connected clients */
  emitToAll(event: string, data: unknown) {
    this.accessBoundary.emit(this.server, 'all', event, data);
  }

  /** Emit to a specific user */
  emitToUser(userId: string, event: string, data: unknown) {
    this.accessBoundary.emit(this.server, `user:${userId}`, event, data);
  }

  /** Emit to all users in a branch */
  emitToBranch(branchId: string, event: string, data: unknown) {
    this.accessBoundary.emit(this.server, `branch:${branchId}`, event, data);
  }

  /** Emit to all users with a specific role */
  emitToRole(role: string, event: string, data: unknown) {
    this.accessBoundary.emit(this.server, `role:${role}`, event, data);
  }

  /** Notify all: payment was recorded */
  notifyPaymentReceived(contractId: string, amount: number, branchId?: string) {
    const data = { contractId, amount, timestamp: new Date().toISOString() };
    if (branchId) {
      this.emitToBranch(branchId, 'payment:received', data);
    }
    // Also notify OWNER and ACCOUNTANT
    this.emitToRole('OWNER', 'payment:received', data);
    this.emitToRole('ACCOUNTANT', 'payment:received', data);
  }

  /** Notify: dashboard data changed (trigger refresh) */
  notifyDashboardUpdate() {
    this.emitToAll('dashboard:update', { timestamp: new Date().toISOString() });
  }

  /** Get count of connected users */
  getConnectedCount(): number {
    return this.connectedUsers.size;
  }
}
