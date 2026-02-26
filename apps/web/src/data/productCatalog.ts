export interface ModelInfo {
  name: string;
  category: 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';
  colors: string[];
  storage: string[];
}

export interface BrandCatalog {
  brand: string;
  models: ModelInfo[];
}

export const productCatalog: BrandCatalog[] = [
  {
    brand: 'Apple',
    models: [
      // === iPhone 17 Series (2025) ===
      {
        name: 'iPhone 17 Pro Max',
        category: 'PHONE_NEW',
        colors: ['Silver', 'Cosmic Orange', 'Deep Blue'],
        storage: ['256GB', '512GB', '1TB', '2TB'],
      },
      {
        name: 'iPhone 17 Pro',
        category: 'PHONE_NEW',
        colors: ['Silver', 'Cosmic Orange', 'Deep Blue'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone Air',
        category: 'PHONE_NEW',
        colors: ['Space Black', 'Cloud White', 'Light Gold', 'Sky Blue'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone 17',
        category: 'PHONE_NEW',
        colors: ['Black', 'Lavender', 'Mist Blue', 'Sage', 'White'],
        storage: ['256GB', '512GB'],
      },

      // === iPhone 16e (2025) ===
      {
        name: 'iPhone 16e',
        category: 'PHONE_NEW',
        colors: ['Black', 'White'],
        storage: ['128GB', '256GB', '512GB'],
      },

      // === iPhone 16 Series (2024) ===
      {
        name: 'iPhone 16 Pro Max',
        category: 'PHONE_NEW',
        colors: ['Desert Titanium', 'Natural Titanium', 'White Titanium', 'Black Titanium'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone 16 Pro',
        category: 'PHONE_NEW',
        colors: ['Desert Titanium', 'Natural Titanium', 'White Titanium', 'Black Titanium'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone 16 Plus',
        category: 'PHONE_NEW',
        colors: ['Black', 'White', 'Pink', 'Teal', 'Ultramarine'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'iPhone 16',
        category: 'PHONE_NEW',
        colors: ['Black', 'White', 'Pink', 'Teal', 'Ultramarine'],
        storage: ['128GB', '256GB', '512GB'],
      },
      // === iPhone 15 Series (2023) ===
      {
        name: 'iPhone 15 Pro Max',
        category: 'PHONE_NEW',
        colors: ['Natural Titanium', 'Blue Titanium', 'White Titanium', 'Black Titanium'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone 15 Pro',
        category: 'PHONE_NEW',
        colors: ['Natural Titanium', 'Blue Titanium', 'White Titanium', 'Black Titanium'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone 15 Plus',
        category: 'PHONE_NEW',
        colors: ['Black', 'Blue', 'Green', 'Yellow', 'Pink'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'iPhone 15',
        category: 'PHONE_NEW',
        colors: ['Black', 'Blue', 'Green', 'Yellow', 'Pink'],
        storage: ['128GB', '256GB', '512GB'],
      },
      // === iPhone 14 Series (2022) ===
      {
        name: 'iPhone 14 Pro Max',
        category: 'PHONE_NEW',
        colors: ['Space Black', 'Silver', 'Gold', 'Deep Purple'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone 14 Pro',
        category: 'PHONE_NEW',
        colors: ['Space Black', 'Silver', 'Gold', 'Deep Purple'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone 14 Plus',
        category: 'PHONE_NEW',
        colors: ['Midnight', 'Starlight', 'Blue', 'Purple', '(PRODUCT)RED', 'Yellow'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'iPhone 14',
        category: 'PHONE_NEW',
        colors: ['Midnight', 'Starlight', 'Blue', 'Purple', '(PRODUCT)RED', 'Yellow'],
        storage: ['128GB', '256GB', '512GB'],
      },
      // === iPhone 13 Series (2021) ===
      {
        name: 'iPhone 13 Pro Max',
        category: 'PHONE_NEW',
        colors: ['Graphite', 'Gold', 'Silver', 'Sierra Blue', 'Alpine Green'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone 13 Pro',
        category: 'PHONE_NEW',
        colors: ['Graphite', 'Gold', 'Silver', 'Sierra Blue', 'Alpine Green'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPhone 13',
        category: 'PHONE_NEW',
        colors: ['Pink', 'Blue', 'Midnight', 'Starlight', '(PRODUCT)RED', 'Green'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'iPhone 13 mini',
        category: 'PHONE_NEW',
        colors: ['Pink', 'Blue', 'Midnight', 'Starlight', '(PRODUCT)RED', 'Green'],
        storage: ['128GB', '256GB', '512GB'],
      },
      // === iPhone 12 Series (2020-2021) ===
      {
        name: 'iPhone 12 Pro Max',
        category: 'PHONE_NEW',
        colors: ['Silver', 'Graphite', 'Gold', 'Pacific Blue'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'iPhone 12 Pro',
        category: 'PHONE_NEW',
        colors: ['Silver', 'Graphite', 'Gold', 'Pacific Blue'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'iPhone 12',
        category: 'PHONE_NEW',
        colors: ['Black', 'White', 'Blue', 'Green', '(PRODUCT)RED', 'Purple'],
        storage: ['64GB', '128GB', '256GB'],
      },
      {
        name: 'iPhone 12 mini',
        category: 'PHONE_NEW',
        colors: ['Black', 'White', 'Blue', 'Green', '(PRODUCT)RED', 'Purple'],
        storage: ['64GB', '128GB', '256GB'],
      },
      // === iPhone 11 Series (2019-2020) ===
      {
        name: 'iPhone 11 Pro Max',
        category: 'PHONE_NEW',
        colors: ['Gold', 'Silver', 'Space Gray', 'Midnight Green'],
        storage: ['64GB', '256GB', '512GB'],
      },
      {
        name: 'iPhone 11 Pro',
        category: 'PHONE_NEW',
        colors: ['Gold', 'Silver', 'Space Gray', 'Midnight Green'],
        storage: ['64GB', '256GB', '512GB'],
      },
      {
        name: 'iPhone 11',
        category: 'PHONE_NEW',
        colors: ['Purple', 'Yellow', 'Green', 'Black', 'White', '(PRODUCT)RED'],
        storage: ['64GB', '128GB', '256GB'],
      },
      // === iPhone SE ===
      {
        name: 'iPhone SE (3rd gen)',
        category: 'PHONE_NEW',
        colors: ['Midnight', 'Starlight', '(PRODUCT)RED'],
        storage: ['64GB', '128GB', '256GB'],
      },
      {
        name: 'iPhone SE (2nd gen)',
        category: 'PHONE_NEW',
        colors: ['Black', 'White', '(PRODUCT)RED'],
        storage: ['64GB', '128GB', '256GB'],
      },
      // === iPad Pro Series ===
      {
        name: 'iPad Pro 13" (M4)',
        category: 'TABLET',
        colors: ['Space Black', 'Silver'],
        storage: ['256GB', '512GB', '1TB', '2TB'],
      },
      {
        name: 'iPad Pro 11" (M4)',
        category: 'TABLET',
        colors: ['Space Black', 'Silver'],
        storage: ['256GB', '512GB', '1TB', '2TB'],
      },
      {
        name: 'iPad Pro 12.9" (6th gen, M2)',
        category: 'TABLET',
        colors: ['Silver', 'Space Gray'],
        storage: ['128GB', '256GB', '512GB', '1TB', '2TB'],
      },
      {
        name: 'iPad Pro 11" (4th gen, M2)',
        category: 'TABLET',
        colors: ['Silver', 'Space Gray'],
        storage: ['128GB', '256GB', '512GB', '1TB', '2TB'],
      },
      {
        name: 'iPad Pro 12.9" (5th gen, M1)',
        category: 'TABLET',
        colors: ['Silver', 'Space Gray'],
        storage: ['128GB', '256GB', '512GB', '1TB', '2TB'],
      },
      {
        name: 'iPad Pro 11" (3rd gen, M1)',
        category: 'TABLET',
        colors: ['Silver', 'Space Gray'],
        storage: ['128GB', '256GB', '512GB', '1TB', '2TB'],
      },
      // === iPad Pro (2020) ===
      {
        name: 'iPad Pro 12.9" (4th gen)',
        category: 'TABLET',
        colors: ['Silver', 'Space Gray'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPad Pro 11" (2nd gen)',
        category: 'TABLET',
        colors: ['Silver', 'Space Gray'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      // === iPad Air Series ===
      {
        name: 'iPad Air 13" (M3)',
        category: 'TABLET',
        colors: ['Space Gray', 'Starlight', 'Purple', 'Blue'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPad Air 11" (M3)',
        category: 'TABLET',
        colors: ['Space Gray', 'Starlight', 'Purple', 'Blue'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPad Air 13" (M2)',
        category: 'TABLET',
        colors: ['Space Gray', 'Starlight', 'Purple', 'Blue'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPad Air 11" (M2)',
        category: 'TABLET',
        colors: ['Space Gray', 'Starlight', 'Purple', 'Blue'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'iPad Air (5th gen)',
        category: 'TABLET',
        colors: ['Space Gray', 'Starlight', 'Pink', 'Purple', 'Blue'],
        storage: ['64GB', '256GB'],
      },
      {
        name: 'iPad Air (4th gen)',
        category: 'TABLET',
        colors: ['Space Gray', 'Silver', 'Rose Gold', 'Green', 'Sky Blue'],
        storage: ['64GB', '256GB'],
      },
      // === iPad mini Series ===
      {
        name: 'iPad mini (A17 Pro)',
        category: 'TABLET',
        colors: ['Space Gray', 'Starlight', 'Purple', 'Blue'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'iPad mini (6th gen)',
        category: 'TABLET',
        colors: ['Space Gray', 'Starlight', 'Pink', 'Purple'],
        storage: ['64GB', '256GB'],
      },
      // === iPad (standard) Series ===
      {
        name: 'iPad (10th gen)',
        category: 'TABLET',
        colors: ['Silver', 'Blue', 'Pink', 'Yellow'],
        storage: ['64GB', '256GB'],
      },
      {
        name: 'iPad (9th gen)',
        category: 'TABLET',
        colors: ['Silver', 'Space Gray'],
        storage: ['64GB', '256GB'],
      },
      {
        name: 'iPad (8th gen)',
        category: 'TABLET',
        colors: ['Silver', 'Gold', 'Space Gray'],
        storage: ['32GB', '128GB'],
      },
    ],
  },
];

export const brands = productCatalog.map((b) => b.brand);

export function getModels(brand: string, categoryFilter?: string): ModelInfo[] {
  const catalog = productCatalog.find((b) => b.brand === brand);
  if (!catalog) return [];
  if (!categoryFilter) return catalog.models;
  if (categoryFilter === 'PHONE_NEW' || categoryFilter === 'PHONE_USED') {
    return catalog.models.filter((m) => m.category === 'PHONE_NEW');
  }
  return catalog.models.filter((m) => m.category === categoryFilter);
}

export function getModelInfo(brand: string, modelName: string): ModelInfo | undefined {
  const catalog = productCatalog.find((b) => b.brand === brand);
  return catalog?.models.find((m) => m.name === modelName);
}
