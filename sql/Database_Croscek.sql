-- ============================================
-- ENABLE UUID extension (opsional, jika mau pakai UUID)
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 0. TABEL KARYAWAN
-- ============================================
CREATE TABLE IF NOT EXISTS karyawan (
    id_karyawan SERIAL PRIMARY KEY,
    nik VARCHAR(30),
    nama VARCHAR(100) NOT NULL,
    jabatan VARCHAR(50),
    dept VARCHAR(50),
    id_absen VARCHAR(50),
    kategori VARCHAR(50),
    UNIQUE (nik, nama),
    UNIQUE (id_absen)  -- dari ALTER TABLE di Python
);

-- ============================================
-- 1. TABEL INFORMASI JADWAL (PARENT)
-- ============================================
CREATE TABLE IF NOT EXISTS informasi_jadwal (
    kode VARCHAR(20) PRIMARY KEY,
    lokasi_kerja VARCHAR(50),
    nama_shift VARCHAR(100),
    jam_masuk TIME,
    jam_pulang TIME,
    keterangan VARCHAR(100),
    "group" VARCHAR(50),   -- pakai double quote karena reserved word di PostgreSQL
    status VARCHAR(50),
    kontrol VARCHAR(50),
    UNIQUE (kode)          -- dari ALTER TABLE di Python
);

-- ============================================
-- 2. TABEL SHIFT_INFO (CHILD 1)
-- ============================================
CREATE TABLE IF NOT EXISTS shift_info (
    kode VARCHAR(20) PRIMARY KEY,
    jam_masuk TIME NOT NULL,
    jam_pulang TIME NOT NULL,
    lintas_hari BOOLEAN NOT NULL,  -- TINYINT(1) → BOOLEAN di PostgreSQL
    CONSTRAINT fk_shiftinfo_kode
        FOREIGN KEY (kode) REFERENCES informasi_jadwal(kode)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- ============================================
-- 3. TABEL JADWAL KARYAWAN (CHILD 2)
-- ============================================
CREATE TABLE IF NOT EXISTS jadwal_karyawan (
    no SERIAL PRIMARY KEY,
    id_karyawan INT NULL,
    nama VARCHAR(100),
    tanggal DATE,
    kode_shift VARCHAR(20),
    shift_window_start TIMESTAMPTZ,   -- DATETIME → TIMESTAMPTZ di PostgreSQL
    shift_window_end TIMESTAMPTZ,
    CONSTRAINT fk_jadwal_kode
        FOREIGN KEY (kode_shift) REFERENCES informasi_jadwal(kode)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_jadwal_nik
        FOREIGN KEY (id_karyawan) REFERENCES karyawan(id_karyawan)
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- ============================================
-- 4. TABEL KEHADIRAN KARYAWAN (CHILD 3)
-- ============================================
CREATE TABLE IF NOT EXISTS kehadiran_karyawan (
    tanggal_scan TIMESTAMPTZ NOT NULL,
    tanggal DATE NOT NULL,
    jam TIME NOT NULL,
    pin VARCHAR(20),
    id_karyawan INT NULL,
    nip VARCHAR(20),
    nama VARCHAR(100) NOT NULL,
    jabatan VARCHAR(50),
    departemen VARCHAR(50),
    kantor VARCHAR(50),
    verifikasi INT,
    io INT,
    workcode VARCHAR(20),
    sn VARCHAR(50),
    mesin VARCHAR(50),
    kode VARCHAR(20),
    CONSTRAINT fk_kehadiran_kode
        FOREIGN KEY (kode) REFERENCES informasi_jadwal(kode)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_kehadiran_nik
        FOREIGN KEY (id_karyawan) REFERENCES karyawan(id_karyawan)
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- ============================================
-- 4.1. TABEL CROSCEK
-- ============================================
CREATE TABLE IF NOT EXISTS croscek (
    id_croscek SERIAL PRIMARY KEY,
    "Nama" VARCHAR(150) NOT NULL,
    "Tanggal" DATE NOT NULL,
    "Kode_Shift" VARCHAR(10),
    "Jabatan" VARCHAR(100),
    "Departemen" VARCHAR(100),
    id_karyawan INT NOT NULL,
    "NIK" VARCHAR(50) NOT NULL,
    "Jadwal_Masuk" TIME,
    "Jadwal_Pulang" TIME,
    "Actual_Masuk" TIMESTAMPTZ NULL,
    "Actual_Pulang" TIMESTAMPTZ NULL,
    "Prediksi_Shift" VARCHAR(50) DEFAULT NULL,
    "Prediksi_Actual_Masuk" TIMESTAMPTZ DEFAULT NULL,
    "Prediksi_Actual_Pulang" TIMESTAMPTZ DEFAULT NULL,
    "Probabilitas_Prediksi" VARCHAR(50),
    "Confidence_Score" VARCHAR(50),
    "Frekuensi_Shift_Historis" VARCHAR(50),
    "Status_Kehadiran" VARCHAR(50),
    "Status_Masuk" VARCHAR(50),
    "Status_Pulang" VARCHAR(50),
    UNIQUE (id_karyawan, "Tanggal", "Kode_Shift")
);

-- ============================================
-- 4.2. TABEL CROSCEK_DW
-- ============================================
CREATE TABLE IF NOT EXISTS croscek_dw (
    id_croscek_dw SERIAL PRIMARY KEY,
    "Nama" VARCHAR(150) NOT NULL,
    "Tanggal" DATE NOT NULL,
    "Kode_Shift" VARCHAR(10),
    "Jabatan" VARCHAR(100),
    "Departemen" VARCHAR(100),
    id_karyawan INT NOT NULL,
    "NIK" VARCHAR(50) NOT NULL,
    "Jadwal_Masuk" TIME,
    "Jadwal_Pulang" TIME,
    "Actual_Masuk" TIMESTAMPTZ NULL,
    "Actual_Pulang" TIMESTAMPTZ NULL,
    "Prediksi_Shift" VARCHAR(50) DEFAULT NULL,
    "Prediksi_Actual_Masuk" TIMESTAMPTZ DEFAULT NULL,
    "Prediksi_Actual_Pulang" TIMESTAMPTZ DEFAULT NULL,
    "Probabilitas_Prediksi" VARCHAR(50),
    "Confidence_Score" VARCHAR(50),
    "Frekuensi_Shift_Historis" VARCHAR(50),
    "Status_Kehadiran" VARCHAR(50),
    "Status_Masuk" VARCHAR(50),
    "Status_Pulang" VARCHAR(50),
    UNIQUE (id_karyawan, "Tanggal", "Kode_Shift")
);

-- ============================================
-- TABEL USERS (Admin & Staf)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(100) UNIQUE NOT NULL,
    nama VARCHAR(100) NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'staf'
        CHECK (role IN ('admin', 'staf')),
    id_karyawan INT NULL
        REFERENCES karyawan(id_karyawan)
        ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index untuk lookup cepat
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

-- ============================================
-- 5. INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_khd_nama_tanggal_scan ON kehadiran_karyawan (nama, tanggal_scan);
CREATE INDEX IF NOT EXISTS idx_khd_nama_tgl ON kehadiran_karyawan (nama, tanggal);
CREATE INDEX IF NOT EXISTS idx_khd_nik_tanggal ON kehadiran_karyawan (nip, tanggal);
CREATE INDEX IF NOT EXISTS idx_khd_pin_tanggal_scan ON kehadiran_karyawan (pin, tanggal_scan);
CREATE INDEX IF NOT EXISTS idx_khd_id_tanggal_scan ON kehadiran_karyawan (id_karyawan, tanggal_scan);
CREATE INDEX IF NOT EXISTS idx_khd_id_tanggal ON kehadiran_karyawan (id_karyawan, tanggal);

CREATE INDEX IF NOT EXISTS idx_jk_nama_tanggal ON jadwal_karyawan (nama, tanggal);
CREATE INDEX IF NOT EXISTS idx_jk_id_tanggal ON jadwal_karyawan (id_karyawan, tanggal);
CREATE INDEX IF NOT EXISTS idx_jk_id_shift_tanggal ON jadwal_karyawan (id_karyawan, kode_shift, tanggal);
CREATE INDEX IF NOT EXISTS idx_jk_tanggal_id ON jadwal_karyawan (tanggal, id_karyawan);

-- Buat fungsi helper agar tidak perlu tulis AT TIME ZONE berulang
CREATE OR REPLACE FUNCTION to_wib(ts TIMESTAMPTZ)
RETURNS TIMESTAMP AS $$
    SELECT ts AT TIME ZONE 'Asia/Jakarta'
$$ LANGUAGE SQL IMMUTABLE;