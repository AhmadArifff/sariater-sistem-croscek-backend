import express from "express";
import multer from "multer";

// ── Jadwal controllers ─────────────────────────────────────
import {
  getJadwalKaryawan,
  getJadwalDW,
  createJadwalKaryawan,
  createJadwalDW,
  updateJadwalKaryawan,
  deleteJadwalKaryawan,
  deleteJadwalPeriodKaryawan,
  clearJadwalKaryawan,
  clearJadwalDW,
  importJadwalKaryawan,
  importJadwalDW,
  importJadwalKaryawanPin,
  importJadwalDWPin,
  importJadwalKaryawanSmartMatch,
  importJadwalDWSmartMatch,
} from "../controllers/jadwalkaryawanController.js";

// ── Kehadiran controllers ──────────────────────────────────
import {
  importKehadiran,
  getAvailablePeriodsKaryawan,
  getAvailablePeriodsDW,
  deleteKehadiranPeriodKaryawan,
  deleteKehadiranPeriodDW,
} from "../controllers/kehadiranController.js";

// ── Croscek controllers ────────────────────────────────────
import {
  getCroscekKaryawan,
  getCroscekKaryawanSQL,
  getCroscekDiagnostics,
  getJadwalCoverage,
  saveCroscekKaryawan,
  getCroscekKaryawanFinal,
  getCroscekDW,
  saveCroscekDW,
  getCroscekDWFinal,
  getKaryawanSelect,
  getRekapHOD,
  refreshMaterializedView,
  recreateMaterializedView,
  clearCroscekKaryawan,
  clearCroscekDW,
} from "../controllers/croscekController.js";

const router = express.Router();

// Multer: file upload ke memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

// =============================================
// JADWAL KARYAWAN ROUTES
// =============================================
router.get("/jadwal-karyawan/list",             getJadwalKaryawan);
router.post("/jadwal-karyawan/create",          createJadwalKaryawan);
router.put("/jadwal-karyawan/update/:no",       updateJadwalKaryawan);
router.delete("/jadwal-karyawan/delete/:no",    deleteJadwalKaryawan);
router.delete("/jadwal-karyawan/delete-period", deleteJadwalPeriodKaryawan);
router.post("/jadwal-karyawan/clear",           clearJadwalKaryawan);
router.post("/import-jadwal-karyawan",          upload.single("file"), importJadwalKaryawan);
router.post("/import-jadwal-karyawan-pin",      upload.single("file"), importJadwalKaryawanPin); // PIN-based
router.post("/import-jadwal-karyawan-smartmatch", upload.single("file"), importJadwalKaryawanSmartMatch); // NEW: Smart NIK/id_absen

// =============================================
// JADWAL DW ROUTES
// =============================================
router.get("/jadwal-dw/list",                   getJadwalDW);
router.post("/jadwal-dw/create",                createJadwalDW);
router.post("/jadwal-dw/clear",                 clearJadwalDW);
router.post("/import-jadwal-dw",                upload.single("file"), importJadwalDW);
router.post("/import-jadwal-dw-pin",            upload.single("file"), importJadwalDWPin); // PIN-based
router.post("/import-jadwal-dw-smartmatch",     upload.single("file"), importJadwalDWSmartMatch); // NEW: Smart NIK/id_absen

// =============================================
// INFORMASI JADWAL (consolidated to jadwal.js/jadwalController)
// =============================================
// Route removed - use /api/informasi-jadwal/list from jadwal.js instead

// =============================================
// KEHADIRAN ROUTES
// =============================================
router.post("/import-kehadiran",                upload.single("file"), importKehadiran);

router.get("/kehadiran-karyawan/available-periods",  getAvailablePeriodsKaryawan);
router.get("/kehadiran-dw/available-periods",        getAvailablePeriodsDW);

router.delete("/kehadiran-karyawan/delete-period",   deleteKehadiranPeriodKaryawan);
router.delete("/kehadiran-dw/delete-period",         deleteKehadiranPeriodDW);

// =============================================
// CROSCEK ROUTES
// =============================================
router.get("/croscek-karyawan",               getCroscekKaryawan);
router.get("/croscek-karyawan/sql",           getCroscekKaryawanSQL);
router.post("/croscek-karyawan/sql/refresh", refreshMaterializedView);
router.post("/croscek-karyawan/sql/recreate", recreateMaterializedView);
router.get("/croscek-karyawan/diagnostics",  getCroscekDiagnostics);
router.get("/croscek-karyawan/coverage", getJadwalCoverage);
router.post("/croscek-karyawan",              saveCroscekKaryawan);
router.post("/croscek-karyawan/clear",        clearCroscekKaryawan);
router.get("/croscek-karyawan/final",         getCroscekKaryawanFinal);

router.get("/croscek-dw",                     getCroscekDW);
router.post("/croscek-dw",                    saveCroscekDW);
router.post("/croscek-dw/clear",              clearCroscekDW);
router.get("/croscek-dw/final",               getCroscekDWFinal);

// =============================================
// UTILITY ROUTES
// =============================================
router.get("/karyawan-select",                getKaryawanSelect);
router.get("/rekap-hod",                      getRekapHOD);

export default router;
