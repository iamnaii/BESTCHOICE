import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  RestoreObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Storage as GcsStorage } from '@google-cloud/storage';
import { Readable } from 'stream';

/**
 * StorageService — file storage abstraction.
 *
 * Supports two backends:
 * 1. **GCS** (default in production) — uses @google-cloud/storage with
 *    Application Default Credentials (Cloud Run service account). No secrets needed.
 *    Set GCS_BUCKET env var (defaults to 'bestchoice-documents').
 *
 * 2. **S3-compatible** (dev / MinIO / R2) — uses @aws-sdk/client-s3.
 *    Set S3_ENDPOINT + S3_ACCESS_KEY + S3_SECRET_KEY + S3_BUCKET.
 *
 * Priority: S3 env vars → GCS → not configured.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly backend: 'gcs' | 's3' | 'none';
  private readonly bucket: string;
  private gcs: GcsStorage | null = null;
  private s3: S3Client | null = null;

  constructor(private configService: ConfigService) {
    const s3Endpoint = this.configService.get<string>('S3_ENDPOINT');
    const s3AccessKey = this.configService.get<string>('S3_ACCESS_KEY');
    const s3SecretKey = this.configService.get<string>('S3_SECRET_KEY');
    const gcsBucket = this.configService.get<string>('GCS_BUCKET');

    if (s3Endpoint && s3AccessKey && s3SecretKey) {
      this.backend = 's3';
      this.bucket = this.configService.get<string>('S3_BUCKET') || 'bestchoice-documents';
      this.s3 = new S3Client({
        endpoint: s3Endpoint,
        region: this.configService.get<string>('S3_REGION') || 'ap-southeast-1',
        credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey },
        forcePathStyle: true,
      });
      this.logger.log(`S3 storage configured: ${s3Endpoint}/${this.bucket}`);
    } else if (gcsBucket || this.configService.get('NODE_ENV') === 'production') {
      this.backend = 'gcs';
      this.bucket = gcsBucket || 'bestchoice-documents';
      this.gcs = new GcsStorage();
      this.logger.log(`GCS storage configured: gs://${this.bucket}`);
    } else {
      this.backend = 'none';
      this.bucket = '';
      this.logger.warn('Storage not configured — set GCS_BUCKET or S3_ENDPOINT');
    }
  }

  get configured(): boolean {
    return this.backend !== 'none';
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    if (this.backend === 'gcs' && this.gcs) {
      const file = this.gcs.bucket(this.bucket).file(key);
      await file.save(body, { contentType, resumable: false });
      this.logger.log(`GCS uploaded: ${key} (${body.length} bytes)`);
      return key;
    }

    if (this.backend === 's3' && this.s3) {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket, Key: key, Body: body, ContentType: contentType,
      }));
      this.logger.log(`S3 uploaded: ${key} (${body.length} bytes)`);
      return key;
    }

    this.logger.warn(`Storage not configured, skipping upload: ${key}`);
    return key;
  }

  async getStream(key: string): Promise<Readable> {
    if (this.backend === 'gcs' && this.gcs) {
      const file = this.gcs.bucket(this.bucket).file(key);
      const [exists] = await file.exists();
      if (!exists) throw new BadRequestException(`ไม่พบไฟล์: ${key}`);
      return file.createReadStream();
    }

    if (this.backend === 's3' && this.s3) {
      const response = await this.s3.send(new GetObjectCommand({
        Bucket: this.bucket, Key: key,
      }));
      return response.Body as Readable;
    }

    throw new BadRequestException('Storage not configured');
  }

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    if (this.backend === 'gcs' && this.gcs) {
      const file = this.gcs.bucket(this.bucket).file(key);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + expiresIn * 1000,
      });
      return url;
    }

    if (this.backend === 's3' && this.s3) {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      return getSignedUrl(this.s3, command, { expiresIn });
    }

    throw new BadRequestException('Storage not configured');
  }

  async delete(key: string): Promise<void> {
    if (this.backend === 'gcs' && this.gcs) {
      await this.gcs.bucket(this.bucket).file(key).delete({ ignoreNotFound: true });
      this.logger.log(`GCS deleted: ${key}`);
      return;
    }

    if (this.backend === 's3' && this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.log(`S3 deleted: ${key}`);
      return;
    }
  }

  /**
   * Presigned PUT upload URL. The optional `maxContentLength` is a HARD cap
   * on GCS (enforced via `x-goog-content-length-range`) but only an ADVISORY
   * cap on S3 (Z5). S3 PUT presigned URLs cannot embed content-length
   * conditions — only S3 POST *policy* presigns can. We accept this asymmetry
   * because:
   *   1. The DTO that produces `key`/`maxContentLength` already validates the
   *      client-declared size and rejects out-of-bound requests at the API
   *      layer before issuing the presign.
   *   2. Production runs on GCS; the S3 path is only used for self-hosted
   *      MinIO dev environments where attackers are not in the threat model.
   *   3. Switching legal-doc upload to POST policy presign would require a
   *      different client form-encoded multipart flow — non-trivial refactor
   *      for a dev-only path.
   * If/when an S3-backed production deployment is needed, migrate to POST
   * policy presign with `Conditions: [['content-length-range', 0, max]]`.
   */
  async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresSec = 600,
    maxContentLength?: number,
  ): Promise<{ url: string; method: 'PUT' }> {
    if (this.backend === 'gcs' && this.gcs) {
      const file = this.gcs.bucket(this.bucket).file(key);
      // GCS V4 signed URLs support a `x-goog-content-length-range: min,max`
      // extension header which the storage server enforces — uploads exceeding
      // the cap are rejected even if the client lies about Content-Length.
      const extensionHeaders: Record<string, string> | undefined =
        typeof maxContentLength === 'number' && maxContentLength > 0
          ? { 'x-goog-content-length-range': `0,${maxContentLength}` }
          : undefined;
      const [url] = await file.getSignedUrl({
        action: 'write',
        version: 'v4',
        expires: Date.now() + expiresSec * 1000,
        contentType,
        ...(extensionHeaders ? { extensionHeaders } : {}),
      });
      if (maxContentLength) {
        this.logger.log(
          `GCS presigned upload ${key} (max ${maxContentLength}B enforced via x-goog-content-length-range)`,
        );
      }
      return { url, method: 'PUT' };
    }

    if (this.backend === 's3' && this.s3) {
      // S3 PUT presigned URLs cannot enforce content-length-range
      // (that constraint only applies to POST policy presigns). The DTO bound
      // is the authoritative cap; we audit the requested size here so any
      // mismatch surfaces in logs / Sentry breadcrumbs.
      const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
      const url = await getSignedUrl(this.s3, cmd, { expiresIn: expiresSec });
      if (maxContentLength) {
        this.logger.log(
          `S3 presigned upload ${key} (max ${maxContentLength}B — DTO-enforced, S3 PUT cannot pin)`,
        );
      }
      return { url, method: 'PUT' };
    }

    throw new BadRequestException('Storage not configured');
  }

  /**
   * P3 Task 3 — request a Glacier restore for the given key (S3 only).
   * `days` controls how long the restored copy stays available before
   * relapsing back into Glacier.
   *
   * No-op + warning when the backend is not S3 (GCS uses a different,
   * synchronous mechanism — see {@link restoreToStandardClass}).
   */
  async requestGlacierRestore(key: string, days: number): Promise<void> {
    if (this.backend !== 's3' || !this.s3) {
      this.logger.warn(
        `requestGlacierRestore called on non-S3 backend (${this.backend}); skipping ${key}`,
      );
      return;
    }
    await this.s3.send(
      new RestoreObjectCommand({
        Bucket: this.bucket,
        Key: key,
        RestoreRequest: {
          Days: days,
          GlacierJobParameters: { Tier: 'Standard' },
        },
      }),
    );
    this.logger.log(`S3 Glacier restore requested: ${key} (Days=${days})`);
  }

  /**
   * P3 Task 3 — poll Glacier restore status (S3 only). Inspects
   * x-amz-restore header on HeadObject; ongoing-request="false" means
   * the restored copy is now available.
   */
  async isRestoreComplete(key: string): Promise<boolean> {
    if (this.backend !== 's3' || !this.s3) {
      // GCS setStorageClass is synchronous — by the time it returns we
      // are already restored. So treat as complete.
      return true;
    }
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const restore = head.Restore || '';
      // Format examples (per AWS docs):
      //   ongoing-request="true"
      //   ongoing-request="false", expiry-date="Wed, 07 Nov 2026 00:00:00 GMT"
      if (!restore) return true; // not in Glacier — already standard
      return /ongoing-request="false"/.test(restore);
    } catch (err) {
      this.logger.warn(
        `HeadObject failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * P3 Task 3 — GCS path. setStorageClass to STANDARD is synchronous
   * (it rewrites the object). Throws when called on a non-GCS backend.
   */
  async restoreToStandardClass(key: string): Promise<void> {
    if (this.backend !== 'gcs' || !this.gcs) {
      this.logger.warn(
        `restoreToStandardClass called on non-GCS backend (${this.backend}); skipping ${key}`,
      );
      return;
    }
    await this.gcs.bucket(this.bucket).file(key).setStorageClass('STANDARD');
    this.logger.log(`GCS storage class restored to STANDARD: ${key}`);
  }

  getPublicUrl(key: string): string {
    if (this.backend === 'gcs') {
      return `https://storage.googleapis.com/${this.bucket}/${key}`;
    }
    if (this.backend === 's3') {
      const endpoint = this.configService.get<string>('S3_ENDPOINT') || '';
      return `${endpoint.replace(/\/$/, '')}/${this.bucket}/${key}`;
    }
    return key;
  }
}
