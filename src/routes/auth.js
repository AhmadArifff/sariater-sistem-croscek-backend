import { Router } from "express";
import { authenticate, adminOnly } from "../middleware/auth.js";
import {
  login,
  registerUser,
  registerAdmin,
  checkAdmin,
  getMe,
  getUsers,
  toggleUserActive,
  updateUser,
  deleteUser,
} from "../controllers/authController.js";

const router = Router();

router.get("/check-admin",                   checkAdmin);
router.post("/login",                        login);
router.post("/register-admin",               registerAdmin);  // PUBLIC - ONE TIME SETUP
router.post("/register",         ...adminOnly, registerUser);
router.post("/users",            ...adminOnly, registerUser);  // Create new user (alias for /register)
router.get("/me",                authenticate, getMe);
router.get("/users",             ...adminOnly, getUsers);
router.put("/users/:id/toggle",  ...adminOnly, toggleUserActive);
router.put("/users/:id",         ...adminOnly, updateUser);      // Update user (nama, role, password)
router.delete("/users/:id",      ...adminOnly, deleteUser);      // Delete user

export default router;