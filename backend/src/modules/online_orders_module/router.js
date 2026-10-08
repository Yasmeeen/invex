import express from 'express';
import mongoose from 'mongoose';
import User from '../../DB/models/user.model.js';
import StoreSettings from '../../DB/models/storeSettings.model.js';
import { isCrmIntegrationFeatureAvailable, isEcommerceIntegrationFeatureAvailable } from '../integrations_module/feature.js';
import {
  getOnlineOrder,
  listOnlineOrders,
  pendingOnlineOrdersSummary,
  updateOnlineOrderStatus,
} from '../integrations_module/crmOrders.js';

const router = express.Router();

const STAFF_ROLES = new Set(['Super Admin', 'Co Admin', 'Branch Manager', 'Cashier']);

/**
 * This branch authenticates staff calls with the logged-in user id
 * (query/body/header), same as the rest of the Invex API.
 */
async function requireOnlineOrderStaff(req, res, next) {
  try {
    const rawId = String(
      req.query?.userId || req.body?.userId || req.headers['x-user-id'] || ''
    ).trim();
    if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = await User.findById(rawId).select('_id name role branch').lean();
    if (!user) return res.status(401).json({ error: 'Invalid user session' });
    if (!STAFF_ROLES.has(String(user.role || ''))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.user = user;
    return next();
  } catch (error) {
    console.error('requireOnlineOrderStaff:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

async function requireOnlineOrdersEnabled(req, res, next) {
  try {
    const settings = await StoreSettings.findOne()
      .sort({ updatedAt: -1 })
      .select('crmIntegrationEnabled ecommerceIntegrationEnabled ecommerceCatalogMode')
      .lean();
    const crmOn =
      isCrmIntegrationFeatureAvailable() && Boolean(settings?.crmIntegrationEnabled);
    const websiteOrdersOn =
      isEcommerceIntegrationFeatureAvailable() &&
      Boolean(settings?.ecommerceIntegrationEnabled) &&
      settings?.ecommerceCatalogMode === 'orders_only';
    if (!crmOn && !websiteOrdersOn) {
      return res.status(403).json({ error: 'Online orders are not enabled in store settings' });
    }
    return next();
  } catch (error) {
    console.error('requireOnlineOrdersEnabled:', error);
    return res.status(500).json({ error: 'Failed to verify online orders access' });
  }
}

router.use(requireOnlineOrderStaff);
router.use(requireOnlineOrdersEnabled);
router.get('/pending-summary', pendingOnlineOrdersSummary);
router.get('/', listOnlineOrders);
router.get('/:id', getOnlineOrder);
router.patch('/:id/status', updateOnlineOrderStatus);

export default router;
