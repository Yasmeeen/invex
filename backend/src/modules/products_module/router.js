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
    importProductsFromExcelRows,
    requestBranchTransfer,
    approveBranchTransfer,
    rejectBranchTransfer,
    listBranchTransfers,
    getPendingBranchTransferCount,
  } from './service.js';
  

router.get('/', getProducts);   
router.get('/getProductsStats', getProductStats);             // GET all with pagination/search
router.get('/import-metadata', getProductsImportMetadata);
router.get('/branch-transfers/pending-count', getPendingBranchTransferCount);
router.get('/branch-transfers', listBranchTransfers);
router.get("/barcode-pdf", generateBarcodePDF);
router.get('/generate-barcode', generateBarcode);
router.get('/barcode/:code', generateBarcodeImage);
router.post('/transfer-stock', transferProductStock);
router.post('/branch-transfer/request', requestBranchTransfer);
router.post('/branch-transfer/:id/approve', approveBranchTransfer);
router.post('/branch-transfer/:id/reject', rejectBranchTransfer);
router.get('/:id', getProductById);        // GET one by ID
router.post('/createProduct', createProduct);           // POST create
router.post('/import-excel', importProductsFromExcelRows);
router.put('/:id', updateProduct);         // PUT update
router.delete('/deleteProduct/:id', deleteProduct);      // DELETE product



export default router; 
