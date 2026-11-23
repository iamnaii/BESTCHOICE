import {
  ArrowRight as InlineArrowRightIcon,
  CreditCard as InlineCreditCardIcon,
  Heart as InlineHeartIcon,
  MapPin as InlineMapPinIcon,
  MessageCircle as InlineMessageCircleIcon,
  Phone as InlinePhoneIcon,
  ShieldCheck as InlineShieldCheckIcon,
  Smartphone as InlineSmartphoneIcon,
} from '@/lib/icons';
import { useRef, useCallback } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import LandingNav from '@/components/landing/LandingNav';
import ProductCard from '@/components/landing/ProductCard';
import { getAccessToken } from '@/lib/api';
import api from '@/lib/api';

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  costPrice: string;
  status: string;
  prices: { id: string; label: string; amount: string; isDefault: boolean }[];
}

export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const productsRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);

  const scrollTo = useCallback((section: string) => {
    const refs: Record<string, React.RefObject<HTMLDivElement | null>> = {
      hero: heroRef,
      products: productsRef,
      services: servicesRef,
      contact: contactRef,
    };
    refs[section]?.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const hasToken = !!getAccessToken();

  const { data: productsResult } = useQuery<{ data: Product[] }>({
    queryKey: ['landing-products'],
    queryFn: async () => {
      const { data } = await api.get('/products', { params: { status: 'IN_STOCK', page: '1' } });
      return data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: hasToken,
    retry: false,
  });

  const products = productsResult?.data?.slice(0, 8) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <LandingNav onScrollTo={scrollTo} />

      {/* Hero Section */}
      <section ref={heroRef} className="relative pt-16 overflow-hidden">
        <div className="bg-hero-gradient">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              {/* Text Content */}
              <div className="animate-slideUp">
                <span className="inline-block px-4 py-1.5 text-xs font-semibold text-primary-foreground/80 bg-primary-foreground/10 rounded-full mb-6">
                  ร้านมือถือที่คุณไว้วางใจ
                </span>
                <h1 className="text-3xl lg:text-4xl xl:text-5xl font-bold text-primary-foreground leading-tight">
                  สินค้าคุณภาพ
                  <br />
                  <span className="text-primary-foreground underline decoration-primary-foreground/40 underline-offset-8">ผ่อนสบาย</span>
                  <br />
                  ราคาเป็นกันเอง
                </h1>
                <p className="mt-6 text-lg text-primary-foreground/70 max-w-lg leading-relaxed">
                  เลือกซื้อสมาร์ทโฟนคุณภาพ ทั้งเครื่องใหม่และมือสอง
                  พร้อมบริการผ่อนชำระที่ยืดหยุ่น ดูแลหลังการขายครบวงจร
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    onClick={() => scrollTo('products')}
                    className="px-8 py-3 text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                  >
                    ดูสินค้าทั้งหมด
                  </button>
                  <button
                    onClick={() => scrollTo('contact')}
                    className="px-8 py-3 text-sm font-semibold text-primary-foreground border border-primary-foreground/30 hover:bg-primary-foreground/10 rounded-xl transition-all"
                  >
                    ติดต่อเรา
                  </button>
                </div>

                {/* Stats */}
                <div className="mt-12 grid grid-cols-3 gap-6">
                  <div className="bg-primary-foreground/5 backdrop-blur-xs border border-primary-foreground/10 rounded-xl p-4">
                    <div className="text-2xl lg:text-3xl font-bold text-primary-foreground">500+</div>
                    <div className="text-sm text-primary-foreground/50 mt-1">สินค้าพร้อมขาย</div>
                  </div>
                  <div className="bg-primary-foreground/5 backdrop-blur-xs border border-primary-foreground/10 rounded-xl p-4">
                    <div className="text-2xl lg:text-3xl font-bold text-primary-foreground">1,000+</div>
                    <div className="text-sm text-primary-foreground/50 mt-1">ลูกค้าที่ไว้ใจ</div>
                  </div>
                  <div className="bg-primary-foreground/5 backdrop-blur-xs border border-primary-foreground/10 rounded-xl p-4">
                    <div className="text-2xl lg:text-3xl font-bold text-primary-foreground">5+</div>
                    <div className="text-sm text-primary-foreground/50 mt-1">สาขาทั่วประเทศ</div>
                  </div>
                </div>
              </div>

              {/* Phone Illustration */}
              <div className="hidden lg:flex justify-center">
                <div className="relative">
                  <div className="w-64 h-[500px] bg-linear-to-b from-white/10 to-white/5 rounded-[3rem] border border-white/20 flex items-center justify-center animate-float">
                    <div className="w-56 h-[460px] bg-linear-to-b from-primary-800 to-primary-900 rounded-[2.5rem] flex flex-col items-center justify-center gap-4">
                      <InlineSmartphoneIcon className="w-20 h-20 text-primary-foreground/80" aria-hidden="true" />
                      <p className="text-primary-foreground/80 text-sm font-medium">Best Choice</p>
                    </div>
                  </div>
                  {/* Decorative circles */}
                  <div className="absolute -top-8 -right-8 w-24 h-24 bg-primary-500/20 rounded-full blur-xl" />
                  <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-primary-500/20 rounded-full blur-xl" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section ref={productsRef} className="py-20 bg-muted">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="inline-block px-4 py-1.5 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-4">
              สินค้าของเรา
            </span>
            <h2 className="text-3xl lg:text-4xl font-bold leading-[1.3] text-foreground">
              สินค้า<span className="text-primary">แนะนำ</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              เลือกชมสมาร์ทโฟนคุณภาพ ทั้งเครื่องใหม่และมือสองสภาพดี พร้อมรับประกันคุณภาพ
            </p>
          </div>

          {products.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {products.map((product) => {
                const defaultPrice = product.prices.find((p) => p.isDefault);
                return (
                  <ProductCard
                    key={product.id}
                    productId={product.id}
                    brand={product.brand}
                    model={product.model}
                    price={defaultPrice?.amount || product.costPrice}
                    category={product.category}
                  />
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Placeholder cards when no data */}
              {[
                { brand: 'iPhone', model: '15 Pro Max', price: '42900', category: 'PHONE_NEW', grade: null },
                { brand: 'Samsung', model: 'Galaxy S24 Ultra', price: '39900', category: 'PHONE_NEW', grade: null },
                { brand: 'iPhone', model: '14 Pro', price: '25900', category: 'PHONE_USED', grade: 'A' },
                { brand: 'Samsung', model: 'Galaxy A55', price: '12900', category: 'PHONE_NEW', grade: null },
                { brand: 'OPPO', model: 'Reno 11', price: '11900', category: 'PHONE_NEW', grade: null },
                { brand: 'Xiaomi', model: 'Redmi Note 13', price: '7990', category: 'PHONE_NEW', grade: null },
                { brand: 'iPhone', model: '13', price: '15900', category: 'PHONE_USED', grade: 'B' },
                { brand: 'iPad', model: 'Air M2', price: '22900', category: 'TABLET', grade: null },
              ].map((item, i) => (
                <ProductCard
                  key={i}
                  brand={item.brand}
                  model={item.model}
                  price={item.price}
                  category={item.category}
                />
              ))}
            </div>
          )}

          <div className="text-center mt-12">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-8 py-3 text-sm font-semibold text-primary bg-card border-2 border-primary/20 hover:border-primary/40 rounded-xl transition-all hover:shadow-lg"
            >
              ดูสินค้าทั้งหมด
              <InlineArrowRightIcon className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section ref={servicesRef} className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="inline-block px-4 py-1.5 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-4">
              ทำไมถึงเลือกเรา
            </span>
            <h2 className="text-3xl lg:text-4xl font-bold leading-[1.3] text-foreground">
              บริการ<span className="text-primary">ของเรา</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: (
                  <InlineShieldCheckIcon className="w-8 h-8" aria-hidden="true" />
                ),
                title: 'สินค้ามีประกัน',
                desc: 'ทุกเครื่องผ่านการตรวจสอบคุณภาพ พร้อมใบรับประกัน',
              },
              {
                icon: (
                  <InlineCreditCardIcon className="w-8 h-8" aria-hidden="true" />
                ),
                title: 'ผ่อนชำระสบาย',
                desc: 'ผ่อนชำระรายเดือน ดอกเบี้ยต่ำ อนุมัติไว',
              },
              {
                icon: (
                  <InlineHeartIcon className="w-8 h-8" aria-hidden="true" />
                ),
                title: 'ดูแลหลังการขาย',
                desc: 'ทีมช่างพร้อมดูแลซ่อมบำรุง ตลอดอายุสัญญา',
              },
              {
                icon: (
                  <InlineMapPinIcon className="w-8 h-8" aria-hidden="true" />
                ),
                title: 'หลายสาขา',
                desc: 'สาขาทั่วประเทศ สะดวกชำระ ใกล้บ้านคุณ',
              },
            ].map((service, i) => (
              <div
                key={i}
                className="text-center p-6 rounded-2xl bg-card border border-border/60 hover:shadow-card-hover hover:-translate-y-1 transition-all duration-300 group"
              >
                <div className="w-14 h-14 mx-auto rounded-xl bg-muted text-foreground flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                  {service.icon}
                </div>
                <h3 className="mt-4 font-semibold text-foreground">{service.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{service.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-hero-gradient">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl lg:text-4xl font-bold leading-[1.3] text-primary-foreground">
            พร้อมเป็นเจ้าของสมาร์ทโฟนในฝัน?
          </h2>
          <p className="mt-4 text-lg text-primary-foreground/70">
            เยี่ยมชมร้านของเราหรือติดต่อสอบถามได้เลยวันนี้
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link
              to="/login"
              className="px-8 py-3 text-sm font-semibold text-primary bg-card hover:bg-muted rounded-xl transition-all hover:shadow-lg"
            >
              เข้าสู่ระบบ
            </Link>
            <button
              onClick={() => scrollTo('contact')}
              className="px-8 py-3 text-sm font-semibold text-primary-foreground border border-primary-foreground/30 hover:bg-primary-foreground/10 rounded-xl transition-all"
            >
              ติดต่อเรา
            </button>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section ref={contactRef} className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="inline-block px-4 py-1.5 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-4">
              ติดต่อเรา
            </span>
            <h2 className="text-3xl lg:text-4xl font-bold leading-[1.3] text-foreground">
              ช่องทาง<span className="text-primary">ติดต่อ</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center p-6 rounded-2xl bg-muted">
              <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                <InlinePhoneIcon className="w-6 h-6" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-foreground">โทรศัพท์</h3>
              <p className="mt-2 text-sm text-muted-foreground">02-xxx-xxxx</p>
            </div>
            <div className="text-center p-6 rounded-2xl bg-muted">
              <div className="w-12 h-12 mx-auto rounded-xl bg-success/10 text-success flex items-center justify-center mb-4">
                <InlineMessageCircleIcon className="w-6 h-6" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-foreground">LINE</h3>
              <p className="mt-2 text-sm text-muted-foreground">@bestchoice</p>
            </div>
            <div className="text-center p-6 rounded-2xl bg-muted">
              <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                <InlineMapPinIcon className="w-6 h-6" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-foreground">ที่ตั้งร้าน</h3>
              <p className="mt-2 text-sm text-muted-foreground">สาขาใกล้บ้านคุณ</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-background/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-linear-to-br from-primary/70 to-primary flex items-center justify-center">
                  <span className="text-background font-bold text-sm">B</span>
                </div>
                <span className="text-xl font-bold text-background">
                  best<span className="text-primary/80">choice</span>
                </span>
              </div>
              <p className="text-sm leading-relaxed max-w-sm">
                ร้านจำหน่ายสมาร์ทโฟนคุณภาพ ทั้งเครื่องใหม่และมือสอง
                พร้อมบริการผ่อนชำระที่ยืดหยุ่น ดูแลหลังการขายครบวงจร
              </p>
            </div>
            <div>
              <h4 className="text-background font-semibold mb-4">ลิงก์</h4>
              <ul className="space-y-2 text-sm">
                <li><button onClick={() => scrollTo('hero')} className="min-h-11 inline-flex items-center hover:text-background transition-colors">หน้าแรก</button></li>
                <li><button onClick={() => scrollTo('products')} className="min-h-11 inline-flex items-center hover:text-background transition-colors">สินค้า</button></li>
                <li><button onClick={() => scrollTo('services')} className="min-h-11 inline-flex items-center hover:text-background transition-colors">บริการ</button></li>
                <li><button onClick={() => scrollTo('contact')} className="min-h-11 inline-flex items-center hover:text-background transition-colors">ติดต่อเรา</button></li>
              </ul>
            </div>
            <div>
              <h4 className="text-background font-semibold mb-4">เวลาเปิดทำการ</h4>
              <ul className="space-y-2 text-sm">
                <li>จันทร์ - เสาร์: 09:00 - 20:00</li>
                <li>อาทิตย์: 10:00 - 18:00</li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-background/10 text-center text-sm">
            <p>&copy; 2024 Best Choice Mobile. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
