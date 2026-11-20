import UsedDeviceDetailsFields from '@/components/product/UsedDeviceDetailsFields';
import { NativeSelect } from '@/components/ui/native-select';
import { Combobox } from '@/components/ui/combobox';
import { useId as useFieldId } from 'react';
import { brands, getModels, getModelInfo } from '@/data/productCatalog';
import { buildAutoProductName } from '../utils/autoProductName';
import FormSection, { SegmentedChoice } from './FormSection';
import CategoryChips from './CategoryChips';

const ORIGIN_OPTIONS = [
  { value: 'THAI', label: 'เครื่องไทย' },
  { value: 'IMPORTED', label: 'เครื่องนอก' },
  { value: '', label: 'ยังไม่ระบุ' },
];

const accessoryTypes = [
  { value: 'ฟิล์ม', label: 'ฟิล์ม' },
  { value: 'ชุดชาร์จ', label: 'ชุดชาร์จ' },
  { value: 'หูฟัง', label: 'หูฟัง' },
  { value: 'เคส', label: 'เคส' },
  { value: 'อื่นๆ', label: 'อื่นๆ' },
];

const chargerConnectorTypes = [
  { value: 'Lightning', label: 'Lightning' },
  { value: 'Type-C', label: 'Type-C' },
];

interface ProductFormState {
  deviceOrigin: string;
  shopWarrantyDays: string;
  warrantyTerms: string;
  name: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  imeiSerial: string;
  serialNumber: string;
  category: string;
  costPrice: string;
  supplierId: string;
  branchId: string;
  status: string;
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
  accessoryType: string;
  accessoryBrand: string;
}

interface ProductInfoCardProps {
  form: ProductFormState;
  setForm: (form: ProductFormState) => void;
  inputCls: string;
  onCategoryChange: (newCategory: string) => void;
  onBrandChange: (newBrand: string) => void;
  onModelChange: (newModel: string) => void;
  onAccessoryTypeChange: (newType: string) => void;
  onToggleModel: (modelName: string) => void;
}

export default function ProductInfoCard({
  form,
  setForm,
  inputCls,
  onCategoryChange,
  onBrandChange,
  onModelChange,
  onAccessoryTypeChange,
  onToggleModel,
}: ProductInfoCardProps) {
  const fieldId = useFieldId();
  const availableModels = getModels(form.brand, form.category);
  const modelInfo = form.brand && form.model ? getModelInfo(form.brand, form.model) : undefined;
  const availableColors = modelInfo?.colors ?? [];
  const availableStorage = modelInfo?.storage ?? [];
  const autoName = buildAutoProductName(form);

  const accessory = form.category === 'ACCESSORY';

  return (
    <>
      <FormSection number={1} title="ประเภทสินค้า *">
        <CategoryChips value={form.category} onChange={onCategoryChange} />
      </FormSection>

      <FormSection number={2} title={accessory ? 'รายละเอียดอุปกรณ์' : 'รุ่นและสเปก'}>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {form.category === 'ACCESSORY' ? (
            <>
              {/* ประเภทอุปกรณ์ */}
              <div>
                <label
                  htmlFor={`${fieldId}-2`}
                  className="block text-sm font-medium text-foreground mb-3"
                >
                  ประเภทอุปกรณ์ *
                </label>
                <NativeSelect
                  id={`${fieldId}-2`}
                  value={form.accessoryType}
                  onChange={(e) => onAccessoryTypeChange(e.target.value)}
                  className={inputCls}
                  required
                >
                  <option value="">เลือกประเภทอุปกรณ์</option>
                  {accessoryTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {form.accessoryType === 'ชุดชาร์จ' ? (
                /* Charger: connector type */
                <div>
                  <label
                    htmlFor={`${fieldId}-3`}
                    className="block text-sm font-medium text-foreground mb-3"
                  >
                    ชนิด *
                  </label>
                  <NativeSelect
                    id={`${fieldId}-3`}
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    className={inputCls}
                    required
                  >
                    <option value="">เลือกชนิด</option>
                    {chargerConnectorTypes.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : form.accessoryType ? (
                /* Non-charger: compatible phone brand */
                <div>
                  <label
                    htmlFor={`${fieldId}-4`}
                    className="block text-sm font-medium text-foreground mb-3"
                  >
                    สำหรับยี่ห้อ
                  </label>
                  <NativeSelect
                    id={`${fieldId}-4`}
                    value={form.brand}
                    onChange={(e) => onBrandChange(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">เลือกยี่ห้อโทรศัพท์</option>
                    {brands.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}

              {/* Multi-model selection for non-charger accessories */}
              {form.accessoryType &&
                form.accessoryType !== 'ชุดชาร์จ' &&
                form.brand &&
                availableModels.length > 0 && (
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-foreground mb-3">
                      สำหรับรุ่น (เลือกได้หลายรุ่น)
                    </label>
                    <div className="flex flex-wrap gap-1.5 p-2 border border-input rounded-lg bg-muted max-h-40 overflow-y-auto">
                      {availableModels.map((m) => {
                        const selectedModels = form.model
                          ? form.model.split(', ').filter(Boolean)
                          : [];
                        const isSelected = selectedModels.includes(m.name);
                        return (
                          <button
                            data-ui-control="button"
                            key={m.name}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => onToggleModel(m.name)}
                            className={`min-h-11 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                              isSelected
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-card text-muted-foreground border-input hover:border-primary/60 hover:text-primary'
                            }`}
                          >
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                    {form.model && (
                      <div className="text-xs text-primary mt-1">
                        เลือกแล้ว {form.model.split(', ').filter(Boolean).length} รุ่น
                      </div>
                    )}
                  </div>
                )}

              {/* ยี่ห้ออุปกรณ์ */}
              <div>
                <label
                  htmlFor={`${fieldId}-5`}
                  className="block text-sm font-medium text-foreground mb-3"
                >
                  ยี่ห้ออุปกรณ์
                </label>
                <input
                  id={`${fieldId}-5`}
                  type="text"
                  value={form.accessoryBrand}
                  onChange={(e) => setForm({ ...form, accessoryBrand: e.target.value })}
                  placeholder="เช่น Spigen, Anker, Samsung"
                  className={inputCls}
                />
              </div>
            </>
          ) : (
            <>
              {/* ยี่ห้อ */}
              <div>
                <label
                  htmlFor={`${fieldId}-6`}
                  className="block text-sm font-medium text-foreground mb-3"
                >
                  ยี่ห้อ *
                </label>
                <NativeSelect
                  id={`${fieldId}-6`}
                  value={form.brand}
                  onChange={(e) => onBrandChange(e.target.value)}
                  className={inputCls}
                  required
                >
                  <option value="">เลือกยี่ห้อ</option>
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {/* รุ่น */}
              <div>
                <label
                  htmlFor={`${fieldId}-7`}
                  className="block text-sm font-medium text-foreground mb-3"
                >
                  รุ่น *
                </label>
                <Combobox
                  id={`${fieldId}-7`}
                  value={form.model}
                  onChange={(model) => {
                    // A native select fired no change for the same option — keep colour/storage.
                    if (model !== form.model) onModelChange(model);
                  }}
                  options={availableModels.map((m) => ({ value: m.name, label: m.name }))}
                  placeholder="เลือกรุ่น"
                  required
                  disabled={!form.brand}
                />
                {form.brand && availableModels.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">ไม่พบรุ่นสำหรับประเภทนี้</p>
                )}
              </div>

              {/* ความจุ — chip selector */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">ความจุ</label>
                {availableStorage.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {availableStorage.map((s) => (
                      <button
                        data-ui-control="button"
                        key={s}
                        type="button"
                        aria-pressed={form.storage === s}
                        onClick={() => setForm({ ...form, storage: s })}
                        disabled={!form.model}
                        className={`min-h-11 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                          form.storage === s
                            ? 'border-primary bg-primary/5 text-primary ring-2 ring-primary/20'
                            : 'border-border hover:border-input text-foreground disabled:opacity-50'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    aria-label="ความจุ"
                    value={form.storage}
                    onChange={(e) => setForm({ ...form, storage: e.target.value })}
                    className={inputCls}
                    placeholder="พิมพ์ความจุ"
                    disabled={!form.model}
                  />
                )}
              </div>
              {/* สี — chip selector */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">สี</label>
                {availableColors.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {availableColors.map((c) => (
                      <button
                        data-ui-control="button"
                        key={c}
                        type="button"
                        aria-pressed={form.color === c}
                        onClick={() => setForm({ ...form, color: c })}
                        disabled={!form.model}
                        className={`min-h-11 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                          form.color === c
                            ? 'border-primary bg-primary/5 text-primary ring-2 ring-primary/20'
                            : 'border-border hover:border-input text-foreground disabled:opacity-50'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    aria-label="สี"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className={inputCls}
                    placeholder="พิมพ์สี"
                    disabled={!form.model}
                  />
                )}
              </div>

              {/* เครื่องไทย / เครื่องนอก — มีผลกับราคากลางและราคาส่ง GFIN (เดิมอยู่บนสุดก่อนเลือกประเภท) */}
              <div className="sm:col-span-2">
                <SegmentedChoice
                  label="เครื่องไทย / เครื่องนอก"
                  options={ORIGIN_OPTIONS}
                  value={form.deviceOrigin}
                  onChange={(deviceOrigin) => setForm({ ...form, deviceOrigin })}
                  hint="มีผลกับราคากลางและราคาส่ง GFIN"
                />
              </div>
            </>
          )}

          {/* ชื่อสินค้า — เว้นว่าง = ใช้ชื่ออัตโนมัติ (พรีวิวสดจากตัวคำนวณเดียวกับตอนบันทึก) */}
          <div className="sm:col-span-2">
            <label
              htmlFor={`${fieldId}-8`}
              className="block text-sm font-medium text-foreground mb-3"
            >
              ชื่อสินค้า
            </label>
            <input
              id={`${fieldId}-8`}
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={
                autoName ||
                (form.category === 'ACCESSORY'
                  ? 'อัตโนมัติจาก ประเภท + ยี่ห้ออุปกรณ์ + รุ่น'
                  : 'อัตโนมัติจาก ยี่ห้อ + รุ่น + สี + ความจุ')
              }
              aria-describedby={`${fieldId}-8-hint`}
              className={inputCls}
            />
            <p
              id={`${fieldId}-8-hint`}
              className="mt-1.5 text-xs leading-snug text-muted-foreground"
            >
              {form.name.trim() ? (
                autoName ? (
                  <>
                    ตั้งชื่อเองแล้ว ·{' '}
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, name: '' })}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      ใช้ชื่ออัตโนมัติแทน
                    </button>
                  </>
                ) : null
              ) : autoName ? (
                <>
                  ระบบจะใช้ชื่อ <span className="font-medium text-foreground">{autoName}</span> ·
                  พิมพ์ทับเพื่อตั้งเอง
                </>
              ) : form.category === 'ACCESSORY' ? (
                'เลือกประเภทอุปกรณ์ก่อน ระบบจะตั้งชื่อให้'
              ) : (
                'เลือกยี่ห้อและรุ่นก่อน ระบบจะตั้งชื่อให้'
              )}
            </p>
          </div>
        </div>
      </FormSection>

      {!accessory && (
        <FormSection number={3} title="ตัวเครื่อง">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {/* IMEI */}
            <div>
              <label
                htmlFor={`${fieldId}-9`}
                className="block text-sm font-medium text-foreground mb-3"
              >
                IMEI
              </label>
              <input
                id={`${fieldId}-9`}
                type="text"
                value={form.imeiSerial}
                onChange={(e) => setForm({ ...form, imeiSerial: e.target.value })}
                placeholder="เลข IMEI 15 หลัก"
                className={`${inputCls} font-mono`}
                maxLength={15}
              />
            </div>

            {/* Serial Number */}
            <div>
              <label
                htmlFor={`${fieldId}-10`}
                className="block text-sm font-medium text-foreground mb-3"
              >
                Serial Number
              </label>
              <input
                id={`${fieldId}-10`}
                type="text"
                value={form.serialNumber}
                onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                placeholder="หมายเลข Serial"
                className={`${inputCls} font-mono`}
              />
            </div>
          </div>
          {/* Used phone fields — ทุกช่องใช้แถวป้าย (mb-3) + กล่อง 44px เท่ากัน ⇒ 3 คอลัมน์ตรงแนวกัน */}
          {form.category === 'PHONE_USED' && (
            <section
              aria-labelledby={`${fieldId}-used`}
              className="mt-5 rounded-lg border border-warning/20 bg-warning/5 p-4 dark:bg-warning/10 sm:p-5"
            >
              <h3
                id={`${fieldId}-used`}
                className="text-sm font-semibold leading-snug text-warning-strong"
              >
                สภาพมือสอง
              </h3>
              <div className="mt-4">
                {/* ชุดช่องเดียวกับหน้าแก้ไขสินค้าและหน้ารับของ PO — ป้ายสูงเท่ากัน ทุกช่องจัดแนวล่าง (items-end) */}
                <UsedDeviceDetailsFields
                  idPrefix={fieldId}
                  value={{
                    batteryHealth: form.batteryHealth,
                    warrantyExpired: form.warrantyExpired,
                    warrantyExpireDate: form.warrantyExpireDate,
                    hasBox: form.hasBox,
                  }}
                  onChange={(patch) =>
                    setForm({
                      ...form,
                      ...patch,
                      ...(patch.warrantyExpired ? { warrantyExpireDate: '' } : {}),
                    })
                  }
                />
              </div>
            </section>
          )}
        </FormSection>
      )}
    </>
  );
}
