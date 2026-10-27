import { InternalServerErrorException } from '@nestjs/common';

/** A timed-out acquisition may resolve later, but has no continuation that can submit. */
export class TemplateGenerationDeadline {
  readonly controller = new AbortController();
  readonly expiresAt = Date.now() + 30000;
  check = () => {
    if (this.controller.signal.aborted || Date.now() >= this.expiresAt) {
      this.controller.abort();
      throw new InternalServerErrorException('AI ใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง');
    }
  };
  async wait<T>(work: () => Promise<T>, maxMs = 30000): Promise<T> {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work().then((value) => {
          this.check();
          return value;
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => {
              this.controller.abort();
              try {
                this.check();
              } catch (error) {
                reject(error);
              }
            },
            Math.min(maxMs, this.expiresAt - Date.now()),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
