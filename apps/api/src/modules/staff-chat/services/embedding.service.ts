import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';

const DEFAULT_MODEL = 'text-multilingual-embedding-002';
const DEFAULT_LOCATION = 'us-central1';
const EMBEDDING_DIM = 768;
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

type TaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' | 'SEMANTIC_SIMILARITY';

interface VertexEmbeddingResponse {
  predictions: { embeddings: { values: number[]; statistics: { token_count: number } } }[];
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly auth: GoogleAuth;
  private readonly project: string | undefined;
  private readonly location: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(private config: ConfigService) {
    this.project =
      this.config.get<string>('GOOGLE_CLOUD_PROJECT') ??
      this.config.get<string>('GCP_PROJECT_ID');
    this.location = this.config.get<string>('VERTEX_LOCATION') ?? DEFAULT_LOCATION;
    this.model = this.config.get<string>('VERTEX_EMBEDDING_MODEL') ?? DEFAULT_MODEL;
    this.endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}/locations/${this.location}/publishers/google/models/${this.model}:predict`;

    this.auth = new GoogleAuth({ scopes: [VERTEX_SCOPE] });

    if (!this.project) {
      this.logger.warn(
        'GOOGLE_CLOUD_PROJECT not set — semantic retrieval disabled. Set env var or run `gcloud auth application-default login`.',
      );
    }
  }

  isReady(): boolean {
    return Boolean(this.project);
  }

  getModel(): string {
    return this.model;
  }

  getDimension(): number {
    return EMBEDDING_DIM;
  }

  async embedOne(text: string, task: TaskType = 'RETRIEVAL_QUERY'): Promise<number[]> {
    const [embedding] = await this.embedBatch([text], task);
    return embedding;
  }

  async embedBatch(texts: string[], task: TaskType = 'RETRIEVAL_DOCUMENT'): Promise<number[][]> {
    if (!this.project) {
      throw new ServiceUnavailableException('GOOGLE_CLOUD_PROJECT ไม่ได้ตั้งค่า');
    }
    if (texts.length === 0) return [];

    const client = await this.auth.getClient();
    const accessToken = (await client.getAccessToken()).token;
    if (!accessToken) {
      throw new ServiceUnavailableException(
        'ไม่สามารถขอ access token ของ Google Cloud ได้ — ตรวจสอบ ADC',
      );
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: texts.map((t) => ({ content: t, task_type: task })),
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      this.logger.error(`Vertex embed failed (${res.status}): ${errBody}`);
      throw new ServiceUnavailableException(`Vertex embed failed: ${res.status}`);
    }

    const json = (await res.json()) as VertexEmbeddingResponse;
    return json.predictions.map((p) => p.embeddings.values);
  }

  /** Convert a number[] embedding to pgvector literal: '[0.1,0.2,...]' */
  toPgvector(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
