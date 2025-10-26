import express from 'express';
const router = express.Router();
import {
    getVendors,
    getVendorById,
    createVendor,
    updateVendor,
    deleteVendor
  } from './service.js';
  

router.get('/', getVendors);   
router.get('/:id', getVendorById);        // GET one by ID
router.post('/createVendor', createVendor);           // POST create
router.put('/updateVendor/:id', updateVendor);         // PUT update
router.delete('/deleteVendor/:id', deleteVendor);      // DELETE product


export default router; 
