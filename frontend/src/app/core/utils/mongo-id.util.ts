/** Normalize Mongo-style ids from API/socket payloads (string, ObjectId shape, `{ _id }`, `{ $oid }`). */
export function normalizeMongoId(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    return /^[a-f\d]{24}$/i.test(s) ? s : null;
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    const inner = o['_id'] ?? o['$oid'] ?? o['id'];
    if (inner != null && inner !== raw) return normalizeMongoId(inner);
  }
  const s = String(raw).trim();
  return /^[a-f\d]{24}$/i.test(s) ? s : null;
}
