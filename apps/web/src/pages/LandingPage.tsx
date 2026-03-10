import { useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import LandingNav from '@/components/landing/LandingNav';
import ProductCard from '@/components/landing/ProductCard';
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

  const hasToken = !!localStorage.getItem('access_token');

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
    <div className="min-h-screen bg-white">
      <LandingNav onScrollTo={scrollTo} />

      {/* Hero Section */}
      <section ref={heroRef} className="relative pt-16 overflow-hidden">
        <div className="bg-hero-gradient">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              {/* Text Content */}
              <div className="animate-slideUp">
                <span className="inline-block px-4 py-1.5 text-xs font-semibold text-primary-200 bg-white/10 rounded-full mb-6">
                  ร้านมือถือที่คุณไว้วางใจ
                </span>
                <h1 className="text-4xl lg:text-5xl xl:text-6xl font-bold text-white leading-tight">
                  สินค้าคุณภาพ
                  <br />
                  <span className="text-gradient">ผ่อนสบาย</span>
                  <br />
                  ราคาเป็นกันเอง
                </h1>
                <p className="mt-6 text-lg text-gray-300 max-w-lg leading-relaxed">
                  เลือกซื้อสมาร์ทโฟนคุณภาพ ทั้งเครื่องใหม่และมือสอง
                  พร้อมบริการผ่อนชำระที่ยืดหยุ่น ดูแลหลังการขายครบวงจร
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    onClick={() => scrollTo('products')}
                    className="px-8 py-3 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 rounded-xl transition-all hover:shadow-lg hover:shadow-primary-600/30"
                  >
                    ดูสินค้าทั้งหมด
                  </button>
                  <button
                    onClick={() => scrollTo('contact')}
                    className="px-8 py-3 text-sm font-semibold text-white border border-white/30 hover:bg-white/10 rounded-xl transition-all"
                  >
                    ติดต่อเรา
                  </button>
                </div>

                {/* Stats */}
                <div className="mt-12 grid grid-cols-3 gap-6">
                  <div>
                    <div className="text-2xl lg:text-3xl font-bold text-white">500+</div>
                    <div className="text-sm text-gray-400 mt-1">สินค้าพร้อมขาย</div>
                  </div>
                  <div>
                    <div className="text-2xl lg:text-3xl font-bold text-white">1,000+</div>
                    <div className="text-sm text-gray-400 mt-1">ลูกค้าที่ไว้ใจ</div>
                  </div>
                  <div>
                    <div className="text-2xl lg:text-3xl font-bold text-white">5+</div>
                    <div className="text-sm text-gray-400 mt-1">สาขาทั่วประเทศ</div>
                  </div>
                </div>
              </div>

              {/* Phone Illustration */}
              <div className="hidden lg:flex justify-center">
                <div className="relative">
                  <div className="w-64 h-[500px] bg-gradient-to-b from-white/10 to-white/5 rounded-[3rem] border border-white/20 flex items-center justify-center animate-float">
                    <div className="w-56 h-[460px] bg-gradient-to-b from-primary-800 to-primary-900 rounded-[2.5rem] flex flex-col items-center justify-center gap-4">
                      <svg className="w-20 h-20 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <p className="text-primary-300 text-sm font-medium">Best Choice</p>
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
      <section ref={productsRef} className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="inline-block px-4 py-1.5 text-xs font-semibold text-primary-600 bg-primary-50 rounded-full mb-4">
              สินค้าของเรา
            </span>
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900">
              สินค้า<span className="text-primary-600">แนะนำ</span>
            </h2>
            <p className="mt-4 text-gray-500 max-w-2xl mx-auto">
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
              className="inline-flex items-center gap-2 px-8 py-3 text-sm font-semibold text-primary-600 bg-white border-2 border-primary-200 hover:border-primary-400 rounded-xl transition-all hover:shadow-lg"
            >
              ดูสินค้าทั้งหมด
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section ref={servicesRef} className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="inline-block px-4 py-1.5 text-xs font-semibold text-primary-600 bg-primary-50 rounded-full mb-4">
              ทำไมถึงเลือกเรา
            </span>
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900">
              บริการ<span className="text-primary-600">ของเรา</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                ),
                title: 'สินค้ามีประกัน',
                desc: 'ทุกเครื่องผ่านการตรวจสอบคุณภาพ พร้อมใบรับประกัน',
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                ),
                title: 'ผ่อนชำระสบาย',
                desc: 'ผ่อนชำระรายเดือน ดอกเบี้ยต่ำ อนุมัติไว',
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                ),
                title: 'ดูแลหลังการขาย',
                desc: 'ทีมช่างพร้อมดูแลซ่อมบำรุง ตลอดอายุสัญญา',
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                ),
                title: 'หลายสาขา',
                desc: 'สาขาทั่วประเทศ สะดวกชำระ ใกล้บ้านคุณ',
              },
            ].map((service, i) => (
              <div
                key={i}
                className="text-center p-6 rounded-2xl bg-gray-50 hover:bg-white hover:shadow-xl border border-transparent hover:border-gray-100 transition-all duration-300 group"
              >
                <div className="w-14 h-14 mx-auto rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center group-hover:bg-primary-600 group-hover:text-white transition-colors duration-300">
                  {service.icon}
                </div>
                <h3 className="mt-4 font-semibold text-gray-900">{service.title}</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">{service.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-hero-gradient">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl lg:text-4xl font-bold text-white">
            พร้อมเป็นเจ้าของสมาร์ทโฟนในฝัน?
          </h2>
          <p className="mt-4 text-lg text-gray-300">
            เยี่ยมชมร้านของเราหรือติดต่อสอบถามได้เลยวันนี้
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link
              to="/login"
              className="px-8 py-3 text-sm font-semibold text-primary-900 bg-white hover:bg-gray-100 rounded-xl transition-all hover:shadow-lg"
            >
              เข้าสู่ระบบ
            </Link>
            <button
              onClick={() => scrollTo('contact')}
              className="px-8 py-3 text-sm font-semibold text-white border border-white/30 hover:bg-white/10 rounded-xl transition-all"
            >
              ติดต่อเรา
            </button>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section ref={contactRef} className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="inline-block px-4 py-1.5 text-xs font-semibold text-primary-600 bg-primary-50 rounded-full mb-4">
              ติดต่อเรา
            </span>
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900">
              ช่องทาง<span className="text-primary-600">ติดต่อ</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center p-6 rounded-2xl bg-gray-50">
              <div className="w-12 h-12 mx-auto rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900">โทรศัพท์</h3>
              <p className="mt-2 text-sm text-gray-500">02-xxx-xxxx</p>
            </div>
            <div className="text-center p-6 rounded-2xl bg-gray-50">
              <div className="w-12 h-12 mx-auto rounded-xl bg-green-100 text-green-600 flex items-center justify-center mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900">LINE</h3>
              <p className="mt-2 text-sm text-gray-500">@bestchoice</p>
            </div>
            <div className="text-center p-6 rounded-2xl bg-gray-50">
              <div className="w-12 h-12 mx-auto rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900">ที่ตั้งร้าน</h3>
              <p className="mt-2 text-sm text-gray-500">สาขาใกล้บ้านคุณ</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-primary-950 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-500 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">B</span>
                </div>
                <span className="text-xl font-bold text-white">
                  best<span className="text-primary-400">choice</span>
                </span>
              </div>
              <p className="text-sm leading-relaxed max-w-sm">
                ร้านจำหน่ายสมาร์ทโฟนคุณภาพ ทั้งเครื่องใหม่และมือสอง
                พร้อมบริการผ่อนชำระที่ยืดหยุ่น ดูแลหลังการขายครบวงจร
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">ลิงก์</h4>
              <ul className="space-y-2 text-sm">
                <li><button onClick={() => scrollTo('hero')} className="hover:text-white transition-colors">หน้าแรก</button></li>
                <li><button onClick={() => scrollTo('products')} className="hover:text-white transition-colors">สินค้า</button></li>
                <li><button onClick={() => scrollTo('services')} className="hover:text-white transition-colors">บริการ</button></li>
                <li><button onClick={() => scrollTo('contact')} className="hover:text-white transition-colors">ติดต่อเรา</button></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">เวลาเปิดทำการ</h4>
              <ul className="space-y-2 text-sm">
                <li>จันทร์ - เสาร์: 09:00 - 20:00</li>
                <li>อาทิตย์: 10:00 - 18:00</li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-white/10 text-center text-sm">
            <p>&copy; 2024 Best Choice Mobile. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
