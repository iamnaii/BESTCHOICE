import {
  IsString,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * IsPublicHttpsUrl — strict URL validator that defends against SSRF.
 *
 * Approach: **allowlist**. We only accept https URLs whose host matches a
 * known storage backend (GCS public host, optional custom S3 endpoint host).
 * This is preferred over a deny-list because storage backends are a closed,
 * predictable set — no need to enumerate private IP ranges.
 *
 * **Defense-in-depth fallback**: even when the host doesn't match the allowlist
 * (e.g. tests without env), we still reject IP literals, localhost, and
 * RFC1918 / link-local ranges so the DTO is safe by default.
 *
 * Allowed hosts (resolved at validation time from env):
 *  - `storage.googleapis.com` (GCS — always allowed)
 *  - host extracted from `S3_ENDPOINT` (if set — for MinIO / R2 / dev)
 */
@ValidatorConstraint({ name: 'isPublicHttpsUrl', async: false })
export class IsPublicHttpsUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value.length === 0) return false;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }

    if (url.protocol !== 'https:') return false;

    const host = url.hostname.toLowerCase();
    if (!host) return false;

    // Always reject obviously-internal hosts (defense in depth)
    if (isPrivateOrLoopbackHost(host)) return false;

    // Allowlist: GCS public host
    if (host === 'storage.googleapis.com') return true;

    // Allowlist: configured S3 endpoint (MinIO / R2 / etc.)
    const s3Endpoint = process.env.S3_ENDPOINT;
    if (s3Endpoint) {
      try {
        const s3Host = new URL(s3Endpoint).hostname.toLowerCase();
        if (s3Host && host === s3Host) return true;
      } catch {
        // malformed S3_ENDPOINT — ignore and fall through to reject
      }
    }

    return false;
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'URL ต้องเป็น https สาธารณะเท่านั้น';
  }
}

/**
 * Returns true if the host is an IP literal, loopback, or RFC1918 / link-local
 * address that must never be reachable from server-side fetches.
 */
export function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();

  // Hostname denylist
  if (h === 'localhost' || h === 'localhost.localdomain') return true;
  if (h.endsWith('.localhost')) return true;

  // IPv6 literal — URL.hostname strips brackets, so "::1" / "0::1" appear raw.
  // Any host containing ":" is an IPv6 literal in this context.
  if (h.includes(':')) return true;

  // IPv4 dotted literal? (4 numeric octets)
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;

  const o = m.slice(1, 5).map((n) => Number(n));
  if (o.some((n) => n < 0 || n > 255)) return true; // malformed IP — reject

  const [a, b] = o;

  // 0.0.0.0/8 — "this network" / unspecified
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC1918
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (incl. cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — RFC1918
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;

  // Any other IPv4 literal — still reject (we want hostnames only for public URLs)
  return true;
}

export class UpdateLetterEvidenceDto {
  @IsString({ message: 'กรุณาระบุ URL' })
  @Validate(IsPublicHttpsUrlConstraint)
  evidencePhotoUrl!: string;
}
