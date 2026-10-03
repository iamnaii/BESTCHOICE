import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { StorageService } from '../storage/storage.service';
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

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=',
    'base64',
  );
  it.each(['upload-image'])(
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
    ['fake.png', 'image/png', Buffer.from('not an image')],
    ['video.mp4', 'video/mp4', mp4],
  ])('rejects invalid image %s before storage', async (filename, contentType, bytes) => {
    await request(app.getHttpServer())
      .post('/line-oa/broadcast/upload-image')
      .attach('file', bytes, { filename, contentType })
      .expect(400);
    expect(objects.size).toBe(0);
  });
  it.each(['upload-video', 'upload-video-thumbnail', 'schedule'])('keeps retired %s route absent', async (route) => {
    await request(app.getHttpServer()).post(`/line-oa/broadcast/${route}`).expect(404);
    expect(objects.size).toBe(0);
  });
  it('keeps upload restricted to OWNER', async () => {
    await request(app.getHttpServer())
      .post('/line-oa/broadcast/upload-image')
      .set('x-test-role', 'SALES')
      .attach('file', png, { filename: 'test.png', contentType: 'image/png' })
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
