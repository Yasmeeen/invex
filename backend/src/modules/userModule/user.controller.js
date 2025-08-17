import express from 'express';
const router = express.Router();

import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser
} from './user.servise.js';

router.get('/', getUsers);                  // GET all with pagination/search
router.get('/:id', getUserById);            // GET one by ID
router.post('/createUser', createUser);     // POST create
router.put('/:id', updateUser);             // PUT update
router.delete('/deleteUser/:id', deleteUser); // DELETE user

export default router;
