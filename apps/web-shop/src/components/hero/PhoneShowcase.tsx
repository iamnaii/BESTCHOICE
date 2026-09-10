import { ShieldCheck } from 'lucide-react';
import './phone-showcase.css';

/** Lightweight brand illustration; no model, colour or stock availability claim. */
export function PhoneShowcase() {
  return (
    <figure className="phone-showcase" aria-label="ภาพประกอบสมาร์ตโฟน BESTCHOICE">
      <div className="phone-showcase__halo" aria-hidden="true" />
      <div className="phone-showcase__stage" aria-hidden="true">
        <div data-phone-back className="phone-showcase__back">
          <div className="phone-showcase__cameras">
            <span />
            <span />
            <span />
            <i />
          </div>
          <img src="/logo-icon.svg" alt="" className="phone-showcase__back-logo" />
        </div>
        <div data-phone-front className="phone-showcase__front">
          <div className="phone-showcase__screen">
            <div className="phone-showcase__island" />
            <div className="phone-showcase__wordmark">
              <img src="/logo-icon.svg" alt="" />
              <span>
                BEST
                <br />
                CHOICE.
              </span>
              <small>เครื่องที่ใช่ ในแบบที่เป็นคุณ</small>
            </div>
            <div className="phone-showcase__home-bar" />
          </div>
        </div>
        <div data-hero-badge className="phone-showcase__badge">
          <span className="grid size-10 place-items-center rounded-full bg-muted text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div className="text-left leading-snug">
            <strong className="block font-head text-sm text-foreground">ตรวจเช็กก่อนส่งมอบ</strong>
            <span className="text-xs text-muted-foreground">เลือกเครื่องได้อย่างสบายใจ</span>
          </div>
        </div>
      </div>
      <figcaption className="phone-showcase__caption">
        ภาพประกอบ · เลือกดูเครื่องจริงในหน้าสินค้า
      </figcaption>
    </figure>
  );
}
