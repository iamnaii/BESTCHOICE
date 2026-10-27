import { BadRequestException } from '@nestjs/common';
import { CreateTemplateDto, UpdateTemplateDto } from '../dto/document.dto';

export const TEMPLATE_HTML_BYTES = 1024 * 1024;
const invalid = () => new BadRequestException('ข้อมูลเทมเพลตไม่ถูกต้องหรือมีขนาดใหญ่เกินไป');
function text(value: unknown, length: number, required = false) {
  if (typeof value !== 'string' || value.length > length || (required && !value.trim()))
    throw invalid();
}
function json(value: unknown, bytes: number, depth: number, nodes: number) {
  const seen = new Set<object>();
  function walk(v: unknown, level: number) {
    if (--nodes < 0 || level > depth) throw invalid();
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw invalid();
      return;
    }
    if (typeof v === 'string') {
      if (Buffer.byteLength(v) > bytes) throw invalid();
      return;
    }
    if (
      !v ||
      typeof v !== 'object' ||
      seen.has(v) ||
      (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)
    )
      throw invalid();
    seen.add(v);
    for (const entry of Object.values(v)) walk(entry, level + 1);
    seen.delete(v);
  }
  walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > bytes) throw invalid();
}
export function validateTemplateInput(dto: CreateTemplateDto | UpdateTemplateDto, create: boolean) {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw invalid();
  if (create || dto.name !== undefined) text(dto.name, 256, true);
  if ('type' in dto && dto.type !== undefined) text(dto.type, 128, true);
  if (create || dto.contentHtml !== undefined) {
    text(dto.contentHtml, TEMPLATE_HTML_BYTES, true);
    if (Buffer.byteLength(dto.contentHtml!) > TEMPLATE_HTML_BYTES) throw invalid();
  }
  if (dto.placeholders !== undefined) {
    if (!Array.isArray(dto.placeholders) || dto.placeholders.length > 1000) throw invalid();
    for (const value of dto.placeholders) text(value, 256);
  }
  if (dto.blocks !== undefined) {
    if (!Array.isArray(dto.blocks) || dto.blocks.length > 2000) throw invalid();
    json(dto.blocks, 2 * 1024 * 1024, 32, 20000);
  }
  if (dto.settings !== undefined) {
    if (dto.settings !== null && (typeof dto.settings !== 'object' || Array.isArray(dto.settings)))
      throw invalid();
    json(dto.settings, 256 * 1024, 16, 5000);
  }
  if (dto.isActive !== undefined && typeof dto.isActive !== 'boolean') throw invalid();
}
