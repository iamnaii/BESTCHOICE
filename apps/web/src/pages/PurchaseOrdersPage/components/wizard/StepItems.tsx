import { brands, getModels, getModelInfo } from '@/data/productCatalog';
import { accessoryTypes, chargerConnectorTypes } from '../../constants';
import { formatNumberDecimal } from '@/utils/formatters';
import type { ItemForm } from '../../types';

interface StepItemsProps {
  items: ItemForm[];
  setItems: React.Dispatch<React.SetStateAction<ItemForm[]>>;
  addItem: () => void;
  removeItem: (idx: number) => void;
  updateItem: (idx: number, field: string, value: string) => void;
  toggleModel: (idx: number, modelName: string) => void;
  subtotal: number;
  selectClass: string;
  inputClass: string;
}

export function StepItems({
  items,
  setItems,
  addItem,
  removeItem,
  updateItem,
  toggleModel,
  subtotal,
  selectClass,
  inputClass,
}: StepItemsProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m7.5 4.27 9 5.15" />
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <path d="m3.3 7 8.7 5 8.7-5" />
            <path d="M12 22V12" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground leading-snug">รายการสินค้า</h3>
          <p className="text-xs text-muted-foreground leading-snug">
            เพิ่มสินค้าที่ต้องการสั่งซื้อ
          </p>
        </div>
        <button
          type="button"
          onClick={addItem}
          className="text-sm text-primary hover:text-primary/90 font-medium"
        >
          + เพิ่มรายการ
        </button>
      </div>

      <div className="space-y-4">
        {items.map((item, idx) => {
          const isAccessory = item.category === 'ACCESSORY';
          const isCharger = isAccessory && item.accessoryType === 'ชุดชาร์จ';
          const availableModels = item.brand
            ? getModels(item.brand, isAccessory ? 'ACCESSORY' : item.category || undefined)
            : [];
          const modelInfo =
            item.brand && item.model ? getModelInfo(item.brand, item.model) : undefined;
          const availableColors = modelInfo?.colors || [];
          const availableStorage = modelInfo?.storage || [];
          const selectedModels =
            isAccessory && item.model ? item.model.split(', ').filter(Boolean) : [];

          const accessoryAutoName = isAccessory
            ? (() => {
                if (isCharger) {
                  return [item.accessoryType, item.accessoryBrand, item.model]
                    .filter(Boolean)
                    .join(' ');
                }
                const accParts = [item.accessoryType, item.accessoryBrand].filter(Boolean);
                const modelStr = item.model;
                return modelStr ? `${accParts.join(' ')} สำหรับ ${modelStr}` : accParts.join(' ');
              })()
            : '';

          return (
            <div
              key={idx}
              className={`border rounded-lg p-3 space-y-2 relative ${isAccessory ? 'border-primary/30 bg-primary/5 dark:bg-primary/10' : 'border-border bg-muted/50'}`}
            >
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="absolute top-2 right-2 text-destructive/70 hover:text-destructive text-lg leading-none"
                >
                  &times;
                </button>
              )}
              <div className="text-xs font-medium text-muted-foreground mb-1">
                รายการ #{idx + 1}
                {isAccessory && (
                  <span className="ml-2 px-1.5 py-0.5 bg-primary/15 text-primary dark:bg-primary/20 rounded text-xs">
                    อุปกรณ์เสริม
                  </span>
                )}
              </div>

              {/* Row 1: Category FIRST, then Brand/Model or AccessoryType */}
              <div className={`grid ${isAccessory ? 'grid-cols-3' : 'grid-cols-3'} gap-2`}>
                <div>
                  <label className="block text-xs text-muted-foreground mb-0.5">
                    ประเภท <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={item.category}
                    onChange={(e) => updateItem(idx, 'category', e.target.value)}
                    className={selectClass}
                  >
                    <option value="">-- เลือกประเภท --</option>
                    <option value="PHONE_NEW">โทรศัพท์ (ใหม่)</option>
                    <option value="PHONE_USED">โทรศัพท์ (มือสอง)</option>
                    <option value="TABLET">แท็บเล็ต</option>
                    <option value="ACCESSORY">อุปกรณ์เสริม</option>
                  </select>
                </div>

                {isAccessory ? (
                  <>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">
                        ประเภทอุปกรณ์ <span className="text-destructive">*</span>
                      </label>
                      <select
                        value={item.accessoryType}
                        onChange={(e) => updateItem(idx, 'accessoryType', e.target.value)}
                        className={selectClass}
                        required
                      >
                        <option value="">-- เลือก --</option>
                        {accessoryTypes.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {isCharger ? (
                      <div>
                        <label className="block text-xs text-muted-foreground mb-0.5">
                          ชนิด <span className="text-destructive">*</span>
                        </label>
                        <select
                          value={item.model}
                          onChange={(e) => {
                            const ni = [...items];
                            ni[idx] = { ...ni[idx], model: e.target.value };
                            setItems(ni);
                          }}
                          className={selectClass}
                          required
                        >
                          <option value="">-- เลือก --</option>
                          {chargerConnectorTypes.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs text-muted-foreground mb-0.5">
                          สำหรับยี่ห้อ
                        </label>
                        <select
                          value={item.brand}
                          onChange={(e) => updateItem(idx, 'brand', e.target.value)}
                          className={selectClass}
                        >
                          <option value="">-- เลือกยี่ห้อโทรศัพท์ --</option>
                          {brands.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">
                        ยี่ห้อ <span className="text-destructive">*</span>
                      </label>
                      <select
                        value={item.brand}
                        onChange={(e) => updateItem(idx, 'brand', e.target.value)}
                        className={selectClass}
                        required
                        disabled={!item.category}
                      >
                        <option value="">-- เลือกยี่ห้อ --</option>
                        {brands.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">
                        รุ่น <span className="text-destructive">*</span>
                      </label>
                      <select
                        value={item.model}
                        onChange={(e) => updateItem(idx, 'model', e.target.value)}
                        className={selectClass}
                        required
                        disabled={!item.brand}
                      >
                        <option value="">-- เลือกรุ่น --</option>
                        {availableModels.map((m) => (
                          <option key={m.name} value={m.name}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>

              {/* Multi-model selection for accessories (non-charger) */}
              {isAccessory &&
                !isCharger &&
                item.accessoryType &&
                item.brand &&
                availableModels.length > 0 && (
                  <div>
                    <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      สำหรับรุ่น (เลือกได้หลายรุ่น)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {availableModels.map((m) => {
                        const isSelected = selectedModels.includes(m.name);
                        return (
                          <button
                            key={m.name}
                            type="button"
                            onClick={() => toggleModel(idx, m.name)}
                            className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                              isSelected
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background text-muted-foreground border-input hover:border-primary/50 hover:text-primary'
                            }`}
                          >
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                    {selectedModels.length > 0 && (
                      <div className="text-xs text-primary mt-1">
                        เลือกแล้ว {selectedModels.length} รุ่น
                      </div>
                    )}
                  </div>
                )}

              {isAccessory ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">
                        ยี่ห้ออุปกรณ์
                      </label>
                      <input
                        type="text"
                        value={item.accessoryBrand}
                        onChange={(e) => updateItem(idx, 'accessoryBrand', e.target.value)}
                        className={inputClass}
                        placeholder="เช่น Spigen, Anker"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">
                        จำนวน <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                        className={inputClass}
                        min="1"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">
                        ราคา/ชิ้น <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                        className={inputClass}
                        required
                      />
                    </div>
                  </div>
                  {accessoryAutoName && (
                    <div className="text-xs text-primary bg-primary/10 dark:bg-primary/15 rounded px-2 py-1">
                      ชื่อสินค้า: {accessoryAutoName}
                    </div>
                  )}
                </>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">สี</label>
                    <select
                      value={item.color}
                      onChange={(e) => updateItem(idx, 'color', e.target.value)}
                      className={selectClass}
                      disabled={availableColors.length === 0}
                    >
                      <option value="">-- เลือกสี --</option>
                      {availableColors.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">ความจุ</label>
                    <select
                      value={item.storage}
                      onChange={(e) => updateItem(idx, 'storage', e.target.value)}
                      className={selectClass}
                      disabled={availableStorage.length === 0}
                    >
                      <option value="">-- เลือกความจุ --</option>
                      {availableStorage.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">
                      จำนวน <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                      className={inputClass}
                      min="1"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">
                      ราคา/ชิ้น <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                      className={inputClass}
                      required
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Running subtotal footer (new) */}
      <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
        <span className="text-sm text-muted-foreground leading-snug">
          รวม {items.length} รายการ · {items.reduce((n, i) => n + (Number(i.quantity) || 0), 0)}{' '}
          ชิ้น
        </span>
        <span className="text-base font-semibold text-foreground tabular-nums font-mono">
          {formatNumberDecimal(subtotal, 2)} บาท
        </span>
      </div>
    </div>
  );
}
