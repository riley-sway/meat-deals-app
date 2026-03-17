export type MeatType = 'beef' | 'chicken' | 'pork' | 'lamb' | 'seafood' | 'deli' | 'other';

export interface Deal {
  meatType: MeatType;
  cut: string;
  store: string;
  price: number | null;
  unit: 'lb' | 'kg' | string;
  description: string;
  originalPrice: number | null;
  validUntil: string | null;
  savings: string | null;
  conditions: string | null;
  url: string | null;
}

export interface SearchResults {
  searchedArea: string;
  deals: Deal[];
}

export const MEAT_TYPES: { type: MeatType | 'all'; label: string; emoji: string }[] = [
  { type: 'all', label: 'All', emoji: '🛒' },
  { type: 'beef', label: 'Beef', emoji: '🥩' },
  { type: 'chicken', label: 'Chicken', emoji: '🍗' },
  { type: 'pork', label: 'Pork', emoji: '🥓' },
  { type: 'lamb', label: 'Lamb', emoji: '🐑' },
  { type: 'seafood', label: 'Seafood', emoji: '🐟' },
  { type: 'deli', label: 'Deli', emoji: '🌭' },
  { type: 'other', label: 'Other', emoji: '🍖' },
];
