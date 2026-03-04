import express from 'express';
import cors from 'cors';
import { readThaiIdCard, ThaiIdCardData } from './thai-smart-card';

const PORT = Number(process.env.CARD_READER_PORT) || 3457;
const app = express();

// Allow requests from any origin (the web app runs on a different port/domain)
app.use(cors());
app.use(express.json());

// ─── PC/SC Smart Card Reader Setup ────────────────────────

let pcsc: any = null;
let connectedReaders: Map<string, any> = new Map();
let lastCardData: ThaiIdCardData | null = null;
let readerStatus: 'no_pcsc' | 'no_reader' | 'waiting' | 'card_inserted' | 'reading' | 'error' = 'no_pcsc';
let readerError: string = '';
let readerName: string = '';
let isReading = false; // Lock to prevent concurrent reads

function initPCSC(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pcsclite = require('pcsclite');
    pcsc = pcsclite();
    readerStatus = 'no_reader';
    console.log('[Card Reader] PC/SC service initialized');

    pcsc.on('reader', (reader: any) => {
      readerName = reader.name;
      connectedReaders.set(reader.name, reader);
      readerStatus = 'waiting';
      console.log(`[Card Reader] Reader detected: ${reader.name}`);

      reader.on('status', (status: any) => {
        const changes = reader.state ^ status.state;
        if (!changes) return;

        // Card inserted
        if ((changes & reader.SCARD_STATE_PRESENT) && (status.state & reader.SCARD_STATE_PRESENT)) {
          readerStatus = 'card_inserted';
          console.log('[Card Reader] Card inserted');

          // Auto-read on card insert
          if (isReading) {
            console.log('[Card Reader] Skipping auto-read — already reading');
            return;
          }
          reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, async (err: Error | null, protocol: number) => {
            if (err) {
              readerStatus = 'error';
              readerError = `เชื่อมต่อบัตรไม่ได้: ${err.message}`;
              console.error('[Card Reader] Connect error:', err.message);
              return;
            }

            isReading = true;
            readerStatus = 'reading';
            console.log('[Card Reader] Reading card data...');

            try {
              lastCardData = await readThaiIdCard(reader, protocol);
              readerStatus = 'card_inserted';
              readerError = '';
              console.log(`[Card Reader] Read success: ${lastCardData.nationalId} — ${lastCardData.firstName} ${lastCardData.lastName}`);
            } catch (readErr: any) {
              readerStatus = 'error';
              readerError = readErr.message || 'อ่านบัตรไม่สำเร็จ';
              console.error('[Card Reader] Read error:', readErr.message);
            } finally {
              isReading = false;
            }

            // Disconnect
            reader.disconnect(reader.SCARD_LEAVE_CARD, (disconnErr: Error | null) => {
              if (disconnErr) console.error('[Card Reader] Disconnect error:', disconnErr.message);
            });
          });
        }

        // Card removed
        if ((changes & reader.SCARD_STATE_EMPTY) && (status.state & reader.SCARD_STATE_EMPTY)) {
          readerStatus = 'waiting';
          readerError = '';
          lastCardData = null;
          console.log('[Card Reader] Card removed — data cleared');
        }
      });

      reader.on('end', () => {
        connectedReaders.delete(reader.name);
        if (connectedReaders.size === 0) {
          readerStatus = 'no_reader';
          readerName = '';
        }
        console.log(`[Card Reader] Reader removed: ${reader.name}`);
      });

      reader.on('error', (err: Error) => {
        readerStatus = 'error';
        readerError = err.message;
        console.error(`[Card Reader] Reader error: ${err.message}`);
      });
    });

    pcsc.on('error', (err: Error) => {
      readerStatus = 'no_pcsc';
      readerError = err.message;
      console.error('[Card Reader] PC/SC error:', err.message);
    });
  } catch (err: any) {
    readerStatus = 'no_pcsc';
    readerError = err.message || 'ไม่สามารถเริ่ม PC/SC service ได้';
    console.error('[Card Reader] Failed to initialize PC/SC:', err.message);
    if (err.code === 'MODULE_NOT_FOUND') {
      console.error('[Card Reader] Missing module — check that pcsclite and bindings are in node_modules');
      console.error('[Card Reader] Module search paths:', module.paths);
    }
  }
}

// ─── API Endpoints ─────────────────────────────────────────

/** Health check / status */
app.get('/api/status', (_req, res) => {
  res.json({
    service: 'bestchoice-card-reader',
    version: '1.0.0',
    status: readerStatus,
    readerName: readerName || null,
    error: readerStatus === 'error' ? readerError : null,
    hasCardData: lastCardData !== null,
    statusText: getStatusText(readerStatus),
  });
});

/** Read card — returns last read data or triggers a new read */
app.get('/api/read-card', async (_req, res) => {
  if (readerStatus === 'no_pcsc') {
    return res.status(503).json({
      error: 'PC/SC service not available',
      message: 'ไม่พบ PC/SC service บนเครื่อง กรุณาตรวจสอบว่า Smart Card Service ทำงานอยู่',
    });
  }

  if (readerStatus === 'no_reader') {
    return res.status(503).json({
      error: 'No reader found',
      message: 'ไม่พบเครื่องอ่านบัตร กรุณาเสียบเครื่องอ่านบัตร USB',
    });
  }

  if (readerStatus === 'waiting') {
    return res.status(404).json({
      error: 'No card',
      message: 'กรุณาเสียบบัตรประชาชนเข้าเครื่องอ่านบัตร',
    });
  }

  if (readerStatus === 'reading') {
    return res.status(202).json({
      error: 'Reading',
      message: 'กำลังอ่านข้อมูลจากบัตร กรุณารอสักครู่...',
    });
  }

  if (readerStatus === 'error') {
    return res.status(500).json({
      error: 'Read error',
      message: readerError || 'เกิดข้อผิดพลาดในการอ่านบัตร',
    });
  }

  if (!lastCardData) {
    return res.status(404).json({
      error: 'No data',
      message: 'ยังไม่มีข้อมูลบัตร กรุณาเสียบบัตรประชาชนเข้าเครื่องอ่าน',
    });
  }

  res.json({
    success: true,
    data: lastCardData,
  });
});

/** Force re-read the current card */
app.post('/api/read-card', async (_req, res) => {
  if (connectedReaders.size === 0) {
    return res.status(503).json({
      error: 'No reader',
      message: 'ไม่พบเครื่องอ่านบัตร',
    });
  }

  if (isReading) {
    return res.status(409).json({
      error: 'Already reading',
      message: 'กำลังอ่านบัตรอยู่แล้ว กรุณารอสักครู่',
    });
  }

  const reader = connectedReaders.values().next().value;
  if (!reader) {
    return res.status(503).json({
      error: 'Reader unavailable',
      message: 'เครื่องอ่านบัตรไม่พร้อมใช้งาน',
    });
  }

  isReading = true;
  try {
    const protocol = await new Promise<number>((resolve, reject) => {
      reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (err: Error | null, proto: number) => {
        if (err) reject(err);
        else resolve(proto);
      });
    });

    readerStatus = 'reading';
    lastCardData = await readThaiIdCard(reader, protocol);
    readerStatus = 'card_inserted';
    readerError = '';

    reader.disconnect(reader.SCARD_LEAVE_CARD, (disconnErr: Error | null) => {
      if (disconnErr) console.error('[Card Reader] Disconnect error:', disconnErr.message);
    });

    res.json({
      success: true,
      data: lastCardData,
    });
  } catch (err: any) {
    readerStatus = 'error';
    readerError = err.message;
    res.status(500).json({
      error: 'Read failed',
      message: err.message || 'อ่านบัตรไม่สำเร็จ',
    });
  } finally {
    isReading = false;
  }
});

/** Clear cached card data */
app.delete('/api/read-card', (_req, res) => {
  lastCardData = null;
  res.json({ success: true, message: 'ล้างข้อมูลบัตรแล้ว' });
});

function getStatusText(status: string): string {
  switch (status) {
    case 'no_pcsc': return 'ไม่พบ PC/SC service';
    case 'no_reader': return 'ไม่พบเครื่องอ่านบัตร';
    case 'waiting': return 'รอเสียบบัตร';
    case 'card_inserted': return 'พร้อมอ่านบัตร';
    case 'reading': return 'กำลังอ่านบัตร...';
    case 'error': return 'เกิดข้อผิดพลาด';
    default: return status;
  }
}

// ─── Start Server ──────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║   BESTCHOICE Smart Card Reader Service v1.0.0   ║
║   Port: ${PORT}                                    ║
║   URL: http://localhost:${PORT}                    ║
╚══════════════════════════════════════════════════╝
  `);
  initPCSC();
});
