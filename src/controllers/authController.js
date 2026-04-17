import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";

const HASH_ALGO = "pbkdf2_sha512";
const HASH_ITERATIONS = 120000;
const HASH_KEYLEN = 64;
const HASH_DIGEST = "sha512";

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST).toString("hex");
  return `${HASH_ALGO}$${HASH_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;

  const [algo, iterationsRaw, salt, expectedHash] = storedHash.split("$");
  if (algo !== HASH_ALGO || !iterationsRaw || !salt || !expectedHash) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const actualHash = pbkdf2Sync(password, salt, iterations, HASH_KEYLEN, HASH_DIGEST).toString("hex");

  const actualBuffer = Buffer.from(actualHash, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  if (actualBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function issueAccessToken(userId, role) {
  return jwt.sign(
    { sub: userId, role, source: "local-auth" },
    process.env.SUPABASE_JWT_SECRET,
    { expiresIn: "8h" }
  );
}

async function createSupabaseAuthUser(username, password) {
  const internalEmail = `${username}@croscek.internal`;

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
  });

  if (authError || !authData?.user?.id) {
    console.error("AUTH ERROR, fallback to local auth:", authError || "No user ID returned");
    return {
      userId: randomUUID(),
      authMode: "local-fallback",
      authError,
    };
  }

  return {
    userId: authData.user.id,
    authMode: "supabase",
    authError: null,
  };
}

// =============================================
// GET /api/auth/check-admin  (Public - cek apakah ada admin)
// =============================================
export async function checkAdmin(req, res) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("role", "admin")
      .limit(1);

    if (error) throw error;

    return res.json({
      hasAdmin: data && data.length > 0,
    });
  } catch (e) {
    console.error("ERROR CHECK ADMIN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// POST /api/auth/register-admin  (Public - ONE TIME SETUP)
// Hanya bisa diakses jika belum ada admin!
// =============================================
export async function registerAdmin(req, res) {
  try {
    const { data: adminCheck } = await supabase
      .from("users")
      .select("id")
      .eq("role", "admin")
      .limit(1);

    if (adminCheck && adminCheck.length > 0) {
      return res.status(403).json({
        error: "Admin sudah ada, tidak bisa register admin lagi!",
        message: "Hubungi admin untuk menambah user baru",
      });
    }

    const { username, password, nama } = req.body;

    if (!username || !password || !nama) {
      return res.status(400).json({ error: "username, password, nama wajib diisi" });
    }

    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      return res.status(400).json({
        error: "Username harus 3-20 karakter, hanya a-z, 0-9, _, -",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password minimal 8 karakter" });
    }

    const { data: existingUsername } = await supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingUsername) {
      return res.status(400).json({ error: "Username sudah terdaftar" });
    }

    const password_hash = hashPassword(password);
    const { userId, authMode } = await createSupabaseAuthUser(username, password);

    const { error: insertError } = await supabase.from("users").insert({
      id: userId,
      username,
      nama,
      password_hash,
      role: "admin",
    });

    if (insertError) {
      console.error("INSERT ERROR:", insertError);
      if (authMode === "supabase") {
        await supabase.auth.admin.deleteUser(userId);
      }

      return res.status(400).json({
        error: "Gagal membuat user record di database",
        details: insertError?.message,
      });
    }

    return res.status(201).json({
      message:
        authMode === "local-fallback"
          ? `Admin user ${nama} (${username}) berhasil dibuat dengan local auth fallback. Silakan login.`
          : `Admin user ${nama} (${username}) berhasil dibuat! Silakan login.`,
      user: { id: userId, username, nama, role: "admin" },
      authMode,
      warning:
        authMode === "local-fallback"
          ? "Supabase Auth createUser gagal. Sistem sementara menggunakan password hash lokal."
          : undefined,
    });
  } catch (e) {
    console.error("ERROR REGISTER ADMIN:", e);
    return res.status(500).json({
      error: e?.message || "Server error saat membuat admin",
      details: process.env.NODE_ENV === "development" ? e : undefined,
    });
  }
}

// =============================================
// POST /api/auth/login
// Login dengan username + password
// =============================================
export async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username dan password wajib diisi" });
    }

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, username, nama, role, is_active, password_hash")
      .eq("username", username)
      .single();

    if (userError || !userData) {
      return res.status(401).json({ error: "Username atau password salah" });
    }

    if (!userData.is_active) {
      return res.status(403).json({ error: "Akun tidak aktif, hubungi admin" });
    }

    // Prioritas local auth jika password_hash tersedia.
    if (userData.password_hash) {
      const isValid = verifyPassword(password, userData.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: "Username atau password salah" });
      }

      const token = issueAccessToken(userData.id, userData.role);
      return res.json({
        message: "Login berhasil",
        token,
        authMode: "local",
        user: {
          id: userData.id,
          username: userData.username,
          nama: userData.nama,
          role: userData.role,
        },
      });
    }

    // Fallback lama: login via Supabase Auth
    const internalEmail = `${userData.username}@croscek.internal`;
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: internalEmail,
      password,
    });

    if (authError || !authData?.session?.access_token) {
      return res.status(401).json({ error: "Username atau password salah" });
    }

    return res.json({
      message: "Login berhasil",
      token: authData.session.access_token,
      authMode: "supabase",
      user: {
        id: userData.id,
        username: userData.username,
        nama: userData.nama,
        role: userData.role,
      },
    });
  } catch (e) {
    console.error("ERROR LOGIN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// POST /api/auth/register  (Admin only - buat akun staf)
// =============================================
export async function registerUser(req, res) {
  try {
    const { username, password, nama, role } = req.body;

    if (!username || !password || !nama || !role) {
      return res.status(400).json({ error: "username, password, nama, role wajib diisi" });
    }

    if (!["admin", "staff"].includes(role)) {
      return res.status(400).json({ error: "Role hanya boleh 'admin' atau 'staff'" });
    }

    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      return res.status(400).json({
        error: "Username harus 3-20 karakter, hanya a-z, 0-9, _, -",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password minimal 8 karakter" });
    }

    const { data: existingUsername } = await supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingUsername) {
      return res.status(400).json({ error: "Username sudah terdaftar" });
    }

    const password_hash = hashPassword(password);
    const { userId, authMode } = await createSupabaseAuthUser(username, password);

    const { error: insertError } = await supabase.from("users").insert({
      id: userId,
      username,
      nama,
      password_hash,
      role,
    });

    if (insertError) {
      if (authMode === "supabase") {
        await supabase.auth.admin.deleteUser(userId);
      }
      throw insertError;
    }

    return res.status(201).json({
      message:
        authMode === "local-fallback"
          ? `User ${nama} (${username}) berhasil dibuat dengan role ${role} (local auth fallback).`
          : `User ${nama} (${username}) berhasil dibuat dengan role ${role}`,
      user: { id: userId, username, nama, role },
      authMode,
      warning:
        authMode === "local-fallback"
          ? "Supabase Auth createUser gagal. User dibuat dengan password hash lokal."
          : undefined,
    });
  } catch (e) {
    console.error("ERROR REGISTER:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// GET /api/auth/me  (Ambil data user yang sedang login)
// =============================================
export async function getMe(req, res) {
  try {
    const userId = req.user?.sub;

    const { data, error } = await supabase
      .from("users")
      .select("id, username, nama, role, is_active, created_at")
      .eq("id", userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    return res.json({ user: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// GET /api/auth/users  (Admin: list semua user)
// =============================================
export async function getUsers(req, res) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, username, nama, role, is_active, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// PUT /api/auth/users/:id/toggle  (Admin: aktif/nonaktif user)
// =============================================
export async function toggleUserActive(req, res) {
  try {
    const { id } = req.params;

    const { data: user } = await supabase
      .from("users")
      .select("is_active")
      .eq("id", id)
      .single();

    if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

    const { error } = await supabase
      .from("users")
      .update({ is_active: !user.is_active })
      .eq("id", id);

    if (error) throw error;

    return res.json({
      message: `User ${!user.is_active ? "diaktifkan" : "dinonaktifkan"}`,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// PUT /api/auth/users/:id  (Admin: update user)
// =============================================
export async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { nama, role, password } = req.body;

    // Validate role if provided
    if (role && !["admin", "staff"].includes(role)) {
      return res.status(400).json({ error: "Role hanya boleh 'admin' atau 'staff'" });
    }

    // Validate password if provided
    if (password && password.length < 8) {
      return res.status(400).json({ error: "Password minimal 8 karakter" });
    }

    // Check if user exists
    const { data: user } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", id)
      .single();

    if (!user) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    // Build update object
    const updateData = {};
    if (nama) updateData.nama = nama;
    if (role) updateData.role = role;
    if (password) updateData.password_hash = hashPassword(password);

    // Update user
    const { error: updateError } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", id);

    if (updateError) throw updateError;

    return res.json({
      message: "User berhasil diperbarui",
      data: { id, username: user.username },
    });
  } catch (e) {
    console.error("ERROR UPDATE USER:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// DELETE /api/auth/users/:id  (Admin: delete user)
// =============================================
export async function deleteUser(req, res) {
  try {
    const { id } = req.params;

    // Check if user exists
    const { data: user } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", id)
      .single();

    if (!user) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    // Delete from users table
    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    return res.json({
      message: `User ${user.username} berhasil dihapus`,
      data: { id, username: user.username },
    });
  } catch (e) {
    console.error("ERROR DELETE USER:", e);
    return res.status(500).json({ error: e.message });
  }
}
