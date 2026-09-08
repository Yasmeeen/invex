import express from 'express';
import {
  listFarmAnimals,
  lookupFarmAnimal,
  updateFarmAnimal,
} from './service.js';

const router = express.Router();

router.get('/', listFarmAnimals);
router.get('/lookup/:serial', lookupFarmAnimal);
router.patch('/:id', updateFarmAnimal);

export default router;
