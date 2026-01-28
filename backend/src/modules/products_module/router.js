import express from 'express';
const router = express.Router();
import {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    getProductStats,
    generateBarcodePDF,
    generateBarcode,
    generateBarcodeImage
  } from './service.js';
  

router.get('/', getProducts);   
router.get('/getProductsStats', getProductStats);             // GET all with pagination/search
router.get("/barcode-pdf", generateBarcodePDF);
router.get('/generate-barcode', generateBarcode);
router.get('/barcode/:code', generateBarcodeImage);
router.get('/:id', getProductById);        // GET one by ID
router.post('/createProduct', createProduct);           // POST create
router.put('/:id', updateProduct);         // PUT update
router.delete('/deleteProduct/:id', deleteProduct);      // DELETE product



export default router; 
