import { supabase } from "../config/supabase.js";
import ExcelJS from "exceljs";

// =============================================
// HELPER: Count total rows dari table dengan batch (handle 1000 limit)
// =============================================
async function countTotalRows(tableName) {
  try {
    let totalCount = 0;
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from(tableName)
        .select("*", { count: "exact", head: true })
        .range(offset, offset + batchSize - 1);

      if (error) throw error;

      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        totalCount += data.length;
        if (data.length < batchSize) {
          hasMore = false;
        }
        offset += batchSize;
      }
    }

    return totalCount;
  } catch (e) {
    console.error(`[COUNT TOTAL] Error counting ${tableName}:`, e.message);
    return 0;
  }
}

// =============================================
// HELPER: Delete semua data croscek dengan batch jika jumlah jadwal_karyawan sama
// =============================================
async function deleteAllCroscekIfMatching(jadwalKaryawanCount) {
  try {
    console.log("[CROSCEK COMPARE] Starting comparison...");
    
    // Count total rows di croscek (dengan batch)
    let croscekCount = 0;
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("croscek")
        .select("*", { count: "exact", head: true })
        .range(offset, offset + batchSize - 1);

      if (error) throw error;

      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        croscekCount += data.length;
        if (data.length < batchSize) {
          hasMore = false;
        }
        offset += batchSize;
      }
    }

    console.log(
      `[CROSCEK COMPARE] jadwal_karyawan count: ${jadwalKaryawanCount}, croscek count: ${croscekCount}`
    );

    // Compare: jika jumlah sama → hapus semua croscek
    if (jadwalKaryawanCount === croscekCount) {
      console.log(
        `[CROSCEK COMPARE] Counts match! Deleting all croscek data...`
      );

      // OPTIMIZED: Single bulk delete query (much faster than per-row loop)
      const { count: totalDeleted, error: deleteErr } = await supabase
        .from("croscek")
        .delete({ count: "exact" });

      if (deleteErr) throw deleteErr;

      console.log(`[CROSCEK DELETE] Successfully deleted ${totalDeleted} rows from croscek in ONE query`);
      return {
        action: "deleted",
        message: `✅ Croscek data DIHAPUS! (Jumlah data sama: ${jadwalKaryawanCount} records)`,
        deleted_count: totalDeleted,
      };
    } else {
      console.log(
        `[CROSCEK COMPARE] Counts DO NOT match! Preserving croscek data.`
      );
      return {
        action: "preserved",
        message: `⚠️ Croscek data DIPERTAHANKAN! (jadwal_karyawan: ${jadwalKaryawanCount}, croscek: ${croscekCount} → TIDAK SAMA)`,
        jadwal_count: jadwalKaryawanCount,
        croscek_count: croscekCount,
      };
    }
  } catch (e) {
    console.error("[CROSCEK DELETE ERROR]:", e.message);
    return {
      action: "error",
      message: `❌ Error pada penghapusan croscek: ${e.message}`,
    };
  }
}

// =============================================
// HELPER: Ekstrak nilai mentah dari cell ExcelJS
// =============================================
function getCellValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.richText) {
    return v.richText.map((r) => r.text).join("");
  }
  if (typeof v === "object" && v.result !== undefined) {
    return v.result;
  }
  return v;
}

// =============================================
// HELPER: Normalisasi format TIME → "HH:MM:SS"
// =============================================
function normalizeTime(t) {
  if (t === null || t === undefined) return null;

  // Jika ExcelJS return Date object (karena kolom TIME di Excel)
  if (t instanceof Date) {
    const hh = String(t.getUTCHours()).padStart(2, "0");
    const mm = String(t.getUTCMinutes()).padStart(2, "0");
    const ss = String(t.getUTCSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  // Jika number (Excel serial fraction — misal 0.354 = 08:30)
  if (typeof t === "number") {
    const totalSeconds = Math.round(t * 86400);
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  // Jika string
  const s = String(t).trim();
  if (!s) return null;

  // Format "HH:MM" → tambah ":00"
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    return s.padStart(5, "0") + ":00";
  }

  // Format "HH:MM:SS" atau lebih → ambil 8 char pertama
  if (/^\d{1,2}:\d{2}:\d{2}/.test(s)) {
    const parts = s.split(":");
    return `${parts[0].padStart(2,"0")}:${parts[1].padStart(2,"0")}:${parts[2].slice(0,2).padStart(2,"0")}`;
  }

  return null;
}

// =============================================
// HELPER: Deteksi lintas hari (migrasi dari Python)
// =============================================
function detectLintasHari(kode, jamMasuk, jamPulang) {
  if (!jamMasuk || !jamPulang) return 0;

  // Rule khusus shift malam
  if (String(kode).toUpperCase() === "3A") return 1;

  // Rule umum: pulang <= masuk → lintas hari
  return jamPulang <= jamMasuk ? 1 : 0;
}

// =============================================
// HELPER: Sync shift_info dari informasi_jadwal
// =============================================
async function syncShiftInfo() {
  try {
    const { data: rows, error } = await supabase
      .from("informasi_jadwal")
      .select("kode, jam_masuk, jam_pulang")
      .not("jam_masuk", "is", null)
      .not("jam_pulang", "is", null);

    if (error) throw error;

    for (const r of rows) {
      const lintas = detectLintasHari(r.kode, r.jam_masuk, r.jam_pulang);

      const { error: upsertErr } = await supabase
        .from("shift_info")
        .upsert(
          {
            kode: r.kode,
            jam_masuk: r.jam_masuk,
            jam_pulang: r.jam_pulang,
            lintas_hari: lintas,
          },
          { onConflict: "kode" }
        );

      if (upsertErr) throw upsertErr;
    }

    console.log("[SYNC shift_info] selesai & valid");
  } catch (e) {
    console.error("[SHIFT SYNC ERROR]:", e.message);
  }
}

// =============================================
// HELPER: Sync satu shift berdasarkan kode
// =============================================
async function syncSingleShift(kode) {
  try {
    const { data: r, error } = await supabase
      .from("informasi_jadwal")
      .select("kode, jam_masuk, jam_pulang")
      .eq("kode", kode)
      .maybeSingle();

    if (error) throw error;
    if (!r) return;

    const lintas = detectLintasHari(r.kode, r.jam_masuk, r.jam_pulang);

    const { error: upsertErr } = await supabase
      .from("shift_info")
      .upsert(
        {
          kode: r.kode,
          jam_masuk: r.jam_masuk,
          jam_pulang: r.jam_pulang,
          lintas_hari: lintas,
        },
        { onConflict: "kode" }
      );

    if (upsertErr) throw upsertErr;

    console.log(`[SYNC SINGLE] Shift ${kode} valid`);
  } catch (e) {
    console.error("[SYNC SINGLE SHIFT ERROR]:", e.message);
  }
}

// =============================================
// HELPER: Hapus satu shift dari shift_info
// =============================================
async function deleteSingleShift(kode) {
  try {
    const { error } = await supabase
      .from("shift_info")
      .delete()
      .eq("kode", kode);

    if (error) throw error;

    console.log(`[SYNC] Shift ${kode} dihapus dari shift_info`);
  } catch (e) {
    console.error("[DELETE SINGLE SHIFT ERROR]:", e.message);
  }
}

// =============================================
// HELPER: Parse Excel buffer → array of rows
// Support header 1 baris dan 2 baris (merged header)
// =============================================
async function parseJadwalExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];

  const rows = [];

  // Deteksi apakah header 2 baris (merged "Jam" dengan sub Masuk/Pulang)
  // Strategi: baca baris 1 & 2, bangun mapping kolom secara manual
  // Kolom yang diharapkan: No, Lokasi_Kerja, Nama, Kode, Jam_Masuk, Jam_Pulang,
  //                        Keterangan, Group, Status, Kontrol

  // Baca semua row mentah dulu
  const rawRows = [];
  ws.eachRow((row, rowNumber) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = getCellValue(cell);
    });
    rawRows.push(cells);
  });

  if (rawRows.length < 2) return rows;

  // Tentukan apakah 2-header atau 1-header
  // Jika baris 1 col 5 ada teks "Jam" dan baris 2 col 5 ada "Masuk" → 2 header
  const row1 = rawRows[0];
  const row2 = rawRows[1];

  const isTwoHeader =
    row1[4] !== null &&
    String(row1[4] ?? "").toUpperCase().includes("JAM") &&
    String(row2[4] ?? "").toUpperCase().includes("MASUK");

  const dataStartIndex = isTwoHeader ? 2 : 1;

  // Mapping posisi kolom (index 0-based):
  // [No=0, LokasiKerja=1, NamaShift=2, Kode=3, JamMasuk=4, JamPulang=5,
  //  Keterangan=6, Group=7, Status=8, Kontrol=9]
  const COL = {
    no: 0,
    lokasi_kerja: 1,
    nama_shift: 2,
    kode: 3,
    jam_masuk: 4,
    jam_pulang: 5,
    keterangan: 6,
    group: 7,
    status: 8,
    kontrol: 9,
  };

  for (let i = dataStartIndex; i < rawRows.length; i++) {
    const r = rawRows[i];

    const kode = r[COL.kode] !== null && r[COL.kode] !== undefined
      ? String(r[COL.kode]).trim()
      : null;

    if (!kode) continue; // skip baris tanpa kode (primary key)

    rows.push({
      kode,
      lokasi_kerja: r[COL.lokasi_kerja] != null ? String(r[COL.lokasi_kerja]).trim() : null,
      nama_shift:   r[COL.nama_shift]   != null ? String(r[COL.nama_shift]).trim()   : null,
      jam_masuk:    normalizeTime(r[COL.jam_masuk]),
      jam_pulang:   normalizeTime(r[COL.jam_pulang]),
      keterangan:   r[COL.keterangan]   != null ? String(r[COL.keterangan]).trim()   : null,
      group:        r[COL.group]        != null ? String(r[COL.group]).trim()        : null,
      status:       r[COL.status]       != null ? String(r[COL.status]).trim()       : "non-active",
      kontrol:      r[COL.kontrol]      != null ? String(r[COL.kontrol]).trim()      : null,
    });
  }

  return rows;
}

// =============================================
// GET /api/informasi-jadwal/list (dengan pagination & search)
// =============================================
export async function getJadwalList(req, res) {
  try {
    const search = req.query.search?.trim() || "";
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 10;
    const offset = (page - 1) * limit;

    // Build search filter condition
    const searchFilter = search
      ? `kode.ilike.%${search}%,nama_shift.ilike.%${search}%,lokasi_kerja.ilike.%${search}%`
      : null;

    // Count total dengan search filter yang sama
    let countQuery = supabase.from("informasi_jadwal").select("*", { count: "exact", head: true });
    if (searchFilter) {
      countQuery = countQuery.or(searchFilter);
    }

    const { count, error: countErr } = await countQuery;
    if (countErr) throw countErr;

    // Fetch data dengan search filter
    let dataQuery = supabase
      .from("informasi_jadwal")
      .select("kode, lokasi_kerja, nama_shift, jam_masuk, jam_pulang, keterangan, group, status, kontrol")
      .order("kode", { ascending: true })
      .range(offset, offset + limit - 1);

    if (searchFilter) {
      dataQuery = dataQuery.or(searchFilter);
    }

    const { data, error } = await dataQuery;
    if (error) {
      console.error("[GET JADWAL LIST] Query error:", error);
      throw error;
    }

    // Normalize response untuk frontend UI
    const normalized = (data || []).map((r) => ({
      kode: r.kode,
      lokasi_kerja: r.lokasi_kerja,
      nama_shift: r.nama_shift,
      jam_masuk: r.jam_masuk,
      jam_pulang: r.jam_pulang,
      keterangan: r.keterangan,
      group: r.group,
      status: r.status || "non-active",
      kontrol: r.kontrol,
    }));

    console.log(`[GET JADWAL LIST] Found ${count} total, returning ${normalized?.length || 0} items (page ${page})`);
    return res.json({ data: normalized, total: count || 0 });
  } catch (e) {
    console.error("[ERROR GET JADWAL LIST]:", e.message);
    return res.status(500).json({
      error: e.message,
      errorCode: "JADWAL_LIST_ERROR"
    });
  }
}

// =============================================
// GET /api/informasi-jadwal/list/all (tanpa pagination, untuk dropdown)
// =============================================
export async function getJadwalListAll(req, res) {
  try {
    const { data, error } = await supabase
      .from("informasi_jadwal")
      .select("kode, lokasi_kerja, nama_shift, jam_masuk, jam_pulang, keterangan, group, status, kontrol")
      .order("kode", { ascending: true });

    if (error) {
      console.error("[GET JADWAL ALL] Query error:", error);
      throw error;
    }

    console.log(`[GET JADWAL ALL] Fetched ${data?.length || 0} total jadwal`);
    return res.json(data || []);
  } catch (e) {
    console.error("[ERROR GET JADWAL ALL]:", e.message);
    return res.status(500).json({
      error: e.message,
      errorCode: "JADWAL_ALL_ERROR"
    });
  }
}

// =============================================
// POST /api/informasi-jadwal/upload (Excel import)
// =============================================
export async function uploadJadwal(req, res) {
  try {
    if (!req.file) {
      console.warn("[UPLOAD JADWAL] File tidak ditemukan");
      return res.status(400).json({ error: "File tidak ditemukan" });
    }
    if (req.file.size === 0) {
      console.warn("[UPLOAD JADWAL] File kosong");
      return res.status(400).json({ error: "File excel kosong" });
    }

    console.log(`[UPLOAD JADWAL] Parsing file: ${req.file.originalname} (${req.file.size} bytes)`);
    const rows = await parseJadwalExcel(req.file.buffer);
    
    if (rows.length === 0) {
      console.warn("[UPLOAD JADWAL] Tidak ada data di file");
      return res.status(400).json({ error: "File excel tidak memiliki data atau format tidak sesuai" });
    }

    console.log(`[UPLOAD JADWAL] Found ${rows.length} rows to process`);
    let insert_count = 0;
    let update_count = 0;
    let skip_count   = 0;
    const updated_data = [];

    for (const row of rows) {
      // Cek existing by kode
      const { data: existing, error: findErr } = await supabase
        .from("informasi_jadwal")
        .select("kode, nama_shift, lokasi_kerja, jam_masuk, jam_pulang")
        .eq("kode", row.kode)
        .maybeSingle();

      if (findErr) throw findErr;

      if (existing) {
        const hasChange =
          row.nama_shift   !== existing.nama_shift   ||
          row.lokasi_kerja !== existing.lokasi_kerja ||
          row.jam_masuk    !== existing.jam_masuk    ||
          row.jam_pulang   !== existing.jam_pulang;

        if (hasChange) {
          const { error: updateErr } = await supabase
            .from("informasi_jadwal")
            .update({
              lokasi_kerja: row.lokasi_kerja,
              nama_shift:   row.nama_shift,
              jam_masuk:    row.jam_masuk,
              jam_pulang:   row.jam_pulang,
              keterangan:   row.keterangan,
              group:        row.group,
              status:       row.status,
              kontrol:      row.kontrol,
            })
            .eq("kode", row.kode);

          if (updateErr) throw updateErr;

          await syncSingleShift(row.kode);
          update_count++;
          updated_data.push({ ...row, action: "updated" });
        } else {
          skip_count++;
        }
      } else {
        const { error: insertErr } = await supabase
          .from("informasi_jadwal")
          .insert(row);

        if (insertErr) throw insertErr;

        await syncSingleShift(row.kode);
        insert_count++;
      }
    }

    // Compare jadwal_karyawan dengan croscek
    console.log("[UPLOAD JADWAL] Proses selesai, checking croscek data...");
    
    const jadwalKaryawanCount = await countTotalRows("jadwal_karyawan");
    console.log(`[UPLOAD JADWAL] Total jadwal_karyawan: ${jadwalKaryawanCount}`);

    const croscekCompareResult = await deleteAllCroscekIfMatching(jadwalKaryawanCount);

    const responseData = {
      message: `Upload sukses! Insert: ${insert_count}, Update: ${update_count}, Skip: ${skip_count}`,
      insert_count,
      update_count,
      skip_count,
      updated_data: updated_data.slice(0, 10),
      croscek_status: {
        action: croscekCompareResult.action,
        message: croscekCompareResult.message,
        deleted_count: croscekCompareResult.deleted_count || null,
        jadwal_count: croscekCompareResult.jadwal_count || null,
        croscek_count: croscekCompareResult.croscek_count || null,
      },
    };

    console.log(`[UPLOAD JADWAL] Completed: ${JSON.stringify({ insert_count, update_count, skip_count })}`);
    return res.json(responseData);
  } catch (e) {
    console.error("[ERROR UPLOAD JADWAL]:", e.message, e.details);
    return res.status(500).json({
      error: e.message,
      errorCode: "UPLOAD_JADWAL_ERROR",
      details: e.details || null
    });
  }
}

// =============================================
// POST /api/informasi-jadwal/create (Create single jadwal)
// =============================================
export async function createJadwal(req, res) {
  try {
    const body = req.body;

    const kode = body.kode ? String(body.kode).trim() : null;
    if (!kode) {
      console.warn("[CREATE JADWAL] Validation error: kode kosong");
      return res.status(400).json({ error: "Kode tidak boleh kosong" });
    }

    // Cek duplikasi kode
    const { data: existing, error: checkErr } = await supabase
      .from("informasi_jadwal")
      .select("kode")
      .eq("kode", kode)
      .maybeSingle();

    if (checkErr) throw checkErr;

    if (existing) {
      console.warn(`[CREATE JADWAL] Duplikat kode: ${kode}`);
      return res.status(409).json({ error: `Kode ${kode} sudah terdaftar di database` });
    }

    const payload = {
      kode,
      lokasi_kerja: body.lokasi_kerja || null,
      nama_shift:   body.nama_shift   || null,
      jam_masuk:    normalizeTime(body.jam_masuk),
      jam_pulang:   normalizeTime(body.jam_pulang),
      keterangan:   body.keterangan   || null,
      group:        body.group        || null,
      status:       body.status       || "non-active",
      kontrol:      body.kontrol      || null,
    };

    console.log(`[CREATE JADWAL] Creating jadwal ${kode}`, payload);

    const { error } = await supabase.from("informasi_jadwal").insert(payload);
    if (error) throw error;

    await syncSingleShift(kode);

    console.log(`[CREATE JADWAL] Success: ${kode}`);
    return res.status(201).json({ 
      message: "Jadwal berhasil ditambahkan",
      kode,
      data: payload
    });
  } catch (e) {
    console.error("[ERROR CREATE JADWAL]:", e.message);
    return res.status(500).json({
      error: e.message,
      errorCode: "CREATE_JADWAL_ERROR"
    });
  }
}

// =============================================
// PUT /api/informasi-jadwal/update/:kode (Update existing jadwal)
// =============================================
export async function updateJadwal(req, res) {
  try {
    const { kode } = req.params;
    const body = req.body;

    if (!kode) {
      console.warn("[UPDATE JADWAL] Validation error: kode tidak ada di params");
      return res.status(400).json({ error: "Kode tidak valid" });
    }

    console.log(`[UPDATE JADWAL] Checking kode: ${kode}`);

    // Cek apakah kode ada
    const { data: existing, error: findErr } = await supabase
      .from("informasi_jadwal")
      .select("kode")
      .eq("kode", kode)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!existing) {
      console.warn(`[UPDATE JADWAL] Kode tidak ditemukan: ${kode}`);
      return res.status(404).json({ error: `Kode ${kode} tidak ditemukan` });
    }

    const payload = {
      lokasi_kerja: body.lokasi_kerja ?? null,
      nama_shift:   body.nama_shift   ?? null,
      jam_masuk:    normalizeTime(body.jam_masuk),
      jam_pulang:   normalizeTime(body.jam_pulang),
      keterangan:   body.keterangan   ?? null,
      group:        body.group        ?? null,
      status:       body.status       ?? "non-active",
      kontrol:      body.kontrol      ?? null,
    };

    console.log(`[UPDATE JADWAL] Updating ${kode}`, payload);

    const { error } = await supabase
      .from("informasi_jadwal")
      .update(payload)
      .eq("kode", kode);

    if (error) throw error;

    await syncSingleShift(kode);

    console.log(`[UPDATE JADWAL] Success: ${kode}`);
    return res.json({ 
      message: "Data jadwal diperbarui",
      kode,
      data: payload
    });
  } catch (e) {
    console.error("[ERROR UPDATE JADWAL]:", e.message);
    return res.status(500).json({
      error: e.message,
      errorCode: "UPDATE_JADWAL_ERROR"
    });
  }
}

// =============================================
// DELETE /api/informasi-jadwal/delete/:kode (Delete jadwal by kode)
// =============================================
export async function deleteJadwal(req, res) {
  try {
    const { kode } = req.params;

    if (!kode) {
      console.warn("[DELETE JADWAL] Validation error: kode tidak ada di params");
      return res.status(400).json({ error: "Kode tidak valid" });
    }

    console.log(`[DELETE JADWAL] Deleting kode: ${kode}`);

    // Optional: Cek apakah kode ada
    const { data: existing, error: checkErr } = await supabase
      .from("informasi_jadwal")
      .select("kode")
      .eq("kode", kode)
      .maybeSingle();

    if (checkErr) throw checkErr;
    if (!existing) {
      console.warn(`[DELETE JADWAL] Kode tidak ditemukan: ${kode}`);
      return res.status(404).json({ error: `Kode ${kode} tidak ditemukan` });
    }

    const { error } = await supabase
      .from("informasi_jadwal")
      .delete()
      .eq("kode", kode);

    if (error) throw error;

    await deleteSingleShift(kode);

    console.log(`[DELETE JADWAL] Success: ${kode}`);
    return res.json({ 
      message: "Data jadwal dihapus",
      kode
    });
  } catch (e) {
    console.error("[ERROR DELETE JADWAL]:", e.message);
    return res.status(500).json({
      error: e.message,
      errorCode: "DELETE_JADWAL_ERROR"
    });
  }
}