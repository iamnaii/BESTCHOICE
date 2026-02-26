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
      // =============================================
      // === Galaxy S Series ========================
      // =============================================

      // === Galaxy S25 Series (2025) ===
      {
        name: 'Galaxy S25 Ultra',
        category: 'PHONE_NEW',
        colors: ['Titanium Silverblue', 'Titanium Black', 'Titanium Whitesilver', 'Titanium Gray', 'Titanium Jetblack', 'Titanium Jadegreen', 'Titanium Pinkgold'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'Galaxy S25+',
        category: 'PHONE_NEW',
        colors: ['Navy', 'Mint', 'Icy Blue', 'Silver Shadow', 'Coral Red', 'Blue Black', 'Pink Gold'],
        storage: ['256GB', '512GB'],
      },
      {
        name: 'Galaxy S25',
        category: 'PHONE_NEW',
        colors: ['Navy', 'Mint', 'Icy Blue', 'Silver Shadow', 'Coral Red', 'Blue Black', 'Pink Gold'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy S24 Series (2024) ===
      {
        name: 'Galaxy S24 Ultra',
        category: 'PHONE_NEW',
        colors: ['Titanium Violet', 'Titanium Black', 'Titanium Gray', 'Titanium Yellow', 'Titanium Blue', 'Titanium Green', 'Titanium Orange'],
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

      // === Galaxy S23 Series (2023) ===
      {
        name: 'Galaxy S23 Ultra',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Cream', 'Green', 'Lavender', 'Graphite', 'Lime', 'Red', 'Sky Blue'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'Galaxy S23+',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Cream', 'Green', 'Lavender', 'Graphite', 'Lime'],
        storage: ['256GB', '512GB'],
      },
      {
        name: 'Galaxy S23',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Cream', 'Green', 'Lavender', 'Graphite', 'Lime'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy S23 FE',
        category: 'PHONE_NEW',
        colors: ['Cream', 'Graphite', 'Mint', 'Purple', 'Indigo', 'Tangerine'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy S22 Series (2022) ===
      {
        name: 'Galaxy S22 Ultra',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Phantom White', 'Green', 'Burgundy', 'Graphite', 'Sky Blue', 'Red'],
        storage: ['128GB', '256GB', '512GB', '1TB'],
      },
      {
        name: 'Galaxy S22+',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Phantom White', 'Green', 'Pink Gold', 'Graphite', 'Cream', 'Sky Blue', 'Violet'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy S22',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Phantom White', 'Green', 'Pink Gold', 'Graphite', 'Cream', 'Sky Blue', 'Violet'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy S21 Series (2021) ===
      {
        name: 'Galaxy S21 Ultra',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Phantom Silver', 'Phantom Titanium', 'Phantom Navy', 'Phantom Brown'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'Galaxy S21+',
        category: 'PHONE_NEW',
        colors: ['Phantom Violet', 'Phantom Black', 'Phantom Silver', 'Phantom Gold', 'Phantom Red'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy S21',
        category: 'PHONE_NEW',
        colors: ['Phantom Violet', 'Phantom Pink', 'Phantom White', 'Phantom Gray'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy S21 FE',
        category: 'PHONE_NEW',
        colors: ['Graphite', 'White', 'Olive', 'Lavender'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy S20 Series (2020) ===
      {
        name: 'Galaxy S20',
        category: 'PHONE_NEW',
        colors: ['Cosmic Grey', 'Cloud Blue', 'Cloud Pink', 'Cloud White', 'Aura Red'],
        storage: ['128GB'],
      },
      {
        name: 'Galaxy S20+',
        category: 'PHONE_NEW',
        colors: ['Cosmic Black', 'Cosmic Grey', 'Cloud Blue', 'Aura Blue'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'Galaxy S20 Ultra',
        category: 'PHONE_NEW',
        colors: ['Cosmic Grey', 'Cosmic Black'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'Galaxy S20 FE',
        category: 'PHONE_NEW',
        colors: ['Cloud Lavender', 'Cloud Mint', 'Cloud Navy', 'Cloud White', 'Cloud Red', 'Cloud Orange'],
        storage: ['128GB', '256GB'],
      },

      // =============================================
      // === Galaxy Note Series =====================
      // =============================================

      // === Galaxy Note20 Series (2020) ===
      {
        name: 'Galaxy Note20',
        category: 'PHONE_NEW',
        colors: ['Mystic Green', 'Mystic Bronze', 'Mystic Grey'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy Note20 Ultra',
        category: 'PHONE_NEW',
        colors: ['Mystic Bronze', 'Mystic Black', 'Mystic White'],
        storage: ['128GB', '256GB', '512GB'],
      },

      // =============================================
      // === Galaxy Z Fold Series ===================
      // =============================================

      // === Galaxy Z Fold6 (2024) ===
      {
        name: 'Galaxy Z Fold6',
        category: 'PHONE_NEW',
        colors: ['Silver Shadow', 'Pink', 'Navy', 'Crafted Black', 'White'],
        storage: ['256GB', '512GB', '1TB'],
      },

      // === Galaxy Z Fold5 (2023) ===
      {
        name: 'Galaxy Z Fold5',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Icy Blue', 'Cream', 'Blue', 'Gray'],
        storage: ['256GB', '512GB', '1TB'],
      },

      // === Galaxy Z Fold4 (2022) ===
      {
        name: 'Galaxy Z Fold4',
        category: 'PHONE_NEW',
        colors: ['Graygreen', 'Phantom Black', 'Beige', 'Burgundy'],
        storage: ['256GB', '512GB', '1TB'],
      },

      // === Galaxy Z Fold3 (2021) ===
      {
        name: 'Galaxy Z Fold3',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Phantom Green', 'Phantom Silver'],
        storage: ['256GB', '512GB'],
      },

      // === Galaxy Z Fold2 (2020) ===
      {
        name: 'Galaxy Z Fold2',
        category: 'PHONE_NEW',
        colors: ['Mystic Black', 'Mystic Bronze'],
        storage: ['256GB', '512GB'],
      },

      // =============================================
      // === Galaxy Z Flip Series ===================
      // =============================================

      // === Galaxy Z Flip6 (2024) ===
      {
        name: 'Galaxy Z Flip6',
        category: 'PHONE_NEW',
        colors: ['Blue', 'Mint', 'Silver Shadow', 'Yellow', 'Crafted Black', 'White', 'Peach'],
        storage: ['256GB', '512GB'],
      },

      // === Galaxy Z Flip5 (2023) ===
      {
        name: 'Galaxy Z Flip5',
        category: 'PHONE_NEW',
        colors: ['Graphite', 'Cream', 'Mint', 'Lavender', 'Gray', 'Blue', 'Green', 'Yellow'],
        storage: ['256GB', '512GB'],
      },

      // === Galaxy Z Flip4 (2022) ===
      {
        name: 'Galaxy Z Flip4',
        category: 'PHONE_NEW',
        colors: ['Graphite', 'Pink Gold', 'Bora Purple', 'Blue'],
        storage: ['128GB', '256GB', '512GB'],
      },

      // === Galaxy Z Flip3 (2021) ===
      {
        name: 'Galaxy Z Flip3',
        category: 'PHONE_NEW',
        colors: ['Phantom Black', 'Lavender', 'Green', 'Cream'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy Z Flip (2020) ===
      {
        name: 'Galaxy Z Flip',
        category: 'PHONE_NEW',
        colors: ['Mirror Black', 'Mirror Gold', 'Mirror Purple'],
        storage: ['256GB'],
      },

      // =============================================
      // === Galaxy A50 Series ======================
      // =============================================

      // === Galaxy A56 5G (2025) ===
      {
        name: 'Galaxy A56 5G',
        category: 'PHONE_NEW',
        colors: ['Awesome Lightgray', 'Awesome Graphite', 'Awesome Olive', 'Awesome Pink'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A55 5G (2024) ===
      {
        name: 'Galaxy A55 5G',
        category: 'PHONE_NEW',
        colors: ['Awesome Iceblue', 'Awesome Lilac', 'Awesome Lemon', 'Awesome Navy'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A54 5G (2023) ===
      {
        name: 'Galaxy A54 5G',
        category: 'PHONE_NEW',
        colors: ['Awesome Graphite', 'Awesome Violet', 'Awesome Lime', 'Awesome White'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A53 5G (2022) ===
      {
        name: 'Galaxy A53 5G',
        category: 'PHONE_NEW',
        colors: ['Awesome Black', 'Awesome White', 'Awesome Blue', 'Awesome Peach'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A52 (2021) ===
      {
        name: 'Galaxy A52',
        category: 'PHONE_NEW',
        colors: ['Awesome Black', 'Awesome White', 'Awesome Blue', 'Awesome Violet'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A52s 5G (2021) ===
      {
        name: 'Galaxy A52s 5G',
        category: 'PHONE_NEW',
        colors: ['Awesome Black', 'Awesome White', 'Awesome Violet', 'Awesome Mint'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A51 (2020) ===
      {
        name: 'Galaxy A51',
        category: 'PHONE_NEW',
        colors: ['Prism Crush Black', 'Prism Crush White', 'Prism Crush Blue', 'Prism Crush Pink'],
        storage: ['64GB', '128GB', '256GB'],
      },

      // =============================================
      // === Galaxy A30 Series ======================
      // =============================================

      // === Galaxy A36 5G (2025) ===
      {
        name: 'Galaxy A36 5G',
        category: 'PHONE_NEW',
        colors: ['Awesome Lavender', 'Awesome Black', 'Awesome White', 'Awesome Lime'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A35 5G (2024) ===
      {
        name: 'Galaxy A35 5G',
        category: 'PHONE_NEW',
        colors: ['Awesome Iceblue', 'Awesome Lilac', 'Awesome Lemon', 'Awesome Navy'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A34 5G (2023) ===
      {
        name: 'Galaxy A34 5G',
        category: 'PHONE_NEW',
        colors: ['Awesome Lime', 'Awesome Silver', 'Awesome Violet', 'Awesome Graphite'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A33 5G (2022) ===
      {
        name: 'Galaxy A33 5G',
        category: 'PHONE_NEW',
        colors: ['Awesome Black', 'Awesome White', 'Awesome Light Blue', 'Awesome Peach'],
        storage: ['128GB'],
      },

      // === Galaxy A32 (2021) ===
      {
        name: 'Galaxy A32',
        category: 'PHONE_NEW',
        colors: ['Awesome Black', 'Awesome White', 'Awesome Blue', 'Awesome Violet'],
        storage: ['64GB', '128GB'],
      },

      // =============================================
      // === Galaxy A20 Series ======================
      // =============================================

      // === Galaxy A26 5G (2025) ===
      {
        name: 'Galaxy A26 5G',
        category: 'PHONE_NEW',
        colors: ['Black', 'White', 'Mint', 'Peach Pink'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A25 5G (2024) ===
      {
        name: 'Galaxy A25 5G',
        category: 'PHONE_NEW',
        colors: ['Blue', 'Blue Black', 'Light Blue', 'Yellow'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A24 (2023) ===
      {
        name: 'Galaxy A24',
        category: 'PHONE_NEW',
        colors: ['Black', 'Dark Red', 'Light Green'],
        storage: ['128GB'],
      },

      // === Galaxy A23 (2022) ===
      {
        name: 'Galaxy A23',
        category: 'PHONE_NEW',
        colors: ['Black', 'White', 'Blue', 'Peach'],
        storage: ['64GB', '128GB'],
      },

      // =============================================
      // === Galaxy A10 Series ======================
      // =============================================

      // === Galaxy A16 5G (2024) ===
      {
        name: 'Galaxy A16 5G',
        category: 'PHONE_NEW',
        colors: ['Blue Black', 'Gold', 'Light Green', 'Light Gray'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A15 (2024) ===
      {
        name: 'Galaxy A15',
        category: 'PHONE_NEW',
        colors: ['Blue', 'Blue Black', 'Light Blue', 'Yellow'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy A14 (2023) ===
      {
        name: 'Galaxy A14',
        category: 'PHONE_NEW',
        colors: ['Black', 'Silver', 'Dark Red', 'Light Green'],
        storage: ['64GB', '128GB'],
      },

      // =============================================
      // === Galaxy Tab S Series ====================
      // =============================================

      // === Galaxy Tab S10 Series (2024-2025) ===
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
        colors: ['Gray', 'Silver', 'Blue'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy Tab S9 Series (2023) ===
      {
        name: 'Galaxy Tab S9 Ultra',
        category: 'TABLET',
        colors: ['Graphite', 'Beige'],
        storage: ['256GB', '512GB', '1TB'],
      },
      {
        name: 'Galaxy Tab S9+',
        category: 'TABLET',
        colors: ['Graphite', 'Beige'],
        storage: ['256GB', '512GB'],
      },
      {
        name: 'Galaxy Tab S9',
        category: 'TABLET',
        colors: ['Graphite', 'Beige'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy Tab S9 FE',
        category: 'TABLET',
        colors: ['Silver', 'Gray', 'Lavender', 'Mint'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy Tab S8 Series (2022) ===
      {
        name: 'Galaxy Tab S8 Ultra',
        category: 'TABLET',
        colors: ['Graphite'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'Galaxy Tab S8+',
        category: 'TABLET',
        colors: ['Graphite', 'Silver', 'Pink Gold'],
        storage: ['128GB', '256GB'],
      },
      {
        name: 'Galaxy Tab S8',
        category: 'TABLET',
        colors: ['Graphite', 'Silver', 'Pink Gold'],
        storage: ['128GB', '256GB'],
      },

      // === Galaxy Tab S7 Series (2020-2021) ===
      {
        name: 'Galaxy Tab S7+',
        category: 'TABLET',
        colors: ['Mystic Black', 'Mystic Silver', 'Mystic Bronze', 'Mystic Navy'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'Galaxy Tab S7',
        category: 'TABLET',
        colors: ['Mystic Black', 'Mystic Silver', 'Mystic Bronze', 'Mystic Navy'],
        storage: ['128GB', '256GB', '512GB'],
      },
      {
        name: 'Galaxy Tab S7 FE',
        category: 'TABLET',
        colors: ['Mystic Black', 'Mystic Silver', 'Mystic Green', 'Mystic Pink'],
        storage: ['64GB', '128GB', '256GB'],
      },

      // === Galaxy Tab S6 Lite (2020) ===
      {
        name: 'Galaxy Tab S6 Lite',
        category: 'TABLET',
        colors: ['Oxford Gray', 'Chiffon Pink', 'Angora Blue'],
        storage: ['64GB', '128GB'],
      },

      // =============================================
      // === Galaxy Tab A Series ====================
      // =============================================
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
      {
        name: 'Galaxy Tab A8',
        category: 'TABLET',
        colors: ['Graphite', 'Silver', 'Pink Gold'],
        storage: ['32GB', '64GB', '128GB'],
      },
      {
        name: 'Galaxy Tab A7 Lite',
        category: 'TABLET',
        colors: ['Gray', 'Silver'],
        storage: ['32GB', '64GB'],
      },
      {
        name: 'Galaxy Tab A7',
        category: 'TABLET',
        colors: ['Dark Gray', 'Silver', 'Gold'],
        storage: ['32GB', '64GB'],
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
      // === iPhone 12 Series (2020) ===
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
