import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

dotenv.config();

import authRoutes     from "../src/routes/auth.js";
import karyawanRoutes from "../src/routes/karyawan.js";
import croscekRoutes  from "../src/routes/croscek.js";
import jadwalRoutes   from "../src/routes/jadwal.js";
import analyticsRoutes from "../src/routes/analytics.js";

const app = express();

// =============================================
// GLOBAL MIDDLEWARE
// =============================================
app.use(helmet());

// CORS: allow configured FRONTEND_URL and local dev ports
const allowedOrigins = [];
if (process.env.FRONTEND_URL) {
  const frontendUrl = process.env.FRONTEND_URL.replace(/\/$/, ''); // Remove trailing slash
  allowedOrigins.push(frontendUrl);
}
// Common local dev ports: 3000 (CRA), 5173 (Vite)
allowedOrigins.push("http://localhost:3000", "http://localhost:5173");

console.log("[CORS] Allowed Origins:", allowedOrigins);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== "production") {
        // In development, allow common dev origins and any configured FRONTEND_URL
        if (allowedOrigins.includes(origin)) return callback(null, true);
        // For convenience, allow subpaths on localhost (e.g., different ports)
        if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
      }
      // In production, be strict and allow only configured FRONTEND_URL
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// =============================================
// ROUTES
// =============================================
app.use("/api/auth",     authRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api",          karyawanRoutes); // /api/karyawan/*, /api/dw/*
app.use("/api",          croscekRoutes);  // /api/jadwal-karyawan/*, /api/croscek-*, dll
app.use("/api",          jadwalRoutes);   // /api/jadwal/*, /api/import-jadwal, dll

// =============================================
// HEALTH CHECK
// =============================================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// =============================================
// DEBUG: Test file upload
// =============================================
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage() });

app.post("/api/test-upload", upload.single("file"), (req, res) => {
  console.log("🧪 Test upload endpoint called");
  console.log("📄 File info:", {
    fieldname: req.file?.fieldname,
    originalname: req.file?.originalname,
    size: req.file?.size,
    bufferLength: req.file?.buffer?.length,
    bufferType: typeof req.file?.buffer
  });
  
  if (req.file && req.file.buffer) {
    console.log("📝 Buffer first 50 bytes:", req.file.buffer.slice(0, 50).toString('hex'));
  }
  
  res.json({ 
    message: "File received",
    file: req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      size: req.file.size,
      bufferLength: req.file.buffer ? req.file.buffer.length : 0
    } : null
  });
});

// =============================================
// 404 HANDLER
// =============================================
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} tidak ditemukan` });
});

// =============================================
// GLOBAL ERROR HANDLER
// =============================================
app.use((err, req, res, next) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

// =============================================
// START SERVER (local dev)
// =============================================
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`📦 Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

// Export untuk Vercel Serverless
export default app;