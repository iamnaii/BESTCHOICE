import { IncomingMessage } from 'http';

/** Express request extended with raw body buffer for webhook HMAC verification */
export interface RawBodyRequest extends IncomingMessage {
  rawBody?: Buffer;
}
