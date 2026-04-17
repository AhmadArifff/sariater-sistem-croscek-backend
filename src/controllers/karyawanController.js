import { supabase } from "../config/supabase.js";
import { cleanNIK, cleanNama, cleanIdAbsen, isEmpty, safeStr } from "../utils/cleansing.js";
import ExcelJS from "exceljs";

// =============================================
// HELPER: Ekstrak nilai mentah dari cell ExcelJS
// ExcelJS bisa return object richText, formula result, Date, dll
// =============================================
function getCellValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.richText) {
    return v.richText.map((r) => r.text).join(""); // rich text → plain string
  }
  if (typeof v === "object" && v.result !== undefined) {
    return v.result; // formula → hasil kalkulasi
  }
  return v;
}

// =============================================
// HELPER: Parse Excel buffer → array of rows
// =============================================
async function parseExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];

  const headers = {};   // { colNumber: "HEADER_NAME" }
  const rows = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      // Baris pertama = header — normalize ke UPPERCASE
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const val = String(getCellValue(cell) ?? "").trim().toUpperCase();
        if (val) headers[colNumber] = val;
      });
    } else {
      const obj = {};
      // Isi semua header dengan null dulu (agar kolom yang tidak ada di row tetap ada)
      Object.values(headers).forEach((h) => { obj[h] = null; });
      // Isi nilai dari cell yang ada
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (headers[colNumber]) {
          obj[headers[colNumber]] = getCellValue(cell);
        }
      });
      // Skip baris yang semua nilainya null/kosong
      if (Object.values(obj).some((v) => v !== null && v !== "")) {
        rows.push(obj);
      }
    }
  });

  return rows;
}

// =============================================
// HELPER: Proses upload karyawan (karyawan & dw pakai logic sama)
// =============================================
async function processUploadKaryawan(rows, kategori) {
  const required = ["NAMA", "NIK", "JABATAN", "DEPT"];
  const headers = Object.keys(rows[0] || {});
  const missing = required.filter((r) => !headers.includes(r));

  if (missing.length > 0) {
    throw new Error(`Format kolom tidak sesuai template. Harus ada: ${required.join(", ")}`);
  }

  let insert_count = 0;
  let update_count = 0;
  let skip_count = 0;
  const duplicate_list = [];
  const skipped_list = [];

  for (const row of rows) {
    // --- NIK ---
    const nik = cleanNIK(row["NIK"]);
    if (!nik) {
      skip_count++;
      skipped_list.push({ error: "NIK kosong", row });
      continue;
    }

    // --- NAMA ---
    const nama = cleanNama(row["NAMA"]);
    if (!nama) {
      skip_count++;
      skipped_list.push({ error: "Nama kosong", nik });
      continue;
    }

    const jabatan = safeStr(row["JABATAN"]);
    const dept = safeStr(row["DEPT"]);
    const id_absen = cleanIdAbsen(row["ID ABSEN"] ?? row["ID_ABSEN"] ?? null);

    // --- CEK DUPLIKASI berdasarkan NIK ---
    const { data: existing, error: findErr } = await supabase
      .from("karyawan")
      .select("id_karyawan, nama, jabatan, dept, id_absen")
      .eq("nik", nik)
      .maybeSingle();

    if (findErr) throw findErr;

    if (existing) {
      // Cek apakah ada perubahan data
      const hasChange =
        nama !== existing.nama ||
        jabatan !== existing.jabatan ||
        dept !== existing.dept ||
        id_absen !== existing.id_absen;

      if (hasChange) {
        // UPDATE jika ada perubahan
        const { error: updateErr } = await supabase
          .from("karyawan")
          .update({ nama, jabatan, dept, id_absen })
          .eq("id_karyawan", existing.id_karyawan);

        if (updateErr) throw updateErr;

        update_count++;
        duplicate_list.push({ nik, nama, jabatan, dept, id_absen, action: "updated" });
      } else {
        // SKIP jika data identik
        skip_count++;
        skipped_list.push({ nik, nama, reason: "Data sudah ada dan identik" });
      }
    } else {
      // INSERT data baru
      const { error: insertErr } = await supabase
        .from("karyawan")
        .insert({ nik, nama, jabatan, dept, id_absen, kategori });

      if (insertErr) throw insertErr;
      insert_count++;
    }
  }

  return {
    message: `Upload sukses! Insert: ${insert_count}, Update: ${update_count}, Skip: ${skip_count}`,
    insert_count,
    update_count,
    skip_count,
    updated_data: duplicate_list.slice(0, 10),
    skipped_data: skipped_list.slice(0, 10),
  };
}

// =============================================
// GET /api/karyawan/list/nama
// =============================================
export async function getKaryawanListNama(req, res) {
  try {
    const { data, error } = await supabase
      .from("karyawan")
      .select("id_karyawan, nik, nama, jabatan, dept, id_absen, kategori")
      .eq("kategori", "karyawan")
      .order("nama", { ascending: true });

    if (error) throw error;

    console.log(`Total karyawan yang diambil: ${data.length}`);
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// GET /api/dw/list/nama
// =============================================
export async function getDWListNama(req, res) {
  try {
    const { data, error } = await supabase
      .from("karyawan")
      .select("id_karyawan, nik, nama, jabatan, dept, id_absen, kategori")
      .eq("kategori", "dw")
      .order("nama", { ascending: true });

    if (error) throw error;

    console.log(`Total DW yang diambil: ${data.length}`);
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// GET /api/karyawan/list?search=&page=
// =============================================
export async function getKaryawanList(req, res) {
  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    // Count total
    let countQuery = supabase
      .from("karyawan")
      .select("*", { count: "exact", head: true })
      .eq("kategori", "karyawan");

    if (search) {
      countQuery = countQuery.or(`nama.ilike.%${search}%,nik.ilike.%${search}%`);
    }

    const { count, error: countErr } = await countQuery;
    if (countErr) throw countErr;

    // Fetch data dengan pagination
    let dataQuery = supabase
      .from("karyawan")
      .select("nik, nama, jabatan, dept, id_absen, kategori")
      .eq("kategori", "karyawan")
      .order("nama", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      dataQuery = dataQuery.or(`nama.ilike.%${search}%,nik.ilike.%${search}%`);
    }

    const { data, error } = await dataQuery;
    if (error) throw error;

    return res.json({ data, total: count });
  } catch (e) {
    console.error("ERROR GET KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// GET /api/dw/list?search=&page=
// =============================================
export async function getDWList(req, res) {
  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    let countQuery = supabase
      .from("karyawan")
      .select("*", { count: "exact", head: true })
      .eq("kategori", "dw");

    if (search) {
      countQuery = countQuery.or(`nama.ilike.%${search}%,nik.ilike.%${search}%`);
    }

    const { count, error: countErr } = await countQuery;
    if (countErr) throw countErr;

    let dataQuery = supabase
      .from("karyawan")
      .select("nik, nama, jabatan, dept, id_absen, kategori")
      .eq("kategori", "dw")
      .order("nama", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      dataQuery = dataQuery.or(`nama.ilike.%${search}%,nik.ilike.%${search}%`);
    }

    const { data, error } = await dataQuery;
    if (error) throw error;

    return res.json({ data, total: count });
  } catch (e) {
    console.error("ERROR GET DW:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// POST /api/karyawan/upload  (Excel)
// =============================================
export async function uploadKaryawan(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });
    if (req.file.size === 0) return res.status(400).json({ error: "File excel kosong" });

    const rows = await parseExcel(req.file.buffer); // ✅ tambah await
    if (rows.length === 0) return res.status(400).json({ error: "File excel tidak memiliki data" });

    const result = await processUploadKaryawan(rows, "karyawan");
    return res.json(result);
  } catch (e) {
    console.error("ERROR UPLOAD KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// POST /api/dw/upload  (Excel)
// =============================================
export async function uploadDW(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });
    if (req.file.size === 0) return res.status(400).json({ error: "File excel kosong" });

    const rows = await parseExcel(req.file.buffer); // ✅ tambah await
    if (rows.length === 0) return res.status(400).json({ error: "File excel tidak memiliki data" });

    const result = await processUploadKaryawan(rows, "dw");
    return res.json(result);
  } catch (e) {
    console.error("ERROR UPLOAD DW:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// POST /api/karyawan/create
// =============================================
export async function createKaryawan(req, res) {
  try {
    const body = req.body;

    const nik = safeStr(body.nik);
    if (!nik) return res.status(400).json({ error: "NIK tidak boleh kosong" });

    const nama = cleanNama(body.nama);
    if (!nama) return res.status(400).json({ error: "Nama tidak boleh kosong" });

    const jabatan = safeStr(body.jabatan);
    const dept = safeStr(body.dept);
    const id_absen = cleanIdAbsen(body.id_absen);
    const kategori = "karyawan";

    // Cek duplikasi NIK
    const { data: existing } = await supabase
      .from("karyawan")
      .select("nik")
      .eq("nik", nik)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: `NIK ${nik} sudah terdaftar di database` });
    }

    const { error } = await supabase
      .from("karyawan")
      .insert({ nik, nama, jabatan, dept, id_absen, kategori });

    if (error) throw error;

    return res.status(201).json({ message: "Karyawan berhasil ditambahkan" });
  } catch (e) {
    console.error("ERROR CREATE KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// POST /api/dw/create
// =============================================
export async function createDW(req, res) {
  try {
    const body = req.body;

    const nik = safeStr(body.nik);
    if (!nik) return res.status(400).json({ error: "NIK tidak boleh kosong" });

    const nama = cleanNama(body.nama);
    if (!nama) return res.status(400).json({ error: "Nama tidak boleh kosong" });

    const jabatan = safeStr(body.jabatan);
    const dept = safeStr(body.dept);
    const id_absen = cleanIdAbsen(body.id_absen);
    const kategori = "dw";

    // Cek duplikasi NIK
    const { data: existing } = await supabase
      .from("karyawan")
      .select("nik")
      .eq("nik", nik)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: `NIK ${nik} sudah terdaftar di database` });
    }

    const { error } = await supabase
      .from("karyawan")
      .insert({ nik, nama, jabatan, dept, id_absen, kategori });

    if (error) throw error;

    return res.status(201).json({ message: "DW berhasil ditambahkan" });
  } catch (e) {
    console.error("ERROR CREATE DW:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// PUT /api/karyawan/update/:nik
// =============================================
export async function updateKaryawan(req, res) {
  try {
    const body = req.body;

    // nik bisa dari body atau dari param — ikuti Python: pakai dari body
    const nik = safeStr(body.nik) || req.params.nik;
    const nama = cleanNama(body.nama);
    const jabatan = safeStr(body.jabatan);
    const dept = safeStr(body.dept);
    const id_absen = cleanIdAbsen(body.id_absen);

    const { error } = await supabase
      .from("karyawan")
      .update({ nama, jabatan, dept, id_absen })
      .eq("nik", nik);

    if (error) throw error;

    return res.json({ message: "Data karyawan diperbarui" });
  } catch (e) {
    console.error("ERROR UPDATE KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}

// =============================================
// DELETE /api/karyawan/delete/:nik
// =============================================
export async function deleteKaryawan(req, res) {
  try {
    const { nik } = req.params;

    const { error } = await supabase.from("karyawan").delete().eq("nik", nik);

    if (error) throw error;

    return res.json({ message: "Data karyawan dihapus" });
  } catch (e) {
    console.error("ERROR DELETE KARYAWAN:", e);
    return res.status(500).json({ error: e.message });
  }
}