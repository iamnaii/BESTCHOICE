import {
  Controller,
  Post,
  Body,
  Query,
  UnauthorizedException,
  Logger,
  Optional,
  Inject,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { EventsGateway } from '../notifications/events.gateway';
import { CallDirection, CallResult } from '@prisma/client';

/**
 * รับ events จาก Yeastar PBX — intentionally public (ไม่มี JwtAuthGuard)
 * ตรวจสอบด้วย query param ?token=<webhookSecret> ที่ตั้งไว้ใน IntegrationConfig
 */
@Controller('yeastar/webhook')
export class YeastarWebhookController {
  private readonly logger = new Logger(YeastarWebhookController.name);

  constructor(
    private readonly configService: IntegrationConfigService,
    private readonly prisma: PrismaService,
    @Optional() @Inject(EventsGateway) private readonly gateway: EventsGateway | null,
  ) {}

  @Post()
  async handleEvent(@Body() body: Record<string, unknown>, @Query('token') token: string) {
    await this.verifyToken(token);

    const event = body.event as string;
    this.logger.debug(`[Yeastar Webhook] event: ${event}`);

    try {
      if (event === 'ExtensionCallStatus') {
        await this.handleCallStatus(body);
      } else if (event === 'NewCdr') {
        await this.handleNewCdr(body);
      }
    } catch (err) {
      Sentry.captureException(err, {
        extra: {
          event,
          callId: typeof body.callId === 'string' ? body.callId : undefined,
          cdrId: typeof body.id === 'string' ? body.id : undefined,
        },
      });
      this.logger.error(`[Yeastar Webhook] error handling ${event}`, err);
    }

    return { ok: true };
  }

  private async verifyToken(token: string) {
    const config = await this.configService.getConfig('yeastar');
    const secret = config.webhookSecret;

    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn('Yeastar webhook secret not configured — rejecting request in production');
        throw new UnauthorizedException('Webhook secret not configured');
      }
      // dev mode: skip signature check
      return;
    }

    if (!token) throw new UnauthorizedException('Missing webhook token');

    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      Sentry.captureMessage('[Yeastar] Invalid webhook token — possible spoofing', 'warning');
      throw new UnauthorizedException('Invalid webhook token');
    }
  }

  private async handleCallStatus(body: Record<string, unknown>) {
    const callStatus = body.callStatus as string;
    if (callStatus !== 'RINGING' && callStatus !== 'ANSWERED') return;

    const callerNumber = body.callerNumber as string;
    const answeredBy = body.answeredBy as string | undefined;
    const callId = body.callId as string;

    const customer = await this.prisma.customer.findFirst({
      where: { phone: callerNumber, deletedAt: null },
      select: { id: true, name: true },
    });

    const contract = customer
      ? await this.prisma.contract.findFirst({
          where: {
            customerId: customer.id,
            status: { in: ['ACTIVE', 'OVERDUE'] },
            deletedAt: null,
          },
          select: { id: true, contractNumber: true },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    // นับงวดค้าง: payments overdue/partially-paid ที่ยังไม่จ่ายครบ
    let overdueCount = 0;
    if (contract) {
      overdueCount = await this.prisma.payment.count({
        where: {
          contractId: contract.id,
          status: { in: ['OVERDUE', 'PARTIALLY_PAID'] },
          deletedAt: null,
        },
      });
    }

    const agentUser = answeredBy
      ? await this.prisma.user.findFirst({
          where: { yeastarExtension: answeredBy, deletedAt: null },
          select: { id: true },
        })
      : null;

    if (agentUser && this.gateway) {
      this.gateway.emitToUser(agentUser.id, 'yeastar:inbound', {
        callId,
        callerNumber,
        customer: customer ? { id: customer.id, name: customer.name } : null,
        contract: contract ? { id: contract.id, contractNumber: contract.contractNumber } : null,
        overdueCount,
      });
    }
  }

  private async handleNewCdr(body: Record<string, unknown>) {
    const cdrId = body.id as string;
    const callFrom = body.callFrom as string;
    const callTo = body.callTo as string;
    const callType = body.callType as string;
    const duration = (body.talkDuration as number) ?? (body.duration as number) ?? 0;
    const startTime = new Date(body.startTime as string);
    const recordingFile = body.recordingFile as string | undefined;

    const direction: CallDirection =
      callType === 'Inbound' ? CallDirection.INBOUND : CallDirection.OUTBOUND;

    const customerPhone = direction === CallDirection.INBOUND ? callFrom : callTo;

    const customer = await this.prisma.customer.findFirst({
      where: { phone: customerPhone, deletedAt: null },
      select: { id: true },
    });

    if (!customer) return;

    const contract = await this.prisma.contract.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!contract) return;

    const agentExtension = direction === CallDirection.INBOUND ? callTo : callFrom;
    const agentUser = await this.prisma.user.findFirst({
      where: { yeastarExtension: agentExtension, deletedAt: null },
      select: { id: true },
    });

    const callResult: CallResult = duration > 0 ? CallResult.ANSWERED : CallResult.NO_ANSWER;

    await this.prisma.callLog.upsert({
      where: { yeastarCallId: cdrId },
      create: {
        contractId: contract.id,
        callerId: agentUser?.id,
        calledAt: startTime,
        result: callResult,
        callResult,
        yeastarCallId: cdrId,
        callDirection: direction,
        duration,
        yeastarRecordingPath: recordingFile ?? null,
        autoLogged: true,
      },
      update: {
        duration,
        ...(recordingFile ? { yeastarRecordingPath: recordingFile } : {}),
      },
    });

    this.logger.log(`[Yeastar] Auto-logged CDR ${cdrId} → contract ${contract.id}`);
  }
}
