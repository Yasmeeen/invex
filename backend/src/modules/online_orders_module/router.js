import express from 'express';
import { allowRoles, requireAuth } from '../../middleware/auth.js';
import {
  getOnlineOrder,
  listOnlineOrders,
  updateOnlineOrderStatus,
} from '../integrations_module/crmOrders.js';

const router = express.Router();

router.use(requireAuth);
router.use(allowRoles('Super Admin', 'Co Admin', 'Branch Manager', 'Cashier'));
router.get('/', listOnlineOrders);
router.get('/:id', getOnlineOrder);
router.patch('/:id/status', updateOnlineOrderStatus);

export default router;
