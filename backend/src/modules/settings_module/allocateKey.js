const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function latinSlug(label) {
  return String(label || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 32);
}

function hashKey(label) {
  let h = 2166136261;
  const s = String(label || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0').slice(0, 10);
  return `tr_${hex}`;
}

/** Unique lowercase slug from a display label. */
export function allocateKey(label, used) {
  const taken = used instanceof Set ? used : new Set(used || []);
  let base = latinSlug(label);
  if (!base.length || !KEY_PATTERN.test(base)) {
    base = hashKey(label);
  }
  if (!/^[a-z]/.test(base)) {
    base = `t_${base}`;
  }
  base = base.replace(/[^a-z0-9_]/g, '').slice(0, 36);
  if (!base.length) base = hashKey(label);

  let cand = base;
  let n = 0;
  while (taken.has(cand) || !KEY_PATTERN.test(cand)) {
    n += 1;
    cand = `${base}_${n}`.slice(0, 40);
    if (n > 800) {
      cand = hashKey(`${label}_${Date.now()}_${n}`).slice(0, 40);
    }
  }
  taken.add(cand);
  return cand;
}

export function isValidKey(raw) {
  return KEY_PATTERN.test(String(raw || '').trim().toLowerCase());
}
