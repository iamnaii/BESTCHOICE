import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
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
}
