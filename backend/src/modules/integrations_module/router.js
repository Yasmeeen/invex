import express from 'express';
import { requireEcommerceIntegrationAuth } from './middleware.js';
import {
  reserveFromEcommerce,
  cancelReservationFromEcommerce,
  confirmOrderFromEcommerce,
  deliverOrderFromEcommerce,
  getCatalog,
  pushCatalogNow,
} from './ecommerceInbound.js';
import { isEcommerceIntegrationFeatureAvailable } from './feature.js';

const router = express.Router();

/** Public to Invex admin UI: is env feature unlocked */
router.get('/feature', (_req, res) => {
  res.json({ ecommerceIntegrationFeatureAvailable: isEcommerceIntegrationFeatureAvailable() });
});

/** Admin-triggered full push (no integration key; same as other Invex routes — FE role guard). */
router.post('/ecommerce/push-catalog', pushCatalogNow);

router.use(requireEcommerceIntegrationAuth);

router.get('/ecommerce/catalog', getCatalog);
router.post('/ecommerce/orders/reserve', reserveFromEcommerce);
router.post('/ecommerce/orders/cancel', cancelReservationFromEcommerce);
router.post('/ecommerce/orders/confirm', confirmOrderFromEcommerce);
router.post('/ecommerce/orders/deliver', deliverOrderFromEcommerce);

export default router;
