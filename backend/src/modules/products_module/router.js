import express from 'express';
const router = express.Router();
import {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    transferProductStock,
    getProductStats,
    generateBarcodePDF,
    generateBarcode,
    generateBarcodeImage,
    getProductsImportMetadata,
    importProductsFromExcelRows
  } from './service.js';
  

router.get('/', getProducts);   
router.get('/getProductsStats', getProductStats);             // GET all with pagination/search
router.get('/import-metadata', getProductsImportMetadata);
router.get("/barcode-pdf", generateBarcodePDF);
router.get('/generate-barcode', generateBarcode);
router.get('/barcode/:code', generateBarcodeImage);
router.post('/transfer-stock', transferProductStock);
router.get('/:id', getProductById);        // GET one by ID
router.post('/createProduct', createProduct);           // POST create
router.post('/import-excel', importProductsFromExcelRows);
router.put('/:id', updateProduct);         // PUT update
router.delete('/deleteProduct/:id', deleteProduct);      // DELETE product



export default router; 
