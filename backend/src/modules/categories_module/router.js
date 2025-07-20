import express from 'express';
const router = express.Router();
import {
    getCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory
  } from './service.js';

router.get('/', getCategories);              // GET all with pagination/search
router.get('/:id', getCategoryById);        // GET one by ID
router.post('/createCategory', createCategory);           // POST create
router.put('/:id', updateCategory);         // PUT update
router.delete('/deleteCategory/:id', deleteCategory);      // DELETE product

export default router; 

