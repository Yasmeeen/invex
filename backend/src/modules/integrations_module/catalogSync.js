import Category from '../../DB/models/category.model.js';
import Product from '../../DB/models/product.model.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
import { isEcommerceIntegrationFeatureAvailable } from './feature.js';
import { ensureOnlineBranch } from './onlineBranch.js';

const getLatestSettingsDoc = () => StoreSettings.findOne().sort({ updatedAt: -1 });

function sellableStock(product) {
  const stock = Number(product.stock) || 0;
  const transfer = Number(product.transferReservedQuantity) || 0;
  const booked = Number(product.bookedQuantity) || 0;
  const ecom = Number(product.ecommerceReservedQuantity) || 0;
  return Math.max(0, stock - transfer - booked - ecom);
}

function mapCategory(cat) {
  return {
    invexCategoryId: String(cat._id),
    name: cat.name,
    code: cat.code || '',
  };
}

function mapProduct(product, categoryIdOnEcomHint) {
  const price = Number(product.price) || 0;
  const discount = Number(product.discount) || 0;
  const offerPrice =
    discount > 0 ? Math.max(0, price - (price * discount) / 100) : undefined;
  return {
    invexProductId: String(product._id),
    invexCategoryId: product.category ? String(product.category._id || product.category) : null,
    name: product.name,
    code: product.code || '',
    price,
    offerPrice,
    stock: sellableStock(product),
    imageUrl: product.imageUrl || '',
    removedWhenOutOfStock: Boolean(product.removedWhenOutOfStock),
    categoryHint: categoryIdOnEcomHint || null,
  };
}

export async function getIntegrationConfig() {
  if (!isEcommerceIntegrationFeatureAvailable()) {
    return { enabled: false, reason: 'feature_disabled_env' };
  }
  const settings = await getLatestSettingsDoc();
  if (!settings?.ecommerceIntegrationEnabled) {
    return { enabled: false, reason: 'disabled_settings' };
  }
  const baseUrl = String(settings.ecommerceBaseUrl || '').trim().replace(/\/$/, '');
  const key = String(settings.ecommerceSharedKey || '').trim();
  if (!baseUrl || !key) {
    return { enabled: false, reason: 'missing_connection' };
  }
  return {
    enabled: true,
    baseUrl,
    key,
    catalogMode: settings.ecommerceCatalogMode === 'online_only' ? 'online_only' : 'all',
    onlineBranchId: settings.onlineBranchId || null,
    settings,
  };
}

export async function buildCatalogPayload() {
  const cfg = await getIntegrationConfig();
  if (!cfg.enabled) {
    return { ok: false, reason: cfg.reason, categories: [], products: [] };
  }

  let productQuery = { removedWhenOutOfStock: { $ne: true } };
  if (cfg.catalogMode === 'online_only') {
    const online = await ensureOnlineBranch();
    productQuery = {
      ...productQuery,
      branch: online._id,
      inWarehouse: { $ne: true },
    };
  } else {
    productQuery = {
      ...productQuery,
      listedOnEcommerce: true,
    };
  }

  const products = (await Product.find(productQuery).populate('category').lean()).filter(
    (p) => sellableStock(p) > 0
  );
  const categoryIds = [
    ...new Set(
      products
        .map((p) => (p.category?._id ? String(p.category._id) : p.category ? String(p.category) : null))
        .filter(Boolean)
    ),
  ];
  const categories = categoryIds.length
    ? await Category.find({ _id: { $in: categoryIds } }).lean()
    : [];

  return {
    ok: true,
    catalogMode: cfg.catalogMode,
    categories: categories.map(mapCategory),
    products: products.map((p) => mapProduct(p)),
  };
}

async function postToEcommerce(path, body) {
  const cfg = await getIntegrationConfig();
  if (!cfg.enabled) {
    return { ok: false, skipped: true, reason: cfg.reason };
  }
  const url = `${cfg.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-integration-key': cfg.key,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      console.error('[invex→ecom]', path, res.status, data);
      return { ok: false, status: res.status, data };
    }
    return { ok: true, data };
  } catch (err) {
    console.error('[invex→ecom] network error', path, err.message);
    return { ok: false, error: err.message };
  }
}

/** Full catalog replace/upsert push to e-commerce (batched to avoid huge payloads). */
export async function pushFullCatalog() {
  const payload = await buildCatalogPayload();
  if (!payload.ok) {
    return { ok: false, reason: payload.reason };
  }

  const categories = payload.categories || [];
  const products = payload.products || [];
  const BATCH = 40;
  let syncedProducts = 0;
  let lastError = null;

  // First batch includes all categories + first product chunk (and clears stale via sync endpoint)
  for (let i = 0; i < products.length || i === 0; i += BATCH) {
    const chunk = products.slice(i, i + BATCH);
    const isFirst = i === 0;
    const body = {
      catalogMode: payload.catalogMode,
      categories: isFirst ? categories : [],
      products: chunk,
      /** When false, ecom must not delete products missing from this chunk. */
      replaceMissing: isFirst && chunk.length === products.length,
      appendOnly: !isFirst,
    };
    // First call with all products if small enough uses replace; otherwise first chunk replaceMissing false and we only upsert
    if (products.length > BATCH) {
      body.replaceMissing = false;
      body.appendOnly = true;
    } else {
      body.replaceMissing = true;
      body.appendOnly = false;
    }

    const result = await postToEcommerce('/api/integration/invex/catalog/sync', body);
    if (!result.ok) {
      lastError = result;
      break;
    }
    syncedProducts += chunk.length;
    if (products.length === 0) break;
  }

  if (lastError) {
    return { ok: false, syncedProducts, total: products.length, ...lastError };
  }
  return {
    ok: true,
    categories: categories.length,
    products: syncedProducts,
    total: products.length,
  };
}

export async function pushProductUpsert(productId) {
  const cfg = await getIntegrationConfig();
  if (!cfg.enabled) return { ok: false, skipped: true, reason: cfg.reason };

  const product = await Product.findById(productId).populate('category').lean();
  if (!product) {
    return postToEcommerce('/api/integration/invex/catalog/product-delete', {
      invexProductId: String(productId),
    });
  }

  if (product.removedWhenOutOfStock || sellableStock(product) <= 0) {
    return postToEcommerce('/api/integration/invex/catalog/product-delete', {
      invexProductId: String(product._id),
    });
  }

  if (cfg.catalogMode === 'online_only') {
    const onlineId = String(cfg.onlineBranchId || (await ensureOnlineBranch())._id);
    if (String(product.branch || '') !== onlineId || product.inWarehouse) {
      return postToEcommerce('/api/integration/invex/catalog/product-delete', {
        invexProductId: String(product._id),
      });
    }
  } else if (!product.listedOnEcommerce) {
    return postToEcommerce('/api/integration/invex/catalog/product-delete', {
      invexProductId: String(product._id),
    });
  }

  const cat = product.category;
  return postToEcommerce('/api/integration/invex/catalog/product-upsert', {
    category: cat ? mapCategory(cat) : null,
    product: mapProduct(product),
  });
}

export async function pushProductDelete(productId) {
  return postToEcommerce('/api/integration/invex/catalog/product-delete', {
    invexProductId: String(productId),
  });
}

export async function pushCategoryUpsert(categoryId) {
  const cfg = await getIntegrationConfig();
  if (!cfg.enabled) return { ok: false, skipped: true, reason: cfg.reason };
  const cat = await Category.findById(categoryId).lean();
  if (!cat) {
    return postToEcommerce('/api/integration/invex/catalog/category-delete', {
      invexCategoryId: String(categoryId),
    });
  }
  return postToEcommerce('/api/integration/invex/catalog/category-upsert', {
    category: mapCategory(cat),
  });
}

export async function pushCategoryDelete(categoryId) {
  return postToEcommerce('/api/integration/invex/catalog/category-delete', {
    invexCategoryId: String(categoryId),
  });
}

/** Fire-and-forget helper for product module hooks. */
export function notifyProductChanged(productId) {
  if (!productId) return;
  setImmediate(() => {
    pushProductUpsert(productId).catch((err) =>
      console.error('[catalog sync] product upsert', err.message)
    );
  });
}

export function notifyProductDeleted(productId) {
  if (!productId) return;
  setImmediate(() => {
    pushProductDelete(productId).catch((err) =>
      console.error('[catalog sync] product delete', err.message)
    );
  });
}

export function notifyCategoryChanged(categoryId) {
  if (!categoryId) return;
  setImmediate(() => {
    pushCategoryUpsert(categoryId).catch((err) =>
      console.error('[catalog sync] category upsert', err.message)
    );
  });
}

export function notifyCategoryDeleted(categoryId) {
  if (!categoryId) return;
  setImmediate(() => {
    pushCategoryDelete(categoryId).catch((err) =>
      console.error('[catalog sync] category delete', err.message)
    );
  });
}
