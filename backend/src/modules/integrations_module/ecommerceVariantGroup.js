import crypto from 'crypto';
import Product from '../../DB/models/product.model.js';
import Category from '../../DB/models/category.model.js';

const COLOR_TOKEN_RE =
  /\b(black|white|silver|gold|golden|blue|red|green|pink|gray|grey|brown|purple|violet|orange|yellow|beige|navy|titanium|graphite|midnight|starlight|space\s*black|deep\s*purple|أسود|ابيض|أبيض|فضي|ذهبي|ازرق|أزرق|احمر|أحمر|اخضر|أخضر|وردي|رمادي|بني|بنفسجي|برتقالي|اصفر|أصفر|بيج|كحلي|تيتانيوم|جرافيت|منتصف\s*الليل)\b/giu;

const COLOR_ATTR_RE = /^(color|colour|لون|اللون|colore)$/i;

const COLOR_HEX = {
  black: '#111827',
  أسود: '#111827',
  white: '#f8fafc',
  ابيض: '#f8fafc',
  أبيض: '#f8fafc',
  silver: '#9ca3af',
  فضي: '#9ca3af',
  gold: '#d4a017',
  golden: '#d4a017',
  ذهبي: '#d4a017',
  blue: '#2563eb',
  ازرق: '#2563eb',
  أزرق: '#2563eb',
  red: '#dc2626',
  احمر: '#dc2626',
  أحمر: '#dc2626',
  green: '#16a34a',
  اخضر: '#16a34a',
  أخضر: '#16a34a',
  pink: '#ec4899',
  وردي: '#ec4899',
  gray: '#6b7280',
  grey: '#6b7280',
  رمادي: '#6b7280',
  brown: '#92400e',
  بني: '#92400e',
  purple: '#7c3aed',
  violet: '#7c3aed',
  بنفسجي: '#7c3aed',
  orange: '#ea580c',
  برتقالي: '#ea580c',
  yellow: '#eab308',
  اصفر: '#eab308',
  أصفر: '#eab308',
  beige: '#d6c6a8',
  بيج: '#d6c6a8',
  navy: '#1e3a8a',
  كحلي: '#1e3a8a',
  titanium: '#8b919a',
  تيتانيوم: '#8b919a',
  graphite: '#4b5563',
  جرافيت: '#4b5563',
};

function newGroupId() {
  return crypto.randomUUID();
}

function attrsToObject(attributes) {
  if (!attributes) return {};
  if (attributes instanceof Map) return Object.fromEntries(attributes.entries());
  if (typeof attributes === 'object') return { ...attributes };
  return {};
}

export function normalizeListingBaseName(name) {
  let s = String(name || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(COLOR_TOKEN_RE, ' ')
    .replace(/[_\-–—|/\\]+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

export function detectVariantAxis(category) {
  const defs = Array.isArray(category?.attributeDefs) ? category.attributeDefs : [];
  for (const d of defs) {
    const key = String(d?.key || '').trim();
    const label = String(d?.label || '').trim();
    if (COLOR_ATTR_RE.test(key) || COLOR_ATTR_RE.test(label)) {
      return {
        key,
        label: label || key || 'Color',
      };
    }
  }
  return { key: 'color', label: 'Color' };
}

export function resolveVariantLabel(product, axisKey) {
  const attrs = attrsToObject(product?.attributes);
  const fromAttr = String(attrs[axisKey] || attrs.color || attrs.لون || attrs.اللون || '').trim();
  if (fromAttr) return fromAttr;

  const name = String(product?.name || '');
  const matches = name.match(COLOR_TOKEN_RE);
  if (matches?.length) {
    return String(matches[matches.length - 1]).trim();
  }
  return String(product?.code || product?.name || 'Variant').trim();
}

export function colorHexForLabel(label) {
  const raw = String(label || '').trim();
  if (!raw) return undefined;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw;
  const key = raw.toLowerCase();
  return COLOR_HEX[key] || COLOR_HEX[raw] || undefined;
}

function clearGroupFields(doc) {
  doc.ecommerceVariantGroupId = null;
  doc.ecommerceVariantGroupSource = undefined;
  doc.ecommerceListingTitle = '';
  doc.ecommerceVariantAxisKey = '';
  doc.ecommerceVariantLabel = '';
}

async function loadCategory(product) {
  if (product?.category && typeof product.category === 'object' && product.category.attributeDefs) {
    return product.category;
  }
  const catId = product?.category?._id || product?.category;
  if (!catId) return null;
  return Category.findById(catId).lean();
}

async function membersOfGroup(groupId) {
  if (!groupId) return [];
  return Product.find({ ecommerceVariantGroupId: String(groupId) })
    .populate('category', 'name attributeDefs')
    .populate('branch', 'name')
    .lean();
}

function pickListingTitle(members, axisKey) {
  const explicit = members
    .map((m) => String(m.ecommerceListingTitle || '').trim())
    .find(Boolean);
  if (explicit) return explicit;
  const first = members[0];
  const base = normalizeListingBaseName(first?.name);
  if (base) {
    return base.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return String(first?.name || 'Product').trim();
}

export async function getVariantGroupSnapshot(productId) {
  const product = await Product.findById(productId)
    .populate('category', 'name attributeDefs')
    .lean();
  if (!product) return null;

  const groupId = product.ecommerceVariantGroupId
    ? String(product.ecommerceVariantGroupId)
    : null;
  const members = groupId ? await membersOfGroup(groupId) : [product];
  const category = await loadCategory(product);
  const axis = detectVariantAxis(category);
  const axisKey = product.ecommerceVariantAxisKey || axis.key;

  const memberRows = members.map((m) => ({
    _id: String(m._id),
    name: m.name,
    code: m.code,
    stock: m.stock,
    price: m.price,
    imageUrl: m.imageUrl || '',
    listedOnEcommerce: Boolean(m.listedOnEcommerce),
    attributes: attrsToObject(m.attributes),
    variantLabel:
      String(m.ecommerceVariantLabel || '').trim() || resolveVariantLabel(m, axisKey),
    locked: Boolean(m.ecommerceVariantGroupLocked),
    source: m.ecommerceVariantGroupSource || null,
  }));

  return {
    productId: String(product._id),
    groupId,
    locked: Boolean(product.ecommerceVariantGroupLocked),
    source: product.ecommerceVariantGroupSource || null,
    listingTitle: groupId
      ? pickListingTitle(members, axisKey)
      : String(product.ecommerceListingTitle || '').trim() || product.name,
    axisKey,
    axisLabel: axis.label,
    isGrouped: Boolean(groupId) && members.length > 1,
    members: memberRows,
    suggestions: groupId ? [] : await findAutoSuggestions(product, category),
  };
}

async function findAutoSuggestions(product, category) {
  const catId = product?.category?._id || product?.category;
  if (!catId) return [];
  const base = normalizeListingBaseName(product.name);
  if (!base || base.length < 2) return [];

  const axis = detectVariantAxis(category);
  const candidates = await Product.find({
    _id: { $ne: product._id },
    category: catId,
    removedWhenOutOfStock: { $ne: true },
  })
    .select(
      'name code stock price imageUrl attributes listedOnEcommerce ecommerceVariantGroupId ecommerceVariantGroupLocked ecommerceVariantLabel'
    )
    .limit(80)
    .lean();

  return candidates
    .filter((c) => normalizeListingBaseName(c.name) === base)
    .filter((c) => !c.ecommerceVariantGroupLocked || !c.ecommerceVariantGroupId)
    .slice(0, 12)
    .map((c) => ({
      _id: String(c._id),
      name: c.name,
      code: c.code,
      stock: c.stock,
      listedOnEcommerce: Boolean(c.listedOnEcommerce),
      variantLabel: resolveVariantLabel(c, axis.key),
      alreadyGrouped: Boolean(c.ecommerceVariantGroupId),
    }));
}

/**
 * Auto-attach product to a variant group when similar SKUs exist.
 * Never moves products that are manually locked.
 */
export async function ensureAutoGroupForProduct(productId) {
  const product = await Product.findById(productId);
  if (!product) return { ok: false, reason: 'not_found' };
  if (product.ecommerceVariantGroupLocked) {
    return { ok: true, skipped: true, reason: 'locked' };
  }

  const category = await loadCategory(product);
  const axis = detectVariantAxis(category);
  const base = normalizeListingBaseName(product.name);
  if (!base || base.length < 2) {
    return { ok: true, skipped: true, reason: 'weak_name' };
  }

  const catId = product.category;
  const peers = await Product.find({
    _id: { $ne: product._id },
    category: catId,
    removedWhenOutOfStock: { $ne: true },
    $or: [
      { ecommerceVariantGroupLocked: { $ne: true } },
      { ecommerceVariantGroupId: product.ecommerceVariantGroupId || '__none__' },
    ],
  }).limit(200);

  const matches = peers.filter((p) => {
    if (p.ecommerceVariantGroupLocked && p.ecommerceVariantGroupId) {
      // only join locked peers if already same group
      return (
        product.ecommerceVariantGroupId &&
        String(p.ecommerceVariantGroupId) === String(product.ecommerceVariantGroupId)
      );
    }
    return normalizeListingBaseName(p.name) === base;
  });

  if (!matches.length) {
    // Alone: drop auto group if it was auto and no peers left
    if (product.ecommerceVariantGroupId && product.ecommerceVariantGroupSource === 'auto') {
      const still = await Product.countDocuments({
        ecommerceVariantGroupId: product.ecommerceVariantGroupId,
        _id: { $ne: product._id },
      });
      if (still === 0) {
        clearGroupFields(product);
        await product.save();
      }
    }
    return { ok: true, grouped: false };
  }

  // Prefer an existing group among matches
  let groupId =
    matches.map((m) => m.ecommerceVariantGroupId).find(Boolean) ||
    product.ecommerceVariantGroupId ||
    newGroupId();
  groupId = String(groupId);

  const toUpdate = [product, ...matches.filter((m) => !m.ecommerceVariantGroupLocked)];
  for (const doc of toUpdate) {
    if (doc.ecommerceVariantGroupLocked) continue;
    doc.ecommerceVariantGroupId = groupId;
    doc.ecommerceVariantGroupSource = doc.ecommerceVariantGroupSource === 'manual' ? 'manual' : 'auto';
    doc.ecommerceVariantAxisKey = axis.key;
    if (!doc.ecommerceVariantLabel) {
      doc.ecommerceVariantLabel = resolveVariantLabel(doc, axis.key);
    }
    await doc.save();
  }

  // Collapse singleton leftover groups
  await collapseSingletonGroups(groupId);

  return { ok: true, grouped: true, groupId };
}

async function collapseSingletonGroups(preferKeepGroupId) {
  const groups = await Product.aggregate([
    { $match: { ecommerceVariantGroupId: { $type: 'string', $ne: '' } } },
    { $group: { _id: '$ecommerceVariantGroupId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: 1 } },
  ]);
  for (const g of groups) {
    if (preferKeepGroupId && String(g._id) === String(preferKeepGroupId)) continue;
    await Product.updateOne(
      { _id: g.ids[0] },
      {
        $set: {
          ecommerceVariantGroupId: null,
          ecommerceVariantGroupSource: null,
          ecommerceListingTitle: '',
          ecommerceVariantAxisKey: '',
          ecommerceVariantLabel: '',
        },
      }
    );
  }
}

export async function joinVariantGroup(productId, otherProductId) {
  if (String(productId) === String(otherProductId)) {
    return { ok: false, error: 'Cannot join a product to itself' };
  }
  const a = await Product.findById(productId);
  const b = await Product.findById(otherProductId);
  if (!a || !b) return { ok: false, error: 'Product not found' };
  if (String(a.category) !== String(b.category)) {
    return { ok: false, error: 'Products must be in the same category' };
  }

  const category = await loadCategory(a);
  const axis = detectVariantAxis(category);
  const groupId = String(
    a.ecommerceVariantGroupId || b.ecommerceVariantGroupId || newGroupId()
  );

  const ids = new Set([String(a._id), String(b._id)]);
  if (a.ecommerceVariantGroupId) {
    const members = await Product.find({ ecommerceVariantGroupId: a.ecommerceVariantGroupId });
    members.forEach((m) => ids.add(String(m._id)));
  }
  if (b.ecommerceVariantGroupId) {
    const members = await Product.find({ ecommerceVariantGroupId: b.ecommerceVariantGroupId });
    members.forEach((m) => ids.add(String(m._id)));
  }

  await Product.updateMany(
    { _id: { $in: [...ids] } },
    {
      $set: {
        ecommerceVariantGroupId: groupId,
        ecommerceVariantGroupLocked: true,
        ecommerceVariantGroupSource: 'manual',
        ecommerceVariantAxisKey: axis.key,
      },
    }
  );

  // Fill missing labels
  const all = await Product.find({ _id: { $in: [...ids] } });
  for (const doc of all) {
    if (!doc.ecommerceVariantLabel) {
      doc.ecommerceVariantLabel = resolveVariantLabel(doc, axis.key);
      await doc.save();
    }
  }

  await collapseSingletonGroups(groupId);
  return { ok: true, groupId, snapshot: await getVariantGroupSnapshot(productId) };
}

export async function leaveVariantGroup(productId) {
  const product = await Product.findById(productId);
  if (!product) return { ok: false, error: 'Product not found' };
  const oldGroup = product.ecommerceVariantGroupId
    ? String(product.ecommerceVariantGroupId)
    : null;

  clearGroupFields(product);
  product.ecommerceVariantGroupLocked = true;
  product.ecommerceVariantGroupSource = 'manual';
  await product.save();

  if (oldGroup) {
    await collapseSingletonGroups(null);
  }

  return { ok: true, snapshot: await getVariantGroupSnapshot(productId) };
}

export async function setVariantGroupMembers(productId, memberIds = []) {
  const product = await Product.findById(productId);
  if (!product) return { ok: false, error: 'Product not found' };

  const unique = [...new Set([String(productId), ...memberIds.map(String)])];
  const docs = await Product.find({ _id: { $in: unique } });
  if (docs.length !== unique.length) {
    return { ok: false, error: 'One or more products not found' };
  }
  const cat = String(product.category);
  if (docs.some((d) => String(d.category) !== cat)) {
    return { ok: false, error: 'All members must share the same category' };
  }

  const category = await loadCategory(product);
  const axis = detectVariantAxis(category);
  const groupId = String(product.ecommerceVariantGroupId || newGroupId());

  // Remove previous auto/manual members that are no longer selected (only from this group)
  if (product.ecommerceVariantGroupId) {
    const prev = await Product.find({ ecommerceVariantGroupId: product.ecommerceVariantGroupId });
    for (const p of prev) {
      if (!unique.includes(String(p._id))) {
        clearGroupFields(p);
        p.ecommerceVariantGroupLocked = true;
        p.ecommerceVariantGroupSource = 'manual';
        await p.save();
      }
    }
  }

  if (unique.length < 2) {
    clearGroupFields(product);
    product.ecommerceVariantGroupLocked = true;
    product.ecommerceVariantGroupSource = 'manual';
    await product.save();
    return { ok: true, snapshot: await getVariantGroupSnapshot(productId) };
  }

  for (const doc of docs) {
    doc.ecommerceVariantGroupId = groupId;
    doc.ecommerceVariantGroupLocked = true;
    doc.ecommerceVariantGroupSource = 'manual';
    doc.ecommerceVariantAxisKey = axis.key;
    if (!doc.ecommerceVariantLabel) {
      doc.ecommerceVariantLabel = resolveVariantLabel(doc, axis.key);
    }
    await doc.save();
  }

  return { ok: true, groupId, snapshot: await getVariantGroupSnapshot(productId) };
}

export async function updateVariantGroupMeta(productId, { listingTitle, variantLabel } = {}) {
  const product = await Product.findById(productId);
  if (!product) return { ok: false, error: 'Product not found' };

  if (listingTitle != null) {
    const title = String(listingTitle).trim();
    if (product.ecommerceVariantGroupId) {
      await Product.updateMany(
        { ecommerceVariantGroupId: product.ecommerceVariantGroupId },
        { $set: { ecommerceListingTitle: title, ecommerceVariantGroupLocked: true, ecommerceVariantGroupSource: 'manual' } }
      );
    } else {
      product.ecommerceListingTitle = title;
      product.ecommerceVariantGroupLocked = true;
      product.ecommerceVariantGroupSource = 'manual';
      await product.save();
    }
  }

  if (variantLabel != null) {
    product.ecommerceVariantLabel = String(variantLabel).trim();
    product.ecommerceVariantGroupLocked = true;
    product.ecommerceVariantGroupSource = 'manual';
    await product.save();
  }

  return { ok: true, snapshot: await getVariantGroupSnapshot(productId) };
}

export async function reSuggestVariantGroup(productId) {
  const product = await Product.findById(productId);
  if (!product) return { ok: false, error: 'Product not found' };

  // Unlock and clear so auto can re-run
  clearGroupFields(product);
  product.ecommerceVariantGroupLocked = false;
  await product.save();

  const result = await ensureAutoGroupForProduct(productId);
  return { ok: true, ...result, snapshot: await getVariantGroupSnapshot(productId) };
}

/**
 * Given lean products eligible for catalog, collapse variant groups into one payload each.
 * Ungrouped products stay flat.
 */
export function collapseProductsForCatalog(products, mapFlatProduct) {
  const byGroup = new Map();
  const singles = [];

  for (const p of products) {
    const gid = p.ecommerceVariantGroupId ? String(p.ecommerceVariantGroupId) : '';
    if (!gid) {
      singles.push(p);
      continue;
    }
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(p);
  }

  const out = [];

  for (const p of singles) {
    out.push(mapFlatProduct(p));
  }

  for (const [groupId, members] of byGroup.entries()) {
    if (members.length < 2) {
      for (const m of members) out.push(mapFlatProduct(m));
      continue;
    }

    const sorted = [...members].sort((a, b) => String(a._id).localeCompare(String(b._id)));
    const primary = sorted[0];
    const category = primary.category && typeof primary.category === 'object' ? primary.category : null;
    const axis = detectVariantAxis(category);
    const axisKey = primary.ecommerceVariantAxisKey || axis.key;
    const axisLabel = axis.label || 'Color';
    const labels = sorted.map((m) =>
      String(m.ecommerceVariantLabel || '').trim() || resolveVariantLabel(m, axisKey)
    );
    const valueColors = {};
    for (const label of labels) {
      const hex = colorHexForLabel(label);
      if (hex) valueColors[label] = hex;
    }

    const flatPrimary = mapFlatProduct(primary);
    const variants = sorted.map((m, idx) => {
      const flat = mapFlatProduct(m);
      const label = labels[idx];
      return {
        sku: String(m.code || m._id),
        invexProductId: String(m._id),
        attributes: { [axisLabel]: label },
        price: flat.price,
        offerPrice: flat.offerPrice,
        stock: flat.stock,
        image: flat.imageUrl || '',
      };
    });

    const images = [
      ...new Set(sorted.map((m) => m.imageUrl).filter(Boolean).map(String)),
    ];

    out.push({
      ...flatPrimary,
      invexProductId: `vg:${groupId}`,
      name: pickListingTitle(sorted, axisKey),
      code: primary.code || '',
      price: 0,
      stock: variants.reduce((s, v) => s + (Number(v.stock) || 0), 0),
      imageUrl: images[0] || flatPrimary.imageUrl || '',
      images,
      hasVariants: true,
      attributes: [
        {
          name: axisLabel,
          values: [...new Set(labels)],
          valueColors,
        },
      ],
      variants,
      variantMemberIds: sorted.map((m) => String(m._id)),
      ecommerceVariantGroupId: groupId,
    });
  }

  return out;
}

export async function notifyGroupProductsChanged(productIds, notifyOne) {
  const ids = [...new Set((productIds || []).map(String).filter(Boolean))];
  const seenGroups = new Set();
  for (const id of ids) {
    const p = await Product.findById(id).select('ecommerceVariantGroupId').lean();
    if (!p) {
      notifyOne(id);
      continue;
    }
    if (p.ecommerceVariantGroupId) {
      const gid = String(p.ecommerceVariantGroupId);
      if (seenGroups.has(gid)) continue;
      seenGroups.add(gid);
      const members = await Product.find({ ecommerceVariantGroupId: gid }).select('_id').lean();
      // Upsert primary group via first member; sync layer collapses
      if (members[0]) notifyOne(String(members[0]._id));
      // Also delete stale flat keys for other members is handled in catalog push
    } else {
      notifyOne(id);
    }
  }
}
