import { ContractsController } from '../contracts/contracts.controller';
import { DefectExchangeController } from '../defect-exchange/defect-exchange.controller';
import { LoyaltyController } from '../loyalty/loyalty.controller';
import { StickersController } from '../stickers/stickers.controller';
import { PricingTemplatesController } from '../pricing-templates/pricing-templates.controller';
import { ShopTendersController } from '../shop-tenders/shop-tenders.controller';
import { ImportedSalesController } from '../imported-sales/imported-sales.controller';
import { CustomerJourneyController } from '../customer-journey/customer-journey.controller';
import { ContactsController } from '../contacts/contacts.controller';
import { CustomersController } from '../customers/customers.controller';
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { AuditService } from './audit.service';
import { sanitizeAuditValue } from './audit-sanitize.util';
import { clientIp } from '../../utils/client-ip.util';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { tap } = require('rxjs');

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;

    const managedSafeRead = this.isManagedSafeRead(context);
    const managedJourney =
      request.user?.access?.managed === true &&
      context.getClass() === CustomerJourneyController &&
      [
        CustomerJourneyController.prototype.list,
        CustomerJourneyController.prototype.summary,
        CustomerJourneyController.prototype.createEntry,
        CustomerJourneyController.prototype.removeEntry,
      ].some((h) => h === context.getHandler());
    // Only audit mutating operations
    const managedDocument =
      request.user?.access?.managed === true &&
      context.getClass() === CustomersController &&
      [
        CustomersController.prototype.uploadDocument,
        CustomersController.prototype.deleteDocument,
        CustomersController.prototype.listDocuments,
        CustomersController.prototype.readDocument,
      ].some((candidate) => candidate === context.getHandler());
    if (['GET', 'HEAD', 'OPTIONS'].includes(method) && !managedDocument && !managedJourney && !managedSafeRead) {
      return next.handle();
    }

    const startTime = Date.now();
    const ipAddress = managedSafeRead ? undefined : clientIp(request);
    const userAgent = managedSafeRead ? undefined : request.headers['user-agent'] || '';

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          // Skip audit for unauthenticated requests (login, register) to avoid FK violation
          if (!user?.id) return;

          const duration = Date.now() - startTime;
          // Try to extract entityId from response for POST (create) operations
          let entityId = this.isSharedReference(context) ? undefined : this.extractEntityId(url);
          if (!entityId && method === 'POST' && responseBody && typeof responseBody === 'object') {
            entityId = responseBody.id;
          }

          void this.auditService.log({
            userId: user.id,
            action: method,
            entity: this.extractEntity(url),
            entityId,
            newValue:
              this.contactRequestMetadata(context, 'SUCCESS', undefined, duration) ??
              this.sanitizeBody(body),
            ipAddress,
            userAgent,
            duration,
          });
        },
        error: (err) => {
          // Skip audit for unauthenticated requests to avoid FK violation
          if (!user?.id) return;

          const duration = Date.now() - startTime;
          void this.auditService.log({
            userId: user.id,
            action: `${method}_ERROR`,
            entity: this.extractEntity(url),
            entityId: this.isSharedReference(context) ? undefined : this.extractEntityId(url),
            newValue: this.contactRequestMetadata(
              context,
              'ERROR',
              err.status || err.statusCode || 500,
              duration,
            ) ?? {
              error: err.message,
              statusCode: err.status || err.statusCode || 500,
              body: this.sanitizeBody(body),
              duration,
            },
            ipAddress,
            userAgent,
            duration,
          });
        },
      }),
    );
  }

  private isSharedReference(context: ExecutionContext): boolean {
    return context.getClass() === StickersController || context.getClass() === PricingTemplatesController;
  }

  private isManagedSafeRead(context: ExecutionContext): boolean {
    if (this.isSharedReference(context)) return true;
    if (context.switchToHttp().getRequest().user?.access?.managed !== true) return false;
    if (context.getClass() === ContractsController && [ContractsController.prototype.findAll, ContractsController.prototype.findOne].some(handler => handler === context.getHandler())) return true;
    if (context.getClass() === DefectExchangeController && [
      DefectExchangeController.prototype.getEligibility, DefectExchangeController.prototype.execute,
      DefectExchangeController.prototype.list,
    ].some(handler => handler === context.getHandler())) return true;
    if (context.getClass() === LoyaltyController && [
      LoyaltyController.prototype.getPoints, LoyaltyController.prototype.getHistory,
      LoyaltyController.prototype.getReferralStats, LoyaltyController.prototype.redeemPoints,
    ].some(handler => handler === context.getHandler())) return true;
    return context.getClass() === ShopTendersController && [
      ShopTendersController.prototype.getDailySummary, ShopTendersController.prototype.getCashCloseStatus,
      ShopTendersController.prototype.getCashCloseHistory, ShopTendersController.prototype.getCashCloseOverview,
      ShopTendersController.prototype.getCashCloseReminder,
      ShopTendersController.prototype.countCashClose, ShopTendersController.prototype.confirmCashClose,
      ShopTendersController.prototype.sendBackCashClose, ShopTendersController.prototype.attachDepositSlip,
      ShopTendersController.prototype.createCashDeposit, ShopTendersController.prototype.getCloseDepositSlip,
      ShopTendersController.prototype.getCashDepositSlip,
    ].some(handler => handler === context.getHandler()) || context.getClass() === ImportedSalesController && [
      ImportedSalesController.prototype.list, ImportedSalesController.prototype.summary,
    ].some(handler => handler === context.getHandler());
  }

  /** These four exact managed handlers own durable business proof in their transaction.
   * This outer best-effort record describes only the HTTP request outcome,
   * including denials and rollbacks, never contact values or exception text. */
  private contactRequestMetadata(
    context: ExecutionContext,
    outcome: 'SUCCESS' | 'ERROR',
    statusCode: number | undefined,
    duration: number,
  ): Record<string, unknown> | undefined {
    const request = context.switchToHttp().getRequest();
    if (request.user?.access?.managed !== true && !this.isSharedReference(context)) return undefined;
    const handler = context.getHandler();
    const controller = context.getClass();
    if (this.isManagedSafeRead(context)) {
      const code = statusCode ?? context.switchToHttp().getResponse().statusCode;
      return { route: `${controller.name}.${handler.name}`, outcome,
        statusCode: Number.isInteger(code) && code >= 100 && code <= 599 ? code : 500, duration };
    }
    if (
      controller === CustomerJourneyController &&
      [
        CustomerJourneyController.prototype.list,
        CustomerJourneyController.prototype.summary,
        CustomerJourneyController.prototype.createEntry,
        CustomerJourneyController.prototype.removeEntry,
      ].some((h) => h === handler)
    ) {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const responseStatus = statusCode ?? context.switchToHttp().getResponse().statusCode;
      return {
        presentFields: [
          'kind',
          'channel',
          'outcome',
          'lostReason',
          'heardFrom',
          'clientRequestId',
        ].filter((key) => Object.prototype.hasOwnProperty.call(body, key)),
        outcome,
        statusCode:
          Number.isInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599
            ? responseStatus
            : 500,
        duration,
      };
    }
    if (controller !== CustomersController && controller !== ContactsController) return undefined;
    const documentHandler =
      controller === CustomersController &&
      [
        CustomersController.prototype.uploadDocument,
        CustomersController.prototype.deleteDocument,
        CustomersController.prototype.listDocuments,
        CustomersController.prototype.readDocument,
      ].some((candidate) => candidate === handler);
    const fields = documentHandler
      ? ['sourceKind', 'sourceId', 'attachmentId']
      : controller === ContactsController && handler === ContactsController.prototype.merge
        ? ['primaryId', 'duplicateId']
        : controller === CustomersController && handler === CustomersController.prototype.absorbInto
          ? []
          : controller === CustomersController &&
              handler === CustomersController.prototype.fillContact
            ? ['phone', 'nationalId', 'name', 'prefix', 'nickname', 'facebookName']
            : controller === CustomersController &&
                handler === CustomersController.prototype.updateContact
              ? ['newPhone', 'newLineId', 'markAsLost']
              : undefined;
    if (!fields) return undefined;
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const requestStatus = statusCode ?? context.switchToHttp().getResponse().statusCode;
    return {
      presentFields: fields.filter((field) => Object.prototype.hasOwnProperty.call(body, field)),
      outcome,
      statusCode:
        Number.isInteger(requestStatus) && requestStatus >= 100 && requestStatus <= 599
          ? requestStatus
          : 500,
      duration,
      ...(handler === CustomersController.prototype.updateContact
        ? { reasonProvided: typeof body.reason === 'string' && body.reason.trim().length > 0 }
        : {}),
    };
  }

  private extractEntity(url: string): string {
    // Remove /api/ prefix and query string
    const path = url.replace(/^\/api\//, '').split('?')[0];
    const parts = path.split('/').filter(Boolean);

    // R-013: Extract the FIRST meaningful segment (primary entity) for nested URLs.
    // For /contracts/uuid/payments/uuid → "contracts" (the primary resource)
    // For /products/uuid → "products"
    // For /auth/login → "auth"
    // Previously walked backwards which returned "payments" for nested URLs,
    // losing the primary resource context in audit logs.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Walk forward to find the first non-UUID segment (the primary entity)
    for (let i = 0; i < parts.length; i++) {
      if (!uuidRegex.test(parts[i])) {
        return parts[i];
      }
    }

    return parts[0] || 'unknown';
  }

  private extractEntityId(url: string): string | undefined {
    const path = url.split('?')[0];
    const parts = path.replace(/^\/api\//, '').split('/');
    // UUID pattern - find the last UUID in the URL
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const uuidParts = parts.filter((p) => uuidRegex.test(p));
    return uuidParts.length > 0 ? uuidParts[uuidParts.length - 1] : undefined;
  }

  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return undefined;
    return sanitizeAuditValue(body) as Record<string, unknown>;
  }
}
