import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { brands, getModels, getModelInfo } from '@/data/productCatalog';
import { categoryOptions } from '@/lib/constants';

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
  statusOptions: { value: string; label: string }[];
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
  statusOptions,
  inputCls,
  onCategoryChange,
  onBrandChange,
  onModelChange,
  onAccessoryTypeChange,
  onToggleModel,
}: ProductInfoCardProps) {
  const availableModels = getModels(form.brand, form.category);
  const modelInfo = form.brand && form.model ? getModelInfo(form.brand, form.model) : undefined;
  const availableColors = modelInfo?.colors ?? [];
  const availableStorage = modelInfo?.storage ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>ข้อมูลสินค้า</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-5 lg:gap-7.5">
          {/* ประเภท - FIRST */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ประเภท *</label>
            <select
              value={form.category}
              onChange={(e) => onCategoryChange(e.target.value)}
              className={inputCls}
            >
              {categoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {form.category === 'ACCESSORY' ? (
            <>
              {/* ประเภทอุปกรณ์ */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  ประเภทอุปกรณ์ *
                </label>
                <select
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
                </select>
              </div>

              {form.accessoryType === 'ชุดชาร์จ' ? (
                /* Charger: connector type */
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">ชนิด *</label>
                  <select
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
                  </select>
                </div>
              ) : form.accessoryType ? (
                /* Non-charger: compatible phone brand */
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    สำหรับยี่ห้อ
                  </label>
                  <select
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
                  </select>
                </div>
              ) : null}

              {/* Multi-model selection for non-charger accessories */}
              {form.accessoryType &&
                form.accessoryType !== 'ชุดชาร์จ' &&
                form.brand &&
                availableModels.length > 0 && (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-foreground mb-1">
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
                            key={m.name}
                            type="button"
                            onClick={() => onToggleModel(m.name)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
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
                <label className="block text-sm font-medium text-foreground mb-1">ยี่ห้ออุปกรณ์</label>
                <input
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
                <label className="block text-sm font-medium text-foreground mb-1">ยี่ห้อ *</label>
                <select
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
                </select>
              </div>

              {/* รุ่น */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">รุ่น *</label>
                <select
                  value={form.model}
                  onChange={(e) => onModelChange(e.target.value)}
                  className={inputCls}
                  required
                  disabled={!form.brand}
                >
                  <option value="">เลือกรุ่น</option>
                  {availableModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {form.brand && availableModels.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">ไม่พบรุ่นสำหรับประเภทนี้</p>
                )}
              </div>

              {/* สี — chip selector */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">สี</label>
                {availableColors.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {availableColors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm({ ...form, color: c })}
                        disabled={!form.model}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
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
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className={inputCls}
                    placeholder="พิมพ์สี"
                    disabled={!form.model}
                  />
                )}
              </div>

              {/* ความจุ — chip selector */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">ความจุ</label>
                {availableStorage.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {availableStorage.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setForm({ ...form, storage: s })}
                        disabled={!form.model}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
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
                    value={form.storage}
                    onChange={(e) => setForm({ ...form, storage: e.target.value })}
                    className={inputCls}
                    placeholder="พิมพ์ความจุ"
                    disabled={!form.model}
                  />
                )}
              </div>
            </>
          )}

          {/* ชื่อสินค้า */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ชื่อสินค้า</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={
                form.category === 'ACCESSORY'
                  ? 'อัตโนมัติจาก ประเภท + ยี่ห้ออุปกรณ์ + รุ่น'
                  : 'อัตโนมัติจาก ยี่ห้อ + รุ่น + สี + ความจุ'
              }
              className={inputCls}
            />
          </div>

          {form.category !== 'ACCESSORY' && (
            <>
              {/* IMEI */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">IMEI</label>
                <input
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
                <label className="block text-sm font-medium text-foreground mb-1">
                  Serial Number
                </label>
                <input
                  type="text"
                  value={form.serialNumber}
                  onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                  placeholder="หมายเลข Serial"
                  className={`${inputCls} font-mono`}
                />
              </div>
            </>
          )}

          {/* สถานะ */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">สถานะ *</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className={inputCls}
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Accessory auto name preview */}
        {form.category === 'ACCESSORY' && (form.accessoryType || form.accessoryBrand) && (
          <div className="mt-3 text-sm text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
            ชื่อสินค้าอัตโนมัติ:{' '}
            {(() => {
              const isCharger = form.accessoryType === 'ชุดชาร์จ';
              if (isCharger)
                return [form.accessoryType, form.accessoryBrand, form.model]
                  .filter(Boolean)
                  .join(' ');
              const accParts = [form.accessoryType, form.accessoryBrand].filter(Boolean);
              return form.model
                ? `${accParts.join(' ')} สำหรับ ${form.model}`
                : accParts.join(' ');
            })()}
          </div>
        )}

        {/* Used phone fields */}
        {form.category === 'PHONE_USED' && (
          <div className="col-span-2 mt-2 border border-warning/20 bg-warning/5 dark:bg-warning/10 rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-semibold text-warning">ข้อมูลมือสอง</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">% แบตเตอรี่</label>
                <input
                  type="number"
                  value={form.batteryHealth}
                  onChange={(e) => setForm({ ...form, batteryHealth: e.target.value })}
                  placeholder="เช่น 87"
                  className={inputCls}
                  min="0"
                  max="100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">ประกันศูนย์</label>
                <div className="flex items-center gap-3 mt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.warrantyExpired}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          warrantyExpired: e.target.checked,
                          warrantyExpireDate: e.target.checked ? '' : form.warrantyExpireDate,
                        })
                      }
                      className="rounded"
                    />
                    <span className="text-sm text-muted-foreground">หมดประกันแล้ว</span>
                  </label>
                </div>
                {!form.warrantyExpired && (
                  <ThaiDateInput
                    value={form.warrantyExpireDate}
                    onChange={(e) => setForm({ ...form, warrantyExpireDate: e.target.value })}
                    className={`${inputCls} mt-2`}
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">กล่อง</label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, hasBox: true })}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${form.hasBox ? 'bg-success text-success-foreground' : 'bg-secondary text-muted-foreground hover:bg-success/10'}`}
                  >
                    มีกล่อง
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, hasBox: false })}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${!form.hasBox ? 'bg-destructive text-destructive-foreground' : 'bg-secondary text-muted-foreground hover:bg-destructive/10'}`}
                  >
                    ไม่มีกล่อง
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
