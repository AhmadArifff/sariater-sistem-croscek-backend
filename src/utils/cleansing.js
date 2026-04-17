// =============================================
// UTILITY: Data Cleansing (1:1 dari Python)
// =============================================

/**
 * Bersihkan NIK dari format float Excel (e.g. "423384.0" → "423384")
 * Replika dari logic Python: str(int(float(nik_str)))
 */
export function cleanNIK(raw) {
  if (raw === null || raw === undefined || raw === "") return "";

  const str = String(raw).trim();

  if (str.includes(".")) {
    try {
      return String(parseInt(parseFloat(str)));
    } catch {
      return str.replace(".0", "");
    }
  }

  return str;
}

/**
 * Bersihkan Nama: hapus titik & koma, rapikan spasi, uppercase
 * Replika dari Python: re.sub(r"[.,]", "", nama_raw) + re.sub(r"\s+", " ", nama) + upper()
 */
export function cleanNama(raw) {
  if (!raw) return "";

  return String(raw)
    .trim()
    .replace(/[.,]/g, "")       // hapus titik & koma
    .replace(/\s+/g, " ")       // rapikan spasi berlebih
    .trim()
    .toUpperCase();
}

/**
 * Bersihkan ID Absen dari format float Excel
 * Sama seperti cleanNIK
 */
export function cleanIdAbsen(raw) {
  if (raw === null || raw === undefined || raw === "") return null;

  const str = String(raw).trim();
  if (!str || str === "undefined" || str === "null") return null;

  if (str.includes(".")) {
    try {
      return String(parseInt(parseFloat(str)));
    } catch {
      return str.replace(".0", "");
    }
  }

  return str;
}

/**
 * Cek apakah nilai kosong / null / undefined / NaN
 */
export function isEmpty(val) {
  return val === null || val === undefined || String(val).trim() === "" || val !== val;
}

/**
 * Parse nilai string menjadi string bersih, atau "" jika null
 */
export function safeStr(val) {
  if (isEmpty(val)) return "";
  return String(val).trim();
}