import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

// Pay Solutions external API timeout. Their published SLA is "instant"
// but real-world we've seen 5-10s on busy hours. 15s leaves headroom
// without holding our request thread forever.
export const PAYSOLUTIONS_TIMEOUT_MS = 15_000;

/**
 * Per-call-site knobs for {@link PaySolutionsGatewayClient.createUiPayment}.
 *
 * The five intent creators previously each inlined an identical
 * AbortController + fetch + `response.json()` + `!response.ok` parse +
 * redirectUrl-extract + timeout/catch block. They were NOT byte-identical —
 * the log prefixes, thrown Thai messages, the presence of `statusCode` in the
 * error log, the missing-redirectUrl log, the timeout Sentry key/extra, and the
 * timeout/generic-error messages all varied per call site. To collapse the
 * mechanics into one place WITHOUT changing the gateway request bytes or any
 * user-/log-/Sentry-visible string, every divergence is threaded through here
 * VERBATIM. Each field reproduces exactly what the original site emitted.
 */
export interface CreateUiPaymentOpts {
  /** Numeric ref carried into the timeout Sentry tag + (optionally) the timeout log. */
  orderRef: string;
  /** Builds the `!response.ok` error log line (varies in shape per call site). */
  buildErrorLog: (
    response: Response,
    gatewayResponse: Record<string, unknown>,
    parsed: { statusCode: string; message: string },
  ) => string;
  /** Prefix for the thrown business-error message: `${prefix}: ${message}`. */
  errorMessagePrefix: string;
  /** Optional log emitted when redirectUrl is missing (only the legacy intent path logs it). */
  buildMissingUrlLog?: (gatewayResponse: Record<string, unknown>) => string;
  /** Thrown message when redirectUrl is missing. */
  missingUrlMessage: string;
  /** Optional log emitted on timeout (only the legacy intent path logs it). */
  buildTimeoutLog?: () => string;
  /** Sentry message + critical tag key for the timeout capture. */
  timeoutSentryKey: string;
  /** Sentry `extra` payload for the timeout capture (caller-local context). */
  timeoutSentryExtra: Record<string, unknown>;
  /** Thrown message on timeout. */
  timeoutMessage: string;
  /**
   * Optional log emitted on a generic (non-timeout, non-business) failure.
   * Only the legacy intent path logged `Pay Solutions API call failed: ...`;
   * the other four call sites threw without logging.
   */
  buildGenericErrorLog?: (error: unknown) => string;
  /** Thrown message on a generic (non-timeout, non-business) failure. */
  genericErrorMessage: string;
}

/**
 * Thin, DB-free client for the Pay Solutions UI-payment gateway.
 *
 * Owns the integration config getters (merchantId / secretKey / apiKey /
 * apiUrl / terminalId) and the single `createUiPayment` call that all five
 * intent creators share. Constructed internally by {@link PaySolutionsService}.
 */
@Injectable()
export class PaySolutionsGatewayClient {
  private readonly logger = new Logger(PaySolutionsGatewayClient.name);

  constructor(
    private config: ConfigService,
    private integrationConfig: IntegrationConfigService,
  ) {}

  async getMerchantId(): Promise<string> {
    return (await this.integrationConfig.getValue('paysolutions', 'merchantId')) || '';
  }

  async getSecretKey(): Promise<string> {
    return (await this.integrationConfig.getValue('paysolutions', 'secretKey')) || '';
  }

  async getApiKey(): Promise<string> {
    return (await this.integrationConfig.getValue('paysolutions', 'apiKey')) || '';
  }

  async getApiUrl(): Promise<string> {
    return (
      (await this.integrationConfig.getValue('paysolutions', 'apiUrl')) ||
      'https://apis.paysolutions.asia'
    );
  }

  async getTerminalId(): Promise<string> {
    return (await this.integrationConfig.getValue('paysolutions', 'terminalId')) || 'TID00001';
  }

  /**
   * POST a UI-payment request to Pay Solutions v2 and return the parsed
   * gateway response + the redirect (payment) URL.
   *
   * AbortController-based timeout (PAYSOLUTIONS_TIMEOUT_MS). Without it a hung
   * gateway would keep the request thread alive indefinitely and the customer
   * would see an infinite spinner. Behavior (request bytes, logs, thrown
   * messages, Sentry capture) is byte-identical to the five original inline
   * blocks via {@link CreateUiPaymentOpts}.
   */
  async createUiPayment(
    paymentPayload: Record<string, unknown>,
    opts: CreateUiPaymentOpts,
  ): Promise<{ gatewayResponse: Record<string, unknown>; paymentUrl: string }> {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), PAYSOLUTIONS_TIMEOUT_MS);
    let gatewayResponse: Record<string, unknown>;
    let paymentUrl: string;

    try {
      const response = await fetch(
        `${await this.getApiUrl()}/payment/gateway/v2/ui-payments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            apiKey: await this.getApiKey(),
            secretKey: await this.getSecretKey(),
          },
          body: JSON.stringify(paymentPayload),
          signal: abortController.signal,
        },
      );

      gatewayResponse = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        // PaySolutions returns error in two shapes:
        //   - Auth fail (401):  { message: "Invalid authentication credentials" }
        //   - Business error:   { status: { statusCode: "4A001", message: "..." } }
        // Read both so logs + user message are useful in either case.
        const status = gatewayResponse.status as Record<string, string> | undefined;
        const flatMessage = gatewayResponse.message as string | undefined;
        const statusCode = status?.statusCode ?? String(response.status);
        const message = status?.message ?? flatMessage ?? 'กรุณาลองใหม่';
        this.logger.error(opts.buildErrorLog(response, gatewayResponse, { statusCode, message }));
        throw new InternalServerErrorException(`${opts.errorMessagePrefix}: ${message}`);
      }

      paymentUrl = (gatewayResponse.redirectUrl as string) || '';

      if (!paymentUrl) {
        if (opts.buildMissingUrlLog) {
          this.logger.error(opts.buildMissingUrlLog(gatewayResponse));
        }
        throw new InternalServerErrorException(opts.missingUrlMessage);
      }
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      // AbortError fires when the timeout trips. Surface a clear Thai
      // message to the user and tag the Sentry event so we can spot a
      // gateway slowdown.
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      if (isTimeout) {
        if (opts.buildTimeoutLog) {
          this.logger.error(opts.buildTimeoutLog());
        }
        Sentry.captureMessage(opts.timeoutSentryKey, {
          level: 'warning',
          tags: { critical: opts.timeoutSentryKey, orderRef: opts.orderRef },
          extra: opts.timeoutSentryExtra,
        });
        throw new InternalServerErrorException(opts.timeoutMessage);
      }
      if (opts.buildGenericErrorLog) {
        this.logger.error(opts.buildGenericErrorLog(error));
      }
      throw new InternalServerErrorException(opts.genericErrorMessage);
    } finally {
      clearTimeout(timeoutHandle);
    }

    return { gatewayResponse, paymentUrl };
  }
}
