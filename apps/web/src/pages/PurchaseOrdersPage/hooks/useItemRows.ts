import { ItemForm } from '../types';
import { emptyItem } from '../constants';
import { categoryKind, resolveCategory, type AccessorySku, type CatalogEntry, type PhoneMode } from '../po-catalog.util';

type SetItems = React.Dispatch<React.SetStateAction<ItemForm[]>>;

/**
 * Row operations behind the items table — shared by the PO wizard (usePOForm) and
 * รับเข้าตรง (DirectReceiveModal), so both screens add/edit rows the same way.
 */
export function useItemRows(items: ItemForm[], setItems: SetItems) {
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  /** Picker: one catalog model → one prefilled row (storage/color/price chosen on the row). */
  const addCatalogItem = (entry: CatalogEntry, phoneMode: PhoneMode) => {
    const category = resolveCategory(entry, phoneMode);
    setItems((prev) => [...prev, { ...emptyItem, brand: entry.brand, model: entry.name, category }]);
  };
  /** Picker: accessory type → one accessory row (brand = the only catalog brand, for the compatible-model chips). */
  const addAccessoryItem = (accessoryType: string) => {
    setItems((prev) => [...prev, { ...emptyItem, category: 'ACCESSORY', accessoryType, brand: 'Apple' }]);
  };
  /** Picker: re-order an EXISTING accessory SKU — copy its identity so received units keep the name; price = last cost. */
  const addExistingAccessoryItem = (sku: AccessorySku) => {
    setItems((prev) => [
      ...prev,
      {
        ...emptyItem,
        category: 'ACCESSORY',
        accessoryType: sku.accessoryType ?? '',
        accessoryBrand: sku.accessoryBrand ?? '',
        model: sku.model,
        unitPrice: sku.lastCost != null ? String(sku.lastCost) : '',
        sourceName: sku.name,
        sourceCode: sku.code,
        sourceInStock: sku.inStock,
      },
    ]);
  };
  /** Same model, another storage/colour — copy the row right below its source. */
  const duplicateItem = (idx: number) => {
    setItems((prev) => [...prev.slice(0, idx + 1), { ...prev[idx] }, ...prev.slice(idx + 1)]);
  };

  const updateItem = (idx: number, field: string, value: string) => {
    const newItems = [...items];
    const item = { ...newItems[idx], [field]: value };

    // Cascade reset when parent changes (Category is first). Flipping a phone between
    // ใหม่/มือสอง (the สภาพ column) is the same kind of product, so its model/storage/colour stay.
    if (field === 'category' && categoryKind(value) !== categoryKind(newItems[idx].category)) {
      item.brand = '';
      item.model = '';
      item.color = '';
      item.storage = '';
      item.accessoryType = '';
      item.accessoryBrand = '';
    } else if (field === 'accessoryType') {
      // Reset compatible brand/model/accessoryBrand when accessory type changes
      item.brand = '';
      item.model = '';
      item.accessoryBrand = '';
    } else if (field === 'brand') {
      item.model = '';
      item.color = '';
      item.storage = '';
    } else if (field === 'model') {
      item.color = '';
      item.storage = '';
    }

    newItems[idx] = item;
    setItems(newItems);
  };

  // Toggle model for multi-select (accessories)
  const toggleModel = (idx: number, modelName: string) => {
    const newItems = [...items];
    const item = { ...newItems[idx] };
    const current = item.model ? item.model.split(', ').filter(Boolean) : [];
    if (current.includes(modelName)) {
      item.model = current.filter((m) => m !== modelName).join(', ');
    } else {
      item.model = [...current, modelName].join(', ');
    }
    newItems[idx] = item;
    setItems(newItems);
  };

  return { removeItem, addCatalogItem, addAccessoryItem, addExistingAccessoryItem, duplicateItem, updateItem, toggleModel };
}
