import { Worker } from 'node:worker_threads';
import { PDFDocument, PDFName } from 'pdf-lib';
import { validateCustomerDocument } from './customer-document-file';
function file(buffer: Buffer): Express.Multer.File {
  return {
    buffer,
    size: buffer.length,
    mimetype: 'application/pdf',
    originalname: 'proof.pdf',
  } as Express.Multer.File;
}
async function document(pages = 1) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index++) pdf.addPage([100, 100]);
  return pdf;
}
it('rejects encryption dictionaries without attempting to decrypt caller PDFs', async () => {
  const pdf = await document();
  pdf.context.trailerInfo.Encrypt = pdf.context.register(
    pdf.context.obj({ Filter: PDFName.of('Standard'), V: 1, R: 2, Length: 40, P: -4 }),
  );
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  await expect(validateCustomerDocument(file(bytes))).rejects.toMatchObject({ status: 400 });
});
it('enforces the actual200-page bound inside the isolated parser', async () => {
  const pdf = await document(201),
    bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  await expect(validateCustomerDocument(file(bytes))).rejects.toMatchObject({ status: 400 });
});
it('terminates the actual worker on a deadline and does not release a validation result', async () => {
  const pdf = await document(),
    bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  const terminate = jest.spyOn(Worker.prototype, 'terminate');
  const realTimeout = global.setTimeout;
  // Shorten only our3s parser deadline: the worker is real, including actual termination.
  const timer = jest
    .spyOn(global, 'setTimeout')
    .mockImplementation(((
      handler: (...args: unknown[]) => void,
      timeout?: number,
      ...args: unknown[]
    ) => realTimeout(handler, timeout === 3000 ? 1 : timeout, ...args)) as typeof setTimeout);
  try {
    await expect(validateCustomerDocument(file(bytes))).rejects.toMatchObject({ status: 400 });
    expect(terminate).toHaveBeenCalledTimes(1);
    await expect(terminate.mock.results[0].value).resolves.toEqual(expect.any(Number));
  } finally {
    timer.mockRestore();
    terminate.mockRestore();
  }
});
it('terminates successful parser workers and rejects declared MIME/size inconsistency', async () => {
  const pdf = await document(),
    bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  const terminate = jest.spyOn(Worker.prototype, 'terminate');
  try {
    await expect(validateCustomerDocument(file(bytes))).resolves.toMatchObject({
      mimeType: 'application/pdf',
      fileSize: bytes.length,
    });
    expect(terminate).toHaveBeenCalledTimes(1);
    await expect(terminate.mock.results[0].value).resolves.toEqual(expect.any(Number));
  } finally {
    terminate.mockRestore();
  }
  await expect(
    validateCustomerDocument({ ...file(bytes), mimetype: 'image/png' }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    validateCustomerDocument({ ...file(bytes), size: bytes.length + 1 }),
  ).rejects.toMatchObject({ status: 400 });
});
