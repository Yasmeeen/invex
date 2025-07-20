import express from 'express';
const router = express.Router();
import {
    getBranches,
    getBranchById,
    createBranch,
    updateBranch,
    deleteBranch
  } from './service.js';

router.get('/', getBranches);              // GET all with pagination/search
router.get('/:id', getBranchById);        // GET one by ID
router.post('/createBranch', createBranch);           // POST create
router.put('/:id', updateBranch);         // PUT update
router.delete('/deleteBranch/:id', deleteBranch);      // DELETE product

export default router; 
