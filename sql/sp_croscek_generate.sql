-- Create RPC that returns the full croscek query result
-- Run this in Supabase SQL Editor as a single statement.

CREATE OR REPLACE FUNCTION sp_croscek_generate()
RETURNS TABLE(
  Nama text,
  Tanggal date,
  Kode_Shift text,
  Jabatan text,
  Departemen text,
  id_karyawan int,
  NIK text,
  Jadwal_Masuk time,
  Jadwal_Pulang time,
  Actual_Masuk timestamptz,
  Actual_Pulang timestamptz,
  Durasi_Shift_Diharapkan_Menit numeric,
  Durasi_Kerja_Aktual_Menit numeric,
  Durasi_Kerja_Aktual text,
  Prediksi_Shift text,
  Prediksi_Actual_Masuk timestamptz,
  Prediksi_Actual_Pulang timestamptz,
  Probabilitas_Prediksi numeric,
  Confidence_Score text,
  Frekuensi_Shift_Historis int,
  Status_Kehadiran text,
  Status_Masuk text,
  Status_Pulang text
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  -- Paste the core SQL SELECT here. For convenience, we include the view SQL by selecting from the materialized view if it exists.
  -- If you prefer to embed the full CTE query directly, replace the following with the full query from `croscek_postgres_full_view.sql`.
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'view_croscek_full') THEN
    RETURN QUERY EXECUTE 'SELECT * FROM view_croscek_full ORDER BY "Nama", "Tanggal"';
  ELSE
    -- If view not present, throw an error to encourage creating the view first
    RAISE EXCEPTION 'Materialized view view_croscek_full not found. Create it using sql/croscek_postgres_full_view.sql then REFRESH MATERIALIZED VIEW view_croscek_full;';
  END IF;
END;
$$;

-- After creating this function you can call it via Supabase RPC: `rpc('sp_croscek_generate')` or via SQL `SELECT * FROM sp_croscek_generate();`.
