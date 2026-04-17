import { supabase } from "../config/supabase.js";
import ExcelJS from "exceljs";

const SUPABASE_BATCH_SIZE = 1000;
const DELETE_ID_CHUNK_SIZE = 500;

function chunkArray(items, chunkSize) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const size = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getPeriodDateRange(bulan, tahun) {
  const month = Number(bulan);
  const year = Number(tahun);
  const monthStr = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const lastDayStr = String(lastDay).padStart(2, "0");

  return {
    startDate: `${year}-${monthStr}-01`,
    endDate: `${year}-${monthStr}-${lastDayStr}`,
  };
}

async function fetchAllRowsInBatches(queryBuilder, batchSize = SUPABASE_BATCH_SIZE) {
  const safeBatchSize = Math.min(Math.max(Number(batchSize) || SUPABASE_BATCH_SIZE, 1), SUPABASE_BATCH_SIZE);
  const allRows = [];
  let offset = 0;

  while (true) {
    const { data, error } = await queryBuilder(offset, safeBatchSize);
    if (error) throw error;

    const rows = data || [];
    allRows.push(...rows);

    if (rows.length < safeBatchSize) break;
    offset += safeBatchSize;
  }

  return allRows;
}

async function fetchKaryawanIdsByKategori(kategori) {
  const rows = await fetchAllRowsInBatches((offset, batchSize) =>
    supabase
      .from("karyawan")
      .select("id_karyawan")
      .eq("kategori", kategori)
      .order("id_karyawan", { ascending: true })
      .range(offset, offset + batchSize - 1)
  );

  return rows.map((row) => row.id_karyawan).filter(Boolean);
}

// =============================================
// HELPER: Parse Excel kehadiran (baris header di row 2, data mulai row 4+)
// Selaras dengan Python app.py
// =============================================
async function parseExcelKehadiran(buffer) {
  console.log("📄 Parsing Excel kehadiran...");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];

  if (!ws) throw new Error("Sheet Excel tidak ditemukan");

  // Ambil header dari row 2 (index 2)
  const headerRow = ws.getRow(2);
  const headers = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value || "").trim();
  });

  const required = [
    "Tanggal scan", "Tanggal", "Jam", "Nama", "PIN", "NIP",
    "Jabatan", "Departemen", "Kantor", "Verifikasi", "I/O", "Workcode", "SN", "Mesin",
  ];

  const presentHeaders = Object.values(headers);
  const missingHeaders = required.filter(req => !presentHeaders.includes(req));
  
  if (missingHeaders.length > 0) {
    console.error("❌ Missing columns:", missingHeaders);
    throw new Error(`Kolom tidak ditemukan: ${missingHeaders.join(", ")}`);
  }

  // Build col number → header name map
  const colMap = Object.fromEntries(Object.entries(headers).map(([k, v]) => [v, parseInt(k)]));

  const rows = [];
  let emptyRowCount = 0;

  // Data mulai row 4 (skip row 1 kosong, row 2 header, row 3 kosong)
  for (let rowIdx = 4; rowIdx <= ws.rowCount; rowIdx++) {
    const row = ws.getRow(rowIdx);
    const obj = {};
    for (const [colName, colNum] of Object.entries(colMap)) {
      const cell = row.getCell(colNum);
      obj[colName] = cell.value ?? null;
    }
    // Skip baris kosong
    if (!obj["Tanggal scan"] && !obj["Tanggal"]) {
      emptyRowCount++;
      continue;
    }
    rows.push(obj);
  }

  // console.log(`✅ Parsed ${rows.length} attendance records (${emptyRowCount} empty rows skipped)`);
  return rows;
}

// =============================================
// HELPER: Parse datetime dari berbagai format Excel
// PRIORITAS: DD-MM-YYYY (format Indonesia) > MM-DD-YYYY > ISO
// =============================================
function parseExcelDate(val) {
  if (!val) return null;
  
  // Already a valid Date object
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val;
  }
  
  // Excel serial number (numeric)
  if (typeof val === "number") {
    if (val > 60000) {
      // Likely serial number
      const date = new Date((val - 25569) * 86400000);
      if (isNaN(date.getTime())) return null;
      return date;
    }
  }
  
  // String format - try multiple parsing strategies
  if (typeof val === "string") {
    const str = val.trim();
    if (!str) return null;
    
    // Extract just the date part (remove time if present)
    const datePart = str.split(" ")[0];
    
    // ✅ FORMAT 1: DD-MM-YYYY atau DD/MM/YYYY (FORMAT INDONESIA - PRIORITAS UTAMA)
    const ddmmyyMatch = datePart.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (ddmmyyMatch) {
      let day = parseInt(ddmmyyMatch[1], 10);
      let month = parseInt(ddmmyyMatch[2], 10);
      const year = parseInt(ddmmyyMatch[3], 10);
      
      // Validasi: day harus 1-31, month harus 1-12
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        // Format DD-MM-YYYY detected
        // ✅ FIX: Use UTC to avoid timezone offset issues (e.g., +7 hours causing day shift)
        const date = new Date(Date.UTC(year, month - 1, day));
        if (!isNaN(date.getTime())) {
          // console.log(`   ✓ Parsed DD-MM-YYYY: "${str}" → ${date.toISOString().split("T")[0]}`);
          return date;
        }
      }
      
      // Jika day > 12, pasti DD-MM-YYYY
      if (day > 12 && month >= 1 && month <= 12) {
        // ✅ FIX: Use UTC to avoid timezone offset issues
        const date = new Date(Date.UTC(year, month - 1, day));
        if (!isNaN(date.getTime())) {
          // console.log(`   ✓ Parsed DD-MM-YYYY (day>12): "${str}" → ${date.toISOString().split("T")[0]}`);
          return date;
        }
      }
      
      // Jika month > 12, berarti format MM-DD-YYYY yang salah parsing
      if (month > 12 && day >= 1 && day <= 12) {
        // Swap: anggap itu MM-DD-YYYY
        [day, month] = [month, day];
        // ✅ FIX: Use UTC to avoid timezone offset issues
        const date = new Date(Date.UTC(year, month - 1, day));
        if (!isNaN(date.getTime())) {
          // console.log(`   ✓ Parsed MM-DD-YYYY (swapped): "${str}" → ${date.toISOString().split("T")[0]}`);
          return date;
        }
      }
    }
    
    // ✅ FORMAT 2: ISO format YYYY-MM-DD
    const isoMatch = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const date = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00Z`);
      if (!isNaN(date.getTime())) {
        console.log(`   ✓ Parsed ISO: "${str}" → ${date.toISOString().split("T")[0]}`);
        return date;
      }
    }
    
    // ✅ FORMAT 3: Try native Date parsing sebagai fallback
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      console.log(`   ✓ Parsed native Date: "${str}" → ${date.toISOString().split("T")[0]}`);
      return date;
    }
  }
  
  return null;
}

function parseExcelTime(val) {
  if (!val && val !== 0) return null;
  
  // Already formatted string
  if (typeof val === "string") {
    const str = val.trim();
    // Check if it looks like HH:MM:SS format
    if (/^\d{1,2}:\d{2}:\d{2}/.test(str)) {
      const timePart = str.substring(0, 8); // Extract HH:MM:SS
      const [h, m, s] = timePart.split(":").map(x => parseInt(x, 10));
      
      // Validasi: h 0-23, m 0-59, s 0-59
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59) {
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }
      return null;
    }
    // Try parsing as time
    return str;
  }
  
  // Date object - extract time
  if (val instanceof Date) {
    const h = String(val.getHours()).padStart(2, "0");
    const m = String(val.getMinutes()).padStart(2, "0");
    const s = String(val.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  
  // Excel fractional day → time (0.5 = 12:00:00)
  if (typeof val === "number" && val < 1 && val >= 0) {
    const totalSec = Math.round(val * 86400);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  
  return String(val).trim();
}

// =============================================
// HELPER: Parse tanggal_scan dengan datetime LENGKAP (DD-MM-YYYY HH:MM:SS)
// Return format: "YYYY-MM-DD HH:MM:SS"
// ✅ PENTING: Jangan hilangkan waktu saat parsing!
// =============================================
function parseExcelDateTimeScan(val) {
  if (!val) return null;
  
  // Already a valid Date object
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    // Return datetime string format
    const year = val.getUTCFullYear();
    const month = String(val.getUTCMonth() + 1).padStart(2, "0");
    const day = String(val.getUTCDate()).padStart(2, "0");
    const h = String(val.getUTCHours()).padStart(2, "0");
    const m = String(val.getUTCMinutes()).padStart(2, "0");
    const s = String(val.getUTCSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${h}:${m}:${s}`;
  }
  
  // String format - parse DD-MM-YYYY HH:MM:SS
  if (typeof val === "string") {
    const str = val.trim();
    if (!str) return null;
    
    // Try format: DD-MM-YYYY HH:MM:SS
    // Pattern: 02-03-2026 06:36:40
    const datetimeMatch = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (datetimeMatch) {
      let day = parseInt(datetimeMatch[1], 10);
      let month = parseInt(datetimeMatch[2], 10);
      const year = parseInt(datetimeMatch[3], 10);
      const h = parseInt(datetimeMatch[4], 10);
      const m = parseInt(datetimeMatch[5], 10);
      const s = parseInt(datetimeMatch[6], 10);
      
      // Validasi: day 1-31, month 1-12, h 0-23, m 0-59, s 0-59
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && 
          h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59) {
        
        // ✅ Format DD-MM-YYYY detected
        const dateObj = new Date(Date.UTC(year, month - 1, day, h, m, s));
        if (!isNaN(dateObj.getTime())) {
          const retDay = String(dateObj.getUTCDate()).padStart(2, "0");
          const retMonth = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
          const retYear = dateObj.getUTCFullYear();
          const retH = String(dateObj.getUTCHours()).padStart(2, "0");
          const retM = String(dateObj.getUTCMinutes()).padStart(2, "0");
          const retS = String(dateObj.getUTCSeconds()).padStart(2, "0");
          const result = `${retYear}-${retMonth}-${retDay} ${retH}:${retM}:${retS}`;
          console.log(`   ✓ Parsed tanggal_scan DD-MM-YYYY HH:MM:SS: "${str}" → ${result}`);
          return result;
        }
      }
    }
    
    // Try format: ISO datetime YYYY-MM-DD HH:MM:SS
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10);
      const day = parseInt(isoMatch[3], 10);
      const h = parseInt(isoMatch[4], 10);
      const m = parseInt(isoMatch[5], 10);
      const s = parseInt(isoMatch[6], 10);
      
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && 
          h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }
    }
    
    // Fallback: Try native Date parsing
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const h = String(date.getUTCHours()).padStart(2, "0");
      const m = String(date.getUTCMinutes()).padStart(2, "0");
      const s = String(date.getUTCSeconds()).padStart(2, "0");
      const result = `${year}-${month}-${day} ${h}:${m}:${s}`;
      console.log(`   ✓ Parsed tanggal_scan (native): "${str}" → ${result}`);
      return result;
    }
  }
  
  return null;
}

// =============================================
// POST /api/import-kehadiran
// =============================================
export async function importKehadiran(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });

    // Validate file extension - ONLY .xlsx allowed
    const filename = req.file.originalname.toLowerCase();
    const isXlsx = filename.endsWith('.xlsx');
    const isXls = filename.endsWith('.xls');
    
    if (isXls) {
      console.warn(`❌ .xls file not supported: ${req.file.originalname}`);
      return res.status(400).json({ 
        error: 'Format .xls tidak didukung! File harus berformat .xlsx.\n\nSilakan:\n1. Buka di Microsoft Excel\n2. Save As → Format: Excel Workbook (.xlsx)\n3. Upload ulang file .xlsx',
        supportedFormat: '.xlsx'
      });
    }
    
    if (!isXlsx) {
      console.warn(`⚠️ File extension not .xlsx: ${req.file.originalname}`);
      return res.status(400).json({ 
        error: 'Format file tidak didukung! Hanya .xlsx yang diterima.',
        supportedFormat: '.xlsx'
      });
    }

    let rows;
    try {
      rows = await parseExcelKehadiran(req.file.buffer);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // ✅ FIRST: Detect periode (bulan/tahun) dari data Excel
    let periodMonths = new Set();
    for (const row of rows) {
      const tanggalRaw = row["Tanggal"];
      if (tanggalRaw) {
        const dt = parseExcelDate(tanggalRaw);
        if (dt && !isNaN(dt.getTime())) {
          const yr = dt.getFullYear();
          const mo = String(dt.getMonth() + 1).padStart(2, "0");
          periodMonths.add(`${yr}-${mo}`);
        }
      }
    }
    
    console.log(`📅 Detected ${periodMonths.size} period(s): ${Array.from(periodMonths).join(", ")}`);
    if (periodMonths.size === 0) {
      return res.status(400).json({ 
        error: "Tidak ada data dengan tanggal valid di Excel",
        message: "Periksa format tanggal di kolom 'Tanggal'"
      });
    }

    // Load semua data PARALLEL: karyawan, jadwal, dan kehadiran ada (untuk cek duplikat)
    console.log("👥 Loading karyawan data...");
    const [karyawanRes, jadwalRes, existingRes] = await Promise.all([
      supabase.from("karyawan").select("id_karyawan, id_absen, nama, nik, kategori"),
      supabase.from("jadwal_karyawan").select("id_karyawan, tanggal, kode_shift"),
      supabase.from("kehadiran_karyawan").select("id_karyawan, tanggal_scan, pin")
    ]);

    const karyawanAll = karyawanRes.data || [];
    const jadwalAll = jadwalRes.data || [];
    const existingAttendance = existingRes.data || [];

    // Check if there were any errors
    if (karyawanRes.error) console.error("❌ Error loading karyawan:", karyawanRes.error);
    if (jadwalRes.error) console.error("❌ Error loading jadwal:", jadwalRes.error);
    if (existingRes.error) console.error("❌ Error loading existing attendance:", existingRes.error);

    // Build lookup maps for O(1) access
    const byPin = {}; // id_absen → id_karyawan
    const byNama = {}; // nama → id_karyawan
    const byNip = {}; // nip → id_karyawan
    const karyawanById = {}; // id_karyawan → full karyawan record (for getting nama, jabatan, dept)
    const jadwalMap = new Map(); // "id_karyawan|tanggal" → kode_shift
    const existingKey = new Set(); // "tanggal_scan|pin" untuk duplikat cek (✅ DIUBAH: sebelumnya tanggal_scan|tanggal|nama|pin)
    
    // 🔍 DEBUG: Analyze karyawan data structure
    console.log(`\n🔍 ANALYZING KARYAWAN DATA STRUCTURE:`);
    if (karyawanAll.length > 0) {
      console.log(`   First 5 karyawan records (showing id_absen):`, 
        karyawanAll.slice(0, 5).map(k => ({
          id_karyawan: k.id_karyawan,
          id_absen: k.id_absen,
          nama: k.nama,
          id_absenType: typeof k.id_absen,
          id_absenNull: k.id_absen === null,
          id_absenEmpty: String(k.id_absen || "").trim() === ""
        }))
      );
    }
    
    // 🔍 DEBUG: Count how many karyawan have id_absen
    let karyawanWithPin = 0;
    let karyawanWithoutPin = 0;
    for (const k of karyawanAll) {
      const absenValue = String(k.id_absen || "").trim();
      if (absenValue && absenValue !== "null" && absenValue !== "undefined") {
        const pinKey = absenValue;
        byPin[pinKey] = k.id_karyawan;
        karyawanWithPin++;
      } else {
        karyawanWithoutPin++;
      }
      if (k.nama) byNama[String(k.nama).trim().toLowerCase()] = k.id_karyawan;
      if (k.nik) byNip[String(k.nik).trim()] = k.id_karyawan;
      
      // ✅ Store full karyawan record for later reference (get nama, jabatan, dept)
      karyawanById[k.id_karyawan] = {
        nama: k.nama || "",
        jabatan: k.jabatan || "",
        dept: k.dept || "",
        kategori: k.kategori || ""
      };
    }
    
    console.log(`\n   🔍 Karyawan analysis: ${karyawanWithPin}/${karyawanAll.length} have id_absen`);
    if (karyawanWithoutPin > 0) {
      console.warn(`   ⚠️ ${karyawanWithoutPin} karyawan records have NULL/empty id_absen!`);
    }
    
    for (const j of jadwalAll) {
      if (j.id_karyawan && j.tanggal && j.kode_shift) {
        jadwalMap.set(`${j.id_karyawan}|${j.tanggal}`, j.kode_shift);
      }
    }
    
    console.log(`✅ Loaded jadwal: ${jadwalMap.size} karyawan-tanggal combinations`);
    
    // Debug: Sample jadwal periods
    const jadwalPeriods = new Set();
    for (const key of jadwalMap.keys()) {
      const [, tanggal] = key.split('|');
      const period = tanggal ? tanggal.substring(0, 7) : "unknown";
      jadwalPeriods.add(period);
    }
    console.log(`   📅 Jadwal periods available: ${Array.from(jadwalPeriods).sort().join(", ")}`);
    console.log(`   📅 Excel periods to import: ${Array.from(periodMonths).sort().join(", ")}`);
    
    // ✅ NEW: Duplicate detection berdasarkan tanggal_scan + pin SAJA
    // ⚠️ PENTING: Jika tanggal_scan SAMA tapi pin BEDA = BUKAN duplikat
    //           Jika tanggal_scan BEDA tapi pin SAMA = BUKAN duplikat (karena bisa check-in/out)
    //           Jika tanggal_scan DAN pin SAMA PERSIS = DUPLIKAT
    for (const e of existingAttendance) {
      const dupKey = `${e.tanggal_scan}|${e.pin}`;
      existingKey.add(dupKey);
    }
    
    // Debug info - group by kategori
    const karyawanByKategori = {};
    for (const k of karyawanAll) {
      if (!karyawanByKategori[k.kategori]) karyawanByKategori[k.kategori] = 0;
      karyawanByKategori[k.kategori]++;
    }
    console.log(`✅ Loaded karyawan: ${JSON.stringify(karyawanByKategori)}`);
    console.log(`✅ Loaded ${karyawanAll.length} total (PIN: ${Object.keys(byPin).length}, Nama: ${Object.keys(byNama).length}, NIP: ${Object.keys(byNip).length})`);
    console.log(`✅ Loaded ${jadwalAll.length} jadwal records`);
    console.log(`✅ Loaded ${existingAttendance.length} existing attendance records`);
    
    // ⚠️ CRITICAL DEBUG: Show actual PIN values loaded from database
    console.log(`\n🔍 DEBUG: PIN Matching Analysis...`);
    if (Object.keys(byPin).length > 0) {
      const samplePins = Object.keys(byPin).slice(0, 5);
      console.log(`   ✅ byPin map has ${Object.keys(byPin).length} entries`);
      console.log(`   📌 Sample PINs from DB (first 5): ${samplePins.join(", ")}`);
      console.log(`   📌 First PIN: "${samplePins[0]}" (length: ${samplePins[0]?.length}, type: string)`);
    } else {
      console.error(`   ❌ CRITICAL: byPin is EMPTY! No karyawan have id_absen!`);
      console.error(`   Check if 'id_absen' column is populated in karyawan table!`);
      console.error(`   Sample karyawan records:`, karyawanAll.slice(0, 3).map(k => ({ nama: k.nama, id_absen: k.id_absen })));
    }
    
    if (Object.keys(byNama).length > 0) {
      console.log(`   👤 Nama map has ${Object.keys(byNama).length} entries`);
      console.log(`   Sample Nama (first 3): ${Object.keys(byNama).slice(0, 3).join(", ")}`);
    }

    let insertedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;
    let duplicateCount = 0; // Track duplicates separately
    let invalidDateCount = 0; // Track invalid dates
    let noJadwalCount = 0; // Track records with no jadwal on that date
    let inputDuplicateCount = 0; // ✅ NEW: Track duplicates WITHIN input file
    const notFoundNames = [];
    const skippedData = []; // Track detailed skipped data
    const duplicateData = []; // Track detailed duplicate data
    const inputDuplicateData = []; // ✅ NEW: Track input file duplicates
    const insertedData = []; // Track detailed inserted data
    const batchesToInsert = [];
    let batchInsert = [];
    const BATCH_SIZE = 3000; // Increased batch size untuk performa lebih cepat (500 → 2000 → 3000)
    
    // ✅ NEW: Deduplicate WITHIN input file FIRST (before any processing)
    // ⚠️ PENTING: Duplikat HANYA jika tanggal_scan + pin SAMA PERSIS!
    const inputDupMap = new Map(); // "tanggal_scan|pin" → first occurrence
    const processedRows = [];
    for (const row of rows) {
      const pin = String(row["PIN"] || "").trim();
      const tanggalScanRaw = row["Tanggal scan"];
      
      if (tanggalScanRaw && pin) {
        const tanggalScan = parseExcelDateTimeScan(tanggalScanRaw);
        
        if (tanggalScan) {
          const inputDupKey = `${tanggalScan}|${pin}`;
          
          if (!inputDupMap.has(inputDupKey)) {
            inputDupMap.set(inputDupKey, row);
            processedRows.push(row);
          } else {
            inputDuplicateCount++;
            // Track detailed input duplicate
            if (inputDuplicateData.length < 100) {
              inputDuplicateData.push({
                id_absen: pin || "-",
                nama: String(row["Nama"] || "").trim() || "-",
                tanggal_scan: tanggalScan,
                reason: "Duplicate in input file (tanggal_scan + PIN sama persis)"
              });
            }
          }
        } else {
          processedRows.push(row);
        }
      } else {
        processedRows.push(row);
      }
    }
    
    console.log(`✅ Input deduplication: ${rows.length} → ${processedRows.length} records (removed ${inputDuplicateCount} duplicates)`);
    
    // ✅ Use deduplicated rows instead of original rows
    const rowsToProcess = processedRows;

    console.log("⏳ Processing attendance data...");

    // 🔍 DEBUG: Show Excel headers and first row values for diagnosis
    if (rows.length > 0) {
      console.log(`\n🔍 EXCEL DATA STRUCTURE DIAGNOSIS:`);
      console.log(`   📊 Available columns in Excel:`, Object.keys(rows[0]));
      console.log(`\n   📋 First row values (row object):`);
      const firstRow = rows[0];
      for (const [key, value] of Object.entries(firstRow)) {
        console.log(`      "${key}": "${value}"`);
      }
    }

    // DEBUG: Show first few rows dari Excel untuk diagnosis
    if (rows.length > 0) {
      console.log(`\n   📋 First 3 rows sample (PIN matching analysis):`);
      for (let i = 0; i < Math.min(3, rows.length); i++) {
        const r = rows[i];
        const pinRaw = r["PIN"];
        const namaRaw = r["Nama"];
        
        const pinStr = String(pinRaw || "").trim();
        const namaStr = String(namaRaw || "").trim();
        
        const foundByPin = byPin[pinStr] !== undefined;
        const foundByNama = byNama[namaStr.toLowerCase()] !== undefined;
        
        console.log(`      Row ${i + 1}:`);
        console.log(`         PIN="${pinRaw}" (stripped: "${pinStr}", len: ${pinStr.length})`);
        console.log(`         Found in byPin? ${foundByPin ? "✅ YES" : "❌ NO"}`);
        console.log(`         Nama="${namaRaw}"`);
        console.log(`         Found in byNama? ${foundByNama ? "✅ YES" : "❌ NO"}`);
        
        if (!foundByPin && Object.keys(byPin).length > 0) {
          console.log(`         Sample DB PINs: [${Object.keys(byPin).slice(0, 3).map(p => `"${p}"`).join(", ")}]`);
        }
      }
    }

    for (let rowIdx = 0; rowIdx < rowsToProcess.length; rowIdx++) {
      const row = rowsToProcess[rowIdx];
      // Validasi tanggal & jam
      const tanggalScanRaw = row["Tanggal scan"];
      const tanggalRaw = row["Tanggal"];
      const jamRaw = row["Jam"];

      if (!tanggalScanRaw || !tanggalRaw) {
        skippedCount++;
        continue;
      }

      // ✅ PENTING: Gunakan parseExcelDateTimeScan untuk tanggal_scan (mempertahankan WAKTU)
      const tanggalScanStr = parseExcelDateTimeScan(tanggalScanRaw);
      const tanggalOnly = parseExcelDate(tanggalRaw);
      const jamOnly = parseExcelTime(jamRaw);

      if (!tanggalScanStr || !tanggalOnly || !jamOnly) {
        invalidDateCount++;
        skippedCount++;
        continue;
      }

      // Extra validation: ensure dates are valid before conversion
      if (isNaN(tanggalOnly.getTime())) {
        console.warn(`⚠️ Row ${rowIdx + 4}: Invalid date value (${tanggalRaw}), skipping`);
        invalidDateCount++;
        skippedCount++;
        continue;
      }

      const tanggalStr = tanggalOnly.toISOString().split("T")[0];

      // ✅ FILTER: Hanya terima tanggal yang sesuai dengan periode Excel
      const periodKey = `${tanggalOnly.getFullYear()}-${String(tanggalOnly.getMonth() + 1).padStart(2, "0")}`;
      if (!periodMonths.has(periodKey)) {
        skippedCount++;
        continue;
      }

      const verifikasi = row["Verifikasi"] !== "" && row["Verifikasi"] !== null
        ? parseInt(row["Verifikasi"]) : null;
      const io = row["I/O"] !== "" && row["I/O"] !== null
        ? parseInt(row["I/O"]) : null;

      // Match karyawan: prioritas PIN/id_absen, fallback NIP, fallback nama
      const pin = String(row["PIN"] || "").trim();
      const nip = String(row["NIP"] || "").trim();
      const nama = String(row["Nama"] || "").trim();

      let idKaryawan = null;
      let matchedVia = null; // Track how we matched
      
      // Try PIN first
      if (pin) {
        idKaryawan = byPin[pin] || null;
        if (idKaryawan) {
          matchedVia = "PIN";
        }
      }
      
      // If PIN failed, try NIP
      if (!idKaryawan && nip) {
        idKaryawan = byNip[nip] || null;
        if (idKaryawan) matchedVia = "NIP";
      }
      
      // If PIN+NIP failed, try Nama
      if (!idKaryawan && nama) {
        idKaryawan = byNama[nama.toLowerCase()] || null;
        if (idKaryawan) matchedVia = "Nama";
      }

      // SKIP: If karyawan not found - don't insert null data
      if (!idKaryawan) {
        const uniqueName = nama || nip || `PIN:${pin}`;
        if (!notFoundNames.includes(uniqueName)) {
          notFoundNames.push(uniqueName);
        }
        
        // 🔍 DEBUG: Show first NOT-FOUND entry with ULTRA-DETAILED analysis
        if (notFoundNames.length === 1 || rowIdx < 5) {
          console.log(`\n   ⚠️ NOT FOUND Row ${rowIdx + 4} (FIRST OCCURRENCE - DETAILED DEBUG):`);
          console.log(`      EXTRACTED VALUES:`);
          console.log(`         PIN="${pin}" (type: ${typeof pin}, length: ${pin.length})`);
          console.log(`         NIP="${nip}" (type: ${typeof nip}, length: ${nip.length})`);
          console.log(`         Nama="${nama}" (type: ${typeof nama}, length: ${nama.length})`);
          
          console.log(`      MATCH ATTEMPTS:`);
          const pinInMap = pin in byPin;
          const nipInMap = nip in byNip;
          const namaInMap = nama.toLowerCase() in byNama;
          console.log(`         PIN in byPin map? ${pinInMap ? "✅ YES (found id_karyawan=" + byPin[pin] + ")" : "❌ NO"}`);
          console.log(`         NIP in byNip map? ${nipInMap ? "✅ YES (found id_karyawan=" + byNip[nip] + ")" : "❌ NO"}`);
          console.log(`         Nama in byNama map? ${namaInMap ? "✅ YES (found id_karyawan=" + byNama[nama.toLowerCase()] + ")" : "❌ NO"}`);
          
          console.log(`      DATABASE COMPARISON:`);
          console.log(`         Total byPin entries: ${Object.keys(byPin).length}`);
          console.log(`         Total byNip entries: ${Object.keys(byNip).length}`);
          console.log(`         Total byNama entries: ${Object.keys(byNama).length}`);
          
          if (Object.keys(byPin).length > 0) {
            const samplePins = Object.keys(byPin).slice(0, 5);
            console.log(`         Sample byPin keys (first 5): ${samplePins.map(p => `"${p}"`).join(", ")}`);
            console.log(`         Is PIN="${pin}" in [${samplePins.map(p => `"${p}"`).join(", ")}]? NO`);
          }
        } else if (notFoundNames.length <= 5) {
          console.log(`   ⚠️ NOT FOUND Row ${rowIdx + 4}:`);
          console.log(`      PIN="${pin}" | NIP="${nip}" | Nama="${nama}"`);
          console.log(`      Attempted: PIN match=${byPin[pin] ? "✅" : "❌"}, NIP match=${byNip[nip] ? "✅" : "❌"}, Nama match=${byNama[nama.toLowerCase()] ? "✅" : "❌"}`);
          if (Object.keys(byPin).length > 0) {
            console.log(`      DB Sample PINs: [${Object.keys(byPin).slice(0, 3).map(p => `"${p}"`).join(", ")}]`);
          } else if (Object.keys(byNama).length > 0) {
            console.log(`      DB Sample Nama: [${Object.keys(byNama).slice(0, 3).join(", ")}]`);
          }
        }
        notFoundCount++;
        skippedCount++;
        
        // Track detailed skipped data with match attempt
        skippedData.push({
          id_absen: pin || nip || "-",
          nama: nama || "-",
          jabatan: row["Jabatan"] ? String(row["Jabatan"]) : "-",
          departemen: row["Departemen"] ? String(row["Departemen"]) : "-",
          matched_via: matchedVia,
          reason: "Not found in karyawan (tried PIN, NIP, Nama)"
        });
        
        continue;
      }

      // ✅ Cek duplikat: HANYA tanggal_scan + pin (YANG BERUBAH dari tanggal_scan|tanggal|nama|pin)
      // ⚠️ Jika waktu berbeda dalam tanggal_scan, itu BUKAN duplikat (check-in vs check-out)
      const dupKey = `${tanggalScanStr}|${pin}`;
      if (existingKey.has(dupKey)) {
        duplicateCount++;
        skippedCount++;
        
        // Track detailed duplicate data
        duplicateData.push({
          id_absen: pin || nip || "-",
          nama: nama || "-",
          jabatan: row["Jabatan"] ? String(row["Jabatan"]) : "-",
          departemen: row["Departemen"] ? String(row["Departemen"]) : "-",
          tanggal_scan: tanggalScanStr,
          reason: "Duplicate (tanggal_scan + PIN sama persis dengan existing)"
        });
        
        continue;
      }

      // ✅ VALIDASI JADWAL: Cek jadwal pada tanggal tersebut
      const jadwalKey = `${idKaryawan}|${tanggalStr}`;
      let kodeShift = jadwalMap.get(jadwalKey) || null;

      // ⚠️ RELAX: If no jadwal for this employee on this date, use default "X"
      // (Previously was SKIP, now we allow it with default shift code)
      if (!kodeShift) {
        kodeShift = "X"; // Default shift code for records without jadwal
        // ℹ️ Note: Not counting as skip anymore - will be inserted with default shift
      }

      // ✅ Get karyawan details for default values (especially nama, since Excel nama might be NULL)
      const karyawanData = karyawanById[idKaryawan] || {};
      const finalNama = nama && String(nama).trim() ? String(nama).trim() : karyawanData.nama;
      const finalJabatan = row["Jabatan"] ? String(row["Jabatan"]) : karyawanData.jabatan;
      const finalDepartemen = row["Departemen"] ? String(row["Departemen"]) : karyawanData.dept;

      batchInsert.push({
        id_karyawan: idKaryawan,
        tanggal_scan: tanggalScanStr,
        tanggal: tanggalStr,
        jam: jamOnly,
        pin: pin || null,
        nip: nip || null,
        nama: finalNama || null,  // ✅ Use karyawan nama if Excel nama is empty
        jabatan: finalJabatan || null,  // ✅ Use karyawan jabatan if Excel jabatan is empty
        departemen: finalDepartemen || null,  // ✅ Use karyawan dept if Excel departemen is empty
        kantor: row["Kantor"] ? String(row["Kantor"]) : null,
        verifikasi,
        io,
        workcode: row["Workcode"] ? String(row["Workcode"]) : null,
        sn: row["SN"] ? String(row["SN"]) : null,
        mesin: row["Mesin"] ? String(row["Mesin"]) : null,
        kode: kodeShift,
      });

      // Track detailed inserted data (limit to first 100 for response size)
      if (insertedData.length < 100) {
        insertedData.push({
          id_absen: pin || nip || "-",
          nama: nama || "-",
          jabatan: row["Jabatan"] ? String(row["Jabatan"]) : "-",
          departemen: row["Departemen"] ? String(row["Departemen"]) : "-",
          tanggal: tanggalStr,
          jam: jamOnly
        });
      }

      insertedCount++;

      // Push batch untuk parallel processing nanti
      if (batchInsert.length >= BATCH_SIZE) {
        batchesToInsert.push(batchInsert);
        batchInsert = [];
      }
    }

    // Push sisa batch
    if (batchInsert.length > 0) {
      batchesToInsert.push(batchInsert);
    }

    // ✅ STEP 1: DELETE kehadiran untuk periode yang akan diimport (sesuai Python app.py)
    console.log(`🗑️ Deleting existing attendance for ${periodMonths.size} period(s)...`);
    const deletePromises = Array.from(periodMonths).map(async (periodKey) => {
      const [year, month] = periodKey.split("-");
      const startDate = `${year}-${month}-01`;
      // Calculate last day of month
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endDate = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
      
      const { error: delError } = await supabase
        .from("kehadiran_karyawan")
        .delete()
        .gte("tanggal", startDate)
        .lte("tanggal", endDate);
      
      if (delError) {
        console.warn(`⚠️ Error deleting period ${periodKey}:`, delError.message);
      } else {
        console.log(`✅ Deleted existing attendance for ${periodKey}`);
      }
    });
    
    await Promise.all(deletePromises);

    // INSERT PARALLEL: Semua batches di-insert simultaneously untuk speed up
    console.log(`💾 Inserting ${batchesToInsert.length} batches (${insertedCount} records) in parallel...`);
    
    const insertPromises = batchesToInsert.map(async (batch, idx) => {
      const { error: insErr, data: insertedData } = await supabase
        .from("kehadiran_karyawan")
        .insert(batch);
      
      // ✅ NEW: If duplicate key error (23505), try UPSERT (individual updates)
      if (insErr && insErr.code === "23505") {
        console.log(`  ⚠️ Batch ${idx + 1} has duplicates (23505) - attempting individual UPSERT...`);
        
        let upsertedCount = 0;
        for (const record of batch) {
          const { id_karyawan, tanggal_scan, tanggal, jam } = record;
          
          // Try update on this composite key
          const { error: updateErr, data: updateData } = await supabase
            .from("kehadiran_karyawan")
            .update(record)
            .eq("id_karyawan", id_karyawan)
            .eq("tanggal_scan", tanggal_scan)
            .eq("tanggal", tanggal)
            .eq("jam", jam);
          
          if (!updateErr && updateData && updateData.length > 0) {
            upsertedCount++;
          }
        }
        
        console.log(`  ✅ Batch ${idx + 1} UPSERT completed: ${upsertedCount}/${batch.length} records`);
        return { success: true, inserted: upsertedCount, error: null, note: `UPSERT` };
      }
      
      // Log but DON'T THROW - continue even if some batches fail (non-duplicate errors)
      if (insErr && insErr.code !== "23505") {
        console.error(`  ⚠️ Batch ${idx + 1} ERROR:`, insErr.message);
        return { success: false, inserted: 0, error: insErr.message };
      }
      
      const actualInserted = insertedData?.length || batch.length;
      console.log(`  ✅ Batch ${idx + 1}: ${actualInserted}/${batch.length} records inserted`);
      return { success: true, inserted: actualInserted, error: null };
    });

    const results = await Promise.all(insertPromises);
    const totalActuallyInserted = results.reduce((acc, r) => acc + r.inserted, 0);
    const failedBatches = results.filter(r => !r.success);
    console.log(`✅ All batches completed: ${totalActuallyInserted}/${insertedCount} records inserted`);
    
    if (failedBatches.length > 0) {
      console.warn(`⚠️ ${failedBatches.length} batches had errors (will be reported in response)`);
    }

    // Reset croscek setelah import kehadiran (sesuai Python logic)
    console.log("🔄 Resetting croscek tables...");
    await supabase.from("croscek").delete().gte("id", 0);
    console.log("✅ Croscek table reset");

    // ✅ STEP 2: Process kehadiran → croscek (sesuai Python app.py logic)
    console.log("🔄 Processing kehadiran data → croscek table...");
    
    try {
      // ✅ CRITICAL FIX: Query jadwal untuk SEMUA tanggal dalam periode, bukan hanya tanggal 01
      // Build date range queries for each period
      const dateRanges = Array.from(periodMonths).map(p => {
        const [year, month] = p.split("-");
        const startDate = `${year}-${month}-01`;
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
        const endDate = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
        return { startDate, endDate };
      });
      
      console.log(`   📅 Querying jadwal for periods: ${Array.from(periodMonths).join(", ")}`);
      
      // Query jadwal with proper date range (all dates, not just 01)
      let jadwalData = [];
      for (const { startDate, endDate } of dateRanges) {
        const { data, error: jadwalError } = await supabase
          .from("jadwal_karyawan")
          .select("id_karyawan, tanggal, kode_shift, nama")
          .gte("tanggal", startDate)
          .lte("tanggal", endDate);
        
        if (jadwalError) throw jadwalError;
        if (data) jadwalData = jadwalData.concat(data);
      }
      
      console.log(`   ✅ Loaded ${jadwalData.length} jadwal entries`);

      // Get informasi jadwal untuk jam masuk/pulang
      const { data: infJadwal, error: infError } = await supabase
        .from("informasi_jadwal")
        .select("kode, jam_masuk, jam_pulang");

      if (infError) throw infError;

      // Query kehadiran untuk periode yang di-import
      const { data: kehadiranData, error: kehadiranError } = await supabase
        .from("kehadiran_karyawan")
        .select("*")
        .gte("tanggal", Array.from(periodMonths).map(p => `${p}-01`)[0])
        .lte("tanggal", Array.from(periodMonths).map(p => {
          const [year, month] = p.split("-");
          const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
          return `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
        })[Array.from(periodMonths).length - 1]);

      if (kehadiranError) throw kehadiranError;

      // Build lookup maps
      const infJadwalMap = {};
      for (const ij of infJadwal) {
        infJadwalMap[ij.kode] = ij;
      }

      // Group kehadiran by karyawan + tanggal
      const kehadiranByKey = {};
      for (const kh of kehadiranData) {
        const key = `${kh.id_karyawan}|${kh.tanggal}`;
        if (!kehadiranByKey[key]) kehadiranByKey[key] = [];
        kehadiranByKey[key].push(kh);
      }

      // Process each jadwal entry
      const croscekRecords = [];
      let skippedShiftCodes = new Set();
      
      for (const jk of jadwalData) {
        const key = `${jk.id_karyawan}|${jk.tanggal}`;
        const scans = kehadiranByKey[key] || [];
        const infJd = infJadwalMap[jk.kode_shift];

        // ⚠️ RELAX: Allow missing infJadwal for special shifts like "X" (libur)
        // If not found, use defaults
        if (!infJd) {
          if (jk.kode_shift !== "X") {
            skippedShiftCodes.add(jk.kode_shift);
          }
          // Continue processing even without infJadwal
        }

        // Calculate actual masuk (MIN of scans)
        const actualMasuk = scans.length > 0 ? scans[0].tanggal_scan : null;
        // Calculate actual pulang (MAX of scans)
        const actualPulang = scans.length > 0 ? scans[scans.length - 1].tanggal_scan : null;

        // Get employee info
        const { data: karyawan } = await supabase
          .from("karyawan")
          .select("*")
          .eq("id_karyawan", jk.id_karyawan)
          .single();

        // Determine status - special handling for shift "X" (libur)
        let statusKehadiran = "Tidak Hadir";
        let statusMasuk = "Tidak scan masuk";
        let statusPulang = "Tidak scan pulang";
        let jadwalMasuk = infJd?.jam_masuk || "00:00:00";
        let jadwalPulang = infJd?.jam_pulang || "00:00:00";

        if (jk.kode_shift === "X") {
          // Shift X = Libur
          statusKehadiran = "Libur";
          jadwalMasuk = "00:00:00";
          jadwalPulang = "00:00:00";
        } else if (actualMasuk && actualPulang) {
          statusKehadiran = "Hadir";
          
          // Simplify: if scans exist, treat as on-time (dapat kompleks sesuai departemen & shift)
          statusMasuk = "Masuk Tepat Waktu";
          statusPulang = "Pulang Tepat Waktu";
        } else if (actualMasuk && !actualPulang) {
          statusKehadiran = "Hadir Sebagian";
          statusMasuk = "Masuk Tepat Waktu";
          statusPulang = "Tidak scan pulang";
        } else if (!actualMasuk && actualPulang) {
          statusKehadiran = "Hadir Sebagian";
          statusMasuk = "Tidak scan masuk";
          statusPulang = "Pulang Tepat Waktu";
        }

        croscekRecords.push({
          Nama: jk.nama || karyawan?.nama || "-",
          Tanggal: jk.tanggal,
          Kode_Shift: jk.kode_shift,
          Jabatan: karyawan?.jabatan || "-",
          Departemen: karyawan?.dept || "-",
          id_karyawan: jk.id_karyawan,
          NIK: karyawan?.nik || "-",
          Jadwal_Masuk: jadwalMasuk,  // ✅ Use computed value
          Jadwal_Pulang: jadwalPulang,  // ✅ Use computed value
          Actual_Masuk: actualMasuk,
          Actual_Pulang: actualPulang,
          Prediksi_Shift: null,
          Prediksi_Actual_Masuk: null,
          Prediksi_Actual_Pulang: null,
          Probabilitas_Prediksi: null,
          Confidence_Score: null,
          Frekuensi_Shift_Historis: null,
          Status_Kehadiran: statusKehadiran,
          Status_Masuk: statusMasuk,
          Status_Pulang: statusPulang
        });
      }
      
      if (skippedShiftCodes.size > 0) {
        console.log(`⚠️ Warning: Missing informasi_jadwal for shifts: ${Array.from(skippedShiftCodes).join(", ")}`);
      }
      console.log(`📊 Total jadwal entries processed: ${jadwalData.length}, croscek records generated: ${croscekRecords.length}`);

      // Batch insert croscek data
      if (croscekRecords.length > 0) {
        console.log(`💾 Inserting ${croscekRecords.length} croscek records...`);
        
        const batchSize = 500;
        for (let i = 0; i < croscekRecords.length; i += batchSize) {
          const batch = croscekRecords.slice(i, i + batchSize);
          const { error: insertError } = await supabase
            .from("croscek")
            .insert(batch);
          
          if (insertError) {
            console.warn(`⚠️ Batch insert error:`, insertError.message);
          } else {
            console.log(`✅ Inserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records`);
          }
        }
      }

      console.log(`✅ Croscek processing completed: ${croscekRecords.length} records`);

    } catch (e) {
      console.warn(`⚠️ Croscek processing warning (non-fatal):`, e.message);
      // Don't fail the import if croscek processing fails
    }

    console.log(`\n✅ SUMMARY KEHADIRAN:`);
    console.log(`   📊 Input rows: ${rows.length}`);
    console.log(`   ✅ Input deduplicated: ${inputDuplicateCount} removed → ${rowsToProcess.length} to process`);
    console.log(`   ✅ Inserted: ${totalActuallyInserted}`);
    console.log(`   ⏭️  Total Skipped: ${skippedCount}`);
    console.log(`       ├─ ❌ Not found in karyawan: ${notFoundCount}`);
    console.log(`       ├─ 🔄 Duplicates (existing DB): ${duplicateCount}`);
    console.log(`       ├─ ⚠️  No jadwal on date: ${noJadwalCount}`);
    console.log(`       └─ ⚠️  Invalid date/time format: ${invalidDateCount}`);
    console.log(`   📅 Periods detected: ${Array.from(periodMonths).join(", ")}`);
    if (notFoundNames.length > 0) {
      console.log(`   📝 Sample not found (first 5): ${notFoundNames.slice(0, 5).join(", ")}`);
    }

    return res.json({ 
      status: "success",
      message: `✅ Import successful! ${totalActuallyInserted} kehadiran records saved for ${periodMonths.size} period(s), ${skippedCount} skipped (${inputDuplicateCount} input duplicates + ${duplicateCount} existing duplicates + ${notFoundCount} not found + ${noJadwalCount} no jadwal + ${invalidDateCount} invalid dates). Croscek processed automatically.`,
      summary: {
        kehadiran: {
          inserted: totalActuallyInserted,
          skipped: skippedCount,
          breakdown: {
            input_duplicates: inputDuplicateCount,
            existing_duplicates: duplicateCount,
            not_found: notFoundCount,
            no_jadwal: noJadwalCount,
            invalid_date_time: invalidDateCount
          }
        },
        workflow: "Kehadiran imported → Croscek table auto-populated with attendance status"
      },
      periods: Array.from(periodMonths),
      employees_loaded: {
        total: karyawanAll.length,
        by_kategori: karyawanByKategori
      },
      inserted_count: totalActuallyInserted,
      skipped_count: skippedCount,
      input_duplicate_count: inputDuplicateCount,
      existing_duplicate_count: duplicateCount,
      not_found_count: notFoundCount,
      no_jadwal_count: noJadwalCount,
      invalid_date_count: invalidDateCount,
      not_found_samples: notFoundNames.slice(0, 10),
      inserted_data: insertedData.slice(0, 50),
      skipped_data: skippedData.slice(0, 50),
      duplicate_data: duplicateData.slice(0, 50),
      input_duplicate_data: inputDuplicateData.slice(0, 50)
    });
  } catch (e) {
    console.error("❌ IMPORT KEHADIRAN ERROR:", e);
    console.error("Stack:", e.stack);
    return res.status(500).json({ 
      status: "error",
      error: e.message,
      details: e.details || e.hint,
      message: "❌ Import Gagal - Terjadi error pada proses import kehadiran",
      stack: process.env.NODE_ENV === "development" ? e.stack?.substring(0, 500) : undefined
    });
  }
}

// =============================================
// GET /api/kehadiran-karyawan/available-periods
// =============================================
export async function getAvailablePeriodsKaryawan(req, res) {
  try {
    // Batch fetch untuk bypass limit 1000 row Supabase
    const rows = await fetchAllRowsInBatches((offset, batchSize) =>
      supabase
        .from("kehadiran_karyawan")
        .select("tanggal, id_karyawan, karyawan!inner(kategori)")
        .eq("karyawan.kategori", "karyawan")
        .order("tanggal", { ascending: false })
        .order("id_karyawan", { ascending: true })
        .order("tanggal_scan", { ascending: true })
        .range(offset, offset + batchSize - 1)
    );

    // Extract unique bulan/tahun dari data
    const periodSet = new Set();
    for (const r of rows || []) {
      if (r.tanggal) {
        const d = new Date(r.tanggal);
        periodSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    }

    // Convert ke array dan sort descending
    const periods = [...periodSet]
      .map((p) => {
        const [tahun, bulan] = p.split("-").map(Number);
        return { bulan, tahun };
      })
      .sort((a, b) => b.tahun - a.tahun || b.bulan - a.bulan);

    console.log(`✅ Found ${periods.length} periods for KARYAWAN`);
    return res.json({ kategori: "karyawan", total_periods: periods.length, periods });
  } catch (e) {
    console.error("ERROR GET PERIODS KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// GET /api/kehadiran-dw/available-periods
// =============================================
export async function getAvailablePeriodsDW(req, res) {
  try {
    // Batch fetch untuk bypass limit 1000 row Supabase
    const rows = await fetchAllRowsInBatches((offset, batchSize) =>
      supabase
        .from("kehadiran_karyawan")
        .select("tanggal, id_karyawan, karyawan!inner(kategori)")
        .eq("karyawan.kategori", "dw")
        .order("tanggal", { ascending: false })
        .order("id_karyawan", { ascending: true })
        .order("tanggal_scan", { ascending: true })
        .range(offset, offset + batchSize - 1)
    );

    // Extract unique bulan/tahun dari data
    const periodSet = new Set();
    for (const r of rows || []) {
      if (r.tanggal) {
        const d = new Date(r.tanggal);
        periodSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    }

    // Convert ke array dan sort descending
    const periods = [...periodSet]
      .map((p) => {
        const [tahun, bulan] = p.split("-").map(Number);
        return { bulan, tahun };
      })
      .sort((a, b) => b.tahun - a.tahun || b.bulan - a.bulan);

    console.log(`✅ Found ${periods.length} periods for DW`);
    return res.json({ kategori: "dw", total_periods: periods.length, periods });
  } catch (e) {
    console.error("ERROR GET PERIODS DW:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// DELETE /api/kehadiran-karyawan/delete-period
// =============================================
export async function deleteKehadiranPeriodKaryawan(req, res) {
  try {
    const bulan = Number(req.body?.bulan);
    const tahun = Number(req.body?.tahun);
    if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12 || !Number.isInteger(tahun) || tahun < 1900) {
      return res.status(400).json({ error: "Bulan dan tahun tidak valid" });
    }

    const ids = await fetchKaryawanIdsByKategori("karyawan");
    const { startDate, endDate } = getPeriodDateRange(bulan, tahun);

    let deletedCount = 0;
    for (const idChunk of chunkArray(ids, DELETE_ID_CHUNK_SIZE)) {
      const { count, error } = await supabase
        .from("kehadiran_karyawan")
        .delete({ count: "exact" })
        .in("id_karyawan", idChunk)
        .gte("tanggal", startDate)
        .lte("tanggal", endDate);
      if (error) throw error;
      deletedCount += count || 0;
    }

    // Reset croscek
    await supabase.from("croscek").delete().neq("id_karyawan", 0);

    return res.json({
      message: `Berhasil hapus kehadiran KARYAWAN periode ${bulan}/${tahun}`,
      kategori: "karyawan",
      kehadiran_deleted: deletedCount,
      croscek_deleted: "FULL RESET",
    });
  } catch (e) {
    console.error("ERROR DELETE PERIOD KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// DELETE /api/kehadiran-dw/delete-period
// =============================================
export async function deleteKehadiranPeriodDW(req, res) {
  try {
    const bulan = Number(req.body?.bulan);
    const tahun = Number(req.body?.tahun);
    if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12 || !Number.isInteger(tahun) || tahun < 1900) {
      return res.status(400).json({ error: "Bulan dan tahun tidak valid" });
    }

    const ids = await fetchKaryawanIdsByKategori("dw");
    const { startDate, endDate } = getPeriodDateRange(bulan, tahun);

    let deletedCount = 0;
    for (const idChunk of chunkArray(ids, DELETE_ID_CHUNK_SIZE)) {
      const { count, error } = await supabase
        .from("kehadiran_karyawan")
        .delete({ count: "exact" })
        .in("id_karyawan", idChunk)
        .gte("tanggal", startDate)
        .lte("tanggal", endDate);
      if (error) throw error;
      deletedCount += count || 0;
    }

    // Reset croscek_dw
    await supabase.from("croscek_dw").delete().neq("id_karyawan", 0);

    return res.json({
      message: `Berhasil hapus kehadiran Daily Worker periode ${bulan}/${tahun}`,
      kategori: "dw",
      kehadiran_deleted: deletedCount,
      croscek_deleted: "FULL RESET",
    });
  } catch (e) {
    console.error("ERROR DELETE PERIOD DW:", e);
    return res.status(500).json({ error: e.message });
  }
}
