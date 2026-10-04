import express from 'express';
import {
  requireCrmIntegrationAuth,
  requireEcommerceIntegrationAuth,
} from './middleware.js';
import {
  reserveFromEcommerce,
  cancelReservationFromEcommerce,
  markPaidFromEcommerce,
  confirmOrderFromEcommerce,
  deliverOrderFromEcommerce,
  getCatalog,
  pushCatalogNow,
} from './ecommerceInbound.js';
import {
  isCrmIntegrationFeatureAvailable,
  isEcommerceIntegrationFeatureAvailable,
} from './feature.js';
import { createCrmOrder, getCrmCatalog, getCrmOrder } from './crmOrders.js';

const router = express.Router();

/** Public to Invex admin UI: is env feature unlocked */
router.get('/feature', (_req, res) => {
  res.json({
    ecommerceIntegrationFeatureAvailable: isEcommerceIntegrationFeatureAvailable(),
    crmIntegrationFeatureAvailable: isCrmIntegrationFeatureAvailable(),
  });
});

/** Admin-triggered full push (no integration key; same as other Invex routes — FE role guard). */
router.post('/ecommerce/push-catalog', pushCatalogNow);

router.use('/ecommerce', requireEcommerceIntegrationAuth);

router.get('/ecommerce/catalog', getCatalog);
router.post('/ecommerce/orders/reserve', reserveFromEcommerce);
router.post('/ecommerce/orders/cancel', cancelReservationFromEcommerce);
router.post('/ecommerce/orders/paid', markPaidFromEcommerce);
router.post('/ecommerce/orders/confirm', confirmOrderFromEcommerce);
router.post('/ecommerce/orders/deliver', deliverOrderFromEcommerce);

router.use('/crm', requireCrmIntegrationAuth);

router.get('/crm/catalog', getCrmCatalog);
router.post('/crm/orders', createCrmOrder);
router.get('/crm/orders/:crmOrderId', getCrmOrder);

export default router;
