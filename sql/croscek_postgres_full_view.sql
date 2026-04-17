-- CREATE MATERIALIZED VIEW for Croscek ported from MySQL CTE to PostgreSQL
-- Run this in Supabase SQL Editor. After creation, run: REFRESH MATERIALIZED VIEW view_croscek_full;

CREATE MATERIALIZED VIEW IF NOT EXISTS view_croscek_full AS
WITH
used_scan_pulang_malam AS (
  -- Part 1: Shift lintas hari normal (non-ACCOUNTING/SALES)
  SELECT DISTINCT
    kk.pin,
    kk.tanggal_scan
  FROM jadwal_karyawan jk
  JOIN karyawan k
    ON k.id_karyawan = jk.id_karyawan
    AND k.kategori = 'karyawan'
  JOIN informasi_jadwal ij
    ON ij.kode = jk.kode_shift
  JOIN kehadiran_karyawan kk
    ON kk.pin = k.id_absen
  WHERE
    k.dept NOT IN ('ACCOUNTING', 'SALES & MARKETING')
    AND (ij.jam_pulang::time < ij.jam_masuk::time)
    AND (kk.tanggal_scan::date = (jk.tanggal + interval '1 day')::date)
    AND (kk.tanggal_scan BETWEEN ((jk.tanggal + interval '1 day')::text || ' ' || ij.jam_pulang)::timestamp - interval '4 hours'
                             AND ((jk.tanggal + interval '1 day')::text || ' ' || ij.jam_pulang)::timestamp + interval '6 hours')

  UNION

  -- Part 2: ACCOUNTING & SALES - Shift lintas hari
  SELECT DISTINCT
    kk.pin,
    kk.tanggal_scan
  FROM jadwal_karyawan jk
  JOIN karyawan k
    ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'karyawan'
  JOIN informasi_jadwal ij
    ON ij.kode = jk.kode_shift
  JOIN kehadiran_karyawan kk
    ON kk.pin = k.id_absen
  WHERE
    k.dept IN ('ACCOUNTING', 'SALES & MARKETING')
    AND (ij.jam_pulang::time < ij.jam_masuk::time)
    AND (kk.tanggal_scan::date = (jk.tanggal + interval '1 day')::date)
    AND (kk.tanggal_scan BETWEEN ((jk.tanggal + interval '1 day')::text || ' ' || ij.jam_pulang)::timestamp - interval '4 hours'
                             AND ((jk.tanggal + interval '1 day')::text || ' ' || ij.jam_pulang)::timestamp + interval '6 hours')

  UNION

  -- Part 3: ACCOUNTING & SALES - normal shift but pulang after midnight (00:00-05:59)
  SELECT DISTINCT
    kk.pin,
    kk.tanggal_scan
  FROM jadwal_karyawan jk
  JOIN karyawan k
    ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'karyawan'
  JOIN informasi_jadwal ij
    ON ij.kode = jk.kode_shift
  JOIN kehadiran_karyawan kk
    ON kk.pin = k.id_absen
  WHERE
    k.dept IN ('ACCOUNTING', 'SALES & MARKETING')
    AND (ij.jam_pulang::time >= ij.jam_masuk::time)
    AND (kk.tanggal_scan::date = (jk.tanggal + interval '1 day')::date)
    AND (kk.tanggal_scan::time BETWEEN time '00:00:00' AND time '05:59:59')
    AND (
      EXTRACT(EPOCH FROM (kk.tanggal_scan - ((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp))) / 3600 BETWEEN -4 AND 6
    )
    AND EXISTS (
      SELECT 1 FROM kehadiran_karyawan kk_in
      WHERE kk_in.pin = k.id_absen
        AND kk_in.tanggal_scan::date = jk.tanggal::date
        AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                 AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jadwal_karyawan jk_next
      JOIN informasi_jadwal ij_next ON ij_next.kode = jk_next.kode_shift
      WHERE jk_next.id_karyawan = jk.id_karyawan
        AND jk_next.tanggal = (jk.tanggal + interval '1 day')::date
        AND jk_next.kode_shift NOT IN ('CT','CTT','EO','OF1','CTB','X')
        AND ABS(EXTRACT(EPOCH FROM (kk.tanggal_scan - (( (jk.tanggal + interval '1 day')::text || ' ' || ij_next.jam_masuk)::timestamp)))/60) <= 60
    )
),

scan_data AS (
  SELECT
    k.id_absen AS pin,
    k.id_karyawan,
    k.nama,
    kk.tanggal_scan::date AS tanggal,
    MIN(kk.tanggal_scan) AS scan_masuk,
    MAX(kk.tanggal_scan) AS scan_pulang
  FROM kehadiran_karyawan kk
  JOIN karyawan k ON k.id_absen = kk.pin AND k.kategori = 'karyawan'
  LEFT JOIN used_scan_pulang_malam u ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
  WHERE u.tanggal_scan IS NULL
  GROUP BY k.id_absen, k.id_karyawan, k.nama, kk.tanggal_scan::date
),

historical_freq AS (
  SELECT
    jk.id_karyawan,
    jk.kode_shift,
    COUNT(*) AS freq_count
  FROM jadwal_karyawan jk
  JOIN karyawan k ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'karyawan'
  WHERE jk.tanggal >= (CURRENT_DATE - interval '90 days')
  GROUP BY jk.id_karyawan, jk.kode_shift
),

base_data AS (
  SELECT
    jk.nama AS Nama,
    jk.tanggal::date AS Tanggal,
    jk.kode_shift AS Kode_Shift,
    k.jabatan AS Jabatan,
    k.dept AS Departemen,
    k.id_karyawan,
    k.nik AS NIK,
    k.id_absen,
    ij.jam_masuk,
    ij.jam_pulang,

    CASE
      WHEN ij.jam_pulang::time < ij.jam_masuk::time THEN
        FLOOR(EXTRACT(EPOCH FROM ((ij.jam_pulang::time + interval '24 hours') - ij.jam_masuk::time))/60)
      ELSE
        FLOOR(EXTRACT(EPOCH FROM (ij.jam_pulang::time - ij.jam_masuk::time))/60)
    END AS expected_duration_minutes,

    -- Actual_Masuk
    CASE
      WHEN jk.kode_shift IN ('CT','CTT','EO','OF1','CTB','X') THEN NULL

      WHEN jk.kode_shift = '3A' THEN (
        SELECT MIN(kk.tanggal_scan)
        FROM kehadiran_karyawan kk
        WHERE kk.pin = k.id_absen
          AND (
            (kk.tanggal_scan >= (jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp
             AND kk.tanggal_scan < ((jk.tanggal + interval '1 day')::text || ' ' || ij.jam_pulang)::timestamp
             AND kk.tanggal_scan::time >= time '22:00:00')
            OR
            (kk.tanggal_scan::date = (jk.tanggal + interval '1 day')::date
             AND kk.tanggal_scan::time <= time '03:00:00')
          )
      )

      WHEN ij.jam_pulang::time < ij.jam_masuk::time THEN (
        SELECT MIN(kk.tanggal_scan)
        FROM kehadiran_karyawan kk
        LEFT JOIN used_scan_pulang_malam u ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
        WHERE kk.pin = k.id_absen
          AND u.tanggal_scan IS NULL
          AND kk.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                 AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
      )
      ELSE (
        SELECT MIN(kk.tanggal_scan)
        FROM kehadiran_karyawan kk
        LEFT JOIN used_scan_pulang_malam u ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
        WHERE kk.pin = k.id_absen
          AND u.tanggal_scan IS NULL
          AND kk.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                 AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
          AND ABS(EXTRACT(EPOCH FROM (kk.tanggal_scan - ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp)))/60) <= 240
          AND NOT EXISTS (
            SELECT 1
            FROM jadwal_karyawan jk_prev
            JOIN informasi_jadwal ij_prev ON ij_prev.kode = jk_prev.kode_shift
            WHERE jk_prev.id_karyawan = jk.id_karyawan
              AND jk_prev.tanggal = (jk.tanggal - interval '1 day')::date
              AND jk_prev.kode_shift NOT IN ('CT','CTT','EO','OF1','CTB','X')
              AND ij_prev.jam_pulang::time < ij_prev.jam_masuk::time
              AND kk.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij_prev.jam_pulang)::timestamp - interval '2 hours')
                                   AND ((jk.tanggal::text || ' ' || ij_prev.jam_pulang)::timestamp + interval '2 hours')
          )
      )
    END AS Actual_Masuk,

    -- Actual_Pulang
    CASE
      WHEN jk.kode_shift IN ('CT','CTT','EO','OF1','CTB','X') THEN NULL

      WHEN jk.kode_shift = '3A' THEN (
        COALESCE(
          (
            SELECT kk_out.tanggal_scan
            FROM kehadiran_karyawan kk_out
            WHERE kk_out.pin = k.id_absen
              AND kk_out.tanggal_scan::date = (jk.tanggal + interval '1 day')::date
              AND kk_out.tanggal_scan BETWEEN (( (jk.tanggal + interval '1 day')::text || ' ' || ij.jam_pulang)::timestamp)
                                        AND (( (jk.tanggal + interval '1 day')::text || ' ' || ij.jam_pulang)::timestamp + interval '75 minutes')
              AND kk_out.tanggal_scan != COALESCE((
                SELECT MIN(kk_in.tanggal_scan)
                FROM kehadiran_karyawan kk_in
                WHERE kk_in.pin = k.id_absen
                  AND (
                    (kk_in.tanggal_scan::date = jk.tanggal::date AND kk_in.tanggal_scan::time >= time '22:00:00')
                    OR
                    (kk_in.tanggal_scan::date = (jk.tanggal + interval '1 day')::date AND kk_in.tanggal_scan::time <= time '03:00:00')
                  )
              ), '1900-01-01'::timestamp)
              AND (EXTRACT(EPOCH FROM (COALESCE((
                  SELECT MIN(kk_in.tanggal_scan)
                  FROM kehadiran_karyawan kk_in
                  WHERE kk_in.pin = k.id_absen
                    AND (
                      (kk_in.tanggal_scan::date = jk.tanggal::date AND kk_in.tanggal_scan::time >= time '22:00:00')
                      OR
                      (kk_in.tanggal_scan::date = (jk.tanggal + interval '1 day')::date AND kk_in.tanggal_scan::time <= time '03:00:00')
                    )
                ), kk_out.tanggal_scan) - kk_out.tanggal_scan))/60) >= (
                  CASE WHEN ij.jam_pulang::time < ij.jam_masuk::time THEN
                    FLOOR(EXTRACT(EPOCH FROM ((ij.jam_pulang::time + interval '24 hours') - ij.jam_masuk::time))/60)
                  ELSE
                    FLOOR(EXTRACT(EPOCH FROM (ij.jam_pulang::time - ij.jam_masuk::time))/60)
                  END * 0.5
                )
            ORDER BY kk_out.tanggal_scan DESC
            LIMIT 1
          ),
          (
            SELECT kk_out.tanggal_scan
            FROM kehadiran_karyawan kk_out
            WHERE kk_out.pin = k.id_absen
              AND kk_out.tanggal_scan::date = jk.tanggal::date
              AND kk_out.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp - interval '75 minutes')
                                         AND ((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp + interval '75 minutes')
              AND kk_out.tanggal_scan != COALESCE((
                SELECT MIN(tanggal_scan)
                FROM kehadiran_karyawan
                WHERE pin = k.id_absen
                  AND tanggal_scan::date = jk.tanggal::date
                  AND tanggal_scan::time <= time '03:00:00'
              ), '1900-01-01'::timestamp)
            ORDER BY ABS(EXTRACT(EPOCH FROM (kk_out.tanggal_scan - ((jk.tanggal + interval '1 day')::text || ' ' || ij.jam_pulang)::timestamp))/60)
            LIMIT 1
          ),
          (
            SELECT MAX(kk_out.tanggal_scan)
            FROM kehadiran_karyawan kk_out
            WHERE kk_out.pin = k.id_absen
              AND kk_out.tanggal_scan::date = (jk.tanggal + interval '1 day')::date
              AND kk_out.tanggal_scan::time BETWEEN time '05:00:00' AND time '12:00:00'
          )
        )
      )

      WHEN k.dept IN ('ACCOUNTING', 'SALES & MARKETING') THEN (
        CASE
          WHEN ij.jam_pulang::time < ij.jam_masuk::time THEN (
            SELECT kk_out.tanggal_scan
            FROM kehadiran_karyawan kk_out
            WHERE kk_out.pin = k.id_absen
              AND kk_out.tanggal_scan BETWEEN (((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp) + interval '1 day' - interval '4 hours')
                                       AND (((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp) + interval '1 day' + interval '12 hours')
              AND kk_out.tanggal_scan != COALESCE((
                SELECT MIN(tanggal_scan) FROM kehadiran_karyawan
                WHERE pin = k.id_absen
                  AND tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                      AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
              ), '1900-01-01'::timestamp)
              AND (
                (
                  SELECT MIN(kk_in.tanggal_scan)
                  FROM kehadiran_karyawan kk_in
                  WHERE kk_in.pin = k.id_absen
                    AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                            AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
                ) IS NULL
                OR
                (EXTRACT(EPOCH FROM (kk_out.tanggal_scan - (
                  SELECT MIN(kk_in.tanggal_scan)
                  FROM kehadiran_karyawan kk_in
                  WHERE kk_in.pin = k.id_absen
                    AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                            AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
                )))/60) >= (FLOOR(EXTRACT(EPOCH FROM ((ij.jam_pulang::time + interval '24 hours') - ij.jam_masuk::time))/60) * 0.5)
              )
            ORDER BY ABS(EXTRACT(EPOCH FROM (kk_out.tanggal_scan - (((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp) + interval '1 day')))/60)
            LIMIT 1
          )
          ELSE (
            SELECT kk_out.tanggal_scan
            FROM kehadiran_karyawan kk_out
            WHERE kk_out.pin = k.id_absen
              AND kk_out.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp - interval '4 hours')
                                       AND ((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp + interval '12 hours')
              AND kk_out.tanggal_scan != COALESCE((
                SELECT MIN(tanggal_scan) FROM kehadiran_karyawan
                WHERE pin = k.id_absen
                  AND tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                      AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
              ), '1900-01-01'::timestamp)
              AND (
                (
                  SELECT MIN(kk_in.tanggal_scan)
                  FROM kehadiran_karyawan kk_in
                  WHERE kk_in.pin = k.id_absen
                    AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                            AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
                ) IS NULL
                OR
                (EXTRACT(EPOCH FROM (kk_out.tanggal_scan - (
                  SELECT MIN(kk_in.tanggal_scan)
                  FROM kehadiran_karyawan kk_in
                  WHERE kk_in.pin = k.id_absen
                    AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                            AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
                )))/60) >= (FLOOR(EXTRACT(EPOCH FROM ((ij.jam_pulang::time) - ij.jam_masuk::time))/60) * 0.8)
              )
              AND (
                (EXTRACT(EPOCH FROM (kk_out.tanggal_scan - (
                  SELECT MIN(kk_in.tanggal_scan)
                  FROM kehadiran_karyawan kk_in
                  WHERE kk_in.pin = k.id_absen
                    AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                            AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
                )))/60) >= 0
                OR NOT EXISTS (
                  SELECT 1
                  FROM jadwal_karyawan jk_next
                  JOIN informasi_jadwal ij_next ON ij_next.kode = jk_next.kode_shift
                  WHERE jk_next.id_karyawan = jk.id_karyawan
                    AND jk_next.tanggal = (jk.tanggal + interval '1 day')::date
                    AND jk_next.kode_shift NOT IN ('CT','CTT','EO','OF1','CTB','X')
                    AND ABS(EXTRACT(EPOCH FROM (kk_out.tanggal_scan - (( (jk.tanggal + interval '1 day')::text || ' ' || ij_next.jam_masuk)::timestamp)))/60) <= 60
                )
            ORDER BY ABS(EXTRACT(EPOCH FROM (kk_out.tanggal_scan - ((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp)))/60)
            LIMIT 1
          )
        END
      )

      WHEN ij.jam_pulang::time < ij.jam_masuk::time THEN (
        SELECT kk_out.tanggal_scan
        FROM kehadiran_karyawan kk_out
        WHERE kk_out.pin = k.id_absen
          AND kk_out.tanggal_scan BETWEEN (((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp) + interval '1 day' - interval '4 hours')
                                   AND (((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp) + interval '1 day' + interval '6 hours')
          AND kk_out.tanggal_scan != COALESCE((
            SELECT MIN(tanggal_scan) FROM kehadiran_karyawan
            WHERE pin = k.id_absen
              AND tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                  AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
          ), '1900-01-01'::timestamp)
          AND (
            (
              SELECT MIN(kk_in.tanggal_scan)
              FROM kehadiran_karyawan kk_in
              WHERE kk_in.pin = k.id_absen
                AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                        AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
            ) IS NULL
            OR
            (EXTRACT(EPOCH FROM (kk_out.tanggal_scan - (
              SELECT MIN(kk_in.tanggal_scan)
              FROM kehadiran_karyawan kk_in
              WHERE kk_in.pin = k.id_absen
                AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                        AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
            )))/60) >= (FLOOR(EXTRACT(EPOCH FROM ((ij.jam_pulang::time + interval '24 hours') - ij.jam_masuk::time))/60) * 0.5)
          )
        ORDER BY ABS(EXTRACT(EPOCH FROM (kk_out.tanggal_scan - (((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp) + interval '1 day')))/60)
        LIMIT 1
      )
      ELSE (
        SELECT kk_out.tanggal_scan
        FROM kehadiran_karyawan kk_out
        WHERE kk_out.pin = k.id_absen
          AND kk_out.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp - interval '4 hours')
                                   AND ((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp + interval '7 hours')
          AND kk_out.tanggal_scan != COALESCE((
            SELECT MIN(tanggal_scan) FROM kehadiran_karyawan
            WHERE pin = k.id_absen
              AND tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                  AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
          ), '1900-01-01'::timestamp)
          AND (
            (
              SELECT MIN(kk_in.tanggal_scan)
              FROM kehadiran_karyawan kk_in
              WHERE kk_in.pin = k.id_absen
                AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                        AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
            ) IS NULL
            OR
            (EXTRACT(EPOCH FROM (kk_out.tanggal_scan - (
              SELECT MIN(kk_in.tanggal_scan)
              FROM kehadiran_karyawan kk_in
              WHERE kk_in.pin = k.id_absen
                AND kk_in.tanggal_scan BETWEEN ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp - interval '6 hours')
                                        AND ((jk.tanggal::text || ' ' || ij.jam_masuk)::timestamp + interval '4 hours')
            )))/60) >= (FLOOR(EXTRACT(EPOCH FROM ((ij.jam_pulang::time) - ij.jam_masuk::time))/60) * 0.5)
          )
        ORDER BY ABS(EXTRACT(EPOCH FROM (kk_out.tanggal_scan - ((jk.tanggal::text || ' ' || ij.jam_pulang)::timestamp)))/60)
        LIMIT 1
      )
    END AS Actual_Pulang

  FROM jadwal_karyawan jk
  JOIN karyawan k ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'karyawan'
  LEFT JOIN informasi_jadwal ij ON ij.kode = jk.kode_shift
),

base_with_duration AS (
  SELECT
    base.*,
    CASE WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL
         THEN FLOOR(EXTRACT(EPOCH FROM (base.Actual_Pulang - base.Actual_Masuk))/60)
         ELSE NULL END AS actual_duration_minutes
  FROM base_data base
),

prediction_data AS (
  SELECT * FROM (
    SELECT
      s.id_karyawan,
      s.pin,
      s.nama,
      s.tanggal,
      ij2.kode AS kode_shift,
      -- For brevity and parity, compute pred_actual_masuk/pulang similar to MySQL logic using lateral subqueries
      (CASE WHEN ij2.kode = '3A' THEN (
        SELECT MIN(kk.tanggal_scan) FROM kehadiran_karyawan kk
        WHERE kk.pin = s.pin
          AND ((kk.tanggal_scan::date = s.tanggal AND kk.tanggal_scan::time >= time '20:00:00')
               OR (kk.tanggal_scan::date = (s.tanggal + interval '1 day')::date AND kk.tanggal_scan::time <= time '05:00:00'))
      ) WHEN ij2.jam_pulang::time < ij2.jam_masuk::time THEN (
        SELECT MIN(kk.tanggal_scan) FROM kehadiran_karyawan kk
        LEFT JOIN used_scan_pulang_malam u ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
        WHERE kk.pin = s.pin AND u.tanggal_scan IS NULL
          AND kk.tanggal_scan::date BETWEEN (s.tanggal - interval '1 day')::date AND s.tanggal::date
          AND kk.tanggal_scan BETWEEN ((s.tanggal::text || ' ' || ij2.jam_masuk)::timestamp - interval '6 hours')
                                 AND ((s.tanggal::text || ' ' || ij2.jam_masuk)::timestamp + interval '4 hours')
      ) ELSE (
        SELECT MIN(kk.tanggal_scan) FROM kehadiran_karyawan kk
        LEFT JOIN used_scan_pulang_malam u ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
        WHERE kk.pin = s.pin AND u.tanggal_scan IS NULL
          AND kk.tanggal_scan::date = s.tanggal::date
          AND kk.tanggal_scan BETWEEN ((s.tanggal::text || ' ' || ij2.jam_masuk)::timestamp - interval '6 hours')
                                 AND ((s.tanggal::text || ' ' || ij2.jam_masuk)::timestamp + interval '4 hours')
      ) END) AS pred_actual_masuk,

      (CASE WHEN ij2.kode = '3A' THEN (
        SELECT kk.tanggal_scan FROM kehadiran_karyawan kk
        WHERE kk.pin = s.pin
          AND kk.tanggal_scan::date = (s.tanggal + interval '1 day')::date
          AND kk.tanggal_scan::time BETWEEN time '05:00:00' AND time '12:00:00'
          AND kk.tanggal_scan != COALESCE(s.scan_masuk, '1900-01-01'::timestamp)
        ORDER BY ABS(EXTRACT(EPOCH FROM (kk.tanggal_scan - (( (s.tanggal + interval '1 day')::text || ' ' || ij2.jam_pulang)::timestamp)))/60) LIMIT 1
      ) WHEN ij2.jam_pulang::time < ij2.jam_masuk::time THEN (
        SELECT kk.tanggal_scan FROM kehadiran_karyawan kk
        LEFT JOIN used_scan_pulang_malam u ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
        WHERE kk.pin = s.pin AND u.tanggal_scan IS NULL
          AND kk.tanggal_scan::date BETWEEN s.tanggal::date AND (s.tanggal + interval '1 day')::date
          AND kk.tanggal_scan BETWEEN ((s.tanggal::text || ' ' || ij2.jam_pulang)::timestamp + interval '1 day' - interval '4 hours')
                                 AND ((s.tanggal::text || ' ' || ij2.jam_pulang)::timestamp + interval '1 day' + interval '12 hours')
        ORDER BY ABS(EXTRACT(EPOCH FROM (kk.tanggal_scan - ((s.tanggal::text || ' ' || ij2.jam_pulang)::timestamp + interval '1 day')))/60) LIMIT 1
      ) ELSE (
        SELECT kk.tanggal_scan FROM kehadiran_karyawan kk
        LEFT JOIN used_scan_pulang_malam u ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
        WHERE kk.pin = s.pin AND u.tanggal_scan IS NULL
          AND kk.tanggal_scan::date = s.tanggal::date
          AND kk.tanggal_scan BETWEEN ((s.tanggal::text || ' ' || ij2.jam_pulang)::timestamp - interval '4 hours')
                                 AND ((s.tanggal::text || ' ' || ij2.jam_pulang)::timestamp + interval '12 hours')
        ORDER BY ABS(EXTRACT(EPOCH FROM (kk.tanggal_scan - ((s.tanggal::text || ' ' || ij2.jam_pulang)::timestamp)))/60) LIMIT 1
      ) END) AS pred_actual_pulang,

      -- final_score/probabilitas/confidence_score/freq_shift calculation approximated
      (0.7 * COALESCE(ABS(EXTRACT(EPOCH FROM (s.scan_masuk::time - ij2.jam_masuk::time))/60), 999)
       + 0.3 * COALESCE(ABS(EXTRACT(EPOCH FROM (s.scan_pulang::time - ij2.jam_pulang::time))/60), 999)
       - COALESCE(hf.freq_count * 5, 0)
      ) AS final_score,

      (CASE WHEN s.scan_masuk IS NOT NULL AND s.scan_pulang IS NOT NULL
        THEN ROUND(100 * (1 - ((0.7 * ABS(EXTRACT(EPOCH FROM (s.scan_masuk::time - ij2.jam_masuk::time))/60)
                                + 0.3 * ABS(EXTRACT(EPOCH FROM (s.scan_pulang::time - ij2.jam_pulang::time))/60)) / 180))::numeric, 2)
        WHEN s.scan_masuk IS NOT NULL THEN ROUND(50 * (1 - (ABS(EXTRACT(EPOCH FROM (s.scan_masuk::time - ij2.jam_masuk::time))/60) / 90))::numeric,2)
        WHEN s.scan_pulang IS NOT NULL THEN ROUND(50 * (1 - (ABS(EXTRACT(EPOCH FROM (s.scan_pulang::time - ij2.jam_pulang::time))/60) / 90))::numeric,2)
        ELSE 0 END) AS probabilitas,

      (CASE WHEN (0.7 * COALESCE(ABS(EXTRACT(EPOCH FROM (s.scan_masuk::time - ij2.jam_masuk::time))/60),999)
                  + 0.3 * COALESCE(ABS(EXTRACT(EPOCH FROM (s.scan_pulang::time - ij2.jam_pulang::time))/60),999)) <= 45 THEN 'Sangat Tinggi'
            WHEN ... THEN 'Tinggi' -- keep conservative mapping; you can elaborate
            ELSE 'Rendah' END) AS confidence_score,

      COALESCE(hf.freq_count,0) AS freq_shift,
      ROW_NUMBER() OVER (PARTITION BY s.id_karyawan, s.tanggal ORDER BY (0.7 * COALESCE(ABS(EXTRACT(EPOCH FROM (s.scan_masuk::time - ij2.jam_masuk::time))/60),999) + 0.3 * COALESCE(ABS(EXTRACT(EPOCH FROM (s.scan_pulang::time - ij2.jam_pulang::time))/60),999) - COALESCE(hf.freq_count * 5,0)) ASC) as rn
    FROM scan_data s
    CROSS JOIN informasi_jadwal ij2
    LEFT JOIN historical_freq hf ON hf.id_karyawan = s.id_karyawan AND hf.kode_shift = ij2.kode
    WHERE ij2.kode NOT IN ('CT','CTT','EO','OF1','CTB','X')
      AND ij2.lokasi_kerja = 'Ciater'
  ) t
  WHERE rn = 1
),

final_select AS (
  SELECT
    base.Nama,
    base.Tanggal,
    base.Kode_Shift,
    base.Jabatan,
    base.Departemen,
    base.id_karyawan,
    base.NIK,
    ij.jam_masuk AS Jadwal_Masuk,
    ij.jam_pulang AS Jadwal_Pulang,
    base.Actual_Masuk,
    base.Actual_Pulang,
    base.expected_duration_minutes AS Durasi_Shift_Diharapkan_Menit,
    base.actual_duration_minutes AS Durasi_Kerja_Aktual_Menit,
    CASE WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL THEN NULL ELSE pred.kode_shift END AS Prediksi_Shift,
    CASE WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL THEN NULL ELSE pred.pred_actual_masuk END AS Prediksi_Actual_Masuk,
    CASE WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL THEN NULL ELSE pred.pred_actual_pulang END AS Prediksi_Actual_Pulang,
    CASE WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL THEN NULL ELSE pred.probabilitas END AS Probabilitas_Prediksi,
    CASE WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL THEN NULL ELSE pred.confidence_score END AS Confidence_Score,
    CASE WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL THEN NULL ELSE pred.freq_shift END AS Frekuensi_Shift_Historis,
    CASE WHEN base.Kode_Shift IN ('CT','CTT','EO','OF1','CTB','X') THEN ij.keterangan
         WHEN base.Actual_Masuk IS NULL AND base.Actual_Pulang IS NULL THEN 'Tidak Hadir'
         ELSE 'Hadir' END AS Status_Kehadiran,
    -- Status_Masuk & Status_Pulang: replicate MySQL CASEs approximately
    CASE
      WHEN base.Actual_Masuk IS NULL AND base.actual_duration_minutes IS NOT NULL AND base.actual_duration_minutes >= (base.expected_duration_minutes * 0.9) THEN 'Masuk Tepat Waktu'
      WHEN base.Actual_Masuk IS NULL THEN 'Tidak scan masuk'
      WHEN base.Departemen NOT IN ('ACCOUNTING','SALES & MARKETING') AND base.Actual_Masuk IS NOT NULL AND (base.Actual_Masuk::time <= (ij.jam_masuk::time + interval '15 minutes')) THEN 'Masuk Tepat Waktu'
      ELSE 'Masuk Telat'
    END AS Status_Masuk,
    CASE
      WHEN base.Actual_Pulang IS NULL THEN 'Tidak scan pulang'
      WHEN base.Departemen NOT IN ('ACCOUNTING','SALES & MARKETING') THEN
        CASE WHEN base.Actual_Pulang::time >= ij.jam_pulang::time THEN 'Pulang Tepat Waktu' WHEN base.actual_duration_minutes >= (base.expected_duration_minutes * 0.9) THEN 'Pulang Tepat Waktu' ELSE 'Pulang Terlalu Cepat' END
      WHEN base.Departemen IN ('ACCOUNTING','SALES & MARKETING') AND base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL THEN
        CASE WHEN base.actual_duration_minutes >= 540 OR (CASE WHEN ij.jam_pulang::time < ij.jam_masuk::time THEN FLOOR(EXTRACT(EPOCH FROM (((jk.tanggal + interval '1 day')::text || ' ' || ij.jam_pulang)::timestamp - ((base.Tanggal::text || ' ' || ij.jam_pulang)::timestamp)))/60) >= 60 ELSE FLOOR(EXTRACT(EPOCH FROM (((base.Tanggal::text || ' ' || ij.jam_pulang)::timestamp - ((base.Tanggal::text || ' ' || ij.jam_pulang)::timestamp)))/60) >= 60 END) THEN 'Pulang Tepat Waktu' WHEN base.Actual_Pulang::time >= ij.jam_pulang::time THEN 'Pulang Tepat Waktu' ELSE 'Pulang Terlalu Cepat' END
      ELSE 'Pulang Terlalu Cepat'
    END AS Status_Pulang
  FROM base_with_duration base
  LEFT JOIN informasi_jadwal ij ON ij.kode = base.Kode_Shift
  LEFT JOIN prediction_data pred ON pred.id_karyawan = base.id_karyawan AND pred.tanggal = base.Tanggal
)

SELECT * FROM final_select
ORDER BY Nama, Tanggal;

-- End of materialized view
