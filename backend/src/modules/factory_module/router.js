import express from 'express';
import {
  listFactories,
  getFactory,
  createFactory,
  updateFactory,
  listFactoryStock,
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  listManufacturingOrders,
  getManufacturingOrder,
  createManufacturingOrder,
  listFactoryTransfers,
  createFactoryTransfer,
  listFactorySales,
  createFactorySale,
} from './service.js';

const router = express.Router();

router.get('/factories', listFactories);
router.get('/factories/:id', getFactory);
router.post('/factories', createFactory);
router.patch('/factories/:id', updateFactory);
router.get('/factories/:id/stock', listFactoryStock);

router.get('/recipes', listRecipes);
router.get('/recipes/:id', getRecipe);
router.post('/recipes', createRecipe);
router.patch('/recipes/:id', updateRecipe);

router.get('/orders', listManufacturingOrders);
router.get('/orders/:id', getManufacturingOrder);
router.post('/orders', createManufacturingOrder);

router.get('/transfers', listFactoryTransfers);
router.post('/transfers', createFactoryTransfer);

router.get('/sales', listFactorySales);
router.post('/sales', createFactorySale);

export default router;
