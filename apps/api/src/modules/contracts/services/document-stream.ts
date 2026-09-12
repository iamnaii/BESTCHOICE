import { Response } from 'express';
import { Readable } from 'stream';

/** Attach error handlers before piping: remote storage can fail after returning a stream. */
export function pipeDocumentStream(res: Response, file: { stream: Readable; filename: string; contentType: string }, disposition: 'inline' | 'attachment' = 'attachment') {
  res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `${disposition}; filename="${encodeURIComponent(file.filename)}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  file.stream.once('error', () => {
    if (res.headersSent) res.destroy();
    else {
      res.removeHeader('Content-Disposition');
      res.removeHeader('Content-Type');
      res.status(503).json({ message: 'ดาวน์โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่' });
    }
  });
  res.once('close', () => file.stream.destroy());
  file.stream.pipe(res);
}
