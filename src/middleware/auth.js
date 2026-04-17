import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";

// =============================================
// MIDDLEWARE: Verifikasi JWT Supabase
// =============================================
export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token tidak ditemukan" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verifikasi token menggunakan JWT secret dari Supabase
    const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token tidak valid atau sudah expired" });
  }
};

// =============================================
// MIDDLEWARE: Cek role dari tabel users kita
// =============================================
export const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.sub; // UUID dari JWT payload Supabase

      if (!userId) {
        return res.status(401).json({ error: "User ID tidak ditemukan" });
      }

      const { data: user, error } = await supabase
        .from("users")
        .select("role, is_active")
        .eq("id", userId)
        .single();

      if (error || !user) {
        return res.status(403).json({ error: "User tidak terdaftar di sistem" });
      }

      if (!user.is_active) {
        return res.status(403).json({ error: "Akun tidak aktif" });
      }

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({
          error: `Akses ditolak. Hanya ${allowedRoles.join("/")} yang diizinkan`,
        });
      }

      req.userRole = user.role; // inject role ke request
      next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
};

// =============================================
// SHORTHAND MIDDLEWARE: Admin only
// =============================================
export const adminOnly = [authenticate, requireRole("admin")];

// =============================================
// SHORTHAND MIDDLEWARE: Admin & Staf
// =============================================
export const adminAndStaf = [authenticate, requireRole("admin", "staff")];
