import express from 'express';
const router = express.Router();

import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  loginUser,
  logoutUser
} from './user.servise.js';

router.get('/', getUsers);                  // GET all with pagination/search
router.post('/login', loginUser);   
router.post('/logout', logoutUser);   
router.get('/:id', getUserById);            // GET one by ID
router.post('/createUser', createUser);     // POST create
router.put('/:id', updateUser);             // PUT update
router.delete('/:id', deleteUser); // DELETE user

export default router;
