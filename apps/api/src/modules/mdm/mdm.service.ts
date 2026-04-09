import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export type MdmDeviceLockStatus = 'LOCKED' | 'UNLOCKED' | 'UNKNOWN';

export interface MdmActionResult {
  success: boolean;
  imei: string;
  message: string;
}

export interface MdmDeviceStatusResult {
  imei: string;
  status: MdmDeviceLockStatus;
  message: string;
}

@Injectable()
export class MdmService {
  private readonly logger = new Logger(MdmService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /** Check if MDM (PJ-Soft) integration is configured */
  isConfigured(): boolean {
    return !!(
      this.configService.get('MDM_API_URL') &&
      this.configService.get('MDM_API_KEY')
    );
  }

  /**
   * Lock a device via MDM PJ-Soft.
   * Typically called when a contract is overdue and all other collection steps have failed.
   *
   * @param imei  - IMEI of the device to lock
   * @param reason - Human-readable reason (e.g. "ค้างชำระ 3 งวด")
   */
  async lockDevice(imei: string, reason: string): Promise<MdmActionResult> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `MDM lock requested for IMEI ${imei} — integration not configured. Set MDM_API_URL and MDM_API_KEY`,
      );
      return {
        success: false,
        imei,
        message: 'MDM integration not configured — ยังไม่ได้ตั้งค่า MDM API',
      };
    }

    // TODO: Implement when PJ-Soft API credentials are available
    // 1. POST to MDM_API_URL/lock with { imei, reason, apiKey: MDM_API_KEY }
    // 2. Handle response / error
    // 3. Persist lock event to AuditLog or a dedicated MdmEvent table

    this.logger.log(`[MDM SCAFFOLD] lockDevice called for IMEI ${imei} — reason: ${reason}`);

    return {
      success: false,
      imei,
      message: 'MDM API integration pending — awaiting PJ-Soft credentials',
    };
  }

  /**
   * Unlock a device via MDM PJ-Soft.
   * Called when customer has paid off the contract or settled arrears.
   *
   * @param imei - IMEI of the device to unlock
   */
  async unlockDevice(imei: string): Promise<MdmActionResult> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `MDM unlock requested for IMEI ${imei} — integration not configured. Set MDM_API_URL and MDM_API_KEY`,
      );
      return {
        success: false,
        imei,
        message: 'MDM integration not configured — ยังไม่ได้ตั้งค่า MDM API',
      };
    }

    // TODO: Implement when PJ-Soft API credentials are available
    // 1. POST to MDM_API_URL/unlock with { imei, apiKey: MDM_API_KEY }
    // 2. Handle response / error
    // 3. Persist unlock event to AuditLog or a dedicated MdmEvent table

    this.logger.log(`[MDM SCAFFOLD] unlockDevice called for IMEI ${imei}`);

    return {
      success: false,
      imei,
      message: 'MDM API integration pending — awaiting PJ-Soft credentials',
    };
  }

  /**
   * Query the current lock status of a device from MDM PJ-Soft.
   *
   * @param imei - IMEI to query
   */
  async getDeviceStatus(imei: string): Promise<MdmDeviceStatusResult> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `MDM status requested for IMEI ${imei} — integration not configured. Set MDM_API_URL and MDM_API_KEY`,
      );
      return {
        imei,
        status: 'UNKNOWN',
        message: 'MDM integration not configured — ยังไม่ได้ตั้งค่า MDM API',
      };
    }

    // TODO: Implement when PJ-Soft API credentials are available
    // 1. GET MDM_API_URL/status?imei=<imei>&apiKey=MDM_API_KEY
    // 2. Map response to MdmDeviceLockStatus

    this.logger.log(`[MDM SCAFFOLD] getDeviceStatus called for IMEI ${imei}`);

    return {
      imei,
      status: 'UNKNOWN',
      message: 'MDM API integration pending — awaiting PJ-Soft credentials',
    };
  }
}
