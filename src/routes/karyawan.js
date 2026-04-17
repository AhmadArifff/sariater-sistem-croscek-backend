import { Router } from "express";
import multer from "multer";
import { adminOnly, adminAndStaf } from "../middleware/auth.js";
import {
  getKaryawanListNama,
  getDWListNama,
  getKaryawanList,
  getDWList,
  uploadKaryawan,
  uploadDW,
  createKaryawan,
  createDW,
  updateKaryawan,
  deleteKaryawan,
} from "../controllers/karyawanController.js";

const router = Router();

// Multer — simpan di memory (tidak ke disk), sama seperti BytesIO Python
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // max 10MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file Excel (.xlsx, .xls) yang diizinkan"));
    }
  },
});

// // =============================================
// // KARYAWAN ROUTES
// // Akses: Admin semua, Staf tidak bisa (menu karyawan = admin only)
// // =============================================

// // GET list nama (untuk dropdown)
// router.get("/karyawan/list/nama",  ...adminOnly, getKaryawanListNama);

// // GET list dengan pagination & search
// router.get("/karyawan/list",       ...adminOnly, getKaryawanList);

// // POST upload Excel
// router.post("/karyawan/upload",    ...adminOnly, upload.single("file"), uploadKaryawan);

// // POST create manual
// router.post("/karyawan/create",    ...adminOnly, createKaryawan);

// // PUT update by NIK
// router.put("/karyawan/update/:nik",...adminOnly, updateKaryawan);

// // DELETE by NIK
// router.delete("/karyawan/delete/:nik", ...adminOnly, deleteKaryawan);

// // =============================================
// // DAILY WORKER (DW) ROUTES
// // Akses: Admin only
// // =============================================

// // GET list nama (untuk dropdown)
// router.get("/dw/list/nama",        ...adminOnly, getDWListNama);

// // GET list dengan pagination & search
// router.get("/dw/list",             ...adminOnly, getDWList);

// // POST upload Excel
// router.post("/dw/upload",          ...adminOnly, upload.single("file"), uploadDW);

// // POST create manual
// router.post("/dw/create",          ...adminOnly, createDW);

// // PUT update (pakai endpoint karyawan/update — sama seperti frontend Python)
// // DW frontend juga pakai /karyawan/update/:nik untuk edit, jadi tidak perlu route baru

// // DELETE (pakai endpoint karyawan/delete — sama seperti frontend)

// Comment semua ...adminOnly sementara
router.get("/karyawan/list/nama",   getKaryawanListNama);
router.get("/karyawan/list",        getKaryawanList);
router.post("/karyawan/upload",     upload.single("file"), uploadKaryawan);
router.post("/karyawan/create",     createKaryawan);
router.put("/karyawan/update/:nik", updateKaryawan);
router.delete("/karyawan/delete/:nik", deleteKaryawan);
router.get("/dw/list/nama",         getDWListNama);
router.get("/dw/list",              getDWList);
router.post("/dw/upload",           upload.single("file"), uploadDW);
router.post("/dw/create",           createDW);

export default router;