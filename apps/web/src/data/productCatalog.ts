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
    brand: 'Samsung',
    models: [
      // === Galaxy S25 Series (2025) ===
      {
        name: 'Galaxy S25 Ultra',
        category: 'PHONE_NEW',
        colors: ['Titanium Silverblue', 'Titanium Black', 'Titanium Whitesilver', 'Titanium Gray', 'Titanium Jadegreen', 'Titanium Jetblack', 'Titanium Pinkgold'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'Galaxy S25+',
        category: 'PHONE_NEW',
        colors: ['Navy', 'Mint', 'Icyblue', 'Silver Shadow', 'Pinkgold', 'Coralred', 'Blueblack'],
        storage: ['256GB', '512GB'],
      },
      {
        name: 'Galaxy S25',
        category: 'PHONE_NEW',
        colors: ['Navy', 'Mint', 'Icyblue', 'Silver Shadow', 'Pinkgold', 'Coralred', 'Blueblack'],
        storage: ['128GB', '256GB', '512GB'],
      },
      // === Galaxy S24 Series (2024) ===
      {
        name: 'Galaxy S24 Ultra',
        category: 'PHONE_NEW',
        colors: ['Titanium Gray', 'Titanium Black', 'Titanium Violet', 'Titanium Yellow', 'Titanium Blue', 'Titanium Green', 'Titanium Orange'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'Galaxy S24+',
        category: 'PHONE_NEW',
        colors: ['Amber Yellow', 'Marble Gray', 'Cobalt Violet', 'Onyx Black', 'Jade Green', 'Sapphire Blue', 'Sandstone Orange'],
        storage: ['256GB', '512GB'],
      },
      {
        name: 'Galaxy S24',
        category: 'PHONE_NEW',
        colors: ['Amber Yellow', 'Marble Gray', 'Cobalt Violet', 'Onyx Black', 'Jade Green', 'Sapphire Blue', 'Sandstone Orange'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy S24 FE',
        category: 'PHONE_NEW',
        colors: ['Blue', 'Graphite', 'Gray', 'Mint', 'Yellow'],
        storage: ['128GB', '256GB'],
      },
      // === Galaxy Z Series (2024) ===
      {
        name: 'Galaxy Z Fold6',
        category: 'PHONE_NEW',
        colors: ['Silver Shadow', 'Pink', 'Navy', 'Crafted Black', 'White'],
        storage: ['256GB', '512GB'],
      },
      {
        name: 'Galaxy Z Flip6',
        category: 'PHONE_NEW',
        colors: ['Silver Shadow', 'Yellow', 'Blue', 'Mint', 'Crafted Black', 'White', 'Peach'],
        storage: ['256GB', '512GB'],
      },
      // === Galaxy A Series (2025) ===
      {
        name: 'Galaxy A56 5G',
        category: 'PHONE_NEW',
        colors: ['Black', 'Blue', 'Lilac', 'Light Green'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy A36 5G',
        category: 'PHONE_NEW',
        colors: ['Black', 'Lilac', 'Light Green', 'Light Blue'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy A26 5G',
        category: 'PHONE_NEW',
        colors: ['Black', 'Cyan', 'Light Green'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy A16 5G',
        category: 'PHONE_NEW',
        colors: ['Blue Black', 'Gold', 'Light Green'],
        storage: ['128GB', '256GB'],
      },
      // === Galaxy Tab S Series (2024-2025) ===
      {
        name: 'Galaxy Tab S10 Ultra',
        category: 'TABLET',
        colors: ['Moonstone Gray', 'Platinum Silver'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'Galaxy Tab S10+',
        category: 'TABLET',
        colors: ['Moonstone Gray', 'Platinum Silver'],
        storage: ['256GB', '512GB'],
      },
      {
        name: 'Galaxy Tab S10 FE',
        category: 'TABLET',
        colors: ['Gray', 'Mint', 'Lavender'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy Tab S9 FE',
        category: 'TABLET',
        colors: ['Gray', 'Silver', 'Mint', 'Lavender'],
        storage: ['128GB', '256GB'],
      },
      // === Galaxy Tab A Series ===
      {
        name: 'Galaxy Tab A9+',
        category: 'TABLET',
        colors: ['Graphite', 'Silver', 'Navy'],
        storage: ['64GB', '128GB'],
      },
      {
        name: 'Galaxy Tab A9',
        category: 'TABLET',
        colors: ['Graphite', 'Silver', 'Navy'],
        storage: ['64GB', '128GB'],
      },
    ],
  },
  {
    brand: 'Apple',
    models: [
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
      // === iPad Series ===
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
        name: 'iPad mini (A17 Pro)',
        category: 'TABLET',
        colors: ['Space Gray', 'Starlight', 'Purple', 'Blue'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'iPad (10th gen)',
        category: 'TABLET',
        colors: ['Silver', 'Blue', 'Pink', 'Yellow'],
        storage: ['64GB', '256GB'],
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
