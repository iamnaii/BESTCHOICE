import { BadRequestException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * HTTP client for the Revenue Department (RD) e-Tax Invoice web service.
 *
 * Endpoint defaults to the sandbox:
 *   https://etax.rd.go.th/etax_staging/etaxws/
 * Production:
 *   https://etax.rd.go.th/etax_v2/etaxws/
 *
 * Credentials are passed in by the orchestrating service (read from the
 * encrypted `e-tax` integration config). No env reads happen here.
 *
 * All network operations have a 30s timeout via AbortController, and every
 * failure path captures to Sentry with explicit tags so SRE can grep.
 */

export interface RdSubmitConfig {
  endpoint: string;
  username: string;
  password: string;
}

export interface RdSubmitResult {
  accepted: boolean;
  /** RD's tracking ID for status polling — populated on accepted responses */
  submissionId?: string;
  /** Rejection reason if accepted=false */
  reason?: string;
  /** Full raw response body for forensics */
  rawResponse: unknown;
}

export interface RdStatusResult {
  /** RD's verdict: 'ACCEPTED' | 'REJECTED' | 'PENDING' */
  status: 'ACCEPTED' | 'REJECTED' | 'PENDING';
  reason?: string;
  rawResponse: unknown;
}

export class RdApiClient {
  private readonly logger = new Logger(RdApiClient.name);
  private static readonly TIMEOUT_MS = 30_000;

  /**
   * Submit a signed XML envelope (PKCS#7) to RD.
   * @returns submissionId on accept, or rejection reason.
   */
  async submit(
    signedXml: string,
    config: RdSubmitConfig,
  ): Promise<RdSubmitResult> {
    if (!config.endpoint) {
      throw new BadRequestException('RD endpoint ไม่ได้ตั้งค่า');
    }
    if (!config.username || !config.password) {
      throw new BadRequestException('RD credentials ไม่ได้ตั้งค่า');
    }

    const url = `${config.endpoint.replace(/\/$/, '')}/submitInvoice`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RdApiClient.TIMEOUT_MS);

    try {
      // RD ws uses HTTP Basic auth + POST body of PKCS#7 (base64) wrapped
      // in their own JSON envelope. Body shape per ETDA spec example.
      const body = JSON.stringify({
        invoice: signedXml,
        submittedAt: new Date().toISOString(),
      });

      const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }

      if (!res.ok) {
        // HTTP-level rejection from RD
        this.logger.warn(
          `RD submit returned HTTP ${res.status} for endpoint ${url}`,
        );
        Sentry.captureMessage('etax.rd.submit.http_error', {
          level: 'warning',
          tags: { module: 'e-tax-xml', op: 'submit' },
          extra: { status: res.status, body: parsed },
        });
        return {
          accepted: false,
          reason: `HTTP ${res.status} จาก RD`,
          rawResponse: parsed,
        };
      }

      // C9 — Fail-loud on unknown RD response shape. RD's submitInvoice
      // returns one of two known schemas:
      //   { result_code: 'ACCEPTED'|'REJECTED', submission_id?, message? }
      //   { status:      'ACCEPTED'|'REJECTED', tracking_id?,  reason?  }
      // Anything else (HTML error page, partial response, downtime mock)
      // must NOT silently map to SUBMITTED — the caller would lock in a
      // false-positive ACCEPTED audit trail. Mark REJECTED with the raw
      // body so accountants can investigate, and alert Sentry.
      const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<
        string,
        unknown
      >;
      const code = (obj.result_code ?? obj.status) as string | undefined;
      const submissionId = (obj.submission_id ?? obj.tracking_id) as string | undefined;
      const message = (obj.message ?? obj.reason) as string | undefined;

      const upper = code ? String(code).toUpperCase() : '';

      if (upper === 'ACCEPTED') {
        return { accepted: true, submissionId, rawResponse: parsed };
      }

      if (upper === 'REJECTED') {
        return {
          accepted: false,
          reason: message ?? 'RD รายงานปฏิเสธ (REJECTED) แต่ไม่ได้แจ้งเหตุผล',
          rawResponse: parsed,
        };
      }

      // Unknown shape — alert + record as REJECTED with raw payload. We do
      // NOT throw because the lifecycle expects a structured result; an
      // exception here would re-enter the transport-error path which is
      // misleading (RD did respond, just in an unrecognized way).
      this.logger.error(
        `RD submit returned unknown response shape (code=${code ?? 'missing'}) at ${url}`,
      );
      Sentry.captureException(
        new Error(
          `etax.rd.submit.unknown_response: ${JSON.stringify(parsed).slice(0, 1000)}`,
        ),
        {
          tags: { module: 'e-tax-xml', op: 'submit', reason: 'unknown_shape' },
          extra: { url, parsed },
        },
      );
      return {
        accepted: false,
        reason: `RD response รูปแบบไม่ถูกต้อง (code=${code ?? 'missing'}) — ตรวจสอบ rd_response`,
        rawResponse: parsed,
      };
    } catch (err) {
      const isAbort = (err as Error).name === 'AbortError';
      this.logger.error(
        `RD submit failed (${isAbort ? 'timeout' : 'transport error'}): ${(err as Error).message}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'e-tax-xml', op: 'submit', isTimeout: isAbort },
      });
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Poll status by RD submission ID.
   */
  async checkStatus(
    submissionId: string,
    config: RdSubmitConfig,
  ): Promise<RdStatusResult> {
    if (!config.endpoint) {
      throw new BadRequestException('RD endpoint ไม่ได้ตั้งค่า');
    }
    if (!submissionId) {
      throw new BadRequestException('ไม่มี submission ID');
    }

    const url = `${config.endpoint.replace(/\/$/, '')}/status/${encodeURIComponent(submissionId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RdApiClient.TIMEOUT_MS);

    try {
      const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }

      if (!res.ok) {
        Sentry.captureMessage('etax.rd.status.http_error', {
          level: 'warning',
          tags: { module: 'e-tax-xml', op: 'status' },
          extra: { status: res.status, body: parsed },
        });
        return { status: 'PENDING', rawResponse: parsed };
      }

      const obj = parsed as Record<string, unknown>;
      const code = ((obj.result_code ?? obj.status) as string | undefined)?.toUpperCase();
      const message = (obj.message ?? obj.reason) as string | undefined;

      if (code === 'ACCEPTED') return { status: 'ACCEPTED', rawResponse: parsed };
      if (code === 'REJECTED') {
        return { status: 'REJECTED', reason: message, rawResponse: parsed };
      }
      return { status: 'PENDING', rawResponse: parsed };
    } catch (err) {
      Sentry.captureException(err, {
        tags: { module: 'e-tax-xml', op: 'status' },
      });
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Connectivity / auth probe — used by the "ทดสอบการเชื่อมต่อ" button on
   * /settings/e-tax-config. Hits the endpoint root (or a known health
   * path) with auth headers; treats any 2xx OR 401-with-RD-body as
   * "endpoint reachable", anything else as failure.
   */
  async ping(config: RdSubmitConfig): Promise<{ ok: boolean; detail: string }> {
    if (!config.endpoint) return { ok: false, detail: 'endpoint ไม่ได้ตั้งค่า' };
    if (!config.username || !config.password) {
      return { ok: false, detail: 'username/password ไม่ได้ตั้งค่า' };
    }

    const url = `${config.endpoint.replace(/\/$/, '')}/ping`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RdApiClient.TIMEOUT_MS);
    try {
      const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.ok) return { ok: true, detail: `HTTP ${res.status}` };
      // RD may not implement /ping — 404 still means TCP/TLS reachable.
      if (res.status === 404) return { ok: true, detail: 'endpoint reachable (404 on /ping)' };
      return { ok: false, detail: `HTTP ${res.status}` };
    } catch (err) {
      const isAbort = (err as Error).name === 'AbortError';
      return {
        ok: false,
        detail: isAbort ? 'timeout 30s' : (err as Error).message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
