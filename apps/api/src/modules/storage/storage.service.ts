import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private gcs: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private s3: any;

  constructor(private configService: ConfigService) {
    const s3Endpoint = this.configService.get<string>('S3_ENDPOINT');
    const s3AccessKey = this.configService.get<string>('S3_ACCESS_KEY');
    const s3SecretKey = this.configService.get<string>('S3_SECRET_KEY');
    const gcsBucket = this.configService.get<string>('GCS_BUCKET');

    if (s3Endpoint && s3AccessKey && s3SecretKey) {
      // S3-compatible (MinIO, R2, etc.)
      this.backend = 's3';
      this.bucket = this.configService.get<string>('S3_BUCKET') || 'bestchoice-documents';
      this.initS3(s3Endpoint, s3AccessKey, s3SecretKey);
    } else if (gcsBucket || this.configService.get('NODE_ENV') === 'production') {
      // GCS with Application Default Credentials (auto on Cloud Run)
      this.backend = 'gcs';
      this.bucket = gcsBucket || 'bestchoice-documents';
      this.initGcs();
    } else {
      this.backend = 'none';
      this.bucket = '';
      this.logger.warn('Storage not configured — set GCS_BUCKET or S3_ENDPOINT');
    }
  }

  private initS3(endpoint: string, accessKeyId: string, secretAccessKey: string) {
    // Dynamic import to avoid bundling S3 SDK when using GCS
    const { S3Client } = require('@aws-sdk/client-s3');
    this.s3 = new S3Client({
      endpoint,
      region: this.configService.get<string>('S3_REGION') || 'ap-southeast-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    this.logger.log(`S3 storage configured: ${endpoint}/${this.bucket}`);
  }

  private initGcs() {
    const { Storage } = require('@google-cloud/storage');
    this.gcs = new Storage();
    this.logger.log(`GCS storage configured: gs://${this.bucket}`);
  }

  get configured(): boolean {
    return this.backend !== 'none';
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    if (this.backend === 'gcs') {
      const file = this.gcs.bucket(this.bucket).file(key);
      await file.save(body, { contentType, resumable: false });
      this.logger.log(`GCS uploaded: ${key} (${body.length} bytes)`);
      return key;
    }

    if (this.backend === 's3') {
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
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
    if (this.backend === 'gcs') {
      const file = this.gcs.bucket(this.bucket).file(key);
      const [exists] = await file.exists();
      if (!exists) throw new BadRequestException(`ไม่พบไฟล์: ${key}`);
      return file.createReadStream();
    }

    if (this.backend === 's3') {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const response = await this.s3.send(new GetObjectCommand({
        Bucket: this.bucket, Key: key,
      }));
      return response.Body as Readable;
    }

    throw new BadRequestException('Storage not configured');
  }

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    if (this.backend === 'gcs') {
      const file = this.gcs.bucket(this.bucket).file(key);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + expiresIn * 1000,
      });
      return url;
    }

    if (this.backend === 's3') {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      return getSignedUrl(this.s3, command, { expiresIn });
    }

    throw new BadRequestException('Storage not configured');
  }

  async delete(key: string): Promise<void> {
    if (this.backend === 'gcs') {
      await this.gcs.bucket(this.bucket).file(key).delete({ ignoreNotFound: true });
      this.logger.log(`GCS deleted: ${key}`);
      return;
    }

    if (this.backend === 's3') {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.log(`S3 deleted: ${key}`);
      return;
    }
  }
}
