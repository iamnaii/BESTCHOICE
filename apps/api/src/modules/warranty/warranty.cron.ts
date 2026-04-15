import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WarrantyService } from './warranty.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WarrantyCron {
  private readonly logger = new Logger(WarrantyCron.name);

  constructor(
    private warrantyService: WarrantyService,
    private prisma: PrismaService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
  async checkExpiringWarranties(): Promise<void> {
    this.logger.log('Checking expiring warranties...');

    try {
      const expiring = await this.warrantyService.getExpiringWarranties(7);

      for (const item of expiring) {
        const typeLabel = item.type === 'manufacturer' ? 'ประกันศูนย์' : 'ประกันร้าน';
        this.logger.log(
          `${typeLabel} ของ ${item.productName} (${item.customerName}) หมดในอีก ${item.daysRemaining} วัน`,
        );
        // LINE notification can be added later when LINE OA is configured
      }

      this.logger.log(`Found ${expiring.length} expiring warranties`);
    } catch (error) {
      this.logger.error('Warranty check failed', error);
    }
  }
}
