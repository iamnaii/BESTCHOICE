import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  private readonly isConfigured: boolean;

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('S3_SECRET_KEY');
    this.bucket = this.configService.get<string>('S3_BUCKET') || 'bestchoice-documents';

    this.isConfigured = !!(endpoint && accessKeyId && secretAccessKey);

    if (this.isConfigured) {
      this.s3 = new S3Client({
        endpoint,
        region: this.configService.get<string>('S3_REGION') || 'ap-southeast-1',
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
        forcePathStyle: true, // Required for MinIO
      });
      this.logger.log(`S3 storage configured: ${endpoint}/${this.bucket}`);
    } else {
      this.s3 = null;
      this.logger.warn('S3 storage not configured — files will not be stored');
    }
  }

  /**
   * Upload a file to S3/MinIO
   * @returns The S3 key (path) of the uploaded file
   */
  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    if (!this.s3) {
      this.logger.warn(`S3 not configured, skipping upload: ${key}`);
      return key; // Return key as-is for DB storage
    }

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    this.logger.log(`Uploaded: ${key} (${body.length} bytes)`);
    return key;
  }

  /**
   * Get a readable stream for downloading a file
   */
  async getStream(key: string): Promise<Readable> {
    if (!this.s3) {
      throw new Error('S3 storage not configured');
    }

    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return response.Body as Readable;
  }

  /**
   * Generate a pre-signed URL for downloading (valid for 1 hour)
   */
  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!this.s3) {
      throw new Error('S3 storage not configured');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * Delete a file from S3
   */
  async delete(key: string): Promise<void> {
    if (!this.s3) return;

    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    this.logger.log(`Deleted: ${key}`);
  }

  get configured(): boolean {
    return this.isConfigured;
  }
}
