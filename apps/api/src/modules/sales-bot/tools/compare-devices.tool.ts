import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { compareDevices, findDeviceSpec } from '../data/device-specs';
import { estimateTradeIn, type TradeInEstimate } from './trade-in-estimate';

export const COMPARE_DEVICES_TOOL = {
  name: 'compare_devices',
  description:
    'Compare a candidate iPhone against the model the customer uses now, using the official ' +
    'Apple spec table (chip, camera, 5G, display, battery, Face ID, USB-C, iOS support). ' +
    'Call this when the customer asks how a model is better / different from their current ' +
    'phone ("ดีกว่ายังไง", "ต่างกันตรงไหน", "คุ้มไหมถ้าเปลี่ยนจาก 11"). Returns ready-to-send ' +
    'Thai sentences: `better` (≤3 strongest wins + iOS note), `same`, and `worse` (honest ' +
    'downsides — tell the customer), plus generationGap and tradeIn (estimated grade-A buy-back ' +
    'value of the current device, ราคาประมาณ). This tool has NO device prices — do NOT quote ' +
    'prices in the same turn; the sales flow asks for storage/rate afterwards. STRICT: use spec ' +
    'sentences and numbers ONLY from this result — never invent specs from memory. If either ' +
    'model is not recognized (recognized=false — e.g. the customer uses Samsung/Android) ' +
    'better/same/worse are empty: use `candidateHighlights` (from the spec table) to describe ' +
    'the iPhone, never describe the non-iPhone device from memory, and note the shop does NOT ' +
    'take non-iPhone trade-ins (tradeIn is null). If the candidate is unrecognized ask the customer to ' +
    'confirm the model instead of guessing.',
  input_schema: {
    type: 'object',
    properties: {
      currentModel: {
        type: 'string',
        description: 'Raw text of the model the customer uses now, e.g. "ใช้ 11 อยู่", "XR 64GB"',
      },
      candidateModel: {
        type: 'string',
        description: 'Raw text of the model being considered, e.g. "15", "iPhone 16 Pro"',
      },
    },
    required: ['currentModel', 'candidateModel'],
  },
};

export interface CompareDevicesResult {
  current: { model: string; recognized: boolean };
  candidate: { model: string; recognized: boolean };
  /** จุดเด่นของรุ่นที่สนใจจากตารางสเปค — ใช้เมื่อเทียบข้ามยี่ห้อไม่ได้ (current ไม่รู้จัก) */
  candidateHighlights: string[];
  better: string[];
  same: string[];
  worse: string[];
  generationGap: number | null;
  tradeIn: TradeInEstimate | null;
}

@Injectable()
export class CompareDevicesTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { currentModel: string; candidateModel: string }): Promise<CompareDevicesResult> {
    const currentText = String(input?.currentModel ?? '').trim();
    const candidateText = String(input?.candidateModel ?? '').trim();
    const currentSpec = currentText ? findDeviceSpec(currentText) : null;
    const candidateSpec = candidateText ? findDeviceSpec(candidateText) : null;

    const diff = currentSpec && candidateSpec ? compareDevices(currentSpec, candidateSpec) : null;
    const tradeIn = await estimateTradeIn(this.prisma, currentSpec, currentText);

    return {
      current: { model: currentSpec?.model ?? currentText, recognized: currentSpec !== null },
      candidate: {
        model: candidateSpec?.model ?? candidateText,
        recognized: candidateSpec !== null,
      },
      candidateHighlights: candidateSpec?.highlights ?? [],
      better: diff?.better ?? [],
      same: diff?.same ?? [],
      worse: diff?.worse ?? [],
      generationGap: diff?.generationGap ?? null,
      tradeIn,
    };
  }
}
