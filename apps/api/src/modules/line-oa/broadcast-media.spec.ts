import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Real Nest multipart parsing, service and S3 SDK; only the remote object store is local.
describe('Broadcast media HTTP and storage contract', () => {
  let app: INestApplication;
  let store: Server;
  let origin: string;
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const mp4 = Buffer.from(
    '000000206674797069736f6d0000020069736f6d69736f32617663316d703431',
    'hex',
  );

  beforeAll(async () => {
    store = createServer(async (req, res) => {
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        objects.set(req.url!.split('?')[0], {
          bytes: Buffer.concat(chunks),
          contentType: req.headers['content-type'] ?? '',
        });
        res.writeHead(200, { ETag: '"test"' }).end();
        return;
      }
      const object = objects.get(req.url!);
      if (!object) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': object.contentType }).end(object.bytes);
    });
    await new Promise<void>((resolve) => store.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(store.address() as AddressInfo).port}`;
    const values: Record<string, string> = {
      NODE_ENV: 'test',
      S3_ENDPOINT: origin,
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
      S3_BUCKET: 'broadcast-test',
      S3_REGION: 'us-east-1',
    };
    const module = await Test.createTestingModule({
      controllers: [BroadcastController],
      providers: [
        BroadcastService,
        StorageService,
        { provide: ConfigService, useValue: { get: (key: string) => values[key] } },
        { provide: PrismaService, useValue: {} },
        { provide: IntegrationConfigService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = {
            id: 'test-owner',
            role: context.switchToHttp().getRequest().headers['x-test-role'] ?? 'OWNER',
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => store?.close(() => resolve()));
  });
  beforeEach(() => objects.clear());

  it('uploads MP4 via multipart and returns retrievable bytes with video/mp4 metadata', async () => {
    const result = await request(app.getHttpServer())
      .post('/line-oa/broadcast/upload-video')
      .attach('file', mp4, { filename: 'test.mp4', contentType: 'video/mp4' })
      .expect(201);
    const url = new URL(result.body.url);
    expect(url.origin).toBe(origin);
    const downloaded = await fetch(url);
    expect(downloaded.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(mp4);
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=',
    'base64',
  );
  it.each(['upload-image', 'upload-video-thumbnail'])(
    'keeps PNG bytes and content type through %s',
    async (route) => {
      const result = await request(app.getHttpServer())
        .post(`/line-oa/broadcast/${route}`)
        .attach('file', png, { filename: 'รูปปก.png', contentType: 'image/png' })
        .expect(201);
      const downloaded = await fetch(result.body.url);
      expect(downloaded.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(png);
    },
  );
  it.each([
    ['upload-video', 'fake.mp4', 'video/mp4', Buffer.from('not a video')],
    ['upload-video', 'image.png', 'image/png', png],
    ['upload-video-thumbnail', 'video.mp4', 'video/mp4', mp4],
    ['upload-image', 'video.mp4', 'video/mp4', mp4],
  ])('rejects invalid media on %s before storage', async (route, filename, contentType, bytes) => {
    await request(app.getHttpServer())
      .post(`/line-oa/broadcast/${route}`)
      .attach('file', bytes, { filename, contentType })
      .expect(400);
    expect(objects.size).toBe(0);
  });
  it('rejects a thumbnail larger than 1MB before storage', async () => {
    await request(app.getHttpServer())
      .post('/line-oa/broadcast/upload-video-thumbnail')
      .attach('file', Buffer.concat([png, Buffer.alloc(1024 * 1024)]), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(objects.size).toBe(0);
  });
  it('keeps upload restricted to OWNER', async () => {
    await request(app.getHttpServer())
      .post('/line-oa/broadcast/upload-video')
      .set('x-test-role', 'SALES')
      .attach('file', mp4, { filename: 'test.mp4', contentType: 'video/mp4' })
      .expect(403);
    expect(objects.size).toBe(0);
  });
  it('does not store a PNG under forged JPEG metadata', async () => {
    const result = await request(app.getHttpServer())
      .post('/line-oa/broadcast/upload-image')
      .attach('file', png, { filename: 'fake.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const downloaded = await fetch(result.body.url);
    expect(downloaded.headers.get('content-type')).toBe('image/png');
  });
});
