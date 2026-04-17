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
// HELPER: Cek apakah nilai adalah bulan/tahun
// =============================================
function parseMonthYear(rawValue) {
  if (!rawValue) return null;

  // ExcelJS Date object
  if (rawValue instanceof Date) {
    return { year: rawValue.getFullYear(), month: rawValue.getMonth() + 1 };
  }

  const valueStr = String(rawValue).trim().replace(/['"]/g, "");
  if (!valueStr || valueStr.length < 4) return null;

  const monthNames = {
    januari: 1, january: 1,
    februari: 2, february: 2,
    maret: 3, march: 3,
    april: 4,
    mei: 5, may: 5,
    juni: 6, june: 6,
    juli: 7, july: 7,
    agustus: 8, august: 8,
    september: 9,
    oktober: 10, october: 10,
    november: 11,
    desember: 12, december: 12,
  };

  // Format 1: "November 2025"
  const lower = valueStr.toLowerCase();
  for (const [name, num] of Object.entries(monthNames)) {
    if (lower.includes(name)) {
      const yearMatch = valueStr.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        return { year: parseInt(yearMatch[1]), month: num };
      }
    }
  }

  // Format 2: "DD/MM/YYYY" atau "MM/DD/YYYY"
  const slashMatch = valueStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, p1, p2, yr] = slashMatch.map(Number);
    // Jika p1 > 12 → DD/MM/YYYY, p2 > 12 → MM/DD/YYYY, default DD/MM/YYYY (Indonesia)
    const month = p1 > 12 ? p2 : p1;
    return { year: yr, month };
  }

  // Format 3: "YYYY-MM-DD" atau "YYYY-MM-DD HH:MM:SS"
  const isoMatch = valueStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return { year: parseInt(isoMatch[1]), month: parseInt(isoMatch[2]) };
  }

  return null; // Tidak dikenali
}

// =============================================
// HELPER: Deteksi baris header & data dari Excel
// Strategi: scan sheet dari atas, cari baris yang
// berisi angka 1..N secara berurutan (baris tanggal)
// =============================================
function detectSheetStructure(ws) {
  let monthYear = null;
  let dataStartRow = null;    // baris pertama data karyawan (setelah header)
  let dayStartCol = null;     // kolom index pertama yang berisi angka hari (1)
  let daysInRow = 0;          // jumlah hari yang terdeteksi

  const MAX_HEADER_ROWS = 15; // scan maksimal 15 baris pertama untuk header

  // ── Tahap 1: Temukan baris bulan/tahun ──────────────────────────────────
  for (let r = 1; r <= Math.min(MAX_HEADER_ROWS, ws.rowCount); r++) {
    const row = ws.getRow(r);
    // Scan semua cell di baris ini
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (monthYear) return; // sudah ketemu
      const parsed = parseMonthYear(cell.value);
      if (parsed) {
        monthYear = parsed;
      }
    });
    if (monthYear) break;
  }

  // ── Tahap 2: Temukan baris yang berisi angka hari (1, 2, 3, ...) ────────
  // Baris ini biasanya adalah sub-header tanggal (misal row 5 di template)
  let dayRowIdx = null;

  for (let r = 1; r <= Math.min(MAX_HEADER_ROWS, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const numbers = [];
    const colPositions = [];

    row.eachCell({ includeEmpty: false }, (cell, colNum) => {
      const v = cell.value;
      const num = typeof v === "number" ? v : parseInt(String(v ?? ""));
      if (!isNaN(num) && num >= 1 && num <= 31) {
        numbers.push(num);
        colPositions.push(colNum);
      }
    });

    // Baris valid: mengandung setidaknya 20 angka berurutan mulai dari 1
    if (numbers.length >= 20 && numbers[0] === 1) {
      // Validasi: angka harus naik berurutan
      let isSequential = true;
      for (let i = 1; i < numbers.length; i++) {
        if (numbers[i] !== numbers[i - 1] + 1) {
          isSequential = false;
          break;
        }
      }
      if (isSequential) {
        dayRowIdx = r;
        dayStartCol = colPositions[0];  // kolom angka "1"
        daysInRow = numbers.length;
        break;
      }
    }
  }

  // ── Tahap 3: Tentukan baris data (setelah baris header/tanggal) ──────────
  if (dayRowIdx !== null) {
    // Data karyawan mulai 1 baris setelah baris tanggal
    dataStartRow = dayRowIdx + 1;
  } else {
    // Fallback: gunakan row 6 (konvensi template lama)
    dataStartRow = 6;
    dayStartCol = 4; // kolom D = hari 1
    daysInRow = monthYear
      ? new Date(monthYear.year, monthYear.month, 0).getDate()
      : 31;
  }

  return { monthYear, dataStartRow, dayStartCol, daysInRow };
}

// =============================================
// HELPER: Hitung shift_window_start & end (dengan timezone)
// =============================================
function computeShiftWindow(tanggal, kodeShift, si) {
  const SKIP_SHIFTS = new Set(["X", "CT", "CTB", "CTT", "OF1", "EO"]);
  if (SKIP_SHIFTS.has(kodeShift)) {
    return { shift_window_start: null, shift_window_end: null };
  }
  if (!si) {
    return { shift_window_start: null, shift_window_end: null };
  }

  const tgl = String(tanggal).split("T")[0];
  const dateObj = new Date(tgl + "T00:00:00Z");

  const prevDay = new Date(dateObj);
  prevDay.setUTCDate(prevDay.getUTCDate() - 1);
  const nextDay = new Date(dateObj);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const prevStr = prevDay.toISOString().split("T")[0];
  const nextStr = nextDay.toISOString().split("T")[0];

  let windowStart, windowEnd;

  if (kodeShift === "3A") {
    windowStart = `${prevStr} 22:00:00+00`;
    windowEnd   = `${tgl} 11:00:00+00`;
  } else if (si.jam_masuk > si.jam_pulang) {
    // Shift lintas hari
    windowStart = `${tgl} ${si.jam_masuk}+00`;
    windowEnd   = `${nextStr} ${si.jam_pulang}+00`;
  } else {
    windowStart = `${tgl} ${si.jam_masuk}+00`;
    windowEnd   = `${tgl} ${si.jam_pulang}+00`;
  }

  return { shift_window_start: windowStart, shift_window_end: windowEnd };
}

// =============================================
// HELPER: Update shift_window untuk satu row
// =============================================
async function updateShiftWindow(no) {
  try {
    const { data: jadwal } = await supabase
      .from("jadwal_karyawan")
      .select("no, tanggal, kode_shift")
      .eq("no", no)
      .single();

    if (!jadwal) return;

    const SKIP_SHIFTS = new Set(["X", "CT", "CTB", "CTT", "OF1", "EO"]);
    if (SKIP_SHIFTS.has(jadwal.kode_shift)) {
      await supabase
        .from("jadwal_karyawan")
        .update({ shift_window_start: null, shift_window_end: null })
        .eq("no", no);
      return;
    }

    const { data: si } = await supabase
      .from("shift_info")
      .select("kode, jam_masuk, jam_pulang, lintas_hari")
      .eq("kode", jadwal.kode_shift)
      .maybeSingle();

    const { shift_window_start, shift_window_end } = computeShiftWindow(
      jadwal.tanggal, jadwal.kode_shift, si
    );

    await supabase
      .from("jadwal_karyawan")
      .update({ shift_window_start, shift_window_end })
      .eq("no", no);
  } catch (e) {
    console.error(`[updateShiftWindow no=${no}]`, e.message);
  }
}

// =============================================
// DEPRECATED: Batch update shift_window digunakan untuk post-processing
// SEKARANG shift_window dihitung SAAT INSERT (lebih efisien)
// =============================================
async function batchUpdateShiftWindow(jadwalRows, shiftInfoMap) {
  console.warn("⚠️  batchUpdateShiftWindow DEPRECATED - shift_window sudah dihitung saat insert");
  // Function ini sekarang tidak digunakan lagi
  // Tetap ada untuk backward compatibility
}

// =============================================
// HELPER: Normalisasi NIK (handle float "208970.0")
// =============================================
function normalizeNIK(raw) {
  if (!raw && raw !== 0) return null;
  let nik = String(raw).trim();
  if (nik === "" || nik.toLowerCase() === "nan") return null;
  // Handle float: "208970121.0" → "208970121"
  if (nik.includes(".") && !isNaN(parseFloat(nik))) {
    nik = String(parseInt(parseFloat(nik)));
  }
  return nik || null;
}

// =============================================
// HELPER: Ambil nilai cell ExcelJS
// =============================================
function getCellVal(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.richText) {
    return v.richText.map((r) => r.text).join("").trim();
  }
  if (typeof v === "object" && v.result !== undefined) return v.result;
  return v;
}

// =============================================
// HELPER: Import jadwal logic (karyawan & DW)
// =============================================
async function importJadwalLogic(buffer, kategori) {
  // ── Validasi buffer ──────────────────────────────────────────────────────
  if (!buffer || buffer.length === 0) {
    throw new Error("Buffer file kosong — file mungkin tidak terupload dengan benar");
  }

  console.log(`📁 Buffer size: ${buffer.length} bytes | kategori: ${kategori}`);
  console.log(`📁 Buffer type: ${typeof buffer} | isBuffer: ${Buffer.isBuffer(buffer)}`);

  // ── Parse Excel ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();

  // Pastikan pakai Node.js Buffer asli (fix untuk beberapa versi multer)
  let nodeBuffer = buffer;
  if (!Buffer.isBuffer(buffer)) {
    nodeBuffer = Buffer.from(buffer);
    console.log(`⚠️  Converting buffer, new size: ${nodeBuffer.length}`);
  }

  try {
    await wb.xlsx.load(nodeBuffer);
    console.log(`✅ Excel loaded successfully`);
  } catch (loadErr) {
    console.error(`❌ Excel load error:`, loadErr);
    console.error(`Buffer content (first 100 bytes):`, nodeBuffer.slice(0, 100));
    throw new Error(
      `Gagal membaca file Excel: ${loadErr.message}. ` +
      `Pastikan file format .xlsx (ExcelJS tidak mendukung .xls)`
    );
  }

  console.log(`📊 Total worksheets: ${wb.worksheets.length}`);
  console.log(`📊 Worksheet names: ${wb.worksheets.map(w => w.name).join(", ")}`);

  // ── Ambil sheet pertama yang valid ───────────────────────────────────────
  let ws = null;

  // Cara 1: direct access
  if (wb.worksheets.length > 0) {
    ws = wb.worksheets[0];
  }

  // Cara 2: eachSheet iterator (fallback)
  if (!ws) {
    wb.eachSheet((sheet) => {
      if (!ws) ws = sheet;
    });
  }

  // Cara 3: getWorksheet by index (fallback terakhir)
  if (!ws) {
    ws = wb.getWorksheet(1);
  }

  if (!ws) {
    throw new Error(
      `Sheet Excel tidak ditemukan. ` +
      `Total sheets terdeteksi: ${wb.worksheets.length}. ` +
      `Coba simpan ulang file Excel sebagai format .xlsx`
    );
  }

  console.log(`✅ Sheet: "${ws.name}" | Rows: ${ws.rowCount} | Cols: ${ws.columnCount}`);

  if (ws.rowCount < 3) {
    throw new Error(`Sheet terlalu sedikit baris (${ws.rowCount}). File mungkin kosong atau format salah`);
  }

  // ── Deteksi struktur sheet ───────────────────────────────────────────────
  const structure = detectSheetStructure(ws);

  if (!structure.monthYear) {
    // Dump 5 baris pertama untuk debug
    const debugRows = [];
    for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const cells = [];
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        cells.push(`[${colNum}]=${JSON.stringify(cell.value)}`);
      });
      debugRows.push(`Row ${r}: ${cells.join(", ")}`);
    }

    throw new Error(
      `Gagal mendeteksi bulan/tahun dari file Excel.\n` +
      `Pastikan ada cell berisi 'November 2025', '11/2025', atau '2025-11-01'.\n` +
      `Debug 5 baris pertama:\n${debugRows.join("\n")}`
    );
  }

  // ... sisa logic sama persis seperti sebelumnya
  const { year, month } = structure.monthYear;
  const { dataStartRow, dayStartCol, daysInRow } = structure;
  const daysInMonth = new Date(year, month, 0).getDate();
  const effectiveDays = daysInRow > 0 ? Math.min(daysInRow, daysInMonth) : daysInMonth;
  const monthStr = String(month).padStart(2, "0");

  console.log(`📅 ${month}/${year} | ${daysInMonth} hari`);
  console.log(`📐 dataStartRow=${dataStartRow}, dayStartCol=${dayStartCol}, days=${effectiveDays}`);


  // ── Ambil kode shift valid ───────────────────────────────────────────────
  const { data: shiftInfoData } = await supabase
    .from("shift_info")
    .select("kode, jam_masuk, jam_pulang, lintas_hari");

  const { data: infoJadwalData } = await supabase
    .from("informasi_jadwal")
    .select("kode");

  const validKodeShift = new Set([
    ...((shiftInfoData || []).map((s) => String(s.kode).trim())),
    ...((infoJadwalData || []).map((s) => String(s.kode).trim())),
  ]);

  const shiftInfoMap = {};
  for (const s of shiftInfoData || []) {
    shiftInfoMap[String(s.kode).trim()] = s;
  }

  console.log(`✅ Kode shift valid: ${validKodeShift.size} kode`);

  // ── Ambil data karyawan dari DB ──────────────────────────────────────────
  const { data: karyawanData } = await supabase
    .from("karyawan")
    .select("id_karyawan, nik, nama")
    .eq("kategori", kategori);

  const karyawanDict = {};
  for (const k of karyawanData || []) {
    karyawanDict[String(k.nik).trim()] = { id: k.id_karyawan, nama: k.nama };
  }

  console.log(`👥 Total ${kategori} di DB: ${Object.keys(karyawanDict).length}`);

  // ── Deteksi posisi kolom NIK & NAMA secara dinamis ──────────────────────
  // Cari di baris header (1 baris sebelum dataStartRow) kolom yang
  // mengandung "NIK", "ID ABSEN", atau "NAMA"
  let nikColIdx  = 2; // default: kolom B (ExcelJS 1-based)
  let namaColIdx = 3; // default: kolom C

  const headerRow = ws.getRow(dataStartRow - 1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
    const val = String(getCellVal(cell) ?? "").toUpperCase().trim();
    if (val.includes("NIK") || val.includes("ID ABSEN") || val.includes("NO ID")) {
      nikColIdx = colNum;
    }
    if (val.includes("NAMA")) {
      namaColIdx = colNum;
    }
  });

  // Juga cek 2 baris sebelum dataStartRow (karena kadang ada double header)
  if (dataStartRow > 2) {
    const headerRow2 = ws.getRow(dataStartRow - 2);
    headerRow2.eachCell({ includeEmpty: false }, (cell, colNum) => {
      const val = String(getCellVal(cell) ?? "").toUpperCase().trim();
      if (val.includes("NIK") || val.includes("ID ABSEN") || val.includes("NO ID")) {
        nikColIdx = colNum;
      }
      if (val.includes("NAMA")) {
        namaColIdx = colNum;
      }
    });
  }

  console.log(`📌 Kolom NIK: ${nikColIdx}, Kolom NAMA: ${namaColIdx}, Kolom hari-1: ${dayStartCol}`);

  // ── Tahap 1: Scan Excel — kumpulkan NIK valid ───────────────────────────
  const validNikInFile = [];
  const notFoundEmployees = [];
  const notFoundScheduleRows = [];
  const MAX_NOT_FOUND_DETAIL_ROWS = 2000;
  let notFoundScheduleRowsTruncatedCount = 0;

  for (let rowIdx = dataStartRow; rowIdx <= ws.rowCount; rowIdx++) {
    const row = ws.getRow(rowIdx);
    const nikRaw  = getCellVal(row.getCell(nikColIdx));
    const namaExcel = String(getCellVal(row.getCell(namaColIdx)) ?? "").trim();

    // Skip baris kosong (semua cell null)
    if (!nikRaw && !namaExcel) continue;

    const nik = normalizeNIK(nikRaw);
    let notFoundReason = "";

    if (!nik) {
      if (namaExcel) {
        notFoundReason = "NIK kosong";
        notFoundEmployees.push({ nik: "", nama: namaExcel, error: notFoundReason });
      }
    } else if (karyawanDict[nik]) {
      if (!validNikInFile.find((x) => x.nik === nik)) {
        validNikInFile.push({
          nik,
          id: karyawanDict[nik].id,
          nama: karyawanDict[nik].nama,
        });
      }
    } else {
      notFoundReason = "Karyawan tidak ditemukan di database";
      notFoundEmployees.push({
        nik,
        nama: namaExcel,
        error: notFoundReason,
      });
    }

    if (notFoundReason) {
      for (let d = 0; d < effectiveDays; d++) {
        const colIdx = dayStartCol + d;
        const rawKode = getCellVal(row.getCell(colIdx));
        if (!rawKode) continue;

        const kodeShift = String(rawKode).trim();
        if (!kodeShift) continue;

        if (notFoundScheduleRows.length < MAX_NOT_FOUND_DETAIL_ROWS) {
          const tanggal = `${year}-${monthStr}-${String(d + 1).padStart(2, "0")}`;
          notFoundScheduleRows.push({
            nik: nik || "",
            nama: namaExcel || "-",
            tanggal,
            kode_shift: kodeShift,
            error: notFoundReason,
          });
        } else {
          notFoundScheduleRowsTruncatedCount++;
        }
      }
    }
  }

  console.log(`📝 NIK valid di file: ${validNikInFile.length}`);

  if (validNikInFile.length === 0) {
    return {
      error: "Tidak ada karyawan valid di file upload",
      hint: `Pastikan kolom NIK (kolom ${nikColIdx}) berisi NIK yang terdaftar di database sebagai kategori '${kategori}'.`,
      not_found_employees: notFoundEmployees.slice(0, 20),
      invalid_codes: [],
      not_found_schedule_count: notFoundScheduleRows.length + notFoundScheduleRowsTruncatedCount,
      not_found_schedule_rows: notFoundScheduleRows,
      not_found_schedule_rows_truncated: notFoundScheduleRowsTruncatedCount,
    };
  }

  // ── Tahap 2: DELETE jadwal lama untuk NIK di file & bulan ini ───────────
  const affectedIds = validNikInFile.map((x) => x.id);
  const monthStart = `${year}-${monthStr}-01`;
  const monthEnd   = `${year}-${monthStr}-${String(daysInMonth).padStart(2, "0")}`;

  const { count: deletedRows } = await supabase
    .from("jadwal_karyawan")
    .delete({ count: "exact" })
    .in("id_karyawan", affectedIds)
    .gte("tanggal", monthStart)
    .lte("tanggal", monthEnd);

  console.log(`🗑️ Deleted ${deletedRows || 0} jadwal lama (${affectedIds.length} karyawan)`);

  // ── Tahap 3: INSERT jadwal baru (WITH shift_window calculation) ──────────
  const nikToId   = Object.fromEntries(validNikInFile.map((x) => [x.nik, x.id]));
  const nikToNama = Object.fromEntries(validNikInFile.map((x) => [x.nik, x.nama]));

  let insertedCount = 0;
  const invalidCodes = [];
  const batchInsert  = [];
  const BATCH_SIZE   = 1000;
  const SKIP_SHIFTS = new Set(["X", "CT", "CTB", "CTT", "OF1", "EO"]);

  console.log("⏳ Membaca data & menghitung shift window...");

  for (let rowIdx = dataStartRow; rowIdx <= ws.rowCount; rowIdx++) {
    const row    = ws.getRow(rowIdx);
    const nikRaw = getCellVal(row.getCell(nikColIdx));
    const nik    = normalizeNIK(nikRaw);

    if (!nik || !nikToId[nik]) continue;

    const idKaryawan = nikToId[nik];
    const nama       = nikToNama[nik];

    // Loop kolom hari: dayStartCol = kolom hari-1
    for (let d = 0; d < effectiveDays; d++) {
      const colIdx  = dayStartCol + d;
      const rawKode = getCellVal(row.getCell(colIdx));

      if (!rawKode) continue;

      const kodeShift = String(rawKode).trim();
      if (!kodeShift) continue;

      const day     = d + 1;
      const tanggal = `${year}-${monthStr}-${String(day).padStart(2, "0")}`;

      if (!validKodeShift.has(kodeShift)) {
        invalidCodes.push({ nik, nama, tanggal, kode_shift: kodeShift });
        continue;
      }

      // ✨ CALCULATE shift_window LANGSUNG saat build batch insert
      let shift_window_start = null;
      let shift_window_end = null;

      if (!SKIP_SHIFTS.has(kodeShift)) {
        // Hitung shift window untuk shift normal
        const si = shiftInfoMap[kodeShift];
        if (si) {
          const shiftWindow = computeShiftWindow(tanggal, kodeShift, si);
          shift_window_start = shiftWindow.shift_window_start;
          shift_window_end = shiftWindow.shift_window_end;
        }
      }

      batchInsert.push({
        id_karyawan: idKaryawan,
        nama,
        tanggal,
        kode_shift: kodeShift,
        shift_window_start,
        shift_window_end
      });
      insertedCount++;

      if (batchInsert.length >= BATCH_SIZE) {
        const chunk = batchInsert.splice(0, BATCH_SIZE);
        const { error: insErr } = await supabase.from("jadwal_karyawan").insert(chunk);
        if (insErr) {
          console.error("[BATCH INSERT]", insErr.message);
          throw insErr;
        }
        console.log(`💾 Batch insert: ${chunk.length} records (dengan shift window)`);
      }
    }
  }

  // Insert sisa
  if (batchInsert.length > 0) {
    const { error: insErr } = await supabase.from("jadwal_karyawan").insert(batchInsert);
    if (insErr) throw insErr;
    console.log(`💾 Final insert: ${batchInsert.length} records (dengan shift window)`);
  }

  console.log(`✅ Shift window dihitung untuk ${insertedCount} jadwal SAAT INSERT`);

  // ── Reset tabel croscek ──────────────────────────────────────────────────
  // Karyawan kategori ini yang tidak mendapat jadwal pada periode import
  const allKategoriEmployees = (karyawanData || []).map((k) => ({
    id_karyawan: k.id_karyawan,
    nik: k.nik ? String(k.nik).trim() : "",
    nama: k.nama || "",
  }));

  const scheduledEmployeeIds = new Set();
  const allEmployeeIds = allKategoriEmployees
    .map((k) => k.id_karyawan)
    .filter((id) => id !== null && id !== undefined);

  for (const idChunk of chunkArray(allEmployeeIds, DELETE_ID_CHUNK_SIZE)) {
    const { data: scheduledRows, error: scheduledErr } = await supabase
      .from("jadwal_karyawan")
      .select("id_karyawan")
      .in("id_karyawan", idChunk)
      .gte("tanggal", monthStart)
      .lte("tanggal", monthEnd);

    if (scheduledErr) throw scheduledErr;

    for (const row of scheduledRows || []) {
      if (row?.id_karyawan !== null && row?.id_karyawan !== undefined) {
        scheduledEmployeeIds.add(row.id_karyawan);
      }
    }
  }

  const employeesWithoutSchedule = allKategoriEmployees
    .filter((k) => !scheduledEmployeeIds.has(k.id_karyawan))
    .map((k) => ({ nik: k.nik, nama: k.nama }))
    .sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || ""), "id"));

  const tabelCroscek = kategori === "dw" ? "croscek_dw" : "croscek";
  await supabase.from(tabelCroscek).delete().gte("id", 0);

  console.log(`\n✅ SUMMARY ${kategori.toUpperCase()}:`);
  console.log(`   👤 Karyawan di file   : ${validNikInFile.length}`);
  console.log(`   🗑️  Jadwal dihapus     : ${deletedRows || 0}`);
  console.log(`   🆕 Jadwal diinsert    : ${insertedCount}`);
  console.log(`   ❌ Tidak ditemukan    : ${notFoundEmployees.length}`);
  console.log(`   ⚠️  Kode invalid      : ${invalidCodes.length}`);
  console.log(`   📭 Tanpa jadwal      : ${employeesWithoutSchedule.length}`);

  return {
    message: `Import selesai! ${insertedCount} jadwal untuk ${validNikInFile.length} ${kategori} berhasil disimpan (${month}/${year}).`,
    period: `${month}/${year}`,
    inserted_count: insertedCount,
    affected_employees: validNikInFile.length,
    deleted_count: deletedRows || 0,
    not_found_employees: notFoundEmployees,
    invalid_codes: invalidCodes,
    not_found_schedule_count: notFoundScheduleRows.length + notFoundScheduleRowsTruncatedCount,
    not_found_schedule_rows: notFoundScheduleRows,
    not_found_schedule_rows_truncated: notFoundScheduleRowsTruncatedCount,
    employees_without_schedule_count: employeesWithoutSchedule.length,
    employees_without_schedule: employeesWithoutSchedule,
  };
}

// =============================================
// GET /api/jadwal-karyawan/list
// =============================================
export async function getJadwalKaryawan(req, res) {
  try {
    const data = await fetchAllRowsInBatches((offset, batchSize) =>
      supabase
        .from("jadwal_karyawan")
        .select("no, tanggal, kode_shift, karyawan!inner(nik, nama, kategori)")
        .eq("karyawan.kategori", "karyawan")
        .order("no", { ascending: true })
        .range(offset, offset + batchSize - 1)
    );

    return res.json(
      (data || []).map((r) => ({
        no: r.no,
        nik: r.karyawan?.nik,
        nama: r.karyawan?.nama,
        tanggal: r.tanggal ? String(r.tanggal) : null,
        kode_shift: r.kode_shift,
      }))
    );
  } catch (e) {
    console.error("ERROR GET JADWAL KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// GET /api/jadwal-dw/list
// =============================================
export async function getJadwalDW(req, res) {
  try {
    const data = await fetchAllRowsInBatches((offset, batchSize) =>
      supabase
        .from("jadwal_karyawan")
        .select("no, tanggal, kode_shift, karyawan!inner(nik, nama, kategori)")
        .eq("karyawan.kategori", "dw")
        .order("no", { ascending: true })
        .range(offset, offset + batchSize - 1)
    );

    return res.json(
      (data || []).map((r) => ({
        no: r.no,
        nik: r.karyawan?.nik,
        nama: r.karyawan?.nama,
        tanggal: r.tanggal ? String(r.tanggal) : null,
        kode_shift: r.kode_shift,
      }))
    );
  } catch (e) {
    console.error("ERROR GET JADWAL DW:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// GET /api/informasi-jadwal/list
// =============================================
export async function getInformasiJadwal(req, res) {
  try {
    const { data, error } = await supabase
      .from("informasi_jadwal")
      .select("kode, lokasi_kerja, keterangan, jam_masuk, jam_pulang")
      .order("kode", { ascending: true });

    if (error) throw error;

    return res.json(
      (data || []).map((r) => ({
        kode_shift: r.kode,
        lokasi_kerja: r.lokasi_kerja || null,
        keterangan: r.keterangan,
        jam_masuk: r.jam_masuk || null,
        jam_pulang: r.jam_pulang || null,
      }))
    );
  } catch (e) {
    console.error("ERROR GET INFORMASI JADWAL:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// CREATE helper
// =============================================
async function createJadwalLogic(req, res, kategori) {
  try {
    const { nik, kode_shift, tanggal } = req.body;

    if (!nik)        return res.status(400).json({ error: "NIK tidak boleh kosong" });
    if (!kode_shift) return res.status(400).json({ error: "Kode shift tidak boleh kosong" });
    if (!tanggal)    return res.status(400).json({ error: "Tanggal tidak boleh kosong" });

    const { data: karyawan, error: kErr } = await supabase
      .from("karyawan")
      .select("id_karyawan, nama")
      .eq("nik", nik)
      .maybeSingle();

    if (kErr) throw kErr;
    if (!karyawan) {
      return res.status(404).json({ error: `Karyawan dengan NIK ${nik} tidak ditemukan` });
    }

    const { data: inserted, error: iErr } = await supabase
      .from("jadwal_karyawan")
      .insert({ id_karyawan: karyawan.id_karyawan, nama: karyawan.nama, tanggal, kode_shift })
      .select("no")
      .single();

    if (iErr) throw iErr;

    await updateShiftWindow(inserted.no);

    return res.status(201).json({ message: "Data jadwal karyawan berhasil ditambahkan" });
  } catch (e) {
    console.error(`ERROR CREATE JADWAL ${kategori.toUpperCase()}:`, e);
    return res.status(500).json({ error: e.message });
  }
}

export const createJadwalKaryawan = (req, res) => createJadwalLogic(req, res, "karyawan");
export const createJadwalDW       = (req, res) => createJadwalLogic(req, res, "dw");

// =============================================
// PUT /api/jadwal-karyawan/update/:no
// =============================================
export async function updateJadwalKaryawan(req, res) {
  try {
    const no = parseInt(req.params.no);
    if (isNaN(no)) return res.status(400).json({ error: "Parameter 'no' tidak valid" });

    const { nik, kode_shift, tanggal, kategori: kategoriBody } = req.body;
    if (!nik) return res.status(400).json({ error: "NIK tidak boleh kosong" });

    const { data: existing } = await supabase
      .from("jadwal_karyawan").select("no").eq("no", no).maybeSingle();
    if (!existing) return res.status(404).json({ error: "Data jadwal tidak ditemukan" });

    const { data: karyawan, error: kErr } = await supabase
      .from("karyawan").select("id_karyawan, nama, kategori").eq("nik", nik).maybeSingle();

    if (kErr) throw kErr;
    if (!karyawan) return res.status(404).json({ error: `Karyawan NIK ${nik} tidak ditemukan` });

    const kategoriNorm = (kategoriBody || karyawan.kategori || "karyawan").toUpperCase().trim();

    const { error: uErr } = await supabase
      .from("jadwal_karyawan")
      .update({ id_karyawan: karyawan.id_karyawan, nama: karyawan.nama, tanggal, kode_shift })
      .eq("no", no);
    if (uErr) throw uErr;

    await updateShiftWindow(no);

    // Reset croscek (TRUNCATE equivalent)
    const tabelCroscek = kategoriNorm === "DW" ? "croscek_dw" : "croscek";
    console.log(`[UPDATE JADWAL] RESET TABLE: ${tabelCroscek} | kategori=${kategoriNorm}`);
    await supabase.from(tabelCroscek).delete().gte("id", 0);

    return res.json({
      message: "Data jadwal karyawan berhasil diupdate",
      kategori: kategoriNorm,
      table_reset: tabelCroscek,
    });
  } catch (e) {
    console.error("ERROR UPDATE JADWAL KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// DELETE /api/jadwal-karyawan/delete/:no
// =============================================
export async function deleteJadwalKaryawan(req, res) {
  try {
    const no = parseInt(req.params.no);
    if (isNaN(no)) return res.status(400).json({ error: "Parameter 'no' tidak valid" });

    const { error } = await supabase.from("jadwal_karyawan").delete().eq("no", no);
    if (error) throw error;

    return res.json({ message: "Data jadwal karyawan berhasil dihapus" });
  } catch (e) {
    console.error("ERROR DELETE JADWAL KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// DELETE /api/jadwal-karyawan/delete-period
// =============================================
export async function deleteJadwalPeriodKaryawan(req, res) {
  try {
    const bulan = Number(req.body?.bulan);
    const tahun = Number(req.body?.tahun);

    if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12 || !Number.isInteger(tahun) || tahun < 1900) {
      return res.status(400).json({ error: "Bulan dan tahun tidak valid" });
    }

    const idList = await fetchKaryawanIdsByKategori("karyawan");
    if (idList.length === 0) {
      return res.json({
        message: `Tidak ada data karyawan untuk periode ${bulan}/${tahun}`,
        kategori: "karyawan",
        jadwal_deleted: 0,
        croscek_deleted: 0,
      });
    }

    const { startDate, endDate } = getPeriodDateRange(bulan, tahun);
    let deletedCount = 0;

    console.log(`[DELETE JADWAL PERIODE] Bulan: ${bulan}, Tahun: ${tahun}, Start: ${startDate}, End: ${endDate}`);

    // ===== Step 1: Delete jadwal_karyawan untuk periode =====
    for (const idChunk of chunkArray(idList, DELETE_ID_CHUNK_SIZE)) {
      const { count, error } = await supabase
        .from("jadwal_karyawan")
        .delete({ count: "exact" })
        .in("id_karyawan", idChunk)
        .gte("tanggal", startDate)
        .lte("tanggal", endDate);

      if (error) throw error;
      deletedCount += count || 0;
    }

    console.log(`[DELETE JADWAL PERIODE] Deleted ${deletedCount} jadwal_karyawan records`);

    // ===== Step 2: Delete croscek untuk periode yang sama (OPTIMIZED - bulk delete) =====
    console.log(`[DELETE CROSCEK PERIODE] Starting bulk delete for period ${startDate} - ${endDate}...`);
    
    let croscekDeletedCount = 0;
    try {
      // OPTIMIZED: Single bulk delete query dengan date range filter
      // Jauh lebih cepat daripada delete per-row dalam loop
      const { count: deleteCount, error: deleteErr } = await supabase
        .from("croscek")
        .delete({ count: "exact" })
        .gte("Tanggal", startDate)
        .lte("Tanggal", endDate);

      if (deleteErr) throw deleteErr;

      croscekDeletedCount = deleteCount || 0;
      console.log(`[DELETE CROSCEK PERIODE] Bulk deleted: ${croscekDeletedCount} records from croscek`);
    } catch (err) {
      console.error(`[DELETE CROSCEK PERIODE] Error during bulk delete:`, err.message);
      throw err;
    }

    return res.json({
      message: `Berhasil hapus jadwal & croscek KARYAWAN periode ${bulan}/${tahun}`,
      kategori: "karyawan",
      jadwal_deleted: deletedCount,
      croscek_deleted: croscekDeletedCount,
      details: {
        period: `${bulan}/${tahun}`,
        date_range: `${startDate} - ${endDate}`,
      },
    });
  } catch (e) {
    console.error("ERROR DELETE PERIODE JADWAL KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// POST /api/jadwal-karyawan/clear
// =============================================
export async function clearJadwalKaryawan(req, res) {
  try {
    console.log(">>> ROUTE CLEAR JADWAL KARYAWAN DIPANGGIL <<<");
    const idList = await fetchKaryawanIdsByKategori("karyawan");

    if (idList.length > 0) {
      for (const idChunk of chunkArray(idList, DELETE_ID_CHUNK_SIZE)) {
        const { error } = await supabase
          .from("jadwal_karyawan")
          .delete()
          .in("id_karyawan", idChunk);
        if (error) throw error;
      }
    }
    return res.json({ message: "Semua jadwal karyawan berhasil dihapus", status: "success" });
  } catch (e) {
    console.error("ERROR CLEAR JADWAL KARYAWAN:", e);
    return res.status(500).json({ error: e.message, status: "failed" });
  }
}

// =============================================
// POST /api/jadwal-dw/clear
// =============================================
export async function clearJadwalDW(req, res) {
  try {
    console.log(">>> ROUTE CLEAR JADWAL DW DIPANGGIL <<<");
    const idList = await fetchKaryawanIdsByKategori("dw");

    if (idList.length > 0) {
      for (const idChunk of chunkArray(idList, DELETE_ID_CHUNK_SIZE)) {
        const { error } = await supabase
          .from("jadwal_karyawan")
          .delete()
          .in("id_karyawan", idChunk);
        if (error) throw error;
      }
    }
    return res.json({ message: "Semua jadwal DW berhasil dihapus", status: "success" });
  } catch (e) {
    console.error("ERROR CLEAR JADWAL DW:", e);
    return res.status(500).json({ error: e.message, status: "failed" });
  }
}

// =============================================
// POST /api/import-jadwal-karyawan
// =============================================
export async function importJadwalKaryawan(req, res) {
  try {
    console.log("🔍 importJadwalKaryawan called");
    console.log(`📄 req.file exists: ${!!req.file}`);
    
    if (!req.file) {
      console.error("❌ No file in request");
      return res.status(400).json({ error: "File tidak ditemukan" });
    }
    
    console.log(`📄 File info:`, {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      encoding: req.file.encoding,
      mimetype: req.file.mimetype,
      size: req.file.size,
      bufferLength: req.file.buffer ? req.file.buffer.length : 0,
      bufferType: typeof req.file.buffer
    });

    if (req.file.size === 0) {
      console.error("❌ File size is 0");
      return res.status(400).json({ error: "File kosong" });
    }

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
      console.warn(`⚠️ File extension warning: ${req.file.originalname}`);
      return res.status(400).json({ 
        error: 'Format file tidak didukung! Hanya .xlsx yang diterima.',
        supportedFormat: '.xlsx'
      });
    }

    const result = await importJadwalLogic(req.file.buffer, "karyawan");
    if (result.error) {
      console.error("❌ Import logic error:", result.error);
      return res.status(400).json(result);
    }
    console.log("✅ Import successful");
    return res.json(result);
  } catch (e) {
    console.error("❌ ERROR IMPORT JADWAL KARYAWAN:", e);
    console.error("Stack:", e.stack);
    return res.status(500).json({ error: e.message, stack: process.env.NODE_ENV === 'development' ? e.stack : undefined });
  }
}

// =============================================
// POST /api/import-jadwal-dw
// =============================================
export async function importJadwalDW(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });
    if (req.file.size === 0) return res.status(400).json({ error: "File kosong" });

    const result = await importJadwalLogic(req.file.buffer, "dw");
    if (result.error) return res.status(400).json(result);
    return res.json(result);
  } catch (e) {
    console.error("ERROR IMPORT JADWAL DW:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// NEW: Import Jadwal dengan Smart NIK/id_absen Matching
// Excel columns: IDENTIFIER (NIK/id_absen), Tanggal, Kode
// =============================================
async function parseExcelJadwalSmartMatch(buffer) {
  console.log("📄 Parsing Excel jadwal (smart match)...");
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

  // Kolom wajib: identifier (NIK/id_absen), Tanggal, Kode
  const required = ["Tanggal", "Kode"];
  const presentHeaders = Object.values(headers);
  
  // Cari kolom identifier (bisa dari NIK, ID ABSEN, atau identifier lain)
  let identifierColNum = null;
  for (const [colNum, colName] of Object.entries(headers)) {
    const upper = colName.toUpperCase();
    if (upper.includes("NIK") || upper.includes("ID ABSEN") || upper.includes("IDENTIFIER") || upper.includes("ID") || upper.includes("NO ID")) {
      identifierColNum = parseInt(colNum);
      break;
    }
  }

  if (!identifierColNum) {
    throw new Error("Kolom identifier (NIK/ID ABSEN) tidak ditemukan di Excel");
  }

  const missingHeaders = required.filter(req => !presentHeaders.includes(req));
  if (missingHeaders.length > 0) {
    throw new Error(`Kolom tidak ditemukan: ${missingHeaders.join(", ")}`);
  }

  // Build col number → header name map
  const colMap = Object.fromEntries(Object.entries(headers).map(([k, v]) => [v, parseInt(k)]));
  colMap["IDENTIFIER"] = identifierColNum;

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
    if (!obj["IDENTIFIER"] && !obj["Tanggal"]) {
      emptyRowCount++;
      if (emptyRowCount > 5) break;
      continue;
    }
    emptyRowCount = 0;
    rows.push(obj);
  }

  console.log(`✅ Parsed ${rows.length} rows dari Excel`);
  return rows;
}

// Smart matching: NIK atau id_absen (id_karyawan bisa darikedua, ambil data lengkap)
async function importJadwalSmartMatchLogic(buffer, kategori) {
  try {
    if (!buffer || buffer.length === 0) {
      throw new Error("Buffer file kosong");
    }

    // Parse Excel
    const rows = await parseExcelJadwalSmartMatch(buffer);
    if (!rows || rows.length === 0) {
      throw new Error("Tidak ada data di Excel");
    }

    console.log(`✅ Total rows: ${rows.length}`);

    // Detect periods dari tanggal
    let periodMonths = new Set();
    for (const row of rows) {
      const dt = parseExcelDateJadwal(row["Tanggal"]);
      if (dt) {
        const yr = dt.getFullYear();
        const mo = String(dt.getMonth() + 1).padStart(2, "0");
        periodMonths.add(`${yr}-${mo}`);
      }
    }
    console.log(`📅 Detected ${periodMonths.size} period(s): ${Array.from(periodMonths).join(", ")}`);

    if (periodMonths.size === 0) {
      return {
        error: "Tidak ada data dengan tanggal valid di Excel",
        message: "Periksa format tanggal di kolom 'Tanggal' (format DD-MM-YYYY)"
      };
    }

    // Load data: karyawan & shift info
    console.log("👥 Loading karyawan data...");
    const [karyawanRes, shiftRes] = await Promise.all([
      supabase.from("karyawan").select("id_karyawan, nik, id_absen, nama, jabatan, departemen, kategori"),
      supabase.from("informasi_jadwal").select("kode")
    ]);

    const karyawanAll = karyawanRes.data || [];
    const shiftCodeSet = new Set((shiftRes.data || []).map(s => String(s.kode).trim()));

    // Build lookup maps: NIK → karyawan dan id_absen → karyawan
    const byNik = {};
    const byIdAbsen = {};
    for (const k of karyawanAll) {
      if (k.kategori === kategori) {
        if (k.nik) byNik[String(k.nik).trim()] = k;
        if (k.id_absen) byIdAbsen[String(k.id_absen).trim()] = k;
      }
    }
    console.log(`✅ Loaded ${Object.keys(byNik).length} ${kategori} by NIK, ${Object.keys(byIdAbsen).length} by id_absen`);
    
    // Show sample mappings
    if (Object.keys(byNik).length > 0) {
      console.log(`   📍 Sample NIK mappings:`);
      const sampleNiks = Object.entries(byNik).slice(0, 2);
      for (const [nik, k] of sampleNiks) {
        console.log(`       NIK ${nik} → id_karyawan ${k.id_karyawan} (${k.nama})`);
      }
    }
    if (Object.keys(byIdAbsen).length > 0) {
      console.log(`   📍 Sample id_absen mappings:`);
      const sampleAbs = Object.entries(byIdAbsen).slice(0, 2);
      for (const [abs, k] of sampleAbs) {
        console.log(`       id_absen ${abs} → id_karyawan ${k.id_karyawan} (${k.nama})`);
      }
    }

    // Counters
    let insertedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;
    let invalidDateCount = 0;
    let invalidShiftCount = 0;
    const notFoundList = [];
    const invalidShiftList = [];
    const skippedData = [];
    const insertedData = [];
    const batchInsert = [];
    const BATCH_SIZE = 3000;

    console.log("⏳ Processing jadwal data...");

    // Process setiap row
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      const identifier = String(row["IDENTIFIER"] || "").trim();
      const tanggalRaw = row["Tanggal"];
      const kodeRaw = String(row["Kode"] || "").trim();

      // Validasi tanggal
      const tanggal = parseExcelDateJadwal(tanggalRaw);
      if (!tanggal) {
        invalidDateCount++;
        skippedCount++;
        continue;
      }

      const tanggalStr = tanggal.toISOString().split("T")[0];

      // Validasi shift code
      if (!kodeRaw) {
        invalidShiftCount++;
        skippedCount++;
        continue;
      }

      if (!shiftCodeSet.has(kodeRaw)) {
        invalidShiftList.push({
          identifier,
          tanggal: tanggalStr,
          kode: kodeRaw,
          reason: "Kode shift tidak valid"
        });
        invalidShiftCount++;
        skippedCount++;
        continue;
      }

      // Smart matching: cek NIK dulu, jika tidak cocok cek id_absen
      let karyawan = null;
      let matchType = null;

      if (byNik[identifier]) {
        karyawan = byNik[identifier];
        matchType = "NIK";
      } else if (byIdAbsen[identifier]) {
        karyawan = byIdAbsen[identifier];
        matchType = "id_absen";
      }

      if (!karyawan) {
        notFoundList.push({
          identifier,
          tanggal: tanggalStr,
          kode: kodeRaw,
          reason: "Identifier (NIK/id_absen) tidak ditemukan"
        });
        notFoundCount++;
        skippedCount++;
        continue;
      }

      // Extract data lengkap dari database
      const {
        id_karyawan: idKaryawan,
        nama,
        jabatan,
        departemen
      } = karyawan;

      // Add to batch dengan data lengkap
      batchInsert.push({
        id_karyawan: idKaryawan,
        tanggal: tanggalStr,
        kode_shift: kodeRaw,
        nama: nama || null,
        jabatan: jabatan || null,
        departemen: departemen || null
      });
      insertedCount++;

      // Track inserted (limit 100 untuk response) - INCLUDE MATCHING INFO
      if (insertedData.length < 100) {
        insertedData.push({
          identifier: identifier,
          match_type: matchType,
          id_karyawan: idKaryawan,
          nama: nama,
          jabatan: jabatan,
          departemen: departemen,
          tanggal: tanggalStr,
          kode: kodeRaw
        });
      }

      // Flush batch
      if (batchInsert.length >= BATCH_SIZE) {
        const { error: insErr } = await supabase
          .from("jadwal_karyawan")
          .insert(batchInsert);
        if (insErr) {
          console.error("⚠️ Batch insert error:", insErr.message);
        } else {
          console.log(`💾 Batch inserted: ${batchInsert.length} records`);
        }
        batchInsert.length = 0;
      }
    }

    // Final batch
    if (batchInsert.length > 0) {
      const { error: insErr } = await supabase
        .from("jadwal_karyawan")
        .insert(batchInsert);
      if (insErr) {
        console.error("⚠️ Final batch error:", insErr.message);
      } else {
        console.log(`💾 Final batch: ${batchInsert.length} records`);
      }
    }

    // Reset croscek
    const tabelCroscek = kategori === "dw" ? "croscek_dw" : "croscek";
    await supabase.from(tabelCroscek).delete().gte("id", 0);
    console.log("🔄 Croscek table reset");

    console.log(`\n✅ SUMMARY JADWAL SMART MATCH (${kategori}):`);
    console.log(`   📊 Total rows: ${rows.length}`);
    console.log(`   ✅ Inserted: ${insertedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`       ├─ ❌ Identifier not found: ${notFoundCount}`);
    console.log(`       ├─ ⚠️  Invalid shift: ${invalidShiftCount}`);
    console.log(`       └─ ⚠️  Invalid date: ${invalidDateCount}`);
    
    // Show matching summary
    if (insertedData.length > 0) {
      console.log(`\n   📍 Match Type Distribution:`);
      const nikCount = insertedData.filter(r => r.match_type === "NIK").length;
      const absCount = insertedData.filter(r => r.match_type === "id_absen").length;
      if (nikCount > 0) console.log(`       ├─ NIK matched: ${nikCount}`);
      if (absCount > 0) console.log(`       └─ id_absen matched: ${absCount}`);
    }

    return {
      message: `✅ Import successful! ${insertedCount} jadwal records saved (${Object.keys(byNik).length} NIK + ${Object.keys(byIdAbsen).length} id_absen in database), ${skippedCount} skipped`,
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      not_found_count: notFoundCount,
      invalid_shift_count: invalidShiftCount,
      invalid_date_count: invalidDateCount,
      database_nik_count: Object.keys(byNik).length,
      database_idabsen_count: Object.keys(byIdAbsen).length,
      not_found_samples: notFoundList.slice(0, 10),
      invalid_shift_samples: invalidShiftList.slice(0, 10),
      inserted_data: insertedData,
      skipped_data: skippedData,
      category: kategori,
      period: Array.from(periodMonths).join(", ")
    };
  } catch (e) {
    console.error("❌ IMPORT JADWAL SMART MATCH ERROR:", e);
    throw e;
  }
}

// =============================================
// POST /api/import-jadwal-karyawan-smartmatch
// Import jadwal dengan NIK/id_absen smart matching (NEW)
// =============================================
export async function importJadwalKaryawanSmartMatch(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });
    if (req.file.size === 0) return res.status(400).json({ error: "File kosong" });

    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx')) {
      return res.status(400).json({ 
        error: 'Format file tidak didukung! Hanya .xlsx yang diterima.',
        supportedFormat: '.xlsx'
      });
    }

    const result = await importJadwalSmartMatchLogic(req.file.buffer, "karyawan");
    return res.json(result);
  } catch (e) {
    console.error("❌ ERROR IMPORT JADWAL KARYAWAN SMART MATCH:", e);
    return res.status(500).json({ 
      error: e.message,
      details: e.details || e.hint
    });
  }
}

// =============================================
// POST /api/import-jadwal-dw-smartmatch
// Import jadwal DW dengan NIK/id_absen smart matching (NEW)
// =============================================
export async function importJadwalDWSmartMatch(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });
    if (req.file.size === 0) return res.status(400).json({ error: "File kosong" });

    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx')) {
      return res.status(400).json({ 
        error: 'Format file tidak didukung! Hanya .xlsx yang diterima.',
        supportedFormat: '.xlsx'
      });
    }

    const result = await importJadwalSmartMatchLogic(req.file.buffer, "dw");
    return res.json(result);
  } catch (e) {
    console.error("❌ ERROR IMPORT JADWAL DW SMART MATCH:", e);
    return res.status(500).json({ 
      error: e.message,
      details: e.details || e.hint
    });
  }
}

// =============================================
// NEW: Import Jadwal dengan PIN Matching (seperti kehadiran)
// Excel columns: PIN/NIP/Nama, Tanggal, Kode Shift
// =============================================
async function parseExcelJadwal(buffer) {
  console.log("📄 Parsing Excel jadwal...");
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

  const required = ["PIN", "Tanggal", "Kode"];
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
    if (!obj["PIN"] && !obj["Tanggal"]) {
      emptyRowCount++;
      if (emptyRowCount > 5) break; // Stop jika 5+ baris kosong berturut-turut
      continue;
    }
    emptyRowCount = 0;
    rows.push(obj);
  }

  console.log(`✅ Parsed ${rows.length} rows dari Excel`);
  return rows;
}

// Helper: Parse date dari Excel (DD-MM-YYYY format seperti kehadiran)
function parseExcelDateJadwal(rawValue) {
  if (!rawValue) return null;
  
  // Jika Date object dari Excel
  if (rawValue instanceof Date) {
    return rawValue;
  }

  const str = String(rawValue).trim();
  
  // Extract date part: "02-03-2026" dari "02-03-2026 07:35:34" (jika ada waktu)
  const datePart = str.split(" ")[0];
  
  // Pattern: DD-MM-YYYY atau DD/MM/YYYY
  const ddmmyyMatch = datePart.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (ddmmyyMatch) {
    let day = parseInt(ddmmyyMatch[1]);
    let month = parseInt(ddmmyyMatch[2]);
    const year = parseInt(ddmmyyMatch[3]);
    
    // Validasi dasar: day 1-31, month 1-12
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(year, month - 1, day);
    }
    
    // Smart detection: Jika day > 12 dan month <= 12 → pasti DD-MM-YYYY, keep as-is
    // Jika month > 12 dan day <= 12 → swap them
    if (month > 12 && day <= 12) {
      [day, month] = [month, day];
      return new Date(year, month - 1, day);
    }
  }
  
  // Try ISO format
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, yr, mo, dy] = isoMatch.map(Number);
    return new Date(yr, mo - 1, dy);
  }
  
  // Fallback ke native Date parsing
  const dt = new Date(str);
  if (!isNaN(dt.getTime())) {
    return dt;
  }
  
  return null;
}

// Main import logic dengan PIN matching
async function importJadwalPinLogic(buffer, kategori) {
  try {
    if (!buffer || buffer.length === 0) {
      throw new Error("Buffer file kosong");
    }

    // Parse Excel
    const rows = await parseExcelJadwal(buffer);
    if (!rows || rows.length === 0) {
      throw new Error("Tidak ada data di Excel");
    }

    console.log(`✅ Total rows: ${rows.length}`);

    // Detect periods dari tanggal
    let periodMonths = new Set();
    for (const row of rows) {
      const dt = parseExcelDateJadwal(row["Tanggal"]);
      if (dt) {
        const yr = dt.getFullYear();
        const mo = String(dt.getMonth() + 1).padStart(2, "0");
        periodMonths.add(`${yr}-${mo}`);
      }
    }
    console.log(`📅 Detected ${periodMonths.size} period(s): ${Array.from(periodMonths).join(", ")}`);

    if (periodMonths.size === 0) {
      return {
        error: "Tidak ada data dengan tanggal valid di Excel",
        message: "Periksa format tanggal di kolom 'Tanggal' (format DD-MM-YYYY)"
      };
    }

    // Load data: karyawan & shift info
    console.log("👥 Loading karyawan data...");
    const [karyawanRes, shiftRes] = await Promise.all([
      supabase.from("karyawan").select("id_karyawan, id_absen, nama, kategori"),
      supabase.from("informasi_jadwal").select("kode")
    ]);

    const karyawanAll = karyawanRes.data || [];
    const shiftCodeSet = new Set((shiftRes.data || []).map(s => String(s.kode).trim()));

    // Build lookup maps: PIN → id_karyawan
    const byPin = {};
    const pinToKaryawan = {}; // For debugging: PIN → {id_karyawan, nama}
    for (const k of karyawanAll) {
      if (k.id_absen && k.kategori === kategori) {
        const pinStr = String(k.id_absen).trim();
        byPin[pinStr] = k.id_karyawan;
        pinToKaryawan[pinStr] = { id_karyawan: k.id_karyawan, nama: k.nama };
      }
    }
    console.log(`✅ Loaded ${Object.keys(byPin).length} ${kategori} by PIN (id_absen)`);
    
    // Show sample PIN mappings for verification
    if (Object.keys(pinToKaryawan).length > 0) {
      console.log(`   📍 Sample PIN mappings (for verification):`);
      const samplePins = Object.entries(pinToKaryawan).slice(0, 3);
      for (const [pin, info] of samplePins) {
        console.log(`       PIN ${pin} → id_karyawan ${info.id_karyawan} (${info.nama})`);
      }
    }

    // Counters
    let insertedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;
    let invalidDateCount = 0;
    let invalidShiftCount = 0;
    const notFoundList = [];
    const invalidShiftList = [];
    const skippedData = [];
    const insertedData = [];
    const batchInsert = [];
    const BATCH_SIZE = 3000;

    console.log("⏳ Processing jadwal data...");

    // Process setiap row
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      const pin = String(row["PIN"] || "").trim();
      const tanggalRaw = row["Tanggal"];
      const kodeRaw = String(row["Kode"] || "").trim();

      // Validasi tanggal
      const tanggal = parseExcelDateJadwal(tanggalRaw);
      if (!tanggal) {
        invalidDateCount++;
        skippedCount++;
        continue;
      }

      const tanggalStr = tanggal.toISOString().split("T")[0];

      // Validasi shift code
      if (!kodeRaw) {
        invalidShiftCount++;
        skippedCount++;
        continue;
      }

      if (!shiftCodeSet.has(kodeRaw)) {
        invalidShiftList.push({
          pin,
          tanggal: tanggalStr,
          kode: kodeRaw,
          reason: "Kode shift tidak valid"
        });
        invalidShiftCount++;
        skippedCount++;
        continue;
      }

      // Match PIN → karyawan
      const idKaryawan = byPin[pin];
      if (!idKaryawan) {
        notFoundList.push({
          pin,
          tanggal: tanggalStr,
          kode: kodeRaw,
          reason: "PIN tidak ditemukan"
        });
        notFoundCount++;
        skippedCount++;
        continue;
      }

      // Add to batch
      batchInsert.push({
        id_karyawan: idKaryawan,
        tanggal: tanggalStr,
        kode_shift: kodeRaw
      });
      insertedCount++;

      // Track inserted (limit 100 untuk response) - INCLUDE PIN MAPPING INFO
      if (insertedData.length < 100) {
        insertedData.push({
          pin: pin,                    // Original PIN from Excel
          id_karyawan: idKaryawan,      // Matched ID (untuk verification)
          tanggal: tanggalStr,
          kode: kodeRaw
        });
      }

      // Flush batch
      if (batchInsert.length >= BATCH_SIZE) {
        const { error: insErr } = await supabase
          .from("jadwal_karyawan")
          .insert(batchInsert);
        if (insErr) {
          console.error("⚠️ Batch insert error:", insErr.message);
        } else {
          console.log(`💾 Batch inserted: ${batchInsert.length} records`);
        }
        batchInsert.length = 0;
      }
    }

    // Final batch
    if (batchInsert.length > 0) {
      const { error: insErr } = await supabase
        .from("jadwal_karyawan")
        .insert(batchInsert);
      if (insErr) {
        console.error("⚠️ Final batch error:", insErr.message);
      } else {
        console.log(`💾 Final batch: ${batchInsert.length} records`);
      }
    }

    // Reset croscek
    const tabelCroscek = kategori === "dw" ? "croscek_dw" : "croscek";
    await supabase.from(tabelCroscek).delete().gte("id", 0);
    console.log("🔄 Croscek table reset");

    console.log(`\n✅ SUMMARY JADWAL (${kategori}):`);
    console.log(`   📊 Total rows: ${rows.length}`);
    console.log(`   ✅ Inserted: ${insertedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`       ├─ ❌ PIN not found: ${notFoundCount}`);
    console.log(`       ├─ ⚠️  Invalid shift: ${invalidShiftCount}`);
    console.log(`       └─ ⚠️  Invalid date: ${invalidDateCount}`);
    
    // Show PIN mapping verification
    if (insertedData.length > 0) {
      console.log(`\n   📍 PIN → id_karyawan Mapping (verification):`);
      const uniquePins = {};
      for (const rec of insertedData) {
        if (!uniquePins[rec.pin]) {
          uniquePins[rec.pin] = rec.id_karyawan;
        }
      }
      for (const [pin, idKary] of Object.entries(uniquePins).slice(0, 5)) {
        console.log(`       PIN ${pin} → id_karyawan ${idKary}`);
      }
    }

    return {
      message: `✅ Import successful! ${insertedCount} jadwal records saved (${Object.keys(byPin).length} unique PINs from database), ${skippedCount} skipped`,
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      not_found_count: notFoundCount,
      invalid_shift_count: invalidShiftCount,
      invalid_date_count: invalidDateCount,
      database_pin_count: Object.keys(byPin).length,
      not_found_samples: notFoundList.slice(0, 10),
      invalid_shift_samples: invalidShiftList.slice(0, 10),
      inserted_data: insertedData,
      skipped_data: skippedData,
      category: kategori,
      period: Array.from(periodMonths).join(", ")
    };
  } catch (e) {
    console.error("❌ IMPORT JADWAL ERROR:", e);
    throw e;
  }
}

// =============================================
// POST /api/import-jadwal-karyawan-pin
// Import jadwal dengan PIN matching (NEW)
// =============================================
export async function importJadwalKaryawanPin(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });
    if (req.file.size === 0) return res.status(400).json({ error: "File kosong" });

    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx')) {
      return res.status(400).json({ 
        error: 'Format file tidak didukung! Hanya .xlsx yang diterima.',
        supportedFormat: '.xlsx'
      });
    }

    const result = await importJadwalPinLogic(req.file.buffer, "karyawan");
    return res.json(result);
  } catch (e) {
    console.error("❌ ERROR IMPORT JADWAL KARYAWAN PIN:", e);
    return res.status(500).json({ 
      error: e.message,
      details: e.details || e.hint
    });
  }
}

// =============================================
// POST /api/import-jadwal-dw-pin
// Import jadwal DW dengan PIN matching (NEW)
// =============================================
export async function importJadwalDWPin(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });
    if (req.file.size === 0) return res.status(400).json({ error: "File kosong" });

    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx')) {
      return res.status(400).json({ 
        error: 'Format file tidak didukung! Hanya .xlsx yang diterima.',
        supportedFormat: '.xlsx'
      });
    }

    const result = await importJadwalPinLogic(req.file.buffer, "dw");
    return res.json(result);
  } catch (e) {
    console.error("❌ ERROR IMPORT JADWAL DW PIN:", e);
    return res.status(500).json({ 
      error: e.message,
      details: e.details || e.hint
    });
  }
}
