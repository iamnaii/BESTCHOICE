import { Injectable } from '@nestjs/common';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { AnthropicOcrClient } from './services/anthropic-ocr.client';
import { OcrExtractorsService } from './services/ocr-extractors.service';
import {
  OcrIdCardResult,
  OcrPaymentSlipResult,
  OcrBookBankResult,
  OcrDrivingLicenseResult,
  OcrSalarySlipResult,
  OcrBankStatementResult,
} from './dto/ocr.dto';

@Injectable()
export class OcrService {
  private readonly anthropicClient: AnthropicOcrClient;
  private readonly extractors: OcrExtractorsService;

  constructor(
    private integrationConfig: IntegrationConfigService,
    private aiUsage: AiUsageService,
  ) {
    this.anthropicClient = new AnthropicOcrClient(this.integrationConfig, this.aiUsage);
    this.extractors = new OcrExtractorsService(this.anthropicClient, this.aiUsage);
  }

  checkAiStatus(): Promise<{ configured: boolean; connected: boolean; model: string; error?: string }> {
    return this.anthropicClient.checkAiStatus();
  }

  generateTemplateHtml(fileBase64: string): Promise<{ contentHtml: string; placeholders: string[] }> {
    return this.extractors.generateTemplateHtml(fileBase64);
  }

  extractIdCard(imageBase64: string): Promise<OcrIdCardResult> {
    return this.extractors.extractIdCard(imageBase64);
  }

  extractPaymentSlip(imageBase64: string): Promise<OcrPaymentSlipResult> {
    return this.extractors.extractPaymentSlip(imageBase64);
  }

  extractBookBank(imageBase64: string): Promise<OcrBookBankResult> {
    return this.extractors.extractBookBank(imageBase64);
  }

  extractDrivingLicense(imageBase64: string): Promise<OcrDrivingLicenseResult> {
    return this.extractors.extractDrivingLicense(imageBase64);
  }

  analyzeSalarySlip(imageBase64: string): Promise<OcrSalarySlipResult> {
    return this.extractors.analyzeSalarySlip(imageBase64);
  }

  analyzeBankStatement(filesBase64: string[]): Promise<OcrBankStatementResult> {
    return this.extractors.analyzeBankStatement(filesBase64);
  }
}
