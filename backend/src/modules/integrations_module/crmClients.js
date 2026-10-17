import Client from '../../DB/models/client.model.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/**
 * GET /api/integrations/crm/clients
 * Paginated client export for CRM customer sync.
 * Query: page, limit, updatedSince (ISO date — incremental)
 */
export async function listCrmClients(req, res) {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query?.page || '1'), 10) || 1);
    const rawLimit = Number.parseInt(String(req.query?.limit || String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT;
    const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));
    const updatedSinceRaw = String(req.query?.updatedSince || '').trim();

    const filter = {};
    if (updatedSinceRaw) {
      const updatedSince = new Date(updatedSinceRaw);
      if (Number.isNaN(updatedSince.getTime())) {
        return res.status(400).json({ error: 'updatedSince must be a valid ISO date' });
      }
      filter.updatedAt = { $gte: updatedSince };
    }

    const [total, rows] = await Promise.all([
      Client.countDocuments(filter),
      Client.find(filter)
        .select(
          '_id name phoneNumber additionalPhoneNumbers address source isEcommerceOnline updatedAt createdAt'
        )
        .sort({ updatedAt: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const items = rows.map((row) => ({
      id: String(row._id),
      name: String(row.name || '').trim(),
      phoneNumber: String(row.phoneNumber || '').trim(),
      additionalPhoneNumbers: Array.isArray(row.additionalPhoneNumbers)
        ? row.additionalPhoneNumbers.map((p) => String(p || '').trim()).filter(Boolean)
        : [],
      address: String(row.address || '').trim() || undefined,
      source: row.source || 'store',
      isEcommerceOnline: Boolean(row.isEcommerceOnline),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
    }));

    return res.json({
      items,
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (err) {
    console.error('listCrmClients:', err);
    return res.status(500).json({ error: 'Failed to list clients for CRM' });
  }
}
