import { supabase } from "../config/supabase.js";

// Constants
const SPECIAL_SHIFTS = ["CT", "CTT", "EO", "OF1", "CTB", "X"];
const ACCOUNTING_DEPTS = ["ACCOUNTING", "SALES & MARKETING"];
const DEFAULT_BATCH_SIZE = 1000;

function getSafeBatchSize(batchSize = DEFAULT_BATCH_SIZE) {
  return Math.min(Math.max(Number(batchSize) || DEFAULT_BATCH_SIZE, 1), DEFAULT_BATCH_SIZE);
}

async function batchFetchAllRows({
  tableName,
  selectFields = "*",
  filters = [],
  orders = [],
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  const safeBatchSize = getSafeBatchSize(batchSize);
  let rows = [];
  let offset = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    let query = supabase.from(tableName).select(selectFields);

    for (const filter of filters) {
      if (!filter || !filter.type || !filter.field) continue;
      const { type, field, value } = filter;
      if (type === "eq") query = query.eq(field, value);
      else if (type === "neq") query = query.neq(field, value);
      else if (type === "gte") query = query.gte(field, value);
      else if (type === "lte") query = query.lte(field, value);
      else if (type === "in" && Array.isArray(value)) query = query.in(field, value);
    }

    for (const orderRule of orders) {
      if (!orderRule || !orderRule.field) continue;
      query = query.order(orderRule.field, { ascending: orderRule.asc !== false });
    }

    const { data, error } = await query.range(offset, offset + safeBatchSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    rows = rows.concat(data);
    offset += data.length;

    if (data.length < safeBatchSize) break;
    if (batchNum > 20000) {
      console.warn(`⚠️ batchFetchAllRows(${tableName}) safety stop`);
      break;
    }
  }

  return rows;
}

// ======= Helper utilities (time/date parsing & conversions) =======
function normalizeTime(t) {
  if (t === null || t === undefined) return null;
  if (t instanceof Date) {
    const hh = String(t.getUTCHours()).padStart(2, "0");
    const mm = String(t.getUTCMinutes()).padStart(2, "0");
    const ss = String(t.getUTCSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  if (typeof t === "number") {
    const totalSeconds = Math.round(t * 86400);
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  const s = String(t).trim();
  if (!s) return null;
  if (/^\d{1,2}:\d{2}$/.test(s)) return s.padStart(5, "0") + ":00";
  if (/^\d{1,2}:\d{2}:\d{2}/.test(s)) {
    const parts = s.split(":");
    return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}:${parts[2].slice(0,2).padStart(2,'0')}`;
  }
  return null;
}

function normalizeDateTime(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  // Convert instant to Asia/Jakarta local by adding +7h then format YYYY-MM-DDTHH:MM:SS
  const jkt = new Date(d.getTime() + 7 * 3600000);
  const YYYY = jkt.getUTCFullYear();
  const MM = String(jkt.getUTCMonth() + 1).padStart(2, "0");
  const DD = String(jkt.getUTCDate()).padStart(2, "0");
  const hh = String(jkt.getUTCHours()).padStart(2, "0");
  const mm = String(jkt.getUTCMinutes()).padStart(2, "0");
  const ss = String(jkt.getUTCSeconds()).padStart(2, "0");
  return `${YYYY}-${MM}-${DD}T${hh}:${mm}:${ss}`;
}

function normalizePin(v) {
  if (v === null || v === undefined) return "";
  let s = String(v).trim();
  if (!s) return "";
  // Handle Excel-style numeric strings, e.g. "3020434.0"
  s = s.replace(/\.0+$/, "");
  return s;
}

function buildCroscekKey(idKaryawan, tanggal, kodeShift) {
  const id = String(idKaryawan ?? "").trim();
  const t = String(tanggal ?? "").split("T")[0].trim();
  const k = String(kodeShift ?? "").trim().toUpperCase();
  return `${id}|${t}|${k}`;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const s = String(timeStr).split("T")[0].includes("T") ? String(timeStr).split("T")[1] : String(timeStr);
  const t = s.split("+")[0].split("-")[0].trim();
  const parts = t.split(":");
  const hh = Number(parts[0] || 0);
  const mm = Number(parts[1] || 0);
  return hh * 60 + mm;
}

function dateAddDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00+07:00`);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Number(days));
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const DD = String(d.getDate()).padStart(2, "0");
  return `${YYYY}-${MM}-${DD}`;
}

function combineDT(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const t = normalizeTime(timeStr);
  if (!t) return null;
  // ✅ CRITICAL FIX: Treat as UTC+7 local time (Asia/Jakarta), not UTC
  // All times in system are in UTC+7 (no timezone suffix), so we must construct
  // the Date by parsing as if it were UTC, then mentally adjust for +7 offset
  // Example: "2026-03-02T08:00:00" in our system = "2026-03-02T01:00:00Z" in UTC
  // But JavaScript's new Date() without timezone assumes system local time
  // SOLUTION: Parse with +07:00 suffix so JavaScript handles it correctly
  const iso = `${dateStr}T${t}+07:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function dt(datetimeStr) {
  if (!datetimeStr) return null;
  const d = new Date(datetimeStr);
  return isNaN(d.getTime()) ? null : d;
}

function getTimeStr(datetimeStr) {
  if (!datetimeStr) return null;
  const s = String(datetimeStr).split("T")[1] || "";
  return s.split(/[+\-]/)[0] || null;
}

function getDateStr(datetimeStr) {
  if (!datetimeStr) return null;
  return String(datetimeStr).split("T")[0] || null;
}

function isLintasHari(kode, jamMasuk, jamPulang) {
  if (!jamMasuk || !jamPulang) return false;
  if (String(kode).toUpperCase() === "3A") return true;
  return timeToMinutes(jamPulang) <= timeToMinutes(jamMasuk);
}

function normalizeMinuteDiff(diff) {
  let d = Number(diff);
  if (Number.isNaN(d)) return null;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}

function scoreShiftByActualTimes(actualMasuk, actualPulang, jamMasuk, jamPulang) {
  const actualMasukMin = timeToMinutes(getTimeStr(actualMasuk));
  const actualPulangMin = timeToMinutes(getTimeStr(actualPulang));
  const jadwalMasukMin = timeToMinutes(jamMasuk);
  const jadwalPulangMin = timeToMinutes(jamPulang);

  if (
    actualMasukMin === null ||
    actualPulangMin === null ||
    jadwalMasukMin === null ||
    jadwalPulangMin === null
  ) {
    return null;
  }

  const diffMasuk = Math.abs(normalizeMinuteDiff(actualMasukMin - jadwalMasukMin));
  const diffPulang = Math.abs(normalizeMinuteDiff(actualPulangMin - jadwalPulangMin));

  return {
    diffMasuk,
    diffPulang,
    total: diffMasuk + diffPulang,
  };
}

function expectedDurationMinutes(jamMasuk, jamPulang) {
  if (!jamMasuk || !jamPulang) return null;
  const mMin = timeToMinutes(jamMasuk);
  const pMin = timeToMinutes(jamPulang);
  if (mMin === null || pMin === null) return null;
  if (pMin > mMin) {
    return pMin - mMin;
  } else {
    // lintas hari: masuk hari ini, pulang besok → durasi dalam menit dari masuk hingga 24:00 + 00:00 hingga pulang
    return (24 * 60 - mMin) + pMin;
  }
}

// Small helpers restored: serializer and used-pulang-malam builder
function serializeCroscekRow(row) {
  const fmt = (v) => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return normalizeDateTime(v);
    return String(v);
  };
  return {
    ...row,
    Tanggal:       fmt(row.Tanggal),
    Jadwal_Masuk:  fmt(row.Jadwal_Masuk),
    Jadwal_Pulang: fmt(row.Jadwal_Pulang),
    Actual_Masuk:  fmt(row.Actual_Masuk),
    Actual_Pulang: fmt(row.Actual_Pulang),
  };
}

function buildUsedScanPulangMalam(jadwalList, karyawanMap, infoMap, allAttendance) {
  const used = new Set();
  if (!Array.isArray(jadwalList)) return used;

  for (const jadwal of jadwalList) {
    const karyawan = karyawanMap.get(String(jadwal.id_karyawan));
    if (!karyawan) continue;
    const infoShift = infoMap.get(String(jadwal.kode_shift || '').trim().toUpperCase());
    if (!infoShift) continue;
    if (SPECIAL_SHIFTS.includes(jadwal.kode_shift)) continue;

    const jm = normalizeTime(infoShift.jam_masuk);
    const jp = normalizeTime(infoShift.jam_pulang);
    if (!jm || !jp) continue;

    // Only consider lintas hari shifts
    if (timeToMinutes(jp) >= timeToMinutes(jm)) continue;

    const pin = normalizePin(karyawan.id_absen);
    if (!pin) continue;
    const nextDate = dateAddDays(jadwal.tanggal, 1);
    const pulangDt = combineDT(nextDate, jp);
    if (!pulangDt) continue;
    const windowStart = new Date(pulangDt.getTime() - 4 * 3600000);
    const windowEnd   = new Date(pulangDt.getTime() + 6 * 3600000);

    for (const att of (allAttendance || [])) {
      if (normalizePin(att.pin) !== pin) continue;
      const norm = getAttendanceDateTime(att);
      if (!norm) continue;
      const attDt = dt(norm);
      if (!attDt) continue;
      if (attDt >= windowStart && attDt <= windowEnd) used.add(`${pin}_${norm}`);
    }
  }

  return used;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION: Check dan fix missing attendance untuk shift lintas hari
// 
// Untuk shift lintas hari (3, 3A, 2A, 3B), validasi apakah ada data
// kehadiran pada jam pulang hari berikutnya. Jika tidak ada, cek apakah
// ada scan yang terlewat yang harus digunakan sebagai pulang.
// ═══════════════════════════════════════════════════════════════
async function validateAndFixLintasHariShifts(
  jadwalList,
  karyawanMap,
  infoMap,
  attendanceByPin,
  existingCroscekMap
) {
  const fixes = [];
  const LINTAS_HARI_SHIFTS = ["3", "3A", "2A", "3B"];
  
  for (const jadwal of jadwalList) {
    const karyawan = karyawanMap.get(String(jadwal.id_karyawan));
    if (!karyawan) continue;
    
    const kode = String(jadwal.kode_shift || "").trim().toUpperCase();
    if (!LINTAS_HARI_SHIFTS.includes(kode)) continue;
    
    const infoShift = infoMap.get(kode);
    if (!infoShift) continue;
    
    const pin = normalizePin(karyawan.id_absen);
    const attendanceRecs = attendanceByPin.get(pin) || [];
    
    if (attendanceRecs.length === 0) continue;
    
    // Check apakah ada croscek entry untuk shift ini
    const croscekKey = `${jadwal.id_karyawan}|${jadwal.tanggal}|${kode}`;
    const existing = existingCroscekMap.get(croscekKey);
    
    if (!existing || !existing.Actual_Masuk || !existing.Actual_Pulang) {
      // Cari scan yang mungkin terlewat pada jam pulang
      const jm = normalizeTime(infoShift.jam_masuk);
      const jp = normalizeTime(infoShift.jam_pulang);
      
      if (!jm || !jp || timeToMinutes(jp) >= timeToMinutes(jm)) continue;
      
      const nextDate = dateAddDays(jadwal.tanggal, 1);
      const expectedPulangDt = combineDT(nextDate, jp);
      
      if (!expectedPulangDt) continue;
      
      // Cari scan di hari berikutnya yang mungkin adalah scan pulang
      const windowStart = new Date(expectedPulangDt.getTime() - 4 * 3600000);
      const windowEnd = new Date(expectedPulangDt.getTime() + 6 * 3600000);
      
      const pulangCandidates = attendanceRecs.filter((rec) => {
        const norm = getAttendanceDateTime(rec);
        if (!norm) return false;
        const recDt = dt(norm);
        if (!recDt) return false;
        return recDt >= windowStart && recDt <= windowEnd;
      });
      
      if (pulangCandidates.length > 0 && (!existing || !existing.Actual_Pulang)) {
        // Ada candidate pulang yang terlewat
        fixes.push({
          id_karyawan: jadwal.id_karyawan,
          nama: karyawan.nama,
          tanggal: jadwal.tanggal,
          kode_shift: kode,
          missing_type: "pulang_lintas_hari",
          candidates: pulangCandidates.map(r => getAttendanceDateTime(r)),
        });
      }
    }
  }
  
  return fixes;
}

async function processCroscekData(kategori = "karyawan", excludeKaryawan = null) {
  console.log(`\n🔄 processCroscekData (paginated) [${kategori}]`);

  const JADWAL_PAGE_SIZE = 1000; // Supabase max per request
  const INSERT_BATCH_SIZE = 1000; // bulk insert per page

  // 1) Load karyawan and info_jadwal once
  console.log("⏳ Loading karyawan and informasi_jadwal...");
  const [karyawanAll, infoJadwal] = await Promise.all([
    batchFetchAllRows({
      tableName: "karyawan",
      selectFields: "*",
      filters: [{ type: "eq", field: "kategori", value: kategori }],
      orders: [{ field: "id_karyawan", asc: true }],
      batchSize: DEFAULT_BATCH_SIZE,
    }),
    batchFetchAllRows({
      tableName: "informasi_jadwal",
      selectFields: "*",
      orders: [{ field: "kode", asc: true }],
      batchSize: DEFAULT_BATCH_SIZE,
    }),
  ]);
  const karyawanMap = new Map();
  const karyawanIdSet = new Set();
  for (const k of (karyawanAll || [])) { karyawanMap.set(String(k.id_karyawan), k); karyawanIdSet.add(String(k.id_karyawan)); }
  const infoMap = new Map(); const infoList = infoJadwal || [];
  for (const i of infoList) if (i && i.kode != null) infoMap.set(String(i.kode).trim().toUpperCase(), i);

  console.log(`   Karyawan loaded: ${karyawanMap.size}, info_jadwal: ${infoList.length}`);

  // 2) Paginate jadwal_karyawan and process per page
  let offset = 0;
  let pageNum = 0;
  let totalProcessed = 0;
  const allResultsSummary = { inserted: 0, skippedInsert: 0 };
  const stats = {
    jadwalFetched: 0,
    jadwalAfterCategory: 0,
    filteredOutByCategory: 0,
    skippedNoKaryawan: 0,
    skippedNoShift: 0,
    rowsWithoutAttendance: 0,
  };

  while (true) {
    pageNum++;
    console.log(`\n📦 Fetching jadwal page ${pageNum}, offset ${offset}..${offset + JADWAL_PAGE_SIZE - 1}`);
    const { data: jadwalPage, error: jadErr } = await supabase
      .from("jadwal_karyawan")
      .select("*")
      .order("tanggal", { ascending: true })
      .order("no", { ascending: true })
      .range(offset, offset + JADWAL_PAGE_SIZE - 1);
    if (jadErr) throw jadErr;
    if (!jadwalPage || jadwalPage.length === 0) {
      console.log(`   ✅ No more jadwal pages. Stopping.`);
      break;
    }
    stats.jadwalFetched += jadwalPage.length;

    // Filter to only karyawan in this kategori
    const jadwalFiltered = (jadwalPage || []).filter(j => karyawanIdSet.has(String(j.id_karyawan)));
    stats.jadwalAfterCategory += jadwalFiltered.length;
    stats.filteredOutByCategory += (jadwalPage.length - jadwalFiltered.length);
    console.log(`   Page ${pageNum}: fetched ${jadwalPage.length}, after filter ${jadwalFiltered.length}`);
    if (jadwalFiltered.length === 0) { offset += jadwalPage.length; continue; }

    // Build pin set for this page and fetch attendance only for these pins
    const pinSet = new Set();
    for (const j of jadwalFiltered) {
      const k = karyawanMap.get(String(j.id_karyawan));
      if (k && k.id_absen) pinSet.add(normalizePin(k.id_absen));
    }

    // Debug: Show PIN matching info
    console.log(`   🔍 PIN Matching Analysis:`);
    console.log(`      Jadwal records: ${jadwalFiltered.length}`);
    console.log(`      Unique PINs to search: ${pinSet.size}`);
    if (pinSet.size > 0) {
      const samplePins = Array.from(pinSet).slice(0, 3);
      console.log(`      Sample PINs: ${samplePins.join(", ")}`);
    }

    // Fetch attendance for pins in this page (scoped by page date range for accuracy + performance)
    const pageDates = (jadwalFiltered || []).map((j) => j.tanggal).filter(Boolean).sort();
    const pageStartDate = pageDates[0] || null;
    const pageEndDate = pageDates[pageDates.length - 1] || null;
    const hasLintasShiftInPage = (jadwalFiltered || []).some((j) => {
      const infoShift = infoMap.get(String(j.kode_shift || "").trim().toUpperCase());
      if (!infoShift) return false;
      const jm = normalizeTime(infoShift.jam_masuk);
      const jp = normalizeTime(infoShift.jam_pulang);
      return isLintasHari(j.kode_shift, jm, jp);
    });
    const attendanceStartDate = hasLintasShiftInPage && pageStartDate
      ? (dateAddDays(pageStartDate, -1) || pageStartDate)
      : pageStartDate;
    const attendanceEndDate = hasLintasShiftInPage && pageEndDate
      ? (dateAddDays(pageEndDate, 1) || pageEndDate)
      : pageEndDate;
    console.log(`   ⏳ Fetching kehadiran for ${pinSet.size} PINs (page ${pageNum})...`);
    const attendanceForPage = await batchFetchKehadiran(
      DEFAULT_BATCH_SIZE,
      pinSet,
      attendanceStartDate,
      attendanceEndDate
    );
    console.log(`   ✅ Attendance fetched: ${attendanceForPage.length} records`);
    
    // 🔍 DEBUG: Show attendance breakdown
    const attByPin = new Map();
    for (const att of attendanceForPage) {
      const p = normalizePin(att.pin);
      if (!attByPin.has(p)) attByPin.set(p, []);
      attByPin.get(p).push(att);
    }
    console.log(`   📊 Attendance by PIN:`);
    for (const [p, recs] of attByPin) {
      const dates = new Set(recs.map(r => {
        const dt = getAttendanceDateTime(r);
        return dt ? dt.split("T")[0] : "unknown";
      }));
      console.log(`      PIN ${p}: ${recs.length} records across ${dates.size} dates [${Array.from(dates).sort().join(", ")}]`);
    }
    
    // Debug: Show attendance distribution with detailed format analysis
    if (attendanceForPage.length > 0) {
      const uniquePins = new Set(attendanceForPage.map(a => normalizePin(a.pin)));
      const uniqueDates = new Set(attendanceForPage.map(a => {
        const norm = getAttendanceDateTime(a);
        if (!norm) return "PARSE_FAIL";
        return norm.split("T")[0];
      }));
      console.log(`   ✅ Attendance found for ${uniquePins.size} PINs, ${uniqueDates.size} unique dates`);
      
      // Sample format check
      if (attendanceForPage.length > 0) {
        const sample = attendanceForPage[0];
        const norm = getAttendanceDateTime(sample);
        console.log(`   📝 Sample attendance format check:`);
        console.log(`      Raw tanggal_scan: "${sample.tanggal_scan}"`);
        console.log(`      Raw tanggal: "${sample.tanggal}", jam: "${sample.jam}"`);
        console.log(`      getAttendanceDateTime(): "${norm}"`);
        console.log(`      Expected format: YYYY-MM-DDTHH:MM:SS`);
      }
      
      if (uniquePins.size < pinSet.size) {
        const missingPins = Array.from(pinSet).filter(p => !uniquePins.has(p));
        console.warn(`   ⚠️ Missing attendance for ${missingPins.length} PINs: ${missingPins.slice(0, 3).join(", ")}${missingPins.length > 3 ? "..." : ""}`);
      }
    } else {
      console.error(`   ❌ ERROR: No attendance records fetched! Check PIN filter and database.`);
    }

    // Build used_pulang_malam for this page
    const usedPulangMalamSet = buildUsedScanPulangMalam(jadwalFiltered, karyawanMap, infoMap, attendanceForPage || []);
    console.log(`   used_pulang_malam keys: ${usedPulangMalamSet.size}`);
    
    // Debug: Show sample of used keys for diagnosis
    if (usedPulangMalamSet.size > 0) {
      const sampleUsedKeys = Array.from(usedPulangMalamSet).slice(0, 3);
      console.log(`   Sample used keys: ${sampleUsedKeys.join(", ")}`);
    }

    // Group attendance by pin for quick lookup
    const attendanceByPin = new Map();
    for (const att of (attendanceForPage || [])) {
      const pin = normalizePin(att.pin);
      if (!attendanceByPin.has(pin)) attendanceByPin.set(pin, []);
      // ✅ FIXED: Store normalized datetime (tanggal+jam atau tanggal_scan)
      const normDt = getAttendanceDateTime(att);
      attendanceByPin.get(pin).push({ ...att, tanggal_scan: normDt || att.tanggal_scan });
    }
    
    // Debug: Show attendance records per PIN
    console.log(`   📊 Attendance grouped by PIN:`);
    let totalAttendanceRecords = 0;
    for (const [pin, records] of attendanceByPin.entries()) {
      totalAttendanceRecords += records.length;
      try {
        const dates = new Set(records.map(r => {
          const norm = r.tanggal_scan || getAttendanceDateTime(r);
          return norm ? norm.split("T")[0] : "unknown";
        }));
        console.log(`      PIN ${pin}: ${records.length} records across ${dates.size} dates [${Array.from(dates).slice(0, 3).join(", ")}${dates.size > 3 ? "..." : ""}]`);
      } catch (e) {
        console.error(`      PIN ${pin}: ERROR processing dates -`, e.message);
      }
    }
    console.log(`      Total: ${totalAttendanceRecords} attendance records`);
    
    // 🔍 CRITICAL DEBUG: Check PIN matching between jadwal and attendance
    console.log(`   🔍 PIN MATCHING DEBUG:`);
    console.log(`      Jadwal PINs in this page: ${pinSet.size} unique`);
    console.log(`      Attendance PINs: ${attendanceByPin.size} unique`);
    let matchedCount = 0, notMatchedCount = 0;
    for (const jPin of pinSet) {
      if (attendanceByPin.has(jPin)) {
        matchedCount++;
      } else {
        notMatchedCount++;
        if (notMatchedCount <= 3) console.log(`         ⚠️ Jadwal PIN "${jPin}" has NO attendance data`);
      }
    }
    console.log(`      Matched: ${matchedCount}/${pinSet.size}, Not matched: ${notMatchedCount}`);

    // Build historical frequency limited to employees in this page (90 days)
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const ids = Array.from(new Set(jadwalFiltered.map(j => j.id_karyawan)));
    let historicalFreq = new Map();
    try {
      const histRows = ids.length > 0
        ? await batchFetchAllRows({
            tableName: "jadwal_karyawan",
            selectFields: "id_karyawan, kode_shift, tanggal",
            filters: [
              { type: "in", field: "id_karyawan", value: ids },
              { type: "gte", field: "tanggal", value: cutoff.toISOString().split("T")[0] },
            ],
            orders: [{ field: "tanggal", asc: true }],
            batchSize: DEFAULT_BATCH_SIZE,
          })
        : [];
      historicalFreq = buildHistoricalFreq(histRows || []);
    } catch (err) {
      console.warn(`   ⚠️ historical freq fetch failed: ${err.message || err}`);
      historicalFreq = new Map();
    }

    // Build scan_data map for predictions for this page
    const scanDataMap = new Map();
    for (const att of (attendanceForPage || [])) {
      const norm = getAttendanceDateTime(att);
      if (!norm) continue;
      const dateStr = norm.split("T")[0];
      const pin = normalizePin(att.pin);
      const key = `${pin}_${dateStr}`;
      // ✅ FIXED: Check usedPulangMalamSet dengan format yang sesuai (tanpa timezone suffix)
      if (usedPulangMalamSet.has(`${pin}_${norm}`)) continue;
      if (!scanDataMap.has(key)) scanDataMap.set(key, { scan_masuk: norm, scan_pulang: norm });
      else {
        const ex = scanDataMap.get(key);
        if (norm < ex.scan_masuk) ex.scan_masuk = norm;
        if (norm > ex.scan_pulang) ex.scan_pulang = norm;
      }
    }

    // Process each jadwal in page and collect results
    const pageResults = [];
    let pageProcessed = 0;
    let pageSkipped = 0;
    let skipReasons = { noKaryawan: 0, noShift: 0, noAttendance: 0, noMasuk: 0, noPulang: 0, other: 0 };
    
    for (const jadwal of jadwalFiltered) {
      const karyawan = karyawanMap.get(String(jadwal.id_karyawan));
      if (!karyawan) { pageSkipped++; skipReasons.noKaryawan++; stats.skippedNoKaryawan++; continue; }
      
      const infoShift = infoMap.get(String(jadwal.kode_shift || "").trim().toUpperCase());
      if (!infoShift) { pageSkipped++; skipReasons.noShift++; stats.skippedNoShift++; continue; }

      const pin = normalizePin(karyawan.id_absen);
      const attendanceRecords = attendanceByPin.get(pin) || [];

      // Keep jadwal row even when attendance is empty.
      // This prevents data loss in croscek output and allows status "Tidak Hadir/Libur".
      if (attendanceRecords.length === 0) {
        skipReasons.noAttendance++;
        stats.rowsWithoutAttendance++;
        if (skipReasons.noAttendance <= 5) {
          console.log(`   ℹ️ Jadwal ${jadwal.id_karyawan} [${karyawan.nama}] ${jadwal.tanggal}: no attendance for PIN=${pin}, row will still be generated.`);
        }
      }

      const expDur = expectedDurationMinutes(infoShift.jam_masuk, infoShift.jam_pulang);
      const actualMasuk = findActualMasuk(jadwal, karyawan, infoShift, attendanceRecords, usedPulangMalamSet);
      
      // ✅ DEBUG: Log untuk diagnosis (first 10 records per page)
      if (pageProcessed < 10) {
        console.log(`   📝 Processing Jadwal ${jadwal.id_karyawan} [${karyawan.nama}] ${jadwal.tanggal} shift ${jadwal.kode_shift}:`);
        console.log(`      PIN=${pin}, attendance_records=${attendanceRecords.length}`);
        if (attendanceRecords.length > 0) {
          console.log(`      First 3 attendance: ${attendanceRecords.slice(0, 3).map(a => a.tanggal_scan).join(" | ")}`);
        }
        console.log(`      actualMasuk=${actualMasuk}`);
      }
      
      const actualPulang = findActualPulang(jadwal, karyawan, infoShift, attendanceRecords, usedPulangMalamSet, actualMasuk, expDur);

      let actualDurMin = null;
      if (actualMasuk && actualPulang) actualDurMin = Math.floor((dt(actualPulang) - dt(actualMasuk)) / (1000 * 60));

      const status = determineStatus(jadwal, karyawan, infoShift, actualMasuk, actualPulang, actualDurMin, expDur);

      let prediksiShift = null, predMasuk = null, predPulang = null, prob = null, conf = null, freq = 0;
      const predFromCompletedScan = inferPrediksiShiftForCompletedScan(
        jadwal,
        infoShift,
        karyawan,
        actualMasuk,
        actualPulang,
        infoList,
        historicalFreq
      );
      if (predFromCompletedScan) {
        prediksiShift = predFromCompletedScan.kode_shift;
        predMasuk = actualMasuk || null;
        predPulang = actualPulang || null;
        prob = predFromCompletedScan.probabilitas ?? null;
        conf = predFromCompletedScan.confidence ?? null;
        freq = predFromCompletedScan.freq ?? 0;
      } else if (!actualMasuk || !actualPulang) {
        const scanKey = `${pin}_${jadwal.tanggal}`;
        const scanData = scanDataMap.get(scanKey);
        const pred = predictShift(karyawan, jadwal.tanggal, scanData?.scan_masuk || null, scanData?.scan_pulang || null, infoList, historicalFreq, usedPulangMalamSet, attendanceForPage || []);
        if (pred) { prediksiShift = pred.kode_shift; predMasuk = scanData?.scan_masuk || null; predPulang = scanData?.scan_pulang || null; prob = pred.probabilitas; conf = pred.confidence; freq = pred.freq; }
      }

      pageResults.push({
        Nama: karyawan.nama,
        Tanggal: jadwal.tanggal,
        Kode_Shift: jadwal.kode_shift,
        Jabatan: karyawan.jabatan,
        Departemen: karyawan.dept,
        id_karyawan: karyawan.id_karyawan,
        NIK: karyawan.nik,
        Jadwal_Masuk: infoShift.jam_masuk,
        Jadwal_Pulang: infoShift.jam_pulang,
        Actual_Masuk: actualMasuk || null,
        Actual_Pulang: actualPulang || null,
        Prediksi_Shift: prediksiShift,
        Prediksi_Actual_Masuk: predMasuk,
        Prediksi_Actual_Pulang: predPulang,
        Probabilitas_Prediksi: prob,
        Confidence_Score: conf,
        Frekuensi_Shift_Historis: freq,
        Status_Kehadiran: status.status_kehadiran,
        Status_Masuk: status.status_masuk,
        Status_Pulang: status.status_pulang,
      });
      pageProcessed++;
    }

    console.log(`   Page ${pageNum}: processed ${pageProcessed} rows (skipped ${pageSkipped}: ${JSON.stringify(skipReasons)}), ready to upsert in ${Math.ceil(pageResults.length / INSERT_BATCH_SIZE)} batch(es)`);

    // Upsert pageResults into target table (croscek or croscek_dw) in batches.
    // This allows safe re-run to repair missing rows without duplicate-key failures.
    const targetTable = kategori === "dw" ? "croscek_dw" : "croscek";
    for (let i = 0; i < pageResults.length; i += INSERT_BATCH_SIZE) {
      const insertBatch = pageResults.slice(i, i + INSERT_BATCH_SIZE);
      const attemptInsert = async (tries = 0) => {
        try {
          const { error: insErr } = await supabase
            .from(targetTable)
            .upsert(insertBatch, {
              onConflict: "id_karyawan,Tanggal,Kode_Shift",
            });
          if (insErr) throw insErr;
          allResultsSummary.inserted += insertBatch.length;
          console.log(`     ✅ Upserted ${insertBatch.length} rows (page ${pageNum}, batch ${Math.floor(i/INSERT_BATCH_SIZE)+1})`);
        } catch (ie) {
          if (tries < 3) {
            console.warn(`     ⚠️ Insert failed, retrying (${tries+1})...`, ie.message || ie);
            await new Promise(r => setTimeout(r, 1000 * (tries + 1)));
            return attemptInsert(tries + 1);
          }
          console.error(`     ❌ Failed to insert after 3 attempts:`, ie.message || ie);
          allResultsSummary.skippedInsert += insertBatch.length;
        }
      };
      await attemptInsert(0);
    }

    totalProcessed += pageProcessed;
    // Move by actual rows returned to avoid skipping if API per-request cap is lower than page size.
    offset += jadwalPage.length;
  }

  console.log(`\n✅ processCroscekData completed: totalProcessed=${totalProcessed}, inserted=${allResultsSummary.inserted}, skippedInsert=${allResultsSummary.skippedInsert}`);
  console.log(`📊 Coverage stats: fetched=${stats.jadwalFetched}, afterKategori=${stats.jadwalAfterCategory}, filteredOutByKategori=${stats.filteredOutByCategory}, skippedNoKaryawan=${stats.skippedNoKaryawan}, skippedNoShift=${stats.skippedNoShift}, rowsWithoutAttendance=${stats.rowsWithoutAttendance}`);
  return { totalProcessed, inserted: allResultsSummary.inserted, skippedInsert: allResultsSummary.skippedInsert, stats };
}

// ═══════════════════════════════════════════════════════════════
// CORE: Find ACTUAL MASUK
//
// Mirrors Python's multi-branch CASE for Actual_Masuk:
//   1. Special shifts → null
//   2. Shift 3A → window malam (22:00 hari ini sd 03:00 besok)
//   3. Lintas hari biasa → window masuk tanpa scan pulang malam
//   4. Normal → window masuk + anti-nyeret dari shift sebelumnya
// ═══════════════════════════════════════════════════════════════
function findActualMasuk(jadwal, karyawan, infoShift, attendanceRecords, usedPulangMalamSet) {
  const kode     = jadwal.kode_shift;
  const tanggal  = jadwal.tanggal; // "YYYY-MM-DD"
  const nextDate = dateAddDays(tanggal, 1);
  const pin      = normalizePin(karyawan.id_absen);
  const jm       = normalizeTime(infoShift.jam_masuk);
  const jp       = normalizeTime(infoShift.jam_pulang);

  if (SPECIAL_SHIFTS.includes(kode)) return null;

  // Normalize semua attendance records sekali
  const normRecords = attendanceRecords.map((a) => ({
    ...a,
    _norm: getAttendanceDateTime(a),
    _dt:   null, // lazy init
  }));
  const withDt = (r) => {
    if (!r._dt) r._dt = dt(r._norm);
    return r;
  };

  // Helper: apakah scan ini sudah dipakai sebagai pulang malam shift lain
  const notUsed = (r) => {
    const rNorm = r._norm;
    // ✅ FIXED: Check tanpa timezone suffix
    return !usedPulangMalamSet.has(`${pin}_${rNorm}`);
  };

  // 2. Shift 3A
  if (kode.toUpperCase() === "3A") {
    const wA_s = new Date(`${tanggal}T22:00:00+07:00`);
    const wA_e = new Date(`${tanggal}T23:59:59+07:00`);
    const wB_s = new Date(`${nextDate}T00:00:00+07:00`);
    const wB_e = new Date(`${nextDate}T03:00:00+07:00`);

    const best = normRecords
      .map(withDt)
      .filter(({ _dt }) => _dt && ((_dt >= wA_s && _dt <= wA_e) || (_dt >= wB_s && _dt <= wB_e)))
      .sort((a, b) => a._dt - b._dt);
    return best.length > 0 ? best[0]._norm : null;
  }

  // 3. Lintas hari biasa
  if (isLintasHari(kode, jm, jp)) {
    const jadwalMasukDt = combineDT(tanggal, jm);
    if (!jadwalMasukDt) return null;
    const wS = new Date(jadwalMasukDt.getTime() - 6 * 3600000);
    const wE = new Date(jadwalMasukDt.getTime() + 4 * 3600000);

    const best = normRecords
      .map(withDt)
      .filter((r) => notUsed(r) && r._dt && r._dt >= wS && r._dt <= wE)
      .sort((a, b) => a._dt - b._dt);
    return best.length > 0 ? best[0]._norm : null;
  }

  // 4. Shift normal
  const jadwalMasukDt = combineDT(tanggal, jm);
  if (!jadwalMasukDt) return null;
  const wS = new Date(jadwalMasukDt.getTime() - 6 * 3600000);
  const wE = new Date(jadwalMasukDt.getTime() + 4 * 3600000);

  const best = normRecords
    .map(withDt)
    .filter((r) => {
      if (!notUsed(r) || !r._dt || r._dt < wS || r._dt > wE) return false;
      return Math.abs((r._dt - jadwalMasukDt) / 60000) <= 240;
    })
    .sort((a, b) => a._dt - b._dt);
  
  // 🔍 DEBUG: Log filtering process
  if (tanggal >= "2026-03-02" && tanggal <= "2026-03-05" && karyawan.nama === "AAM ALAMSYAH") {
    console.log(`   🔍 [${karyawan.nama}] ${tanggal} shift ${kode}:`);
    console.log(`      Window: ${wS.toISOString()} to ${wE.toISOString()}`);
    console.log(`      Total records: ${normRecords.length}`);
    const reasons = normRecords.map(r => {
      const used = usedPulangMalamSet.has(`${pin}_${r._norm}`);
      const dt_val = dt(r._norm);
      const inWindow = dt_val && dt_val >= wS && dt_val <= wE;
      const distance = dt_val ? Math.abs((dt_val - jadwalMasukDt) / 60000) : null;
      return `${r._norm}: used=${used}, inWindow=${inWindow}, dist=${distance}min`;
    });
    console.log(`      Details:\n        ${reasons.join("\n        ")}`);
    console.log(`      Result: ${best.length > 0 ? best[0]._norm : "NONE"}`);
  }
  
  return best.length > 0 ? best[0]._norm : null;
}

// ═══════════════════════════════════════════════════════════════
// CORE: Find ACTUAL PULANG
//
// Mirrors Python multi-branch CASE untuk Actual_Pulang:
//   1. Special shift → null
//   2. Shift 3A     → cari di hari berikutnya + fallback
//   3. ACCOUNTING/SALES + lintas hari
//   4. ACCOUNTING/SALES + normal (duration+conflict check)
//   5. Lintas hari biasa
//   6. Normal (dengan duration validation)
//
// Semua cabang: validasi durasi >= 50% expected sebelum accept
// ═══════════════════════════════════════════════════════════════
function findActualPulang(
  jadwal, karyawan, infoShift,
  attendanceRecords, usedPulangMalamSet,
  actualMasuk, expectedDurMin
) {
  const kode     = jadwal.kode_shift;
  const tanggal  = jadwal.tanggal;
  const nextDate = dateAddDays(tanggal, 1);
  const pin      = normalizePin(karyawan.id_absen);
  const dept     = karyawan.dept || "";
  const isAccounting = ACCOUNTING_DEPTS.includes(dept);
  const jm = normalizeTime(infoShift.jam_masuk);
  const jp = normalizeTime(infoShift.jam_pulang);

  if (SPECIAL_SHIFTS.includes(kode)) return null;

  // ⚠️ CRITICAL: Jika tidak ada scan masuk SAMA SEKALI,
  // jangan cari pulang — akan salah ambil scan orang lain
  // KECUALI jika ada scan tunggal (mungkin hanya scan 1x)
  const masukDt = actualMasuk ? dt(actualMasuk) : null;

  // Normalize semua attendance records sekali
  const normRecords = attendanceRecords.map((a) => {
    const norm = getAttendanceDateTime(a);
    return { ...a, _norm: norm, _dt: dt(norm) };
  });

  // Helper: duration dari masuk ke candidate (dalam menit)
  const durationMin = (candDt) => {
    if (!masukDt || !candDt) return null;
    return (candDt - masukDt) / 60000;
  };

  // Helper: duration valid >= threshold × expected
  const durationOk = (candDt, threshold = 0.5) => {
    const dur = durationMin(candDt);
    if (dur === null) return !masukDt; // jika tidak ada masuk, jangan accept
    return dur >= expectedDurMin * threshold && dur >= 0;
  };

  // Helper: filter candidate pulang yang valid
  const filterPulang = (wS, wE, threshold = 0.5) => {
    return normRecords
      .filter((r) => {
        if (!r._dt || r._dt < wS || r._dt > wE) return false;
        // Bukan scan masuk yang sama
        if (actualMasuk && r._norm === actualMasuk) return false;
        return durationOk(r._dt, threshold);
      });
  };

  // Sort by closest to target time
  const sortByClosest = (records, targetDt) =>
    [...records].sort((a, b) =>
      Math.abs(a._dt - targetDt) - Math.abs(b._dt - targetDt)
    );

  // ─── BRANCH 1: Shift 3A ─────────────────────
  if (kode.toUpperCase() === "3A") {
    const jadwalPulangDt = combineDT(nextDate, jp);
    if (!jadwalPulangDt) return null;

    // Cari di hari berikutnya ±75 menit dari jam pulang
    const wS = new Date(jadwalPulangDt.getTime());
    const wE = new Date(jadwalPulangDt.getTime() + 75 * 60000);

    const cands = sortByClosest(
      filterPulang(wS, wE, 0.5).filter((r) => r._norm.startsWith(nextDate)),
      jadwalPulangDt
    );
    if (cands.length > 0) return cands[0]._norm;

    // Fallback: scan pagi (05:00–12:00 besok)
    const fbS = new Date(`${nextDate}T05:00:00+07:00`);
    const fbE = new Date(`${nextDate}T12:00:00+07:00`);
    const fallback = normRecords
      .filter((r) => r._dt && r._dt >= fbS && r._dt <= fbE && r._norm !== actualMasuk)
      .sort((a, b) => b._dt - a._dt);
    return fallback.length > 0 ? fallback[0]._norm : null;
  }

  // ─── BRANCH 2: ACCOUNTING + lintas hari ─────
  if (isAccounting && isLintasHari(kode, jm, jp)) {
    const jadwalPulangDt = combineDT(nextDate, jp);
    if (!jadwalPulangDt) return null;
    const wS = new Date(jadwalPulangDt.getTime() - 4 * 3600000);
    const wE = new Date(jadwalPulangDt.getTime() + 12 * 3600000);
    const cands = sortByClosest(filterPulang(wS, wE, 0.5), jadwalPulangDt);
    return cands.length > 0 ? cands[0]._norm : null;
  }

  // ─── BRANCH 3: ACCOUNTING + shift normal ────
  if (isAccounting) {
    const jadwalPulangDt = combineDT(tanggal, jp);
    if (!jadwalPulangDt) return null;
    const wS = new Date(jadwalPulangDt.getTime() - 4 * 3600000);
    const wE = new Date(jadwalPulangDt.getTime() + 12 * 3600000);

    const cands = sortByClosest(filterPulang(wS, wE, 0.5), jadwalPulangDt);
    if (cands.length === 0) return null;

    // Prioritas 1: durasi >= 80%
    const highQ = cands.filter((r) => durationOk(r._dt, 0.8));
    if (highQ.length > 0) return highQ[0]._norm;

    return cands[0]._norm;
  }

  // ─── BRANCH 4: Lintas hari biasa ────────────
  if (isLintasHari(kode, jm, jp)) {
    const jadwalPulangDt = combineDT(nextDate, jp);
    if (!jadwalPulangDt) return null;
    const wS = new Date(jadwalPulangDt.getTime() - 4 * 3600000);
    const wE = new Date(jadwalPulangDt.getTime() + 6 * 3600000);
    const cands = sortByClosest(filterPulang(wS, wE, 0.5), jadwalPulangDt);
    return cands.length > 0 ? cands[0]._norm : null;
  }

  // ─── BRANCH 5: Shift normal biasa ───────────
  const jadwalPulangDt = combineDT(tanggal, jp);
  if (!jadwalPulangDt) return null;
  const wS = new Date(jadwalPulangDt.getTime() - 4 * 3600000);
  const wE = new Date(jadwalPulangDt.getTime() + 7 * 3600000);
  const cands = sortByClosest(filterPulang(wS, wE, 0.5), jadwalPulangDt);
  return cands.length > 0 ? cands[0]._norm : null;
}

// ═══════════════════════════════════════════════════════════════
// CORE: Determine STATUS_KEHADIRAN, STATUS_MASUK, STATUS_PULANG
//
// Mirrors full Python CASE logic:
// - Special shift → keterangan
// - Tidak Hadir   → tidak ada scan
// - Hadir         → hitung masuk/pulang on-time
// ═══════════════════════════════════════════════════════════════
function determineStatus(
  jadwal, karyawan, infoShift,
  actualMasuk, actualPulang,
  actualDurMin, expectedDurMin
) {
  const kode    = jadwal.kode_shift;
  const tanggal = jadwal.tanggal;
  const dept    = karyawan.dept || "";
  const isAccounting = ACCOUNTING_DEPTS.includes(dept);
  const nextDate = dateAddDays(tanggal, 1);
  const jm = normalizeTime(infoShift.jam_masuk);
  const jp = normalizeTime(infoShift.jam_pulang);
  const lintasHari = isLintasHari(kode, jm, jp);

  // ─── Special shifts ───────────────────────
  if (SPECIAL_SHIFTS.includes(kode)) {
    return {
      status_kehadiran: infoShift.keterangan || "Special",
      status_masuk:     null,
      status_pulang:    null,
    };
  }

  // ─── Tidak hadir: tidak ada scan sama sekali ──
  if (!actualMasuk && !actualPulang) {
    return {
      status_kehadiran: "Tidak Hadir",
      status_masuk:     null,
      status_pulang:    null,
    };
  }

  // ─── STATUS MASUK ─────────────────────────
  let status_masuk = "Tidak scan masuk";
  const masukTimeStr = getTimeStr(actualMasuk);

  if (!actualMasuk) {
    // Tidak ada scan masuk tapi ada pulang — bisa terjadi untuk ACCOUNTING
    // jika durasi cukup, anggap tepat waktu
    if (actualDurMin != null && actualDurMin >= expectedDurMin * 0.9) {
      status_masuk = "Masuk Tepat Waktu";
    }
  } else {
    const jadwalMasukMin = timeToMinutes(jm);
    const actualMasukMin = timeToMinutes(masukTimeStr);
    const TOLERANCE_MIN  = 15;
    const masukDateStr   = getDateStr(actualMasuk);

    // ACCOUNTING + 3A
    if (isAccounting && kode.toUpperCase() === "3A" && actualPulang) {
      const pulangDt      = dt(actualPulang);
      const jadwalPulangDt = combineDT(nextDate, jp);
      const overstayMin   = jadwalPulangDt ? (pulangDt - jadwalPulangDt) / 60000 : 0;

      if (masukDateStr === tanggal && actualMasukMin >= timeToMinutes("22:00")) {
        status_masuk = "Masuk Tepat Waktu";
      } else if (masukDateStr === nextDate && (actualDurMin >= 540 || overstayMin >= 60)) {
        status_masuk = "Masuk Tepat Waktu";
      } else {
        status_masuk = "Masuk Telat";
      }

    // ACCOUNTING + shift biasa + ada pulang
    } else if (isAccounting && kode.toUpperCase() !== "3A" && actualPulang) {
      const pulangDt      = dt(actualPulang);
      const jadwalPulangDt = lintasHari
        ? combineDT(nextDate, jp)
        : combineDT(tanggal, jp);
      const overstayMin = jadwalPulangDt ? (pulangDt - jadwalPulangDt) / 60000 : 0;

      if (actualDurMin >= 540 || overstayMin >= 60) {
        status_masuk = "Masuk Tepat Waktu";
      } else {
        status_masuk = actualMasukMin <= jadwalMasukMin + TOLERANCE_MIN
          ? "Masuk Tepat Waktu" : "Masuk Telat";
      }

    // Shift 3A non-ACCOUNTING
    } else if (kode.toUpperCase() === "3A") {
      if (masukDateStr === tanggal && actualMasukMin >= timeToMinutes("22:00")) {
        status_masuk = "Masuk Tepat Waktu";
      } else if (masukDateStr === nextDate && actualMasukMin <= timeToMinutes("00:15")) {
        status_masuk = "Masuk Tepat Waktu";
      } else {
        status_masuk = "Masuk Telat";
      }

    // Shift lintas hari biasa
    } else if (lintasHari) {
      const prevDate = dateAddDays(tanggal, -1);
      if (masukDateStr === tanggal && actualMasukMin <= jadwalMasukMin + TOLERANCE_MIN) {
        status_masuk = "Masuk Tepat Waktu";
      } else if (masukDateStr === prevDate && actualMasukMin >= jadwalMasukMin) {
        status_masuk = "Masuk Tepat Waktu";
      } else {
        status_masuk = "Masuk Telat";
      }

    // Shift normal biasa
    } else {
      status_masuk = actualMasukMin <= jadwalMasukMin + TOLERANCE_MIN
        ? "Masuk Tepat Waktu" : "Masuk Telat";
    }
  }

  // ─── STATUS PULANG ────────────────────────
  let status_pulang = "Tidak scan pulang";

  if (actualPulang) {
    const pulangTimeStr  = getTimeStr(actualPulang);
    const actualPulangMin = timeToMinutes(pulangTimeStr);
    const jadwalPulangMin = timeToMinutes(jp);

    if (!isAccounting) {
      // Non-ACCOUNTING: cek jam pulang ATAU durasi >= 90%
      if (actualPulangMin >= jadwalPulangMin ||
          (actualDurMin != null && actualDurMin >= expectedDurMin * 0.9)) {
        status_pulang = "Pulang Tepat Waktu";
      } else {
        status_pulang = "Pulang Terlalu Cepat";
      }
    } else {
      // ACCOUNTING: durasi >= 9 jam ATAU overstay >= 60 menit
      const jadwalPulangDt = lintasHari
        ? combineDT(nextDate, jp)
        : combineDT(tanggal, jp);
      const pulangDt    = dt(actualPulang);
      const overstayMin = jadwalPulangDt ? (pulangDt - jadwalPulangDt) / 60000 : 0;

      if (actualDurMin >= 540 || overstayMin >= 60 || actualPulangMin >= jadwalPulangMin) {
        status_pulang = "Pulang Tepat Waktu";
      } else {
        status_pulang = "Pulang Terlalu Cepat";
      }
    }
  }

  return {
    status_kehadiran: "Hadir",
    status_masuk,
    status_pulang,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate lateness minutes with shift prediction support
// 
// Returns object { telatMenit, kategori }
// kategori: "TIDAK_TELAT" | "TL_1_5" | "TL_5_10" | "TL_10"
//
// Logic:
// 1. Jika ada prediksi shift (Prediksi_Shift), gunakan jadwal dari shift prediksi
// 2. Jika menggunakan prediksi, gunakan Prediksi_Actual_Masuk untuk menghitung terlat
// 3. Pengelompokan: 5-6 menit = TL_1_5, 6-10 = TL_5_10, >10 = TL_10
// ═══════════════════════════════════════════════════════════════
function calculateLatenessFromCroscekData(
  row,
  infoList
) {
  // Determine which schedule to use (predicted or original)
  let jadwalMasukTime = row.Jadwal_Masuk;
  let actualMasukTime = row.Actual_Masuk;
  
  // If prediksi shift exists, use predicted schedule and scan times
  if (row.Prediksi_Shift && row.Prediksi_Actual_Masuk) {
    const predShiftInfo = infoList.find(
      (s) => String(s.kode).trim().toUpperCase() === String(row.Prediksi_Shift).trim().toUpperCase()
    );
    if (predShiftInfo) {
      jadwalMasukTime = predShiftInfo.jam_masuk;
      actualMasukTime = row.Prediksi_Actual_Masuk;
    }
  }

  // Extract time only if full datetime
  const jadwalMasukTimeStr = getTimeStr(jadwalMasukTime) || jadwalMasukTime;
  const actualMasukTimeStr = getTimeStr(actualMasukTime) || actualMasukTime;

  const jadwalMasukMin = timeToMinutes(jadwalMasukTimeStr);
  const actualMasukMin = timeToMinutes(actualMasukTimeStr);

  if (jadwalMasukMin === null || actualMasukMin === null) {
    return { telatMenit: null, kategori: "TIDAK_TERDETEKSI" };
  }

  // Calculate difference (normalize for 24-hour wrap)
  let diff = actualMasukMin - jadwalMasukMin;
  if (diff > 720) diff -= 1440;  // Jika perbedaan > 12 jam, anggap hari sebelumnya
  if (diff < -720) diff += 1440; // Jika perbedaan < -12 jam, anggap hari berikutnya

  // If masuk lebih awal atau tepat waktu, tidak terlat
  if (diff <= 0) {
    return { telatMenit: 0, kategori: "TIDAK_TELAT" };
  }

  // Kategorisasi keterlambatan
  let kategori = "TIDAK_TELAT";
  if (diff > 0 && diff <= 120) {
    // Terlat sampai 2 jam
    if (diff >= 4 && diff < 6) {
      kategori = "TL_1_5";  // 1-5 menit (value: 5-6 menit)
    } else if (diff >= 6 && diff <= 10) {
      kategori = "TL_5_10";  // 5-10 menit (value: 6-10 menit)
    } else if (diff > 10) {
      kategori = "TL_10";  // Lebih dari 10 menit
    }
  } else if (diff > 120) {
    // Lebih dari 2 jam, tidak masuk kategori terlat rekap (ungu)
    return { telatMenit: diff, kategori: "TIDAK_MASUK_REKAP" };
  }

  return { telatMenit: diff, kategori };
}

// ═══════════════════════════════════════════════════════════════
// CORE: Build historical frequency map
// Mirrors Python CTE historical_freq
// historical_freq[id_karyawan][kode_shift] = count
// ═══════════════════════════════════════════════════════════════
function buildHistoricalFreq(jadwalList) {
  const freq = new Map(); // `${id_karyawan}_${kode}` → count
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  for (const j of jadwalList) {
    if (new Date(`${j.tanggal}T00:00:00`) < cutoff) continue;
    if (SPECIAL_SHIFTS.includes(j.kode_shift)) continue;
    const key = `${j.id_karyawan}_${j.kode_shift}`;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  return freq;
}

// ═══════════════════════════════════════════════════════════════
// CORE: Predict shift (mirip Python CTE prediction_data)
// Picks the best matching shift code for a given scan pattern,
// weighted by scan-time closeness + historical frequency
// ═══════════════════════════════════════════════════════════════
function predictShift(
  karyawan, tanggal, scanMasuk, scanPulang,
  infoList, historicalFreq, usedPulangMalamSet, allAttendance
) {
  if (!scanMasuk && !scanPulang) return null; // tidak ada scan, tidak bisa prediksi

  const masukTime = scanMasuk ? getTimeStr(scanMasuk) : null;
  const pulangTime = scanPulang ? getTimeStr(scanPulang) : null;

  const candidates = infoList
    .filter((s) => !SPECIAL_SHIFTS.includes(s.kode) && s.lokasi_kerja === "Ciater")
    .map((s) => {
      const masukDiff = masukTime
        ? Math.abs(timeToMinutes(masukTime) - timeToMinutes(s.jam_masuk))
        : 999;
      const pulangDiff = pulangTime
        ? Math.abs(timeToMinutes(pulangTime) - timeToMinutes(s.jam_pulang))
        : 999;

      const freqKey = `${karyawan.id_karyawan}_${s.kode}`;
      const freq    = historicalFreq.get(freqKey) || 0;

      const finalScore = 0.7 * masukDiff + 0.3 * pulangDiff - freq * 5;

      // Confidence score (string label)
      const rawScore = 0.7 * masukDiff + 0.3 * pulangDiff;
      let confidence;
      if (rawScore <= 45)  confidence = "Sangat Tinggi";
      else if (rawScore <= 90) confidence = "Tinggi";
      else if (rawScore <= 180) confidence = "Sedang";
      else confidence = "Rendah";

      // Probabilitas (0-100)
      let probabilitas = 0;
      if (masukTime && pulangTime) {
        probabilitas = Math.round(100 * (1 - rawScore / 180));
      } else if (masukTime) {
        probabilitas = Math.round(50 * (1 - masukDiff / 90));
      } else if (pulangTime) {
        probabilitas = Math.round(50 * (1 - pulangDiff / 90));
      }

      return {
        kode_shift: s.kode,
        finalScore,
        confidence,
        probabilitas: Math.max(0, probabilitas),
        freq,
        jam_masuk: s.jam_masuk,
        jam_pulang: s.jam_pulang,
      };
    })
    .sort((a, b) => a.finalScore - b.finalScore);

  return candidates.length > 0 ? candidates[0] : null;
}

function inferPrediksiShiftForCompletedScan(
  jadwal,
  infoShift,
  karyawan,
  actualMasuk,
  actualPulang,
  infoList,
  historicalFreq
) {
  if (!actualMasuk || !actualPulang) return null;
  const currentKode = String(jadwal.kode_shift || "").trim().toUpperCase();
  if (!currentKode || SPECIAL_SHIFTS.includes(currentKode)) return null;

  const currentScore = scoreShiftByActualTimes(
    actualMasuk,
    actualPulang,
    infoShift?.jam_masuk,
    infoShift?.jam_pulang
  );
  if (!currentScore) return null;

  const pred = predictShift(
    karyawan,
    jadwal.tanggal,
    actualMasuk,
    actualPulang,
    infoList,
    historicalFreq
  );
  if (!pred) return null;

  const predKode = String(pred.kode_shift || "").trim().toUpperCase();
  if (!predKode || predKode === currentKode) return null;

  const predScore = scoreShiftByActualTimes(
    actualMasuk,
    actualPulang,
    pred.jam_masuk,
    pred.jam_pulang
  );
  if (!predScore) return null;

  // ✅ IMPROVED: Pendeteksian pindah shift lebih akurat
  // Jika selisih pulang > selisih masuk dan masuk di awal hari, 
  // kemungkinan karyawan pindah ke shift berikutnya
  const masukDiff = currentScore.diffMasuk;
  const pulangDiff = currentScore.diffPulang;
  const improvement = currentScore.total - predScore.total;
  
  // Kriteria 1: Shift prediksi JAUH lebih baik (improvement >= 40) dan match kuat
  const strongMatch1 = predScore.diffMasuk <= 30 && predScore.diffPulang <= 30;
  
  // Kriteria 2 (NEW): Jika pulang jauh lebih benar di shift baru, dan masuk awal (< 60 menit selisih)
  // Ini indikasi karyawan mungkin pindah shift karena pulang terlalu lama
  const strongMatch2 = predScore.diffPulang <= 15 && masukDiff < 60 && predScore.diffMasuk <= 45;
  
  // Kriteria 3 (NEW): Jika masuk dan pulang BOTH within 15 menit di shift prediksi
  const strongMatch3 = predScore.diffMasuk <= 15 && predScore.diffPulang <= 15;
  
  if ((!strongMatch1 && !strongMatch2 && !strongMatch3) || improvement < 20) return null;

  return {
    kode_shift: predKode,
    jam_masuk: pred.jam_masuk,
    jam_pulang: pred.jam_pulang,
    probabilitas: pred.probabilitas,
    confidence: pred.confidence,
    freq: historicalFreq.get(`${karyawan.id_karyawan}_${predKode}`) || pred.freq || 0,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPER: Batch fetch kehadiran dengan pagination untuk avoid rate limit/timeout
// Optional: filter by PIN set jika disediakan (untuk kategori tertentu)
// ═════════════════════════════════════════════════════════════════════════════
async function batchFetchKehadiran(batchSize = DEFAULT_BATCH_SIZE, pinSet = null, startDate = null, endDate = null) {
  const safeBatchSize = Math.min(Math.max(Number(batchSize) || DEFAULT_BATCH_SIZE, 1), DEFAULT_BATCH_SIZE);
  console.log(`⏳ Batch fetching kehadiran${pinSet ? ` for ${pinSet.size} PINs` : ""}${startDate && endDate ? ` (${startDate}..${endDate})` : ""}...`);
  let allKehadiran = [];
  let offset = 0;
  let batchNum = 0;
  const endDateExclusive = endDate ? (dateAddDays(endDate, 1) || endDate) : null;
  const startScanTs = startDate ? `${startDate}T00:00:00+07:00` : null;
  const endScanTs = endDateExclusive ? `${endDateExclusive}T00:00:00+07:00` : null;
  let useTanggalScanFilter = !!(startDate || endDate);

  while (true) {
    batchNum++;
    console.log(`   📦 Batch ${batchNum}: fetching rows ${offset}-${offset + safeBatchSize - 1}...`);
    
    let query = supabase
      .from("kehadiran_karyawan")
      .select("*")
      .order("tanggal_scan", { ascending: true });

    // ✅ FIX: Add PIN filter DURING query (not after) to reduce data transfer
    if (pinSet && pinSet.size > 0) {
      const pinArray = Array.from(pinSet);
      query = query.in("pin", pinArray);
    }

    if (useTanggalScanFilter) {
      if (startScanTs) query = query.gte("tanggal_scan", startScanTs);
      if (endScanTs) query = query.lt("tanggal_scan", endScanTs);
    } else {
      if (startDate) query = query.gte("tanggal", startDate);
      if (endDate) query = query.lte("tanggal", endDate);
    }

    query = query.range(offset, offset + safeBatchSize - 1);

    const { data, error } = await query;

    if (error && useTanggalScanFilter) {
      console.warn(`   ⚠️ tanggal_scan filter failed (${error.message || error}). Fallback ke kolom tanggal.`);
      useTanggalScanFilter = false;
      allKehadiran = [];
      offset = 0;
      batchNum = 0;
      continue;
    }

    if (error) throw error;
    
    if (!data || data.length === 0) {
      console.log(`   ✅ Batch ${batchNum}: No more data. Total: ${allKehadiran.length} records`);
      break;
    }

    console.log(`   ✅ Batch ${batchNum}: Fetched ${data.length} records (cumulative: ${allKehadiran.length + data.length})`);
    allKehadiran = allKehadiran.concat(data);
    // IMPORTANT: advance by actual rows returned to avoid large skips when API caps rows (e.g., 1000).
    offset += data.length;

    // If returned rows are less than requested page size, we've reached the end.
    if (data.length < safeBatchSize) {
      console.log(`   ✅ Batch ${batchNum}: last page reached.`);
      break;
    }

    // Prevent infinite loop
    if (batchNum > 1000) {
      console.warn(`   ⚠️  Safety limit: Stopped after ${batchNum} batches`);
      break;
    }
  }

  console.log(`📊 Total kehadiran fetched: ${allKehadiran.length} records in ${batchNum} batch(es)`);
  return allKehadiran;
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPER: Batch fetch croscek data dengan pagination untuk bypass Supabase 1000-row limit
// ═════════════════════════════════════════════════════════════════════════════
async function batchFetchCroscekData(tableName = "croscek", batchSize = 1000) {
  const safeBatchSize = getSafeBatchSize(batchSize);
  console.log(`⏳ Batch fetching ${tableName} (${safeBatchSize} rows per request)...`);
  let allData = [];
  let offset = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    console.log(`   📦 Batch ${batchNum}: fetching rows ${offset}-${offset + safeBatchSize - 1}...`);
    
    const { data, error } = await supabase
      .from(tableName)
      .select(`Nama, Tanggal, Kode_Shift, Jabatan, Departemen, id_karyawan, NIK,
               Jadwal_Masuk, Jadwal_Pulang, Actual_Masuk, Actual_Pulang,
               Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang,
               Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis,
               Status_Kehadiran, Status_Masuk, Status_Pulang`)
      .order("Tanggal", { ascending: true })
      .order("Nama", { ascending: true })
      .order("id_karyawan", { ascending: true })
      .order("Kode_Shift", { ascending: true })
      .range(offset, offset + safeBatchSize - 1);

    if (error) throw error;
    
    if (!data || data.length === 0) {
      console.log(`   ✅ Batch ${batchNum}: No more data. Total: ${allData.length} records`);
      break;
    }

    console.log(`   ✅ Batch ${batchNum}: Fetched ${data.length} records (cumulative: ${allData.length + data.length})`);
    allData = allData.concat(data);
    offset += data.length;

    if (data.length < safeBatchSize) break;

    // Prevent infinite loop
    if (batchNum > 20000) {
      console.warn(`   ⚠️  Safety limit: Stopped after ${batchNum} batches`);
      break;
    }
  }

  console.log(`📊 Total ${tableName} fetched: ${allData.length} records in ${batchNum} batch(es)`);
  return allData;
}

async function batchFetchJadwalKeys(startDate, endDate, batchSize = DEFAULT_BATCH_SIZE) {
  const safeBatchSize = getSafeBatchSize(batchSize);
  let rows = [];
  let offset = 0;
  let batchNum = 0;
  while (true) {
    batchNum++;
    const { data, error } = await supabase
      .from("jadwal_karyawan")
      .select("id_karyawan, tanggal, kode_shift, no")
      .gte("tanggal", startDate)
      .lte("tanggal", endDate)
      .order("tanggal", { ascending: true })
      .order("no", { ascending: true })
      .range(offset, offset + safeBatchSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    offset += data.length;
    if (data.length < safeBatchSize) break;
    if (batchNum > 20000) {
      console.warn("⚠️ batchFetchJadwalKeys safety stop");
      break;
    }
  }
  return rows;
}

async function batchFetchCroscekKeys(tableName, startDate, endDate, batchSize = DEFAULT_BATCH_SIZE) {
  const safeBatchSize = getSafeBatchSize(batchSize);
  let rows = [];
  let offset = 0;
  let batchNum = 0;
  while (true) {
    batchNum++;
    const { data, error } = await supabase
      .from(tableName)
      .select("id_karyawan, Tanggal, Kode_Shift")
      .gte("Tanggal", startDate)
      .lte("Tanggal", endDate)
      .order("Tanggal", { ascending: true })
      .order("id_karyawan", { ascending: true })
      .order("Kode_Shift", { ascending: true })
      .range(offset, offset + safeBatchSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    offset += data.length;
    if (data.length < safeBatchSize) break;
    if (batchNum > 20000) {
      console.warn(`⚠️ batchFetchCroscekKeys(${tableName}) safety stop`);
      break;
    }
  }
  return rows;
}

async function resetCroscekTable(tableName) {
  console.log(`🧹 Reset table ${tableName} sebelum proses ulang...`);
  const { error } = await supabase
    .from(tableName)
    .delete()
    .gte("id", 0);
  if (error) throw error;
}

// removed duplicate legacy paginated function (replaced by new paginated implementation earlier)

// ═══════════════════════════════════════════════════════════════
// ROUTE HANDLERS
// ═══════════════════════════════════════════════════════════════

// GET /api/croscek-karyawan
// 🔥 OPTIMIZED: Cache checking + Batch processing + PIN matching
export async function getCroscekKaryawan(req, res) {
  try {
    console.log("📊 GET /api/croscek-karyawan (OPTIMIZED)");
    const forceReprocess = ["1", "true", "yes"].includes(String(req.query?.force || "").toLowerCase());

    // 🔥 OPTIMIZATION 1: Check if ALL data ALREADY PROCESSED (not just for today)
    // Get date range dari jadwal yang tersedia (min dan max tanggal)
    const { data: jadwalStats, error: statsError } = await supabase
      .from("jadwal_karyawan")
      .select("tanggal")
      .order("tanggal", { ascending: true })
      .limit(1);

    const { data: jadwalStatsMax, error: statsErrorMax } = await supabase
      .from("jadwal_karyawan")
      .select("tanggal")
      .order("tanggal", { ascending: false })
      .limit(1);

    if (statsError || statsErrorMax) throw (statsError || statsErrorMax);

    const minTanggal = jadwalStats?.[0]?.tanggal || null;
    const maxTanggal = jadwalStatsMax?.[0]?.tanggal || null;

    if (!minTanggal || !maxTanggal) {
      console.log("❌ No jadwal data found");
      return res.json({ 
        data: [], 
        summary: { 
          total: 0, 
          inserted: 0, 
          skipped: 0, 
          from_cache: false 
        } 
      });
    }

    console.log(`📋 Jadwal range: ${minTanggal} to ${maxTanggal}`);

    // Build allowed id_karyawan set from master karyawan table (batch-safe)
    const karyawanRows = await batchFetchAllRows({
      tableName: "karyawan",
      selectFields: "id_karyawan",
      filters: [{ type: "eq", field: "kategori", value: "karyawan" }],
      orders: [{ field: "id_karyawan", asc: true }],
      batchSize: DEFAULT_BATCH_SIZE,
    });
    const karyawanIdSet = new Set((karyawanRows || []).map((r) => String(r.id_karyawan)));

    // Build expected key set from jadwal (paginated) to avoid 1000-row truncation
    const jadwalRows = await batchFetchJadwalKeys(minTanggal, maxTanggal, DEFAULT_BATCH_SIZE);
    const expectedRows = (jadwalRows || []).filter((r) => karyawanIdSet.has(String(r.id_karyawan))).length;
    const jadwalKategoriRows = expectedRows;
    const jadwalDuplicateRows = 0;
    if (expectedRows === 0) {
      return res.json({
        data: [],
        summary: {
          total: 0,
          inserted: 0,
          skipped: 0,
          from_cache: false,
          expected_rows: 0,
          processed_rows: 0,
          row_gap: 0,
        },
      });
    }
    console.log(`📋 Expected unique jadwal keys (karyawan): ${expectedRows}`);
    console.log(`📋 Jadwal rows (karyawan): ${jadwalKategoriRows}, duplicate keys: ${jadwalDuplicateRows}`);

    // Build processed key set from croscek (paginated) to avoid cache false-positive
    const croscekRows = await batchFetchCroscekKeys("croscek", minTanggal, maxTanggal, DEFAULT_BATCH_SIZE);
    const processedRows = (croscekRows || []).filter((r) => karyawanIdSet.has(String(r.id_karyawan))).length;
    const rowGap = expectedRows - processedRows;
    const missingRows = rowGap;
    console.log(`✅ Processed unique croscek keys: ${processedRows}/${expectedRows} (missing: ${Math.max(0, missingRows)})`);

    // Cache hit only if key-level coverage is complete
    if (!forceReprocess && expectedRows > 0 && rowGap === 0) {
      console.log(`✅ Cache hit: ALL karyawan processed for date range ${minTanggal} to ${maxTanggal}`);
      const data = await batchFetchCroscekData("croscek", DEFAULT_BATCH_SIZE);
      return res.json({
        data: (data || []).map(serializeCroscekRow),
        summary: { 
          total: data?.length || 0, 
          inserted: 0, 
          skipped: 0, 
          from_cache: true,
          expected_rows: expectedRows,
          processed_rows: processedRows,
          row_gap: rowGap,
          jadwal_rows_kategori: jadwalKategoriRows,
          jadwal_duplicate_keys: jadwalDuplicateRows
        },
      });
    } else if (forceReprocess) {
      console.log(`♻️ Force reprocess enabled (?force=1). Rebuilding croscek rows...`);
    } else if (expectedRows > 0) {
      console.log(`⚠️  Incomplete coverage: ${processedRows}/${expectedRows} unique keys processed. Re-processing...`);
    }

    // Cache miss → process ALL karyawan (no exclude set, since checking full range)
    console.log("⏳ Processing full date range (paginated)...");
    if (!forceReprocess && expectedRows > 0 && rowGap !== 0) {
      const mode = rowGap > 0 ? "kurang" : "lebih";
      console.log(`Validasi jumlah baris tidak match: croscek ${mode} ${Math.abs(rowGap)} baris dibanding jadwal.`);
    }

    if (forceReprocess || rowGap < 0) {
      await resetCroscekTable("croscek");
    }

    const summary = await processCroscekData("karyawan", null);
    if (!summary || summary.totalProcessed === 0) {
      return res.json({ data: [], summary: { total: 0, inserted: 0, skipped: 0, from_cache: false } });
    }
    console.log(`📦 Processing complete: processed=${summary.totalProcessed}, inserted=${summary.inserted}, skipped=${summary.skippedInsert}`);

    // Return final data from cache with BATCH FETCHING to bypass 1000-row Supabase limit
    console.log(`🔍 Fetching final data from croscek table (with pagination)...`);
    const finalData = await batchFetchCroscekData("croscek", DEFAULT_BATCH_SIZE);
    
    console.log(`✅ Fetched ${finalData?.length || 0} final rows from croscek (ALL DATA)`);
    
    // Debug: Count hasil per karyawan
    const finalPerKaryawan = new Map();
    for (const r of (finalData || [])) {
      const key = String(r.id_karyawan);
      if (!finalPerKaryawan.has(key)) finalPerKaryawan.set(key, []);
      finalPerKaryawan.get(key).push(r);
    }
    console.log(`📊 Final result: ${finalPerKaryawan.size} unique karyawan`);
    
    // Log top 5 karyawan by row count
    const sortedFinal = Array.from(finalPerKaryawan.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);
    for (const [kId, rows] of sortedFinal) {
      console.log(`   - id_karyawan ${kId}: ${rows.length} rows`);
    }

    return res.json({
      data: (finalData || []).map(serializeCroscekRow),
      summary: { 
        total: finalData?.length || 0, 
        inserted: summary.inserted, 
        skipped: summary.skippedInsert, 
        from_cache: false,
        final_fetched: finalData?.length || 0,
        expected_rows: expectedRows,
        processed_rows_before_run: processedRows,
        row_gap_before_run: rowGap,
        jadwal_rows_kategori: jadwalKategoriRows,
        jadwal_duplicate_keys: jadwalDuplicateRows,
        process_stats: summary.stats || null
      },
    });
  } catch (e) {
    console.error("❌ getCroscekKaryawan:", e);
    return res.status(500).json({ error: e.message });
  }
}

// POST /api/croscek-karyawan
export async function saveCroscekKaryawan(req, res) {
  try {
    const data = req.body;
    if (!data || !Array.isArray(data)) return res.status(400).json({ error: "Invalid payload" });

    console.log(`💾 saveCroscekKaryawan: ${data.length} records (UPSERT mode)`);

    // Prepare data untuk insert/update
    const prepareRow = (row) => ({
      Nama:               row.Nama,
      Tanggal:            typeof row.Tanggal === "string" ? row.Tanggal.split("T")[0] : row.Tanggal,
      Kode_Shift:         row.Kode_Shift,
      Jabatan:            row.Jabatan,
      Departemen:         row.Departemen,
      id_karyawan:        row.id_karyawan,
      NIK:                row.NIK,
      Jadwal_Masuk:       row.Jadwal_Masuk,
      Jadwal_Pulang:      row.Jadwal_Pulang,
      Actual_Masuk:       row.Actual_Masuk,
      Actual_Pulang:      row.Actual_Pulang,
      Prediksi_Shift:         row.Prediksi_Shift,
      Prediksi_Actual_Masuk:  row.Prediksi_Actual_Masuk,
      Prediksi_Actual_Pulang: row.Prediksi_Actual_Pulang,
      Probabilitas_Prediksi:  row.Probabilitas_Prediksi,
      Confidence_Score:       row.Confidence_Score,
      Frekuensi_Shift_Historis: row.Frekuensi_Shift_Historis,
      Status_Kehadiran:   row.Status_Kehadiran,
      Status_Masuk:       row.Status_Masuk,
      Status_Pulang:      row.Status_Pulang,
    });

    // Deduplicate by (id_karyawan, Tanggal, Kode_Shift)
    const keyMap = new Map();
    for (const row of data) {
      const prepared = prepareRow(row);
      const key = `${prepared.id_karyawan}|${prepared.Tanggal}|${prepared.Kode_Shift}`;
      if (!keyMap.has(key)) {
        keyMap.set(key, prepared);
      }
    }
    const dedupedData = Array.from(keyMap.values());
    console.log(`🔍 After dedup: ${dedupedData.length} unique records (removed ${data.length - dedupedData.length} duplicates)`);

    // ⚡ OPTIMIZED: Batch fetch ALL existing records at once (per 1000), then map locally
    console.log(`⏳ Batch fetching all existing records from croscek...`);
    const existingMap = new Map();
    let offset = 0;
    let batchNum = 0;

    while (true) {
      batchNum++;
      const { data: existingBatch, error: fetchErr } = await supabase
        .from("croscek")
        .select("id_karyawan, Tanggal, Kode_Shift, Nama, Jabatan, Departemen, NIK, Jadwal_Masuk, Jadwal_Pulang, Actual_Masuk, Actual_Pulang, Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang, Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis, Status_Kehadiran, Status_Masuk, Status_Pulang")
        .order("Tanggal", { ascending: true })
        .range(offset, offset + 999);

      if (fetchErr) throw fetchErr;

      if (!existingBatch || existingBatch.length === 0) {
        console.log(`   ✅ Batch ${batchNum}: No more records. Total existing: ${existingMap.size}`);
        break;
      }

      console.log(`   📦 Batch ${batchNum}: Fetched ${existingBatch.length} records (offset: ${offset})`);

      // Map by key (id_karyawan|Tanggal|Kode_Shift)
      for (const rec of existingBatch) {
        const key = `${rec.id_karyawan}|${rec.Tanggal}|${rec.Kode_Shift}`;
        if (!existingMap.has(key)) {
          existingMap.set(key, rec);
        }
      }

      offset += 1000;

      // Safety limit
      if (batchNum > 1000) {
        console.warn(`⚠️  Safety limit: Stopped after ${batchNum} batches`);
        break;
      }
    }

    console.log(`📊 Total existing records in map: ${existingMap.size}`);


    // Separate insert vs update
    const toInsert = [];
    const toUpdate = [];
    const changeLog = []; // Track changes

    for (const prepared of dedupedData) {
      const key = `${prepared.id_karyawan}|${prepared.Tanggal}|${prepared.Kode_Shift}`;
      const existing = existingMap.get(key);

      if (!existing) {
        // NEW RECORD
        toInsert.push(prepared);
      } else {
        // EXISTING RECORD - check for changes
        const changes = {};
        let hasChanges = false;

        for (const [field, newVal] of Object.entries(prepared)) {
          const oldVal = existing[field];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            changes[field] = { old: oldVal, new: newVal };
            hasChanges = true;
          }
        }

        if (hasChanges) {
          toUpdate.push({
            key: key,  // Use key tuple instead of id
            data: changes,
            record: prepared,
            existing: existing,
          });

          // Track for summary
          const changedFields = Object.keys(changes);
          changeLog.push({
            nama: prepared.Nama,
            tanggal: prepared.Tanggal,
            kode_shift: prepared.Kode_Shift,
            fields: changedFields,
          });
        }
      }
    }

    console.log(`📝 To Insert: ${toInsert.length}, To Update: ${toUpdate.length}`);

    // Perform INSERT in batches (with fallback to UPDATE on duplicate key error)
    let insertedCount = 0;
    let fallbackUpdateCount = 0;
    const failedInserts = [];
    
    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += 500) {
        const batch = toInsert.slice(i, i + 500);
        const { error: insertErr } = await supabase
          .from("croscek")
          .insert(batch);

        if (insertErr) {
          console.error(`⚠️  Insert batch error at offset ${i}: ${insertErr.code}`, insertErr.details);
          
          // If duplicate key error, try to update each record individually
          if (insertErr.code === '23505') {
            console.log(`   🔄 Attempting fallback UPDATE for ${batch.length} records...`);
            
            for (const record of batch) {
              const key = `${record.id_karyawan}|${record.Tanggal}|${record.Kode_Shift}`;
              
              // Try UPDATE
              const updateData = { ...record };
              delete updateData.id_karyawan;
              delete updateData.Tanggal;
              delete updateData.Kode_Shift;
              
              const { error: updateErr } = await supabase
                .from("croscek")
                .update(updateData)
                .eq("id_karyawan", record.id_karyawan)
                .eq("Tanggal", record.Tanggal)
                .eq("Kode_Shift", record.Kode_Shift);
              
              if (updateErr) {
                console.error(`   ❌ Fallback UPDATE failed for key=${key}:`, updateErr.message);
                failedInserts.push({ key, error: updateErr.message });
              } else {
                fallbackUpdateCount++;
                console.log(`   ✅ Fallback UPDATE success for key=${key}`);
              }
            }
          } else {
            throw insertErr;
          }
        } else {
          insertedCount += batch.length;
          console.log(`   ✅ Inserted: ${batch.length} (cumulative: ${insertedCount})`);
        }
      }
    }

    // Perform UPDATE in batches
    let updatedCount = 0;
    if (toUpdate.length > 0) {
      for (let i = 0; i < toUpdate.length; i += 100) {
        const batch = toUpdate.slice(i, i + 100);

        for (const item of batch) {
          // Build updateable fields (only changed ones)
          const updateData = {};
          for (const [field, change] of Object.entries(item.data)) {
            updateData[field] = change.new;
          }

          // Parse key to get id_karyawan, Tanggal, Kode_Shift
          const [id_karyawan, Tanggal, Kode_Shift] = item.key.split('|');

          const { error: updateErr } = await supabase
            .from("croscek")
            .update(updateData)
            .eq("id_karyawan", parseInt(id_karyawan))
            .eq("Tanggal", Tanggal)
            .eq("Kode_Shift", Kode_Shift);

          if (updateErr) {
            console.error(`⚠️  Update error for key=${item.key}:`, updateErr.message);
            // Continue dengan record lain
          } else {
            updatedCount++;
          }
        }
        console.log(`   ✅ Updated: ${batch.length} (cumulative: ${updatedCount})`);
      }
    }

    console.log(`✅ Insert/Update completed: inserted=${insertedCount}, updated=${updatedCount}`);

    // Fetch final data dengan batch
    const finalData = await batchFetchCroscekData("croscek", 1000);

    // Build response dengan change summary
    const uniqueChanges = changeLog.reduce((acc, log) => {
      const key = `${log.nama}|${log.tanggal}|${log.kode_shift}`;
      if (!acc.has(key)) {
        acc.set(key, log);
      }
      return acc;
    }, new Map());

    return res.json({
      success: true,
      total: dedupedData.length,
      inserted: insertedCount,
      updated: updatedCount,
      changes: Array.from(uniqueChanges.values()),
      data: (finalData || []).map(serializeCroscekRow),
      summary: {
        message: `✅ Berhasil! ${insertedCount} data baru ditambahkan, ${updatedCount} data diperbarui`,
        inserted: insertedCount,
        updated: updatedCount,
        changeCount: changeLog.length,
      }
    });
  } catch (e) {
    console.error("❌ saveCroscekKaryawan:", e);
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/croscek-karyawan/final
export async function getCroscekKaryawanFinal(req, res) {
  try {
    const data = await batchFetchCroscekData("croscek", DEFAULT_BATCH_SIZE);
    return res.json({ success: true, data: (data || []).map(serializeCroscekRow) });
  } catch (e) {
    console.error("❌ getCroscekKaryawanFinal:", e);
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/croscek-dw
// 🔥 OPTIMIZED: Cache checking + Batch processing + PIN matching
export async function getCroscekDW(req, res) {
  try {
    console.log("📊 GET /api/croscek-dw (OPTIMIZED)");
    const forceReprocess = ["1", "true", "yes"].includes(String(req.query?.force || "").toLowerCase());

    // Build allowed id_karyawan set from karyawan kategori=dw
    const dwRows = await batchFetchAllRows({
      tableName: "karyawan",
      selectFields: "id_karyawan",
      filters: [{ type: "eq", field: "kategori", value: "dw" }],
      orders: [{ field: "id_karyawan", asc: true }],
      batchSize: DEFAULT_BATCH_SIZE,
    });
    const dwIdSet = new Set((dwRows || []).map((r) => String(r.id_karyawan)));
    if (dwIdSet.size === 0) {
      console.log("❌ No DW karyawan found");
      return res.json({
        data: [],
        summary: { total: 0, inserted: 0, skipped: 0, from_cache: false }
      });
    }

    // Load jadwal once, then derive date range + expected rows for DW ids
    const { data: jadwalStats, error: statsError } = await supabase
      .from("jadwal_karyawan")
      .select("tanggal")
      .order("tanggal", { ascending: true })
      .limit(1);

    const { data: jadwalStatsMax, error: statsErrorMax } = await supabase
      .from("jadwal_karyawan")
      .select("tanggal")
      .order("tanggal", { ascending: false })
      .limit(1);

    if (statsError || statsErrorMax) throw (statsError || statsErrorMax);
    const minTanggal = jadwalStats?.[0]?.tanggal || null;
    const maxTanggal = jadwalStatsMax?.[0]?.tanggal || null;
    const jadwalRows = minTanggal && maxTanggal
      ? await batchFetchJadwalKeys(minTanggal, maxTanggal, DEFAULT_BATCH_SIZE)
      : [];
    const jadwalDWFiltered = (jadwalRows || []).filter((r) => dwIdSet.has(String(r.id_karyawan)) && r.tanggal);
    if (jadwalDWFiltered.length === 0) {
      console.log("❌ No jadwal DW data found");
      return res.json({
        data: [],
        summary: { total: 0, inserted: 0, skipped: 0, from_cache: false }
      });
    }
    console.log(`📋 Jadwal DW range: ${minTanggal} to ${maxTanggal}`);

    const expectedDWRows = jadwalDWFiltered.length;
    console.log(`📋 Expected jadwal rows (DW) in range: ${expectedDWRows}`);

    // Count processed rows in croscek_dw in same range
    const croscekDWInRange = await batchFetchCroscekKeys("croscek_dw", minTanggal, maxTanggal, DEFAULT_BATCH_SIZE);
    const processedDWRows = (croscekDWInRange || []).filter((r) => dwIdSet.has(String(r.id_karyawan))).length;
    const rowGap = expectedDWRows - processedDWRows;
    console.log(`✅ Processed croscek_dw rows in range: ${processedDWRows}/${expectedDWRows}`);

    // Cache hit ONLY if all expected rows are present
    if (!forceReprocess && expectedDWRows > 0 && rowGap === 0) {
      console.log(`✅ Cache hit: ALL DW processed for date range ${minTanggal} to ${maxTanggal}`);
      // Use batch fetch to get ALL data (bypass 1000-row limit)
      const data = await batchFetchCroscekData("croscek_dw", DEFAULT_BATCH_SIZE);
      return res.json({
        data: (data || []).map(serializeCroscekRow),
        summary: { 
          total: data?.length || 0, 
          inserted: 0, 
          skipped: 0, 
          from_cache: true,
          final_fetched: data?.length || 0,
          expected_rows: expectedDWRows,
          processed_rows: processedDWRows,
          row_gap: rowGap
        },
      });
    } else if (forceReprocess) {
      console.log(`♻️ Force reprocess enabled (?force=1). Rebuilding croscek_dw rows...`);
    } else if (expectedDWRows > 0) {
      console.log(`⚠️  Incomplete coverage: ${processedDWRows}/${expectedDWRows} rows processed. Re-processing...`);
    }

    // Cache miss → process ALL DW (paginated and upserted inside)
    console.log("⏳ Processing full date range (paginated)...");
    if (!forceReprocess && expectedDWRows > 0 && rowGap !== 0) {
      const mode = rowGap > 0 ? "kurang" : "lebih";
      console.log(`Validasi jumlah baris DW tidak match: croscek ${mode} ${Math.abs(rowGap)} baris dibanding jadwal.`);
    }

    if (forceReprocess || rowGap < 0) {
      await resetCroscekTable("croscek_dw");
    }

    const summary = await processCroscekData("dw", null);
    if (!summary || summary.totalProcessed === 0) {
      return res.json({ data: [], summary: { total: 0, inserted: 0, skipped: 0, from_cache: false } });
    }
    console.log(`📦 Processing complete: processed=${summary.totalProcessed}, inserted=${summary.inserted}, skipped=${summary.skippedInsert}`);

    // Return final data from cache with BATCH FETCHING to bypass 1000-row Supabase limit
    console.log(`🔍 Fetching final data from croscek_dw table (with pagination)...`);
    const finalData = await batchFetchCroscekData("croscek_dw", DEFAULT_BATCH_SIZE);
    
    console.log(`✅ Fetched ${finalData?.length || 0} final rows from croscek_dw (ALL DATA)`);
    
    // Debug: Count hasil per karyawan
    const finalPerKaryawan = new Map();
    for (const r of (finalData || [])) {
      const key = String(r.id_karyawan);
      if (!finalPerKaryawan.has(key)) finalPerKaryawan.set(key, []);
      finalPerKaryawan.get(key).push(r);
    }
    console.log(`📊 Final result: ${finalPerKaryawan.size} unique DW`);
    
    // Log top 5 DW by row count
    const sortedFinal = Array.from(finalPerKaryawan.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);
    for (const [kId, rows] of sortedFinal) {
      console.log(`   - id_karyawan ${kId}: ${rows.length} rows`);
    }

    return res.json({
      data: (finalData || []).map(serializeCroscekRow),
      summary: { 
        total: finalData?.length || 0,
        inserted: summary.inserted,
        skipped: summary.skippedInsert,
        from_cache: false,
        final_fetched: finalData?.length || 0,
        expected_rows: expectedDWRows,
        processed_rows_before_run: processedDWRows,
        row_gap_before_run: rowGap
      },
    });
  } catch (e) {
    console.error("❌ getCroscekDW:", e);
    return res.status(500).json({ error: e.message });
  }
}

// POST /api/croscek-dw
export async function saveCroscekDW(req, res) {
  try {
    const data = req.body;
    if (!data || !Array.isArray(data)) return res.status(400).json({ error: "Invalid payload" });

    console.log(`💾 saveCroscekDW: ${data.length} records (UPSERT mode)`);

    // Prepare data untuk insert/update
    const prepareRow = (row) => ({
      Nama:               row.Nama,
      Tanggal:            typeof row.Tanggal === "string" ? row.Tanggal.split("T")[0] : row.Tanggal,
      Kode_Shift:         row.Kode_Shift,
      Jabatan:            row.Jabatan,
      Departemen:         row.Departemen,
      id_karyawan:        row.id_karyawan,
      NIK:                row.NIK,
      Jadwal_Masuk:       row.Jadwal_Masuk,
      Jadwal_Pulang:      row.Jadwal_Pulang,
      Actual_Masuk:       row.Actual_Masuk,
      Actual_Pulang:      row.Actual_Pulang,
      Prediksi_Shift:         row.Prediksi_Shift,
      Prediksi_Actual_Masuk:  row.Prediksi_Actual_Masuk,
      Prediksi_Actual_Pulang: row.Prediksi_Actual_Pulang,
      Probabilitas_Prediksi:  row.Probabilitas_Prediksi,
      Confidence_Score:       row.Confidence_Score,
      Frekuensi_Shift_Historis: row.Frekuensi_Shift_Historis,
      Status_Kehadiran:   row.Status_Kehadiran,
      Status_Masuk:       row.Status_Masuk,
      Status_Pulang:      row.Status_Pulang,
    });

    // Deduplicate by (id_karyawan, Tanggal, Kode_Shift)
    const keyMap = new Map();
    for (const row of data) {
      const prepared = prepareRow(row);
      const key = `${prepared.id_karyawan}|${prepared.Tanggal}|${prepared.Kode_Shift}`;
      if (!keyMap.has(key)) {
        keyMap.set(key, prepared);
      }
    }
    const dedupedData = Array.from(keyMap.values());
    console.log(`🔍 After dedup: ${dedupedData.length} unique records (removed ${data.length - dedupedData.length} duplicates)`);

    // ⚡ OPTIMIZED: Batch fetch ALL existing records at once (per 1000), then map locally
    console.log(`⏳ Batch fetching all existing records from croscek_dw...`);
    const existingMap = new Map();
    let offset = 0;
    let batchNum = 0;

    while (true) {
      batchNum++;
      const { data: existingBatch, error: fetchErr } = await supabase
        .from("croscek_dw")
        .select("id_karyawan, Tanggal, Kode_Shift, Nama, Jabatan, Departemen, NIK, Jadwal_Masuk, Jadwal_Pulang, Actual_Masuk, Actual_Pulang, Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang, Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis, Status_Kehadiran, Status_Masuk, Status_Pulang")
        .order("Nama", { ascending: true })
        .order("Tanggal", { ascending: true })
        .range(offset, offset + 999);

      if (fetchErr) throw fetchErr;

      if (!existingBatch || existingBatch.length === 0) {
        console.log(`   ✅ Batch ${batchNum}: No more records. Total existing: ${existingMap.size}`);
        break;
      }

      console.log(`   📦 Batch ${batchNum}: Fetched ${existingBatch.length} records (offset: ${offset})`);

      // Map by key (id_karyawan|Tanggal|Kode_Shift)
      for (const rec of existingBatch) {
        const key = `${rec.id_karyawan}|${rec.Tanggal}|${rec.Kode_Shift}`;
        if (!existingMap.has(key)) {
          existingMap.set(key, rec);
        }
      }

      offset += 1000;

      // Safety limit
      if (batchNum > 1000) {
        console.warn(`⚠️  Safety limit: Stopped after ${batchNum} batches`);
        break;
      }
    }

    console.log(`📊 Total existing records in map: ${existingMap.size}`);

    // Separate insert vs update
    const toInsert = [];
    const toUpdate = [];
    const changeLog = []; // Track changes

    for (const prepared of dedupedData) {
      const key = `${prepared.id_karyawan}|${prepared.Tanggal}|${prepared.Kode_Shift}`;
      const existing = existingMap.get(key);

      if (!existing) {
        // NEW RECORD
        toInsert.push(prepared);
      } else {
        // EXISTING RECORD - check for changes
        const changes = {};
        let hasChanges = false;

        for (const [field, newVal] of Object.entries(prepared)) {
          const oldVal = existing[field];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            changes[field] = { old: oldVal, new: newVal };
            hasChanges = true;
          }
        }

        if (hasChanges) {
          toUpdate.push({
            key: key,  // Use key tuple instead of id
            data: changes,
            record: prepared,
            existing: existing,
          });

          // Track for summary
          const changedFields = Object.keys(changes);
          changeLog.push({
            nama: prepared.Nama,
            tanggal: prepared.Tanggal,
            kode_shift: prepared.Kode_Shift,
            fields: changedFields,
          });
        }
      }
    }

    console.log(`📝 To Insert: ${toInsert.length}, To Update: ${toUpdate.length}`);

    // Perform INSERT in batches (with fallback to UPDATE on duplicate key error)
    let insertedCount = 0;
    let fallbackUpdateCount = 0;
    const failedInserts = [];
    
    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += 500) {
        const batch = toInsert.slice(i, i + 500);
        const { error: insertErr } = await supabase
          .from("croscek_dw")
          .insert(batch);

        if (insertErr) {
          console.error(`⚠️  Insert batch error at offset ${i}: ${insertErr.code}`, insertErr.details);
          
          // If duplicate key error, try to update each record individually
          if (insertErr.code === '23505') {
            console.log(`   🔄 Attempting fallback UPDATE for ${batch.length} records...`);
            
            for (const record of batch) {
              const key = `${record.id_karyawan}|${record.Tanggal}|${record.Kode_Shift}`;
              
              // Try UPDATE
              const updateData = { ...record };
              delete updateData.id_karyawan;
              delete updateData.Tanggal;
              delete updateData.Kode_Shift;
              
              const { error: updateErr } = await supabase
                .from("croscek_dw")
                .update(updateData)
                .eq("id_karyawan", record.id_karyawan)
                .eq("Tanggal", record.Tanggal)
                .eq("Kode_Shift", record.Kode_Shift);
              
              if (updateErr) {
                console.error(`   ❌ Fallback UPDATE failed for key=${key}:`, updateErr.message);
                failedInserts.push({ key, error: updateErr.message });
              } else {
                fallbackUpdateCount++;
                console.log(`   ✅ Fallback UPDATE success for key=${key}`);
              }
            }
          } else {
            throw insertErr;
          }
        } else {
          insertedCount += batch.length;
          console.log(`   ✅ Inserted: ${batch.length} (cumulative: ${insertedCount})`);
        }
      }
    }
    
    // Add fallback updates to total
    updatedCount += fallbackUpdateCount;
    console.log(`   📊 Fallback updates: ${fallbackUpdateCount}`);

    // Perform UPDATE in batches (explicit updates - those we detected changes for)
    if (toUpdate.length > 0) {
      for (let i = 0; i < toUpdate.length; i += 100) {
        const batch = toUpdate.slice(i, i + 100);

        for (const item of batch) {
          // Build updateable fields (only changed ones)
          const updateData = {};
          for (const [field, change] of Object.entries(item.data)) {
            updateData[field] = change.new;
          }

          // Parse key to get id_karyawan, Tanggal, Kode_Shift
          const [id_karyawan, Tanggal, Kode_Shift] = item.key.split('|');

          const { error: updateErr } = await supabase
            .from("croscek_dw")
            .update(updateData)
            .eq("id_karyawan", parseInt(id_karyawan))
            .eq("Tanggal", Tanggal)
            .eq("Kode_Shift", Kode_Shift);

          if (updateErr) {
            console.error(`⚠️  Update error for key=${item.key}:`, updateErr.message);
            // Continue dengan record lain
          } else {
            updatedCount++;
          }
        }
        console.log(`   ✅ Updated: ${batch.length} (cumulative: ${updatedCount})`);
      }
    }

    console.log(`✅ Insert/Update completed: inserted=${insertedCount}, updated=${updatedCount}`);

    // Fetch final data dengan batch
    const finalData = await batchFetchCroscekData("croscek_dw", 1000);

    // Build response dengan change summary
    const uniqueChanges = changeLog.reduce((acc, log) => {
      const key = `${log.nama}|${log.tanggal}|${log.kode_shift}`;
      if (!acc.has(key)) {
        acc.set(key, log);
      }
      return acc;
    }, new Map());

    return res.json({ 
      success: true, 
      total: dedupedData.length, 
      inserted: insertedCount, 
      updated: updatedCount,
      changes: Array.from(uniqueChanges.values()),
      data: (finalData || []).map(serializeCroscekRow),
      summary: {
        message: `✅ Berhasil! ${insertedCount} data baru ditambahkan, ${updatedCount} data diperbarui`,
        inserted: insertedCount,
        updated: updatedCount,
        changeCount: changeLog.length,
      }
    });
  } catch (e) {
    console.error("❌ saveCroscekDW:", e);
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/croscek-dw/final
export async function getCroscekDWFinal(req, res) {
  try {
    const data = await batchFetchCroscekData("croscek_dw", DEFAULT_BATCH_SIZE);
    return res.json({ success: true, data: (data || []).map(serializeCroscekRow) });
  } catch (e) {
    console.error("❌ getCroscekDWFinal:", e);
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/karyawan-select
export async function getKaryawanSelect(req, res) {
  try {
    const { data, error } = await supabase
      .from("karyawan")
      .select("id_absen, nama")
      .not("id_absen", "is", null)
      .neq("id_absen", "")
      .order("nama", { ascending: true });

    if (error) throw error;
    return res.json((data || []).map((r) => ({ label: `${r.nama} - ${r.id_absen}`, value: r.id_absen })));
  } catch (e) {
    console.error("❌ getKaryawanSelect:", e);
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/rekap-hod
export async function getRekapHOD(req, res) {
  try {
    const { id_absen, start_date, end_date } = req.query;
    if (!id_absen || !start_date || !end_date) {
      return res.status(400).json({ error: "Missing required parameters: id_absen, start_date, end_date" });
    }

    const { data: karyawanData, error: karyawanError } = await supabase
      .from("karyawan")
      .select("id_karyawan")
      .eq("id_absen", id_absen)
      .single();

    if (karyawanError || !karyawanData) {
      return res.status(404).json({ error: "Karyawan not found" });
    }

    const { data, error } = await supabase
      .from("croscek")
      .select(`Nama, Tanggal, Jabatan, Departemen, Kode_Shift, Actual_Masuk, Actual_Pulang, Status_Kehadiran`)
      .eq("id_karyawan", karyawanData.id_karyawan)
      .gte("Tanggal", start_date)
      .lte("Tanggal", end_date)
      .order("Tanggal", { ascending: true });

    if (error) throw error;

    const formatTanggalDDMMYYYY = (value) => {
      if (!value) return null;
      const str = String(value).trim();

      if (/^\d{2}-\d{2}-\d{4}$/.test(str)) return str;

      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const [y, m, d] = str.split("-");
        return `${d}-${m}-${y}`;
      }

      const parsed = new Date(str);
      if (!Number.isNaN(parsed.getTime())) {
        const d = String(parsed.getDate()).padStart(2, "0");
        const m = String(parsed.getMonth() + 1).padStart(2, "0");
        const y = String(parsed.getFullYear());
        return `${d}-${m}-${y}`;
      }

      return str;
    };

    const result = (data || []).map((row) => ({
      id_absen: id_absen,
      tanggal: formatTanggalDDMMYYYY(row.Tanggal),
      nama: row.Nama || "",
      jabatan: row.Jabatan || "",
      departemen: row.Departemen || "",
      shift: row.Kode_Shift || "",
      check_in: row.Actual_Masuk || null,
      check_out: row.Actual_Pulang || null,
      status_kehadiran: row.Status_Kehadiran || "",
    }));

    return res.json(result);
  } catch (e) {
    console.error("❌ getRekapHOD:", e);
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/croscek-karyawan/sql
// Tries to call a DB-side RPC `sp_croscek_generate` or selects from a view `view_croscek_full`.
// This allows running the original (MySQL) CTE logic inside the DB (after translation to Postgres).
export async function getCroscekKaryawanSQL(req, res) {
  try {
    console.log("📊 GET /api/croscek-karyawan/sql - DB-side generation (RPC/view)");

    // First try calling RPC (preferred)
    const { data: rpcData, error: rpcError } = await supabase.rpc("sp_croscek_generate");

    if (!rpcError && rpcData) {
      return res.json({
        data: (rpcData || []).map(serializeCroscekRow),
        summary: { total: rpcData.length || 0, from_cache: false, source: "rpc" }
      });
    }

    console.warn("RPC sp_croscek_generate not available or returned error:", rpcError ? rpcError.message : "no data");

    // Fallback: try selecting from a view named `view_croscek_full`
    const { data: viewData, error: viewError } = await supabase
      .from("view_croscek_full")
      .select("*")
      .order("Nama", { ascending: true })
      .order("Tanggal", { ascending: true });

    if (viewError) throw viewError;

    return res.json({
      data: (viewData || []).map(serializeCroscekRow),
      summary: { total: viewData.length || 0, from_cache: false, source: "view" }
    });
  } catch (e) {
    console.error("❌ ERROR GET CROSCEK KARYAWAN SQL:", e);
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/croscek-karyawan/diagnostics
export async function getCroscekDiagnostics(req, res) {
  try {
    console.log("🔬 GET /api/croscek-karyawan/diagnostics - running quick checks");

    const [{ data: jadwalCountRes, error: e1 }, { data: karyawanCountRes, error: e2 }, { data: kehadiranCountRes, error: e3 }, { data: croscekCountRes, error: e4 }] = await Promise.all([
      supabase.from("jadwal_karyawan").select("*", { count: "exact", head: true }),
      supabase.from("karyawan").select("*", { count: "exact", head: true }),
      supabase.from("kehadiran_karyawan").select("*", { count: "exact", head: true }),
      supabase.from("croscek").select("*", { count: "exact", head: true }),
    ]);

    if (e1 || e2 || e3 || e4) {
      const err = e1 || e2 || e3 || e4;
      throw err;
    }

    // sample dates and pins
    const { data: sampleDates } = await supabase
      .from("jadwal_karyawan")
      .select("tanggal")
      .order("tanggal", { ascending: true })
      .limit(10);

    const { data: samplePins } = await supabase
      .from("kehadiran_karyawan")
      .select("pin")
      .order("tanggal_scan", { ascending: true })
      .limit(20);

    return res.json({
      jadwal_count: jadwalCountRes?.count || 0,
      karyawan_count: karyawanCountRes?.count || 0,
      kehadiran_count: kehadiranCountRes?.count || 0,
      croscek_count: croscekCountRes?.count || 0,
      sample_dates: (sampleDates || []).map(d => d.tanggal),
      sample_pins: (samplePins || []).map(p => String(p.pin)),
      note: "If jadwal_count << expected (e.g., 373*30), generate missing jadwal. If pins are missing or mismatched vs karyawan.id_absen, import PINs."
    });
  } catch (e) {
    console.error("❌ ERROR DIAGNOSTICS:", e);
    return res.status(500).json({ error: e.message });
  }
}

// ─────────────────────────────────────────────
// HELPER: Normalize attendance record to local datetime string
// Prefer `tanggal` + `jam` fields if available (device stored local time),
// otherwise fall back to `tanggal_scan` (which may be timestamptz UTC).
// Returns string like "YYYY-MM-DDTHH:MM:SS+07:00" or null.
// ─────────────────────────────────────────────
function getAttendanceDateTime(att) {
  if (!att) return null;
  if (att.tanggal && att.jam) {
    const t = normalizeTime(att.jam);
    if (!t) return null;
    // ✅ FIXED: Treat device-provided tanggal+jam as Asia/Jakarta local time explicitly
    return `${att.tanggal}T${t}+07:00`;
  }

  const raw = String(att.tanggal_scan || "").trim();
  if (!raw) return null;

  // Jika string datetime tidak membawa timezone, anggap itu jam lokal perangkat (UTC+7).
  const plainMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/);
  const hasTz = /(?:Z|[+\-]\d{2}:?\d{2})$/i.test(raw);
  if (plainMatch && !hasTz) {
    const localTime = normalizeTime(plainMatch[2]);
    return localTime ? `${plainMatch[1]}T${localTime}+07:00` : null;
  }

  // Fallback: normalize DB timestamptz ke Asia/Jakarta local datetime
  const nd = normalizeDateTime(raw);
  if (!nd) return null;
  return `${nd}+07:00`;
}

// POST /api/croscek-karyawan/sql/refresh
// Try to call DB-side RPC `sp_refresh_view_croscek_full` which should run
// `REFRESH MATERIALIZED VIEW CONCURRENTLY view_croscek_full;`.
export async function refreshMaterializedView(req, res) {
  try {
    // Preferred: RPC that performs refresh server-side
    const { data, error } = await supabase.rpc("sp_refresh_view_croscek_full");
    if (!error) return res.json({ success: true, note: "RPC executed", data });

    // Fallback: instruct user to run REFRESH manually in Supabase SQL Editor
    return res.status(400).json({
      success: false,
      error: error.message || "RPC not available",
      advice: "Run `REFRESH MATERIALIZED VIEW view_croscek_full;` in Supabase SQL editor or create RPC `sp_refresh_view_croscek_full` that runs the REFRESH command.",
      sql_file: "sql/croscek_postgres_full_view.sql"
    });
  } catch (e) {
    console.error("❌ refreshMaterializedView:", e);
    return res.status(500).json({ error: e.message });
  }
}

// POST /api/croscek-karyawan/sql/recreate
// Try to call DB-side RPC `sp_recreate_view_croscek_full` which should DROP
// and CREATE the materialized view. If not present, return the SQL file
// path so the operator can paste it to Supabase SQL editor.
export async function recreateMaterializedView(req, res) {
  try {
    const { data, error } = await supabase.rpc("sp_recreate_view_croscek_full");
    if (!error) return res.json({ success: true, note: "RPC executed", data });

    return res.status(400).json({
      success: false,
      error: error.message || "RPC not available",
      advice: "Run the SQL in `sql/croscek_postgres_full_view.sql` in Supabase SQL editor. After creation run `REFRESH MATERIALIZED VIEW view_croscek_full;`.",
      sql_file: "sql/croscek_postgres_full_view.sql"
    });
  } catch (e) {
    console.error("❌ recreateMaterializedView:", e);
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/croscek-karyawan/coverage?start=YYYY-MM-DD&end=YYYY-MM-DD&min_days=20
// Returns per-id_karyawan jadwal counts between start and end, and lists those below threshold.
export async function getJadwalCoverage(req, res) {
  try {
    const { start, end, min_days = 20 } = req.query;
    if (!start || !end) return res.status(400).json({ error: "Missing start or end query params" });

    const jadwalRows = await batchFetchAllRows({
      tableName: "jadwal_karyawan",
      selectFields: "id_karyawan, tanggal",
      filters: [
        { type: "gte", field: "tanggal", value: start },
        { type: "lte", field: "tanggal", value: end },
      ],
      orders: [
        { field: "tanggal", asc: true },
        { field: "id_karyawan", asc: true },
      ],
      batchSize: DEFAULT_BATCH_SIZE,
    });

    const counts = {};
    for (const r of (jadwalRows || [])) {
      const k = String(r.id_karyawan);
      counts[k] = (counts[k] || 0) + 1;
    }

    // Find karyawan with low coverage
    const low = Object.entries(counts)
      .filter(([_, c]) => c < Number(min_days))
      .map(([id_karyawan, c]) => ({ id_karyawan, count: c }));

    return res.json({ start, end, total_jadwal_rows: (jadwalRows || []).length, unique_karyawan: Object.keys(counts).length, low_coverage: low });
  } catch (e) {
    console.error("❌ getJadwalCoverage:", e);
    return res.status(500).json({ error: e.message });
  }
}

// POST /api/croscek-karyawan/clear
// Truncate seluruh tabel croscek (untuk kategori karyawan)
export async function clearCroscekKaryawan(req, res) {
  try {
    console.log("🧹 POST /api/croscek-karyawan/clear - Truncating croscek table");
    
    const { error } = await supabase
      .from("croscek")
      .delete()
      .gte("id_karyawan", 0); // Delete semua records
    
    if (error) throw error;
    
    console.log("✅ Croscek table successfully truncated");
    return res.json({ 
      success: true, 
      message: "✅ Semua data croscek berhasil dihapus!"
    });
  } catch (e) {
    console.error("❌ clearCroscekKaryawan:", e);
    return res.status(500).json({ error: e.message });
  }
}

// POST /api/croscek-dw/clear
// Truncate seluruh tabel croscek_dw (untuk kategori dw)
export async function clearCroscekDW(req, res) {
  try {
    console.log("🧹 POST /api/croscek-dw/clear - Truncating croscek_dw table");
    
    const { error } = await supabase
      .from("croscek_dw")
      .delete()
      .gte("id_karyawan", 0); // Delete semua records
    
    if (error) throw error;
    
    console.log("✅ Croscek_dw table successfully truncated");
    return res.json({ 
      success: true, 
      message: "✅ Semua data croscek DW berhasil dihapus!"
    });
  } catch (e) {
    console.error("❌ clearCroscekDW:", e);
    return res.status(500).json({ error: e.message });
  }
}
