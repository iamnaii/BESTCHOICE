import { Injectable } from '@nestjs/common';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { AiProviderService } from '../ai-usage/ai-provider.service';
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
    private provider: AiProviderService,
  ) {
    this.anthropicClient = new AnthropicOcrClient(this.integrationConfig, this.provider);
    this.extractors = new OcrExtractorsService(this.anthropicClient, this.provider);
  }

  checkAiStatus(userId?: string): Promise<{ configured: boolean; connected: boolean; model: string; error?: string }> {
    return this.anthropicClient.checkAiStatus(userId);
  }

  generateTemplateHtml(fileBase64: string, userId?: string): Promise<{ contentHtml: string; placeholders: string[] }> {
    return this.extractors.generateTemplateHtml(fileBase64, userId);
  }

  extractIdCard(imageBase64: string, userId?: string): Promise<OcrIdCardResult> {
    return this.extractors.extractIdCard(imageBase64, userId);
  }

  extractPaymentSlip(imageBase64: string, userId?: string): Promise<OcrPaymentSlipResult> {
    return this.extractors.extractPaymentSlip(imageBase64, userId);
  }

  extractBookBank(imageBase64: string, userId?: string): Promise<OcrBookBankResult> {
    return this.extractors.extractBookBank(imageBase64, userId);
  }

  extractDrivingLicense(imageBase64: string, userId?: string): Promise<OcrDrivingLicenseResult> {
    return this.extractors.extractDrivingLicense(imageBase64, userId);
  }

  analyzeSalarySlip(imageBase64: string, userId?: string): Promise<OcrSalarySlipResult> {
    return this.extractors.analyzeSalarySlip(imageBase64, userId);
  }

  analyzeBankStatement(filesBase64: string[], userId?: string): Promise<OcrBankStatementResult> {
    return this.extractors.analyzeBankStatement(filesBase64, userId);
  }
}
