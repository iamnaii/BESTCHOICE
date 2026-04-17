import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { RawBodyRequest } from '../../../common/types/raw-body-request';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

/**
 * Verify LINE webhook signature สำหรับ Staff OA
 * ใช้ secret คนละตัวกับ Shop/Finance OA — config key: line-staff / channelSecret
 */
@Injectable()
export class LineStaffWebhookGuard implements CanActivate {
  private readonly logger = new Logger(LineStaffWebhookGuard.name);

  constructor(private readonly integrationConfig: IntegrationConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const channelSecret =
      (await this.integrationConfig.getValue('line-staff', 'channelSecret')) || undefined;

    const request = context.switchToHttp().getRequest<Request>();

    if (!channelSecret) {
      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev) {
        this.logger.warn('LINE Staff channel secret not configured — skipping verification (DEV ONLY)');
        return true;
      }
      this.logger.error('LINE Staff channel secret missing in production — refusing webhook');
      throw new UnauthorizedException('Webhook signature verification not configured');
    }

    const signature = request.headers['x-line-signature'] as string | undefined;
    if (!signature) {
      this.logger.warn('Missing x-line-signature header');
      throw new UnauthorizedException('Missing LINE signature');
    }

    const rawBody = (request as unknown as RawBodyRequest).rawBody;
    if (!rawBody) {
      const isDev = process.env.NODE_ENV !== 'production';
      if (!isDev) {
        this.logger.error('rawBody missing in production — refusing webhook');
        throw new UnauthorizedException('Cannot verify webhook signature without rawBody');
      }
      this.logger.warn('rawBody missing — falling back to JSON.stringify (DEV ONLY)');
    }
    const body = rawBody ?? Buffer.from(JSON.stringify(request.body));
    const expected = createHmac('SHA256', channelSecret).update(body).digest('base64');

    const sigBuf = Buffer.from(signature, 'base64');
    const expBuf = Buffer.from(expected, 'base64');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      this.logger.warn('Invalid LINE Staff webhook signature');
      throw new UnauthorizedException('Invalid LINE signature');
    }
    return true;
  }
}
