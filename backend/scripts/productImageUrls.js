/** Category-appropriate demo product image URLs (Unsplash + picsum fallback). */

/** GET-verified Unsplash URLs (auto=format for smaller payload). */
export const IMAGES_BY_CATEGORY = {
  MEAT: [
    'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1558030006-450675393462?w=400&h=400&fit=crop&auto=format',
  ],
  POULTRY: [
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=400&h=400&fit=crop&auto=format',
  ],
  FISH: [
    'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=400&h=400&fit=crop&auto=format',
  ],
  VEG: [
    'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&h=400&fit=crop&auto=format',
  ],
  FRUIT: [
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&h=400&fit=crop&auto=format',
  ],
  DAIRY: [
    'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&h=400&fit=crop&auto=format',
  ],
  BAKERY: [
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&h=400&fit=crop&auto=format',
  ],
  DRINKS: [
    'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=400&fit=crop&auto=format',
  ],
  CANNED: [
    'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&h=400&fit=crop&auto=format',
  ],
  CLEAN: [
    'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop&auto=format',
  ],
  RICE: [
    'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&h=400&fit=crop&auto=format',
  ],
  PASTA: [
    'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&h=400&fit=crop&auto=format',
  ],
  SPICE: [
    'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=400&h=400&fit=crop&auto=format',
  ],
  SNACKS: [
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&h=400&fit=crop&auto=format',
  ],
  BABY: [
    'https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=400&h=400&fit=crop&auto=format',
  ],
  PERSONAL: [
    'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop&auto=format',
  ],
  FROZEN: [
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=400&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&h=400&fit=crop&auto=format',
  ],
};

const DEFAULT_IMAGES = [
  'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&h=400&fit=crop&auto=format',
];

/** Always resolves (picsum returns 200). Unique per product code. */
export function picsumFallback(productCode) {
  const seed = encodeURIComponent(String(productCode || 'product').replace(/\s+/g, '-'));
  return `https://picsum.photos/seed/invex-${seed}/400/400`;
}

/** Pick a stable image URL for a product in a category. */
export function pickProductImageUrl(categoryCode, productCode, index = 0) {
  const code = String(categoryCode || '').trim().toUpperCase();
  const pool = IMAGES_BY_CATEGORY[code] || DEFAULT_IMAGES;
  if (pool?.length) {
    return pool[index % pool.length];
  }
  return picsumFallback(productCode);
}
