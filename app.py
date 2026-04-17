# backend/app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import mysql.connector
import pandas as pd
from io import BytesIO
from datetime import datetime
import re
import calendar
from datetime import time
# ============================================================
# HELPERS
# ============================================================
from calendar import monthrange
from datetime import datetime
import re
from flask import request, jsonify
import pandas as pd
from io import BytesIO

app = Flask(__name__)
CORS(app, origins=["http://localhost:5173"])

# -----------------------
# DATABASE CONNECTION
# -----------------------
def get_db_connection():
    return mysql.connector.connect(
        host="localhost",
        user="root",
        password="",  # ganti sesuai setting-mu
        database="croscek_absen"  # ganti sesuai nama DB
    )

def db():
    return mysql.connector.connect(
        host="localhost",
        user="root",
        password="",
        database="croscek_absen"
    )


def detect_lintas_hari(kode, jam_masuk, jam_pulang):
    if jam_masuk is None or jam_pulang is None:
        return 0

    # RULE KHUSUS SHIFT MALAM
    if kode.upper() == '3A':
        return 1

    # RULE UMUM
    return 1 if jam_pulang <= jam_masuk else 0

# ============================================================
# AUTO-SYNC SHIFT_INFO SETIAP ADA PERUBAHAN informasi_jadwal
# ===========================================================
def sync_shift_info():
    try:
        conn = db()
        cur = conn.cursor(dictionary=True)

        cur.execute("""
            SELECT kode, jam_masuk, jam_pulang
            FROM informasi_jadwal
            WHERE jam_masuk IS NOT NULL
              AND jam_pulang IS NOT NULL
        """)
        rows = cur.fetchall()

        for r in rows:
            kode = r["kode"]
            jm = r["jam_masuk"]
            jp = r["jam_pulang"]

            # lintas = detect_lintas_hari(jm, jp)
            lintas = lintas = detect_lintas_hari(kode, jm, jp)

            cur.execute("""
                INSERT INTO shift_info (kode, jam_masuk, jam_pulang, lintas_hari)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    jam_masuk = VALUES(jam_masuk),
                    jam_pulang = VALUES(jam_pulang),
                    lintas_hari = VALUES(lintas_hari)
            """, (kode, jm, jp, lintas))

        conn.commit()
        cur.close()
        conn.close()

        print("[SYNC shift_info] selesai & valid")

    except Exception as e:
        print("[SHIFT SYNC ERROR]:", e)

def sync_single_shift(kode):
    """Sinkronisasi satu shift berdasarkan kode tertentu"""
    try:
        conn = db()
        cur = conn.cursor(dictionary=True)

        cur.execute("""
            SELECT kode, jam_masuk, jam_pulang
            FROM informasi_jadwal
            WHERE kode = %s
        """, (kode,))
        r = cur.fetchone()

        if not r:
            return

        jm = r["jam_masuk"]
        jp = r["jam_pulang"]

        # lintas = detect_lintas_hari(jm, jp)
        lintas = detect_lintas_hari(kode, jm, jp)

        cur.execute("""
            INSERT INTO shift_info (kode, jam_masuk, jam_pulang, lintas_hari)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                jam_masuk = VALUES(jam_masuk),
                jam_pulang = VALUES(jam_pulang),
                lintas_hari = VALUES(lintas_hari)
        """, (kode, jm, jp, lintas))

        conn.commit()
        cur.close()
        conn.close()

        print(f"[SYNC SINGLE] Shift {kode} valid")

    except Exception as e:
        print("[SYNC SINGLE SHIFT ERROR]:", e)

def delete_single_shift(kode):
    """Hapus satu shift dari shift_info"""
    try:
        conn = db()
        cur = conn.cursor()

        cur.execute("DELETE FROM shift_info WHERE kode = %s", (kode,))

        conn.commit()
        cur.close()
        conn.close()

        print(f"[SYNC] Shift {kode} dihapus dari shift_info")

    except Exception as e:
        print("[DELETE SINGLE SHIFT ERROR]:", e)

# -----------------------
# GET ALL informasi jadwal
# -----------------------
@app.route("/api/list", methods=["GET"])
def get_jadwal():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT kode, lokasi_kerja, nama_shift, jam_masuk, jam_pulang,
                   keterangan, `group`, status, kontrol
            FROM informasi_jadwal
            ORDER BY kode ASC
        """)
        rows = cursor.fetchall()
        
        # Convert timedelta objects to strings for JSON serialization
        for row in rows:
            if row['jam_masuk'] is not None:
                row['jam_masuk'] = str(row['jam_masuk'])  # e.g., "08:30:00"
            if row['jam_pulang'] is not None:
                row['jam_pulang'] = str(row['jam_pulang'])  # e.g., "17:00:00"
        sync_shift_info()
        cursor.close()
        conn.close()
        return jsonify(rows)
    except Exception as e:
        print("ERROR GET LIST:", e)
        return jsonify({"error": str(e)}), 500

# -----------------------
# CREATE informasi jadwal
# -----------------------
@app.route("/api/create", methods=["POST"])
def create_jadwal():
    try:
        data = request.json
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO informasi_jadwal 
            (kode, lokasi_kerja, nama_shift, jam_masuk, jam_pulang, keterangan, `group`, status, kontrol)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            data.get("kode"),
            data.get("lokasi_kerja"),
            data.get("nama_shift"),
            data.get("jam_masuk"),
            data.get("jam_pulang"),
            data.get("keterangan"),
            data.get("group"),
            data.get("status", "non-active"),
            data.get("kontrol", "")
        ))
        conn.commit()
        sync_single_shift(data.get("kode"))
        cursor.close()
        conn.close()
        return jsonify({"message": "Data berhasil ditambahkan"}), 201
    except Exception as e:
        print("ERROR CREATE:", e)
        return jsonify({"error": str(e)}), 500

# -----------------------
# UPDATE informasi jadwal (PERBAIKAN)
# -----------------------
@app.route("/api/update/<kode>", methods=["PUT"])
def update_jadwal(kode):
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "No JSON body"}), 400

        # Ambil dan normalisasi field yang diharapkan
        lokasi_kerja = data.get("lokasi_kerja") or ""
        nama_shift = data.get("nama_shift") or ""
        jam_masuk = data.get("jam_masuk")
        jam_pulang = data.get("jam_pulang")
        keterangan = data.get("keterangan") or ""
        group = data.get("group") or ""
        status = data.get("status") or "non-active"
        kontrol = data.get("kontrol") or ""

        # Normalisasi jam: kalau format "HH:MM" tambahkan :00
        def normalize_time(t):
            if t is None:
                return None
            t_str = str(t).strip()
            if t_str == "":
                return None
            # jika 'HH:MM' -> tambahkan ':00'
            if len(t_str) == 5 and t_str.count(":") == 1:
                return t_str + ":00"
            # jika mengandung ' ' atau ada milliseconds, ambil bagian jam:menit:detik terdepan
            if ":" in t_str:
                parts = t_str.split(":")
                # ensure at least 3 parts
                if len(parts) == 2:
                    return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:00"
                return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{parts[2].zfill(2)}"
            return None

        jam_masuk_db = normalize_time(jam_masuk)
        jam_pulang_db = normalize_time(jam_pulang)

        conn = get_db_connection()
        cursor = conn.cursor()

        # Pastikan kode ada di DB (opsional, tapi membantu debugging)
        cursor.execute("SELECT COUNT(*) FROM informasi_jadwal WHERE kode=%s", (kode,))
        exists = cursor.fetchone()[0]
        if exists == 0:
            # Jika tidak ada, bisa pilih meng-insert atau return error. Kita return 404
            cursor.close()
            conn.close()
            return jsonify({"error": "Kode tidak ditemukan"}), 404

        cursor.execute("""
            UPDATE informasi_jadwal
            SET lokasi_kerja=%s, nama_shift=%s, jam_masuk=%s, jam_pulang=%s,
                keterangan=%s, `group`=%s, status=%s, kontrol=%s
            WHERE kode=%s
        """, (
            lokasi_kerja,
            nama_shift,
            jam_masuk_db,
            jam_pulang_db,
            keterangan,
            group,
            status,
            kontrol,
            kode
        ))
        conn.commit()
        get_jadwal()
        sync_single_shift(kode)
        cursor.close()
        conn.close()
        return jsonify({"message": "Data berhasil diupdate"})
    except Exception as e:
        print("ERROR UPDATE:", e)
        return jsonify({"error": str(e)}), 500

# -----------------------
# DELETE informasi jadwal
# -----------------------
@app.route("/api/delete/<kode>", methods=["DELETE"])
def delete_jadwal(kode):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM informasi_jadwal WHERE kode=%s", (kode,))
        get_jadwal()
        conn.commit()
        delete_single_shift(kode)
        cursor.close()
        conn.close()
        return jsonify({"message": "Data berhasil dihapus"})
    except Exception as e:
        print("ERROR DELETE:", e)
        return jsonify({"error": str(e)}), 500

# ============================================================
# UPLOAD EXCEL OTOMATIS MASUK Tabel DATABASE informasi jadwal  — FULL FIX
# ============================================================

@app.route("/api/upload", methods=["POST"])
def upload_excel():
    try:
        file = request.files.get("file")
        if file is None:
            return jsonify({"error": "File tidak ada"}), 400

        raw = file.read()
        if len(raw) == 0:
            return jsonify({"error": "File kosong"}), 400

        # =====================================================
        # 1. BACA EXCEL DENGAN HEADER 2 BARIS (WAJIB!) 
        #    AGAR JAM MASUK & PULANG TERDETEKSI
        # =====================================================
        df = pd.read_excel(BytesIO(raw), header=[0, 1])

        conn = mysql.connector.connect(
            host='localhost',
            user='root',      # default user XAMPP
            password=''       # default password XAMPP (kosong)
        )
        cursor = conn.cursor()
        
        # =========================
        # BUAT DATABASE DAN TABEL
        # =========================
        database_name = 'croscek_absen'
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS {database_name}")
        cursor.execute(f"USE {database_name}")

        # cursor.execute("""
        # CREATE TABLE IF NOT EXISTS informasi_jadwal (
        #     kode VARCHAR(20) PRIMARY KEY,
        #     lokasi_kerja VARCHAR(50),
        #     nama_shift VARCHAR(100),
        #     jam_masuk TIME,
        #     jam_pulang TIME,
        #     keterangan VARCHAR(100),
        #     `group` VARCHAR(50),
        #     status VARCHAR(50),
        #     kontrol VARCHAR(50)
        # )
        # """)
        
        # =========================
        # RENAME COLUMNS SUPAYA MUDAH DIPAKAI
        # =========================
        df.columns = [
            'No', 'Lokasi_Kerja', 'Nama', 'Kode', 'Jam_Masuk', 'Jam_Pulang',
            'Keterangan', 'Group', 'Status', 'Kontrol'
        ]

        # =========================
        # LOOP DAN INSERT KE DATABASE
        # =========================
        for index, row in df.iterrows():
            # Ganti NaN dengan string kosong
            row = row.fillna('')

            # Pastikan kode tidak kosong (PRIMARY KEY)
            if row['Kode'] != '':
                cursor.execute("""
                INSERT INTO informasi_jadwal (
                    kode, lokasi_kerja, nama_shift, jam_masuk, jam_pulang, keterangan, `group`, status, kontrol
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    lokasi_kerja = VALUES(lokasi_kerja),
                    nama_shift = VALUES(nama_shift),
                    jam_masuk = VALUES(jam_masuk),
                    jam_pulang = VALUES(jam_pulang),
                    keterangan = VALUES(keterangan),
                    `group` = VALUES(`group`),
                    status = VALUES(status),
                    kontrol = VALUES(kontrol)
                """, (
                    row['Kode'],
                    row['Lokasi_Kerja'],
                    row['Nama'],
                    row['Jam_Masuk'],
                    row['Jam_Pulang'],
                    row['Keterangan'],
                    row['Group'],
                    row['Status'],
                    row['Kontrol']
                ))

        # =========================
        # COMMIT DAN TUTUP KONEKSI
        # =========================
        conn.commit()
        sync_shift_info()
        cursor.close()
        conn.close()

        return jsonify({"message": "Upload sukses!"})

    except Exception as e:
        print("UPLOAD ERROR:", e)
        return jsonify({"error": str(e)}), 500


# =========================
# Data KARYAWAN
# =========================

@app.route("/api/karyawan/list/nama", methods=["GET"])
def get_karyawan_list():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT id_karyawan, nik, nama , jabatan, dept, id_absen, kategori
            FROM karyawan where kategori = 'karyawan'
            ORDER BY nama ASC
        """)
        rows = cursor.fetchall()

        cursor.close()
        conn.close()
        # Debug: print jumlah data
        print(f"Total karyawan yang diambil: {len(rows)}")
        return jsonify(rows)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/dw/list/nama", methods=["GET"])
def get_dw_list():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT id_karyawan, nik, nama , jabatan, dept, id_absen, kategori
            FROM karyawan where kategori = 'dw'
            ORDER BY nama ASC
        """)
        rows = cursor.fetchall()

        cursor.close()
        conn.close()
        # Debug: print jumlah data
        print(f"Total karyawan yang diambil: {len(rows)}")
        return jsonify(rows)

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
# =================== LIST Karyawan ===================
@app.route("/api/karyawan/list", methods=["GET"])
def get_karyawan():
    try:
        search = request.args.get("search", "")
        page = int(request.args.get("page", 1))
        limit = 10
        offset = (page - 1) * limit

        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)

        cur.execute("""
            SELECT COUNT(*) as total FROM karyawan
            WHERE kategori = 'karyawan' AND (nama LIKE %s OR nik LIKE %s)

        """, (f"%{search}%", f"%{search}%"))
        total = cur.fetchone()["total"]

        cur.execute("""
            SELECT nik, nama, jabatan, dept, id_absen, kategori FROM karyawan
            WHERE kategori = 'karyawan' AND (nama LIKE %s OR nik LIKE %s)
            ORDER BY nama ASC
            LIMIT %s OFFSET %s
        """, (f"%{search}%", f"%{search}%", limit, offset))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return jsonify({"data": rows, "total": total}), 200
    except Exception as e:
        print("ERROR GET KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500
      
# =================== LIST Daily Worker ===================
@app.route("/api/dw/list", methods=["GET"])
def get_dw():
    try:
        search = request.args.get("search", "")
        page = int(request.args.get("page", 1))
        limit = 10
        offset = (page - 1) * limit

        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)

        cur.execute("""
            SELECT COUNT(*) as total FROM karyawan
            WHERE kategori = 'dw' AND (nama LIKE %s OR nik LIKE %s)
        """, (f"%{search}%", f"%{search}%"))
        total = cur.fetchone()["total"]

        cur.execute("""
            SELECT nik, nama, jabatan, dept, id_absen, kategori FROM karyawan
            WHERE kategori = 'dw' AND (nama LIKE %s OR nik LIKE %s)
            ORDER BY nama ASC
            LIMIT %s OFFSET %s
        """, (f"%{search}%", f"%{search}%", limit, offset))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return jsonify({"data": rows, "total": total}), 200
    except Exception as e:
        print("ERROR GET KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

# =================== UPLOAD EXCEL ===================
@app.route("/api/karyawan/upload", methods=["POST"])
def upload_karyawan():
    try:
        file = request.files.get("file")
        if not file:
            return jsonify({"error": "File tidak ditemukan"}), 400

        raw = file.read()
        if len(raw) == 0:
            return jsonify({"error": "File excel kosong"}), 400

        df = pd.read_excel(BytesIO(raw))
        df.columns = [c.strip().upper() for c in df.columns]

        required = {"NAMA", "NIK", "JABATAN", "DEPT"}
        if not required.issubset(set(df.columns)):
            return jsonify({
                "error": f"Format kolom tidak sesuai template. Harus ada: {required}"
            }), 400

        df = df.dropna(subset=["NIK"])

        conn = get_db_connection()
        cur = conn.cursor()

        insert_count = 0
        update_count = 0
        skip_count = 0
        duplicate_list = []
        skipped_list = []

        for _, row in df.iterrows():
            # ✅ PERBAIKAN NIK: Hapus .0 dari float
            nik_raw = row["NIK"]
            if pd.notna(nik_raw):
                nik_str = str(nik_raw).strip()
                # Jika berbentuk "423384.0", ambil bagian integer
                if '.' in nik_str:
                    try:
                        nik = str(int(float(nik_str)))
                    except:
                        nik = nik_str.replace('.0', '')
                else:
                    nik = nik_str
            else:
                nik = ""

            # ✅ VALIDASI NIK TIDAK BOLEH KOSONG
            if not nik:
                skip_count += 1
                skipped_list.append({"error": "NIK kosong", "row": row.to_dict()})
                continue

            # ✅ DATA CLEANSING NAMA
            nama_raw = str(row["NAMA"]).strip()
            nama = re.sub(r"[.,]", "", nama_raw)
            nama = re.sub(r"\s+", " ", nama)
            nama = nama.upper()

            # ✅ VALIDASI NAMA TIDAK BOLEH KOSONG
            if not nama:
                skip_count += 1
                skipped_list.append({"error": "Nama kosong", "nik": nik})
                continue

            jabatan = str(row["JABATAN"]).strip() if pd.notna(row["JABATAN"]) else ""
            dept = str(row["DEPT"]).strip() if pd.notna(row["DEPT"]) else ""
            
            # ✅ PERBAIKAN ID_ABSEN: Hapus .0 dari float
            id_absen_raw = row.get("ID ABSEN") if "ID ABSEN" in row else None
            if pd.notna(id_absen_raw):
                id_absen_str = str(id_absen_raw).strip()
                if '.' in id_absen_str:
                    try:
                        id_absen = str(int(float(id_absen_str)))
                    except:
                        id_absen = id_absen_str.replace('.0', '')
                else:
                    id_absen = id_absen_str
            else:
                id_absen = None

            kategori = "karyawan"  # ✅ FIXED VALUE

            # 🔍 CEK DUPLIKASI HANYA BERDASARKAN NIK
            cur.execute("""
                SELECT id_karyawan, nama, jabatan, dept, id_absen FROM karyawan
                WHERE nik = %s
            """, (nik,))
            existing = cur.fetchone()

            if existing:
                id_karyawan = existing[0]
                nama_lama = existing[1]
                jabatan_lama = existing[2]
                dept_lama = existing[3]
                id_absen_lama = existing[4]

                # ✅ CEK APAKAH ADA PERUBAHAN DATA
                if (nama != nama_lama or 
                    jabatan != jabatan_lama or 
                    dept != dept_lama or 
                    id_absen != id_absen_lama):
                    
                    # UPDATE jika ada perubahan
                    cur.execute("""
                        UPDATE karyawan
                        SET nama=%s, jabatan=%s, dept=%s, id_absen=%s
                        WHERE id_karyawan=%s
                    """, (nama, jabatan, dept, id_absen, id_karyawan))

                    update_count += 1
                    duplicate_list.append({
                        "nik": nik,
                        "nama": nama,
                        "jabatan": jabatan,
                        "dept": dept,
                        "id_absen": id_absen,
                        "action": "updated"
                    })
                else:
                    # SKIP jika data sama persis
                    skip_count += 1
                    skipped_list.append({
                        "nik": nik,
                        "nama": nama,
                        "reason": "Data sudah ada dan identik"
                    })
            else:
                # ✅ INSERT DATA BARU
                cur.execute("""
                    INSERT INTO karyawan (nik, nama, jabatan, dept, id_absen, kategori)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (nik, nama, jabatan, dept, id_absen, kategori))

                insert_count += 1

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({
            "message": f"Upload sukses! Insert: {insert_count}, Update: {update_count}, Skip: {skip_count}",
            "insert_count": insert_count,
            "update_count": update_count,
            "skip_count": skip_count,
            "updated_data": duplicate_list[:10],
            "skipped_data": skipped_list[:10]
        }), 200

    except Exception as e:
        print("ERROR UPLOAD KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

# =================== UPLOAD EXCEL DW ===================
@app.route("/api/dw/upload", methods=["POST"])
def upload_dw():
    try:
        file = request.files.get("file")
        if not file:
            return jsonify({"error": "File tidak ditemukan"}), 400

        raw = file.read()
        if len(raw) == 0:
            return jsonify({"error": "File excel kosong"}), 400

        df = pd.read_excel(BytesIO(raw))
        df.columns = [c.strip().upper() for c in df.columns]

        required = {"NAMA", "NIK", "JABATAN", "DEPT"}
        if not required.issubset(set(df.columns)):
            return jsonify({
                "error": f"Format kolom tidak sesuai template. Harus ada: {required}"
            }), 400

        df = df.dropna(subset=["NIK"])

        conn = get_db_connection()
        cur = conn.cursor()

        insert_count = 0
        update_count = 0
        skip_count = 0
        duplicate_list = []
        skipped_list = []

        for _, row in df.iterrows():
            # ✅ PERBAIKAN NIK: Hapus .0 dari float
            nik_raw = row["NIK"]
            if pd.notna(nik_raw):
                nik_str = str(nik_raw).strip()
                # Jika berbentuk "423384.0", ambil bagian integer
                if '.' in nik_str:
                    try:
                        nik = str(int(float(nik_str)))
                    except:
                        nik = nik_str.replace('.0', '')
                else:
                    nik = nik_str
            else:
                nik = ""

            # ✅ VALIDASI NIK TIDAK BOLEH KOSONG
            if not nik:
                skip_count += 1
                skipped_list.append({"error": "NIK kosong", "row": row.to_dict()})
                continue

            # ✅ DATA CLEANSING NAMA
            nama_raw = str(row["NAMA"]).strip()
            nama = re.sub(r"[.,]", "", nama_raw)
            nama = re.sub(r"\s+", " ", nama)
            nama = nama.upper()

            # ✅ VALIDASI NAMA TIDAK BOLEH KOSONG
            if not nama:
                skip_count += 1
                skipped_list.append({"error": "Nama kosong", "nik": nik})
                continue

            jabatan = str(row["JABATAN"]).strip() if pd.notna(row["JABATAN"]) else ""
            dept = str(row["DEPT"]).strip() if pd.notna(row["DEPT"]) else ""
            
            # ✅ PERBAIKAN ID_ABSEN: Hapus .0 dari float
            id_absen_raw = row.get("ID ABSEN") if "ID ABSEN" in row else None
            if pd.notna(id_absen_raw):
                id_absen_str = str(id_absen_raw).strip()
                if '.' in id_absen_str:
                    try:
                        id_absen = str(int(float(id_absen_str)))
                    except:
                        id_absen = id_absen_str.replace('.0', '')
                else:
                    id_absen = id_absen_str
            else:
                id_absen = None

            kategori = "dw"  # ✅ FIXED VALUE

            # 🔍 CEK DUPLIKASI HANYA BERDASARKAN NIK
            cur.execute("""
                SELECT id_karyawan, nama, jabatan, dept, id_absen FROM karyawan
                WHERE nik = %s
            """, (nik,))
            existing = cur.fetchone()

            if existing:
                id_karyawan = existing[0]
                nama_lama = existing[1]
                jabatan_lama = existing[2]
                dept_lama = existing[3]
                id_absen_lama = existing[4]

                # ✅ CEK APAKAH ADA PERUBAHAN DATA
                if (nama != nama_lama or 
                    jabatan != jabatan_lama or 
                    dept != dept_lama or 
                    id_absen != id_absen_lama):
                    
                    # UPDATE jika ada perubahan
                    cur.execute("""
                        UPDATE karyawan
                        SET nama=%s, jabatan=%s, dept=%s, id_absen=%s
                        WHERE id_karyawan=%s
                    """, (nama, jabatan, dept, id_absen, id_karyawan))

                    update_count += 1
                    duplicate_list.append({
                        "nik": nik,
                        "nama": nama,
                        "jabatan": jabatan,
                        "dept": dept,
                        "id_absen": id_absen,
                        "action": "updated"
                    })
                else:
                    # SKIP jika data sama persis
                    skip_count += 1
                    skipped_list.append({
                        "nik": nik,
                        "nama": nama,
                        "reason": "Data sudah ada dan identik"
                    })
            else:
                # ✅ INSERT DATA BARU
                cur.execute("""
                    INSERT INTO karyawan (nik, nama, jabatan, dept, id_absen, kategori)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (nik, nama, jabatan, dept, id_absen, kategori))

                insert_count += 1

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({
            "message": f"Upload sukses! Insert: {insert_count}, Update: {update_count}, Skip: {skip_count}",
            "insert_count": insert_count,
            "update_count": update_count,
            "skip_count": skip_count,
            "updated_data": duplicate_list[:10],
            "skipped_data": skipped_list[:10]
        }), 200

    except Exception as e:
        print("ERROR UPLOAD DW:", e)
        return jsonify({"error": str(e)}), 500

# =================== CREATE ===================
@app.route("/api/karyawan/create", methods=["POST"])
def create_karyawan():
    try:
        data = request.json

        nik = str(data.get("nik", "")).strip()

        # ✅ VALIDASI NIK TIDAK BOLEH KOSONG
        if not nik:
            return jsonify({"error": "NIK tidak boleh kosong"}), 400

        # ✅ DATA CLEANSING NAMA
        nama_raw = str(data.get("nama", "")).strip()
        nama = re.sub(r"[.,]", "", nama_raw)
        nama = re.sub(r"\s+", " ", nama)
        nama = nama.upper()

        # ✅ VALIDASI NAMA TIDAK BOLEH KOSONG
        if not nama:
            return jsonify({"error": "Nama tidak boleh kosong"}), 400

        jabatan = str(data.get("jabatan", "")).strip()
        dept = str(data.get("dept", "")).strip()
        id_absen = data.get("id_absen")

        kategori = "karyawan"  # ✅ FIXED VALUE

        conn = get_db_connection()
        cur = conn.cursor()

        # ✅ CEK DUPLIKASI NIK
        cur.execute("SELECT nik FROM karyawan WHERE nik = %s", (nik,))
        existing = cur.fetchone()
        
        if existing:
            cur.close()
            conn.close()
            return jsonify({"error": f"NIK {nik} sudah terdaftar di database"}), 409

        # ✅ INSERT DATA
        cur.execute("""
            INSERT INTO karyawan (nik, nama, jabatan, dept, id_absen, kategori)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (nik, nama, jabatan, dept, id_absen, kategori))

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({"message": "Karyawan berhasil ditambahkan"}), 201

    except Exception as e:
        print("ERROR CREATE KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

# =================== CREATE DW ===================
@app.route("/api/dw/create", methods=["POST"])
def create_dw():
    try:
        data = request.json

        nik = str(data.get("nik", "")).strip()

        # ✅ VALIDASI NIK TIDAK BOLEH KOSONG
        if not nik:
            return jsonify({"error": "NIK tidak boleh kosong"}), 400

        # ✅ DATA CLEANSING NAMA
        nama_raw = str(data.get("nama", "")).strip()
        nama = re.sub(r"[.,]", "", nama_raw)
        nama = re.sub(r"\s+", " ", nama)
        nama = nama.upper()

        # ✅ VALIDASI NAMA TIDAK BOLEH KOSONG
        if not nama:
            return jsonify({"error": "Nama tidak boleh kosong"}), 400

        jabatan = str(data.get("jabatan", "")).strip()
        dept = str(data.get("dept", "")).strip()
        id_absen = data.get("id_absen")

        kategori = "dw"  # ✅ FIXED VALUE

        conn = get_db_connection()
        cur = conn.cursor()

        # ✅ CEK DUPLIKASI NIK
        cur.execute("SELECT nik FROM karyawan WHERE nik = %s", (nik,))
        existing = cur.fetchone()
        
        if existing:
            cur.close()
            conn.close()
            return jsonify({"error": f"NIK {nik} sudah terdaftar di database"}), 409

        # ✅ INSERT DATA
        cur.execute("""
            INSERT INTO karyawan (nik, nama, jabatan, dept, id_absen, kategori)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (nik, nama, jabatan, dept, id_absen, kategori))

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({"message": "DW berhasil ditambahkan"}), 201

    except Exception as e:
        print("ERROR CREATE DW:", e)
        return jsonify({"error": str(e)}), 500

# =================== UPDATE ===================
@app.route("/api/karyawan/update/<nik>", methods=["PUT"])
def update_karyawan(nik):
    try:
        data = request.get_json(force=True)
        conn = get_db_connection()
        cur = conn.cursor()

        nik = str(data.get("nik", "")).strip()

        # ✅ DATA CLEANSING NAMA
        nama_raw = str(data.get("nama", "")).strip()
        nama = re.sub(r"[.,]", "", nama_raw)   # hapus titik & koma
        nama = re.sub(r"\s+", " ", nama)       # rapikan spasi
        nama = nama.upper()                    # konsistensi

        jabatan = str(data.get("jabatan", "")).strip()
        dept = str(data.get("dept", "")).strip()
        id_absen = data.get("id_absen")

        
        cur.execute("""
            UPDATE karyawan
            SET nama=%s, jabatan=%s, dept=%s, id_absen=%s
            WHERE nik=%s
        """, (
            nama,
            jabatan,
            dept,
            id_absen,
            nik
        ))

        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"message": "Data karyawan diperbarui"})
    except Exception as e:
        print("ERROR UPDATE KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

# =================== DELETE ===================
@app.route("/api/karyawan/delete/<nik>", methods=["DELETE"])
def delete_karyawan(nik):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM karyawan WHERE nik=%s", (nik,))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"message": "Data karyawan dihapus"})
    except Exception as e:
        print("ERROR DELETE KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500
    

@app.errorhandler(500)
def handle_500(e):
    return jsonify({"error": "Server bermasalah, cek log backend"}), 500


# ============================================================
# CREATE TABLES JIKA BELUM ADA
# ============================================================
def db_server():
    return mysql.connector.connect(
        host="localhost",
        user="root",
        password=""
    )
    
def init_tables():
    
    # ==============================
    # STEP 1: CONNECT KE MYSQL SERVER
    # ==============================
    conn_server = db_server()
    cur_server = conn_server.cursor()

    cur_server.execute("""
        CREATE DATABASE IF NOT EXISTS croscek_absen
        CHARACTER SET utf8mb4
        COLLATE utf8mb4_unicode_ci;
    """)

    cur_server.close()
    conn_server.close()

    conn = db()
    cur = conn.cursor()
    # ============================================
    # 0. TABEL KARYAWAN (BARU)
    # ============================================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS karyawan (
            id_karyawan INT AUTO_INCREMENT PRIMARY KEY,
            nik VARCHAR(30),
            nama VARCHAR(100) NOT NULL,
            jabatan VARCHAR(50),
            dept VARCHAR(50),
            id_absen VARCHAR(50),
            kategori VARCHAR(50),
            UNIQUE KEY uk_nik_nama (nik, nama)  -- jika mau kombinasi unik (opsional)
        );
    """)


    # ============================================
    # 1. TABEL INFORMASI JADWAL (PARENT)
    # ============================================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS informasi_jadwal (
            kode VARCHAR(20) PRIMARY KEY,
            lokasi_kerja VARCHAR(50),
            nama_shift VARCHAR(100),
            jam_masuk TIME,
            jam_pulang TIME,
            keterangan VARCHAR(100),
            `group` VARCHAR(50),
            status VARCHAR(50),
            kontrol VARCHAR(50)
        )
    """)

    # ============================================
    # 2. TABEL SHIFT_INFO (CHILD 1)
    # ============================================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS shift_info (
            kode VARCHAR(20),
            jam_masuk TIME NOT NULL,
            jam_pulang TIME NOT NULL,
            lintas_hari TINYINT(1) NOT NULL,
            PRIMARY KEY (kode),
            CONSTRAINT fk_shiftinfo_kode 
                FOREIGN KEY (kode) REFERENCES informasi_jadwal(kode)
                ON DELETE CASCADE
                ON UPDATE CASCADE
        );
    """)

    # ============================================
    # 3. TABEL JADWAL KARYAWAN (CHILD 2)
    # ============================================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS jadwal_karyawan (
            no INT AUTO_INCREMENT PRIMARY KEY,
            id_karyawan INT NULL,
            nama VARCHAR(100),
            tanggal DATE,
            kode_shift VARCHAR(20),
            shift_window_start DATETIME,
            shift_window_end DATETIME,

            CONSTRAINT fk_jadwal_kode
                FOREIGN KEY (kode_shift) REFERENCES informasi_jadwal(kode)
                ON DELETE CASCADE
                ON UPDATE CASCADE,

            CONSTRAINT fk_jadwal_nik
                FOREIGN KEY (id_karyawan) REFERENCES karyawan(id_karyawan)
                ON DELETE SET NULL
                ON UPDATE CASCADE
        )
    """)

    # ============================================
    # 4. TABEL KEHADIRAN KARYAWAN (CHILD 3)
    # ============================================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS kehadiran_karyawan (
            tanggal_scan DATETIME NOT NULL,
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
                ON DELETE SET NULL
                ON UPDATE CASCADE,

            CONSTRAINT fk_kehadiran_nik
                FOREIGN KEY (id_karyawan) REFERENCES karyawan(id_karyawan)
                ON DELETE SET NULL
                ON UPDATE CASCADE
        )
    """)
    
    # ============================================
    # 4.1. TABEL Croscek (Hasil Proses Croscek)
    # ============================================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS croscek (
            id_croscek INT AUTO_INCREMENT PRIMARY KEY,
            Nama VARCHAR(150) NOT NULL,
            Tanggal DATE NOT NULL,
            Kode_Shift VARCHAR(10),
            Jabatan VARCHAR(100),
            Departemen VARCHAR(100),
            id_karyawan INT NOT NULL,
            NIK VARCHAR(50) NOT NULL,
            Jadwal_Masuk TIME,
            Jadwal_Pulang TIME,
            Actual_Masuk DATETIME NULL,
            Actual_Pulang DATETIME NULL,
            Prediksi_Shift VARCHAR(50) DEFAULT NULL,
            Prediksi_Actual_Masuk DATETIME DEFAULT NULL,
            Prediksi_Actual_Pulang DATETIME DEFAULT NULL,
            Probabilitas_Prediksi VARCHAR(50),
            Confidence_Score VARCHAR(50),
            Frekuensi_Shift_Historis VARCHAR(50),
            Status_Kehadiran VARCHAR(50),
            Status_Masuk VARCHAR(50),
            Status_Pulang VARCHAR(50)
            # UNIQUE KEY uniq_karyawan_tanggal (id_karyawan, Tanggal)
        )
    """)
    # ============================================
    # 4.2. TABEL Croscek-wd (Hasil Proses Croscek)
    # ============================================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS croscek_dw (
            id_croscek_dw INT AUTO_INCREMENT PRIMARY KEY,
            Nama VARCHAR(150) NOT NULL,
            Tanggal DATE NOT NULL,
            Kode_Shift VARCHAR(10),
            Jabatan VARCHAR(100),
            Departemen VARCHAR(100),
            id_karyawan INT NOT NULL,
            NIK VARCHAR(50) NOT NULL,
            Jadwal_Masuk TIME,
            Jadwal_Pulang TIME,
            Actual_Masuk DATETIME NULL,
            Actual_Pulang DATETIME NULL,
            Prediksi_Shift VARCHAR(50) DEFAULT NULL,
            Prediksi_Actual_Masuk DATETIME DEFAULT NULL,
            Prediksi_Actual_Pulang DATETIME DEFAULT NULL,
            Probabilitas_Prediksi VARCHAR(50),
            Confidence_Score VARCHAR(50),
            Frekuensi_Shift_Historis VARCHAR(50),
            Status_Kehadiran VARCHAR(50),
            Status_Masuk VARCHAR(50),
            Status_Pulang VARCHAR(50)
            # UNIQUE KEY uniq_karyawan_tanggal (id_karyawan, Tanggal)
        )
    """)


    # ============================================
    # 5. TAMBAHKAN INDEX AGAR QUERY CEPAT (AMAN)
    # ============================================
    try:
        cur.execute("""
            ALTER TABLE kehadiran_karyawan 
                ADD INDEX idx_khd_nama_tanggal (nama, tanggal_scan),
                ADD INDEX idx_khd_nama_tgl (nama, tanggal)
        """)
    except:
        pass

    try:
        cur.execute("""
            ALTER TABLE jadwal_karyawan 
                ADD INDEX idx_jk_nama_tanggal (nama, tanggal)
        """)
    except:
        pass
    
    try:
        cur.execute("""
            ALTER TABLE kehadiran_karyawan 
                ADD INDEX idx_khd_nik_tanggal (nik, tanggal),
                ADD INDEX idx_khd_nama_tanggal (nama, tanggal_scan)
        """)
    except:
        pass

    try:
        cur.execute("""
            ALTER TABLE jadwal_karyawan 
                ADD INDEX idx_jk_nik_tanggal (nik, tanggal),
                ADD INDEX idx_jk_nama_tanggal (nama, tanggal)
        """)
    except:
        pass

    try:
        cur.execute("""
            ALTER TABLE croscek
                ADD UNIQUE KEY uq_croscek (id_karyawan, Tanggal, Kode_Shift);
        """)
    except:
        pass
    
    try:
        cur.execute("""
            ALTER TABLE croscek_dw
                ADD UNIQUE KEY uq_croscek_dw (id_karyawan, Tanggal, Kode_Shift);
        """)
    except:
        pass
    
    try:
        cur.execute("""
            ALTER TABLE kehadiran_karyawan
                ADD INDEX idx_kehadiran_pin_tanggal (pin, tanggal_scan);
        """)
    except:
        pass
    
    try:
        cur.execute("""
            ALTER TABLE jadwal_karyawan
                ADD INDEX idx_jadwal_karyawan_tanggal_shift
                (id_karyawan, tanggal, kode_shift);
        """)
    except:
        pass

    try:
        cur.execute("""
            ALTER TABLE jadwal_karyawan
                ADD INDEX idx_jadwal_tanggal_karyawan (tanggal, id_karyawan);
        """)
    except:
        pass
    
    try:
        cur.execute("""
            ALTER TABLE karyawan
                ADD UNIQUE INDEX uq_karyawan_id_absen (id_absen);
        """)
    except:
        pass
    
    try:
        cur.execute("""
            ALTER TABLE informasi_jadwal
                ADD UNIQUE INDEX uq_informasi_jadwal_kode (kode);
        """)
    except:
        pass


    
    # Prediksi kode shift
    try:
        cur.execute("""
            ALTER TABLE kehadiran_karyawan
                ADD INDEX idx_khd_id_tanggal_scan (id_karyawan, tanggal_scan);
        """)
    except:
        pass
    try:
        cur.execute("""
            ALTER TABLE jadwal_karyawan
                ADD INDEX idx_jk_id_tanggal (id_karyawan, tanggal);
        """)
    except:
        pass
    try:
        cur.execute("""
            ALTER TABLE croscek
                ADD UNIQUE INDEX uq_croscek_id_tanggal_shift (id_karyawan, Tanggal, Kode_Shift);
        """)
    except:
        pass
    try:
        cur.execute("""
            ALTER TABLE croscek_dw
                ADD UNIQUE INDEX uq_croscek_dw_id_tanggal_shift (id_karyawan, Tanggal, Kode_Shift);
        """)
    except:
        pass
    try:
        cur.execute("""
            ALTER TABLE kehadiran_karyawan
                ADD INDEX idx_khd_id_tanggal (id_karyawan, tanggal);
        """)
    except:
        pass
    try:
        cur.execute("""
            ALTER TABLE jadwal_karyawan
                ADD INDEX idx_jk_id_shift_tanggal (id_karyawan, kode_shift, tanggal);
        """)
    except:
        pass
    
    
    
    
    
    
    conn.commit()
    cur.close()
    conn.close()


init_tables()

# =========================================================
# ==================  JADWAL KARYAWAN  ====================
# =========================================================

def parse_month_year(raw_value):
    """
    Parse bulan dan tahun dari berbagai format input.
    
    Supported formats:
    - 'November 2025'
    - '11/11/2025' (ambil bulan dan tahun, abaikan tanggal)
    - '2025-11-01' atau '2025-11-01 00:00:00'
    - pandas.Timestamp object
    
    Returns:
        tuple: (year, month) as integers
    
    Raises:
        ValueError: jika format tidak dikenali
    """
    import pandas as pd
    
    # Handle pandas Timestamp
    if isinstance(raw_value, pd.Timestamp):
        return raw_value.year, raw_value.month
    
    # Convert to string and clean
    value_str = str(raw_value).strip()
    
    # Remove extra quotes (single or double)
    value_str = value_str.strip("'\"")
    
    print(f"🔍 Parsing: '{value_str}'")
    
    # Format 1: "November 2025" atau "november 2025"
    # Match: <bulan_nama> <tahun>
    month_names = {
        'januari': 1, 'january': 1,
        'februari': 2, 'february': 2,
        'maret': 3, 'march': 3,
        'april': 4,
        'mei': 5, 'may': 5,
        'juni': 6, 'june': 6,
        'juli': 7, 'july': 7,
        'agustus': 8, 'august': 8,
        'september': 9,
        'oktober': 10, 'october': 10,
        'november': 11,
        'desember': 12, 'december': 12
    }
    
    for month_name, month_num in month_names.items():
        if month_name in value_str.lower():
            # Extract year (4 digits)
            year_match = re.search(r'\b(20\d{2})\b', value_str)
            if year_match:
                year = int(year_match.group(1))
                print(f"✅ Parsed as '{month_name.title()} {year}' -> ({year}, {month_num})")
                return year, month_num
    
    # Format 2: "DD/MM/YYYY" atau "MM/DD/YYYY"
    # Kita asumsikan MM/DD/YYYY atau DD/MM/YYYY
    slash_match = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', value_str)
    if slash_match:
        part1, part2, year = slash_match.groups()
        part1, part2, year = int(part1), int(part2), int(year)
        
        # Detect format: jika part1 > 12, maka format DD/MM/YYYY
        if part1 > 12:
            day, month = part1, part2
        # Jika part2 > 12, maka format MM/DD/YYYY
        elif part2 > 12:
            month, day = part1, part2
        # Jika keduanya <= 12, asumsikan DD/MM/YYYY (format Indonesia)
        else:
            day, month = part1, part2
        
        print(f"✅ Parsed as date '{value_str}' -> ({year}, {month}) [day={day} ignored]")
        return year, month
    
    # Format 3: "YYYY-MM-DD" atau "YYYY-MM-DD HH:MM:SS"
    iso_match = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})', value_str)
    if iso_match:
        year, month, day = iso_match.groups()
        year, month = int(year), int(month)
        print(f"✅ Parsed as ISO date '{value_str}' -> ({year}, {month}) [day ignored]")
        return year, month
    
    # Format 4: Try datetime parsing as fallback
    try:
        dt = datetime.strptime(value_str.split()[0], '%Y-%m-%d')
        print(f"✅ Parsed via datetime -> ({dt.year}, {dt.month})")
        return dt.year, dt.month
    except:
        pass
    
    # If all parsing fails
    raise ValueError(
        f"Format tidak dikenali: '{value_str}'. "
        f"Gunakan format: 'November 2025', '11/11/2025', atau '2025-11-01'"
    )

# ============================================================
# CRUD JADWAL KARYAWAN (DISESUAIKAN DENGAN KOLOM BARU: nik, nama, tanggal, kode_shift)
# ============================================================
@app.route("/api/jadwal-karyawan/list", methods=["GET"])
def get_jadwal_karyawan():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            # SELECT jk.no, k.nik, k.nama, jk.tanggal, jk.kode_shift
            # FROM jadwal_karyawan jk
            # LEFT JOIN karyawan k ON jk.id_karyawan = k.id_karyawan
            # ORDER BY jk.no ASC
            SELECT 
                jk.no,
                k.nik,
                k.nama,
                jk.tanggal,
                jk.kode_shift
            FROM jadwal_karyawan jk
            INNER JOIN karyawan k 
                ON jk.id_karyawan = k.id_karyawan
            WHERE k.kategori = 'karyawan'
            ORDER BY jk.no ASC;

        """)
        rows = cursor.fetchall()

        for row in rows:
            if row["tanggal"]:
                row["tanggal"] = str(row["tanggal"])

        cursor.close()
        conn.close()
        return jsonify(rows)

    except Exception as e:
        print("ERROR GET JADWAL KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/jadwal-dw/list", methods=["GET"])
def get_jadwal_dw():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            # SELECT jk.no, k.nik, k.nama, jk.tanggal, jk.kode_shift
            # FROM jadwal_karyawan jk
            # LEFT JOIN karyawan k ON jk.id_karyawan = k.id_karyawan
            # ORDER BY jk.no ASC
            SELECT 
                jk.no,
                k.nik,
                k.nama,
                jk.tanggal,
                jk.kode_shift
            FROM jadwal_karyawan jk
            INNER JOIN karyawan k 
                ON jk.id_karyawan = k.id_karyawan
            WHERE k.kategori = 'dw'
            ORDER BY jk.no ASC;

        """)
        rows = cursor.fetchall()

        for row in rows:
            if row["tanggal"]:
                row["tanggal"] = str(row["tanggal"])

        cursor.close()
        conn.close()
        return jsonify(rows)

    except Exception as e:
        print("ERROR GET JADWAL KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/informasi-jadwal/list", methods=["GET"])
def get_informasi_jadwal():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT kode AS kode_shift, keterangan
            FROM informasi_jadwal
            ORDER BY kode ASC
        """)
        rows = cursor.fetchall()

        cursor.close()
        conn.close()
        return jsonify(rows)

    except Exception as e:
        print("ERROR GET INFORMASI JADWAL:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/jadwal-karyawan/create", methods=["POST"])
def create_jadwal_karyawan():
    try:
        data = request.json
        nik = data.get("nik")
        kode_shift = data.get("kode_shift")
        tanggal = data.get("tanggal")

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id_karyawan, nama FROM karyawan WHERE nik=%s",
            (nik,)
        )
        karyawan = cursor.fetchone()
        if not karyawan:
            return jsonify({"error": f"Karyawan dengan NIK {nik} tidak ditemukan"}), 404

        id_karyawan, nama = karyawan

        # INSERT jadwal
        cursor.execute("""
            INSERT INTO jadwal_karyawan (id_karyawan, nama, tanggal, kode_shift)
            VALUES (%s, %s, %s, %s)
        """, (id_karyawan, nama, tanggal, kode_shift))

        # Ambil no terakhir (row yang baru diinsert)
        no_jadwal = cursor.lastrowid

        # ===============================
        # UPDATE WINDOW START & END
        # ===============================
        cursor.execute("""
            UPDATE jadwal_karyawan jk
            JOIN shift_info si ON jk.kode_shift = si.kode
            SET
                jk.shift_window_start =
                    CASE
                        WHEN jk.kode_shift = '3A'
                            THEN CONCAT(DATE_SUB(jk.tanggal, INTERVAL 1 DAY), ' 22:00:00')
                        WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO')
                            THEN NULL
                        WHEN si.lintas_hari = 1 AND si.jam_masuk > si.jam_pulang
                            THEN CONCAT(jk.tanggal, ' ', si.jam_masuk)
                        ELSE CONCAT(jk.tanggal, ' ', si.jam_masuk)
                    END,
                jk.shift_window_end =
                    CASE
                        WHEN jk.kode_shift = '3A'
                            THEN CONCAT(jk.tanggal, ' 11:00:00')
                        WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO')
                            THEN NULL
                        WHEN si.lintas_hari = 1 AND si.jam_masuk > si.jam_pulang
                            THEN CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', si.jam_pulang)
                        ELSE CONCAT(jk.tanggal, ' ', si.jam_pulang)
                    END
            WHERE jk.no = %s
        """, (no_jadwal,))

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({"message": "Data jadwal karyawan berhasil ditambahkan"}), 201

    except Exception as e:
        print("ERROR CREATE JADWAL KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/jadwal-dw/create", methods=["POST"])
def create_jadwal_dw():
    try:
        data = request.json
        nik = data.get("nik")
        kode_shift = data.get("kode_shift")
        tanggal = data.get("tanggal")

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id_karyawan, nama FROM karyawan WHERE nik=%s",
            (nik,)
        )
        karyawan = cursor.fetchone()
        if not karyawan:
            return jsonify({"error": f"Karyawan dengan NIK {nik} tidak ditemukan"}), 404

        id_karyawan, nama = karyawan

        # INSERT jadwal
        cursor.execute("""
            INSERT INTO jadwal_karyawan (id_karyawan, nama, tanggal, kode_shift)
            VALUES (%s, %s, %s, %s)
        """, (id_karyawan, nama, tanggal, kode_shift))

        # Ambil no terakhir (row yang baru diinsert)
        no_jadwal = cursor.lastrowid

        # ===============================
        # UPDATE WINDOW START & END
        # ===============================
        cursor.execute("""
            UPDATE jadwal_karyawan jk
            JOIN shift_info si ON jk.kode_shift = si.kode
            SET
                jk.shift_window_start =
                    CASE
                        WHEN jk.kode_shift = '3A'
                            THEN CONCAT(DATE_SUB(jk.tanggal, INTERVAL 1 DAY), ' 22:00:00')
                        WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO')
                            THEN NULL
                        WHEN si.lintas_hari = 1 AND si.jam_masuk > si.jam_pulang
                            THEN CONCAT(jk.tanggal, ' ', si.jam_masuk)
                        ELSE CONCAT(jk.tanggal, ' ', si.jam_masuk)
                    END,
                jk.shift_window_end =
                    CASE
                        WHEN jk.kode_shift = '3A'
                            THEN CONCAT(jk.tanggal, ' 11:00:00')
                        WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO')
                            THEN NULL
                        WHEN si.lintas_hari = 1 AND si.jam_masuk > si.jam_pulang
                            THEN CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', si.jam_pulang)
                        ELSE CONCAT(jk.tanggal, ' ', si.jam_pulang)
                    END
            WHERE jk.no = %s
        """, (no_jadwal,))

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({"message": "Data jadwal karyawan berhasil ditambahkan"}), 201

    except Exception as e:
        print("ERROR CREATE JADWAL KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/jadwal-karyawan/update/<int:no>", methods=["PUT"])
def update_jadwal_karyawan(no):
    try:
        data = request.get_json(force=True)

        nik = data.get("nik")
        kode_shift = data.get("kode_shift")
        tanggal = data.get("tanggal")

        # ===============================
        # AMBIL KATEGORI (JSON → DB fallback)
        # ===============================
        kategori = data.get("kategori")

        conn = get_db_connection()
        cursor = conn.cursor()

        if not kategori:
            cursor.execute("SELECT kategori FROM karyawan WHERE nik=%s", (nik,))
            res = cursor.fetchone()
            if res:
                kategori = res[0]

        kategori_norm = (kategori or "").upper().strip()

        # ===============================
        # CEK DATA JADWAL
        # ===============================
        cursor.execute("SELECT COUNT(*) FROM jadwal_karyawan WHERE no=%s", (no,))
        if cursor.fetchone()[0] == 0:
            return jsonify({"error": "Data jadwal tidak ditemukan"}), 404

        # ===============================
        # CEK DATA KARYAWAN
        # ===============================
        cursor.execute("""
            SELECT id_karyawan, nama
            FROM karyawan
            WHERE nik=%s
        """, (nik,))
        karyawan = cursor.fetchone()

        if not karyawan:
            return jsonify({"error": f"Karyawan dengan NIK {nik} tidak ditemukan"}), 404

        id_karyawan, nama = karyawan

        # ===============================
        # UPDATE jadwal utama
        # ===============================
        cursor.execute("""
            UPDATE jadwal_karyawan SET
                id_karyawan=%s,
                nama=%s,
                tanggal=%s,
                kode_shift=%s
            WHERE no=%s
        """, (id_karyawan, nama, tanggal, kode_shift, no))

        # ===============================
        # UPDATE WINDOW START & END
        # ===============================
        cursor.execute("""
            UPDATE jadwal_karyawan jk
            JOIN shift_info si ON jk.kode_shift = si.kode
            SET
                jk.shift_window_start =
                    CASE
                        WHEN jk.kode_shift = '3A'
                            THEN CONCAT(DATE_SUB(jk.tanggal, INTERVAL 1 DAY), ' 22:00:00')
                        WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO')
                            THEN NULL
                        WHEN si.lintas_hari = 1 AND si.jam_masuk > si.jam_pulang
                            THEN CONCAT(jk.tanggal, ' ', si.jam_masuk)
                        ELSE CONCAT(jk.tanggal, ' ', si.jam_masuk)
                    END,
                jk.shift_window_end =
                    CASE
                        WHEN jk.kode_shift = '3A'
                            THEN CONCAT(jk.tanggal, ' 11:00:00')
                        WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO')
                            THEN NULL
                        WHEN si.lintas_hari = 1 AND si.jam_masuk > si.jam_pulang
                            THEN CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', si.jam_pulang)
                        ELSE CONCAT(jk.tanggal, ' ', si.jam_pulang)
                    END
            WHERE jk.no = %s
        """, (no,))

        # ===============================
        # RESET DATA CROSCEK SESUAI KATEGORI
        # ===============================
        table_croscek = "croscek_dw" if kategori_norm == "DW" else "croscek"

        print(f"RESET TABLE: {table_croscek} | kategori={kategori_norm}")

        cursor.execute(f"TRUNCATE TABLE {table_croscek}")

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            "message": "Data jadwal karyawan berhasil diupdate",
            "kategori": kategori_norm,
            "table_reset": table_croscek
        })

    except Exception as e:
        print("ERROR UPDATE JADWAL KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

# -----------------------
# DELETE jadwal_karyawan
# -----------------------
@app.route("/api/jadwal-karyawan/delete/<int:no>", methods=["DELETE"])
def delete_jadwal_karyawan(no):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("DELETE FROM jadwal_karyawan WHERE no=%s", (no,))
        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({"message": "Data jadwal karyawan berhasil dihapus"})

    except Exception as e:
        print("ERROR DELETE JADWAL KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

# -----------------------
# CLEAR ALL jadwal_karyawan 
# -----------------------
@app.route("/api/jadwal-karyawan/clear", methods=["POST"])
def clear_jadwal_karyawan():
    print(">>> ROUTE CLEAR JADWAL DIPANGGIL <<<")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # cursor.execute("DELETE FROM jadwal_karyawan")
        cursor.execute("DELETE jk FROM jadwal_karyawan jk INNER JOIN karyawan k ON jk.id_karyawan = k.id_karyawan WHERE k.kategori = 'karyawan';")
        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({"message": "Semua jadwal berhasil dihapus", "status": "success"}), 200

    except Exception as e:
        print("ERROR CLEAR JADWAL KARYAWAN:", e)
        return jsonify({"error": str(e), "status": "failed"}), 500

# -----------------------
# CLEAR ALL jadwal_karyawan  DW
# -----------------------
@app.route("/api/jadwal-dw/clear", methods=["POST"])
def clear_jadwal_dw():
    print(">>> ROUTE CLEAR JADWAL DIPANGGIL <<<")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # cursor.execute("DELETE FROM jadwal_karyawan")
        cursor.execute("DELETE jk FROM jadwal_karyawan jk INNER JOIN karyawan k ON jk.id_karyawan = k.id_karyawan WHERE k.kategori = 'dw';")
        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({"message": "Semua jadwal berhasil dihapus", "status": "success"}), 200

    except Exception as e:
        print("ERROR CLEAR JADWAL KARYAWAN:", e)
        return jsonify({"error": str(e), "status": "failed"}), 500

@app.route("/api/import-jadwal-karyawan", methods=["POST"])
def import_jadwal():
    try:
        return _import_jadwal_logic()
    except Exception as e:
        import traceback
        print(f"💥 UNHANDLED ERROR:\n{traceback.format_exc()}")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

def _import_jadwal_logic():
    if "file" not in request.files:
        return jsonify({"error": "File tidak ditemukan"}), 400

    file = request.files["file"]

    # ─── Baca Excel ───────────────────────────────────────────────────────────
    try:
        df = pd.read_excel(file, header=None)
        print(f"📊 Total baris  : {len(df)}")
        print(f"📊 Total kolom  : {len(df.columns)}")
    except Exception as e:
        return jsonify({"error": f"Gagal membaca file Excel: {str(e)}"}), 500

    # ─── Ambil bulan dan tahun ────────────────────────────────────────────────
    try:
        raw_cell = df.iloc[1, 0]
        if isinstance(raw_cell, pd.Timestamp):
            year  = raw_cell.year
            month = raw_cell.month
            print(f"✓ Timestamp: {year}-{month}")
        else:
            month_year_str = str(raw_cell).strip()
            print(f"Raw cell: {repr(month_year_str)}")
            year, month = parse_month_year(month_year_str)
    except Exception as e:
        return jsonify({
            "error": f"Gagal parsing bulan/tahun: {str(e)}",
            "hint" : "Format: 'November 2025', '11/11/2025', '2025-11-01'"
        }), 400

    days_in_month = monthrange(year, month)[1]
    print(f"📅 {month}/{year} — {days_in_month} hari")

    data = df.iloc[5:, :]
    print(f"📋 Baris data karyawan: {len(data)}")

    conn = db()
    cur  = conn.cursor()

    # ─── Kode shift valid ─────────────────────────────────────────────────────
    cur.execute("SELECT kode, jam_masuk, jam_pulang FROM shift_info")
    shift_info       = {}
    valid_kode_shift = set()
    for row in cur.fetchall():
        kode = row[0].strip()
        shift_info[kode] = {"jam_masuk": row[1], "jam_pulang": row[2]}
        valid_kode_shift.add(kode)

    cur.execute("SELECT kode FROM informasi_jadwal")
    for row in cur.fetchall():
        valid_kode_shift.add(row[0].strip())

    print(f"✅ Kode shift valid: {valid_kode_shift}")

    # ─── Data karyawan dari DB ────────────────────────────────────────────────
    cur.execute("""
        SELECT id_karyawan, nik, nama
        FROM karyawan
        WHERE kategori = 'karyawan'
    """)
    karyawan_dict = {
        row[1]: {"id": row[0], "nama": row[2]}
        for row in cur.fetchall()
    }
    print(f"👥 Total karyawan DB: {len(karyawan_dict)}")

    # ─── Tahap 1: Scan Excel — kumpulkan NIK valid yang ada di file ───────────
    # Tujuan: hanya hapus jadwal karyawan yang memang ada di file upload,
    # karyawan lain yang tidak ada di file sama sekali tidak tersentuh.
    valid_nik_in_file = []   # list (nik, id_karyawan, nama)
    not_found_employees = []

    for idx, row in data.iterrows():
        nik_raw    = row[1]
        nik        = str(nik_raw).strip() if pd.notna(nik_raw) else ""
        nama_excel = str(row[2]).strip()  if pd.notna(row[2])  else ""

        if not nik:
            not_found_employees.append({
                "nik": nik, "nama": nama_excel, "error": "NIK kosong"
            })
            continue

        # Handle float NIK seperti "208970121.0"
        nik_variations = [nik]
        if nik.replace(".", "").isdigit():
            nik_variations.append(str(int(float(nik))))

        found = False
        for nik_var in nik_variations:
            if nik_var in karyawan_dict:
                nik   = nik_var
                found = True
                break

        if not found:
            not_found_employees.append({
                "nik": nik, "nama": nama_excel,
                "error": "Karyawan tidak ditemukan di database"
            })
            continue

        # Cek agar tidak duplikat dalam list (bisa ada baris kosong dsb)
        id_karyawan = karyawan_dict[nik]["id"]
        if not any(x[0] == nik for x in valid_nik_in_file):
            valid_nik_in_file.append((nik, id_karyawan, karyawan_dict[nik]["nama"]))

    print(f"📝 NIK valid di file: {len(valid_nik_in_file)}")

    if not valid_nik_in_file:
        cur.close()
        conn.close()
        return jsonify({
            "error"              : "Tidak ada karyawan valid di file upload",
            "not_found_employees": not_found_employees,
            "invalid_codes"      : []
        }), 400

    # ─── Tahap 2: DELETE jadwal HANYA untuk NIK yang ada di file ─────────────
    # Karyawan lain (tidak ada di file) = AMAN, tidak terhapus
    affected_ids = [x[1] for x in valid_nik_in_file]   # list id_karyawan
    id_placeholders = ", ".join(["%s"] * len(affected_ids))

    delete_query = """
        DELETE FROM jadwal_karyawan
        WHERE id_karyawan IN ({placeholders})
        AND YEAR(tanggal)  = %s
        AND MONTH(tanggal) = %s
    """.format(placeholders=id_placeholders)

    params_delete = affected_ids + [year, month]
    cur.execute(delete_query, params_delete)
    deleted_rows = cur.rowcount
    conn.commit()
    print(f"🗑️ Deleted {deleted_rows} jadwal lama (hanya {len(affected_ids)} karyawan di file)")

    # ─── Tahap 3: INSERT jadwal baru ──────────────────────────────────────────
    inserted_count = 0
    invalid_codes  = []
    batch_size     = 5000
    batch_counter  = 0

    # Buat mapping id_karyawan untuk lookup cepat
    nik_to_id   = {x[0]: x[1] for x in valid_nik_in_file}
    nik_to_nama = {x[0]: x[2] for x in valid_nik_in_file}

    for idx, row in data.iterrows():
        nik_raw = row[1]
        nik     = str(nik_raw).strip() if pd.notna(nik_raw) else ""

        if not nik:
            continue

        # Handle float NIK
        if nik.replace(".", "").isdigit():
            nik_int = str(int(float(nik)))
            if nik_int in nik_to_id:
                nik = nik_int

        if nik not in nik_to_id:
            continue   # sudah dicatat di not_found, skip

        id_karyawan = nik_to_id[nik]
        nama        = nik_to_nama[nik]

        for col_idx in range(3, 3 + days_in_month):
            if col_idx >= len(row):
                break

            raw_kode = row[col_idx]
            if pd.isna(raw_kode):
                continue

            kode_shift = str(raw_kode).strip()
            if not kode_shift:
                continue

            day = col_idx - 2   # col 3 → hari 1

            if kode_shift not in valid_kode_shift:
                invalid_codes.append({
                    "nik"       : nik,
                    "nama"      : nama,
                    "tanggal"   : f"{year}-{month:02d}-{day:02d}",
                    "kode_shift": kode_shift
                })
                continue

            tanggal = datetime(year, month, day).date()

            try:
                cur.execute("""
                    INSERT INTO jadwal_karyawan (id_karyawan, nama, tanggal, kode_shift)
                    VALUES (%s, %s, %s, %s)
                """, (id_karyawan, nama, tanggal, kode_shift))

                inserted_count += 1
                batch_counter  += 1

                if batch_counter >= batch_size:
                    conn.commit()
                    print(f"💾 Batch commit: {batch_counter} records")
                    batch_counter = 0

            except Exception as e:
                print(f"    ❌ Insert error [{nik} | {tanggal}]: {str(e)}")
                continue

    if batch_counter > 0:
        conn.commit()
        print(f"💾 Final commit: {batch_counter} records")

    # ─── Tahap 4: Update shift_window HANYA untuk karyawan di file ───────────
    print("⏳ Menghitung shift window...")

    shift_window_query = """
        UPDATE jadwal_karyawan jk
        JOIN shift_info si ON jk.kode_shift = si.kode
        SET
            jk.shift_window_start = CASE
                WHEN jk.kode_shift = '3A'
                    THEN CONCAT(DATE_SUB(jk.tanggal, INTERVAL 1 DAY), ' 22:00:00')
                WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO')
                    THEN NULL
                WHEN si.jam_masuk > si.jam_pulang
                    THEN CONCAT(jk.tanggal, ' ', si.jam_masuk)
                ELSE CONCAT(jk.tanggal, ' ', si.jam_masuk)
            END,
            jk.shift_window_end = CASE
                WHEN jk.kode_shift = '3A'
                    THEN CONCAT(jk.tanggal, ' 11:00:00')
                WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO')
                    THEN NULL
                WHEN si.jam_masuk > si.jam_pulang
                    THEN CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', si.jam_pulang)
                ELSE CONCAT(jk.tanggal, ' ', si.jam_pulang)
            END
        WHERE jk.id_karyawan IN ({placeholders})
        AND YEAR(jk.tanggal)  = %s
        AND MONTH(jk.tanggal) = %s
    """.format(placeholders=id_placeholders)

    params_sw = affected_ids + [year, month]

    try:
        cur.execute(shift_window_query, params_sw)
        conn.commit()
        print(f"✅ Shift window dihitung untuk {len(affected_ids)} karyawan")
    except Exception as e:
        print(f"❌ Error shift window: {str(e)}")

    # ─── Reset croscek ────────────────────────────────────────────────────────
    cur.execute("TRUNCATE TABLE croscek")
    conn.commit()

    cur.close()
    conn.close()

    print(f"\n✅ SUMMARY:")
    print(f"   👤 Karyawan di file    : {len(valid_nik_in_file)}")
    print(f"   🗑️  Jadwal dihapus     : {deleted_rows}")
    print(f"   🆕 Jadwal diinsert     : {inserted_count}")
    print(f"   ❌ Tidak ditemukan     : {len(not_found_employees)}")
    print(f"   ⚠️  Kode invalid       : {len(invalid_codes)}")

    return jsonify({
        "message"            : f"Import selesai! {inserted_count} jadwal untuk {len(valid_nik_in_file)} karyawan berhasil disimpan ({month}/{year}).",
        "period"             : f"{month}/{year}",
        "inserted_count"     : inserted_count,
        "affected_employees" : len(valid_nik_in_file),
        "deleted_count"      : deleted_rows,
        "not_found_employees": not_found_employees,
        "invalid_codes"      : invalid_codes
    })
    
## Import jadwal karyawan DW
@app.route("/api/import-jadwal-dw", methods=["POST"])
def import_jadwal_dw():
    if "file" not in request.files:
        return jsonify({"error": "File tidak ditemukan"}), 400
    
    file = request.files["file"]
    
    # Baca Excel
    try:
        df = pd.read_excel(file, header=None)
        print(f"📊 Total baris di Excel: {len(df)}")
        print(f"📊 Total kolom di Excel: {len(df.columns)}")
    except Exception as e:
        return jsonify({"error": f"Gagal membaca file Excel: {str(e)}"}), 500
    
    # Ambil bulan dan tahun
    try:
        raw_cell = df.iloc[1, 0]
        if isinstance(raw_cell, pd.Timestamp):
            year = raw_cell.year
            month = raw_cell.month
            print(f"✓ Detected pandas Timestamp: {year}-{month}")
        else:
            month_year_str = str(raw_cell).strip()
            print(f"Raw month_year_str: {repr(month_year_str)}")
            year, month = parse_month_year(month_year_str)
    except Exception as e:
        return jsonify({
            "error": f"Gagal parsing bulan/tahun: {str(e)}",
            "hint": "Format yang didukung: 'November 2025', '11/11/2025', '2025-11-01'"
        }), 400
    
    days_in_month = monthrange(year, month)[1]
    print(f"📅 Bulan: {month}, Tahun: {year}, Jumlah hari: {days_in_month}")
    
    data = df.iloc[5:, :]
    print(f"📋 Jumlah baris data karyawan: {len(data)}")
    
    conn = db()
    cur = conn.cursor()
    
    # Ambil semua kode valid dengan info shift dari shift_info
    cur.execute("""
        SELECT kode, jam_masuk, jam_pulang 
        FROM shift_info
    """)
    shift_info = {}
    valid_kode_shift = set()
    for row in cur.fetchall():
        kode = row[0].strip()
        shift_info[kode] = {
            "jam_masuk": row[1],
            "jam_pulang": row[2]
        }
        valid_kode_shift.add(kode)
    
    # Tambahkan kode dari informasi_jadwal yang mungkin belum ada di shift_info
    cur.execute("SELECT kode FROM informasi_jadwal")
    for row in cur.fetchall():
        valid_kode_shift.add(row[0].strip())
    
    print(f"✅ Kode shift valid: {valid_kode_shift}")
    
    # Ambil semua id_karyawan dari database
    cur.execute("SELECT id_karyawan, nik, nama, kategori FROM karyawan WHERE kategori = 'dw'")
    karyawan_rows = cur.fetchall()
    
    # ✅ PERBAIKAN UTAMA: Buat dictionary dengan NIK yang sudah dinormalisasi
    karyawan_dict = {}
    for row in karyawan_rows:
        nik_db = str(row[1]).strip()
        karyawan_dict[nik_db] = {"id": row[0], "nama": row[2]}
    
    print(f"👥 Total karyawan di database: {len(karyawan_dict)}")
    print(f"🔑 Sample NIK keys: {list(karyawan_dict.keys())[:5]}")
    
    # ✅✅✅ PERUBAHAN UTAMA: Kumpulkan dulu ID karyawan yang ada di Excel
    excel_karyawan_ids = []
    
    for idx, row in data.iterrows():
        nik_raw = row[1]
        
        # Normalisasi NIK dari Excel
        if pd.notna(nik_raw):
            nik_str = str(nik_raw).strip()
            if '.' in nik_str:
                try:
                    nik = str(int(float(nik_str)))
                except:
                    nik = nik_str.replace('.0', '')
            else:
                nik = nik_str
        else:
            continue  # Skip jika NIK kosong
        
        # Cek apakah karyawan ada di database
        if nik in karyawan_dict:
            id_karyawan = karyawan_dict[nik]["id"]
            excel_karyawan_ids.append(id_karyawan)
    
    # ✅✅✅ HAPUS HANYA JADWAL KARYAWAN YANG ADA DI EXCEL
    if excel_karyawan_ids:
        # Buat placeholder untuk IN clause
        placeholders = ','.join(['%s'] * len(excel_karyawan_ids))
        
        delete_query = f"""
            DELETE jk 
            FROM jadwal_karyawan jk
            INNER JOIN karyawan k ON jk.id_karyawan = k.id_karyawan
            WHERE k.kategori = %s 
            AND YEAR(jk.tanggal) = %s 
            AND MONTH(jk.tanggal) = %s
            AND jk.id_karyawan IN ({placeholders})
        """
        
        # Gabungkan parameter
        delete_params = ["dw", year, month] + excel_karyawan_ids
        
        cur.execute(delete_query, delete_params)
        deleted_rows = cur.rowcount
        conn.commit()
        print(f"🗑️ Deleted {deleted_rows} jadwal lama untuk {len(excel_karyawan_ids)} karyawan")
    else:
        deleted_rows = 0
        print(f"⚠️ Tidak ada karyawan yang valid di Excel untuk dihapus")
    
    inserted_count = 0
    invalid_codes = []
    not_found_employees = []
    batch_size = 5000
    batch_counter = 0
    
    for idx, row in data.iterrows():
        nik_raw = row[1]
        
        # ✅ PERBAIKAN KRUSIAL: Normalisasi NIK dari Excel
        if pd.notna(nik_raw):
            # Konversi ke string dulu
            nik_str = str(nik_raw).strip()
            
            # Jika berbentuk float (contoh: "423384.0"), ambil bagian integer
            if '.' in nik_str:
                try:
                    nik = str(int(float(nik_str)))
                except:
                    nik = nik_str.replace('.0', '')
            else:
                nik = nik_str
        else:
            nik = ""
        
        nama_excel = str(row[2]).strip() if pd.notna(row[2]) else ""
        
        # print(f"🔍 Processing NIK: '{nik}' | Nama: '{nama_excel}'")
        
        if nik:
            # Cek langsung di dictionary
            if nik in karyawan_dict:
                id_karyawan = karyawan_dict[nik]["id"]
                nama = karyawan_dict[nik]["nama"]
                print(f"  ✅ Found: ID={id_karyawan}, Nama={nama}")
            else:
                print(f"  ❌ Not found in database. Available keys: {list(karyawan_dict.keys())}")
                not_found_employees.append({
                    "nik": nik,
                    "nama": nama_excel,
                    "error": "Karyawan tidak ditemukan di database"
                })
                continue
        else:
            not_found_employees.append({
                "nik": "N/A",
                "nama": nama_excel,
                "error": "NIK kosong"
            })
            continue
        
        # Loop untuk setiap hari dalam bulan
        for col_idx in range(3, 3 + days_in_month):
            if col_idx >= len(row):
                break
            
            raw_kode = row[col_idx]
            if pd.isna(raw_kode):
                continue
            
            kode_shift = str(raw_kode).strip()
            if not kode_shift:
                continue
            
            day = col_idx - 2
            
            if kode_shift not in valid_kode_shift:
                invalid_codes.append({
                    "nik": nik,
                    "nama": nama,
                    "tanggal": f"{year}-{month:02d}-{day:02d}",
                    "kode_shift": kode_shift
                })
                continue
            
            tanggal = datetime(year, month, day).date()
            
            try:
                cur.execute("""
                    INSERT INTO jadwal_karyawan 
                    (id_karyawan, nama, tanggal, kode_shift) 
                    VALUES (%s, %s, %s, %s)
                """, (id_karyawan, nama, tanggal, kode_shift))
                
                inserted_count += 1
                batch_counter += 1
                
                if batch_counter >= batch_size:
                    conn.commit()
                    print(f"💾 Batch commit: {batch_counter} records")
                    batch_counter = 0
                    
            except Exception as e:
                print(f"❌ Insert error: {str(e)}")
                continue
    
    # Final commit untuk sisa data
    if batch_counter > 0:
        conn.commit()
        print(f"💾 Final commit: {batch_counter} records")
    
    # UPDATE shift_window menggunakan LOGIC EXACT dari query asli
    print("⏳ Menghitung shift window...")
    try:
        cur.execute("""
            UPDATE jadwal_karyawan jk
            JOIN shift_info si ON jk.kode_shift = si.kode
            SET jk.shift_window_start = CASE
                    WHEN jk.kode_shift = '3A' THEN CONCAT(
                        DATE_SUB(jk.tanggal, INTERVAL 1 DAY), 
                        ' 22:00:00'
                    )
                    
                    WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO') THEN NULL
                    
                    WHEN si.jam_masuk > si.jam_pulang THEN CONCAT(
                        jk.tanggal, 
                        ' ', 
                        si.jam_masuk
                    )
                    
                    ELSE CONCAT(jk.tanggal, ' ', si.jam_masuk)
                END,
                
                jk.shift_window_end = CASE
                    WHEN jk.kode_shift = '3A' THEN CONCAT(
                        jk.tanggal, 
                        ' 11:00:00'
                    )
                    
                    WHEN jk.kode_shift IN ('X','CT','CTB','CTT','OF1','EO') THEN NULL
                    
                    WHEN si.jam_masuk > si.jam_pulang THEN CONCAT(
                        DATE_ADD(jk.tanggal, INTERVAL 1 DAY), 
                        ' ', 
                        si.jam_pulang
                    )
                    
                    ELSE CONCAT(jk.tanggal, ' ', si.jam_pulang)
                END
            WHERE YEAR(jk.tanggal) = %s AND MONTH(jk.tanggal) = %s
        """, (year, month))
        conn.commit()
        print("✅ Shift window berhasil dihitung")
    except Exception as e:
        print(f"❌ Error updating shift window: {str(e)}")
    
    # Reset hasil croscek
    cur.execute("TRUNCATE TABLE croscek")
    conn.commit()
    
    cur.close()
    conn.close()
    
    print(f"\n✅ SUMMARY: {inserted_count} data berhasil disimpan")
    print(f"❌ Karyawan tidak ditemukan: {len(not_found_employees)}")
    print(f"⚠️ Kode shift invalid: {len(invalid_codes)}")
    
    return jsonify({
        "message": f"Import selesai! {inserted_count} data berhasil disimpan untuk {month}/{year}.",
        "period": f"{month}/{year}",
        "inserted_count": inserted_count,
        "not_found_employees": not_found_employees,
        "invalid_codes": invalid_codes
    })

# Kehadiran karyawan dari data mesin file excel upload
@app.route("/api/import-kehadiran", methods=["POST"])
def import_kehadiran():
    try:
        if "file" not in request.files:
            return jsonify({"error": "File tidak ditemukan"}), 400

        file = request.files["file"]
        df = pd.read_excel(file, header=1).fillna("")

        # buang baris header tambahan (jika ada)
        if len(df) > 0:
            df = df.iloc[1:]

        required = [
            "Tanggal scan", "Tanggal", "Jam", "Nama",
            "PIN", "NIP", "Jabatan", "Departemen", "Kantor",
            "Verifikasi", "I/O", "Workcode", "SN", "Mesin"
        ]

        for col in required:
            if col not in df.columns:
                return jsonify({"error": f"Kolom '{col}' tidak ditemukan di Excel"}), 400

        conn = db()
        cur = conn.cursor(dictionary=True)

        inserted_count = 0
        skipped_count = 0
        not_found_name = []   # SIMPAN NAMA / PIN YANG GAGAL MATCH

        for _, row in df.iterrows():

            # ===============================
            # VALIDASI TANGGAL & JAM
            # ===============================
            if str(row["Tanggal scan"]).strip() == "" or str(row["Tanggal"]).strip() == "":
                skipped_count += 1
                continue

            try:
                tanggal_scan = pd.to_datetime(row["Tanggal scan"], dayfirst=True)
                tanggal_only = pd.to_datetime(row["Tanggal"], dayfirst=True).date()
                jam_only = pd.to_datetime(row["Jam"], dayfirst=True).time()
            except:
                skipped_count += 1
                continue

            verifikasi = int(row["Verifikasi"]) if row["Verifikasi"] != "" else None
            io = int(row["I/O"]) if row["I/O"] != "" else None

            # =====================================================
            # MATCH KARYAWAN
            # PRIORITAS: PIN / ID_ABSEN
            # FALLBACK : NAMA
            # =====================================================
            data_k = None

            pin = str(row["PIN"]).strip()
            nama = str(row["Nama"]).strip()

            if pin != "":
                cur.execute("""
                    SELECT id_karyawan 
                    FROM karyawan 
                    WHERE id_absen = %s 
                    LIMIT 1
                """, (pin,))
                data_k = cur.fetchone()

            if not data_k and nama != "":
                cur.execute("""
                    SELECT id_karyawan 
                    FROM karyawan 
                    WHERE nama = %s 
                    LIMIT 1
                """, (nama,))
                data_k = cur.fetchone()

            if not data_k:
                not_found_name.append(nama if nama != "" else f"PIN:{pin}")
                skipped_count += 1
                continue

            id_karyawan = data_k["id_karyawan"]

            # =====================================================
            # MATCH SHIFT DARI JADWAL KARYAWAN
            # =====================================================
            cur.execute("""
                SELECT kode_shift
                FROM jadwal_karyawan
                WHERE id_karyawan = %s AND tanggal = %s
                LIMIT 1
            """, (id_karyawan, tanggal_only))

            result = cur.fetchone()
            kode_shift = result["kode_shift"] if result else None
            
            # =====================================================
            # CEK DUPLIKAT: id_karyawan + tanggal + jam
            # =====================================================
            cur.execute("""
                SELECT id_karyawan FROM kehadiran_karyawan
                WHERE id_karyawan = %s AND tanggal = %s AND jam = %s
                LIMIT 1
            """, (id_karyawan, tanggal_only, jam_only))

            if cur.fetchone():
                skipped_count += 1
                continue

            # =====================================================
            # INSERT DATA KEHADIRAN
            # =====================================================
            cur.execute("""
                INSERT INTO kehadiran_karyawan (
                    id_karyawan, tanggal_scan, tanggal, jam,
                    pin, nip, nama, jabatan, departemen, kantor,
                    verifikasi, io, workcode, sn, mesin, kode
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                id_karyawan,
                tanggal_scan,
                tanggal_only,
                jam_only,
                row["PIN"],
                row["NIP"],
                row["Nama"],
                row["Jabatan"],
                row["Departemen"],
                row["Kantor"],
                verifikasi,
                io,
                row["Workcode"],
                row["SN"],
                row["Mesin"],
                kode_shift
            ))

            inserted_count += 1

        conn.commit()
        cur.close()
        conn.close()

        message = f"{inserted_count} data berhasil disimpan, {skipped_count} dilewati."

        if len(not_found_name) > 0:
            message += f" ❗ Ada data yang tidak ditemukan: {set(not_found_name)}"

        return jsonify({"message": message})

    except Exception as e:
        print("IMPORT ERROR:", e)
        return jsonify({"error": str(e)}), 500

# =================== AVAILABLE PERIODS (KARYAWAN) ===================
@app.route("/api/kehadiran-karyawan/available-periods", methods=["GET"])
def get_available_periods_karyawan():
    try:
        conn = db()
        cur = conn.cursor(dictionary=True)

        query = """
            SELECT DISTINCT
                MONTH(kk.tanggal) AS bulan,
                YEAR(kk.tanggal) AS tahun
            FROM kehadiran_karyawan kk
            INNER JOIN karyawan k
                ON kk.id_karyawan = k.id_karyawan
            WHERE k.kategori = 'karyawan'
            ORDER BY tahun DESC, bulan DESC
        """

        cur.execute(query)
        rows = cur.fetchall()

        cur.close()
        conn.close()

        periods = [
            {"bulan": row["bulan"], "tahun": row["tahun"]}
            for row in rows
        ]

        return jsonify({
            "kategori": "karyawan",
            "total_periods": len(periods),
            "periods": periods
        }), 200

    except Exception as e:
        print("ERROR GET AVAILABLE PERIODS KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500
    
# =================== AVAILABLE PERIODS (Daily Worker) ===================
@app.route("/api/kehadiran-dw/available-periods", methods=["GET"])
def get_available_periods_dw():
    try:
        conn = db()
        cur = conn.cursor(dictionary=True)

        query = """
            SELECT DISTINCT
                MONTH(kk.tanggal) AS bulan,
                YEAR(kk.tanggal) AS tahun
            FROM kehadiran_karyawan kk
            INNER JOIN karyawan k
                ON kk.id_karyawan = k.id_karyawan
            WHERE k.kategori = 'dw'
            ORDER BY tahun DESC, bulan DESC
        """

        cur.execute(query)
        rows = cur.fetchall()

        cur.close()
        conn.close()

        periods = [
            {"bulan": row["bulan"], "tahun": row["tahun"]}
            for row in rows
        ]

        return jsonify({
            "kategori": "karyawan",
            "total_periods": len(periods),
            "periods": periods
        }), 200

    except Exception as e:
        print("ERROR GET AVAILABLE PERIODS KARYAWAN:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/kehadiran-dw/delete-period", methods=["DELETE"])
def delete_kehadiran_period_dw():
    try:
        data = request.get_json()
        bulan = data.get("bulan")
        tahun = data.get("tahun")

        if not bulan or not tahun:
            return jsonify({"error": "Bulan dan tahun diperlukan"}), 400

        conn = db()
        cur = conn.cursor()

        # =========================
        # DELETE KEHADIRAN KARYAWAN
        # =========================
        cur.execute("""
            DELETE kk
            FROM kehadiran_karyawan kk
            INNER JOIN karyawan k
                ON kk.id_karyawan = k.id_karyawan
            WHERE k.kategori = 'dw'
              AND MONTH(kk.tanggal) = %s
              AND YEAR(kk.tanggal) = %s
        """, (bulan, tahun))

        deleted_kehadiran = cur.rowcount

        # =========================
        # RESET CROSCEK (FULL REBUILD)
        # =========================
        cur.execute("TRUNCATE TABLE croscek_dw")

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({
            "message": f"Berhasil hapus kehadiran Daily Worker periode {bulan}/{tahun}",
            "kategori": "dw",
            "kehadiran_deleted": deleted_kehadiran,
            "croscek_deleted": "FULL RESET"
        }), 200

    except Exception as e:
        print("ERROR DELETE PERIOD:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/kehadiran-karyawan/delete-period", methods=["DELETE"])
def delete_kehadiran_period_karyawan():
    try:
        data = request.get_json()
        bulan = data.get("bulan")
        tahun = data.get("tahun")

        if not bulan or not tahun:
            return jsonify({"error": "Bulan dan tahun diperlukan"}), 400

        conn = db()
        cur = conn.cursor()

        # =========================
        # DELETE KEHADIRAN KARYAWAN
        # =========================
        cur.execute("""
            DELETE kk
            FROM kehadiran_karyawan kk
            INNER JOIN karyawan k
                ON kk.id_karyawan = k.id_karyawan
            WHERE k.kategori = 'karyawan'
              AND MONTH(kk.tanggal) = %s
              AND YEAR(kk.tanggal) = %s
        """, (bulan, tahun))

        deleted_kehadiran = cur.rowcount

        # =========================
        # RESET CROSCEK (FULL REBUILD)
        # =========================
        cur.execute("TRUNCATE TABLE croscek")

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({
            "message": f"Berhasil hapus kehadiran KARYAWAN periode {bulan}/{tahun}",
            "kategori": "karyawan",
            "kehadiran_deleted": deleted_kehadiran,
            "croscek_deleted": "FULL RESET"
        }), 200

    except Exception as e:
        print("ERROR DELETE PERIOD:", e)
        return jsonify({"error": str(e)}), 500

# ===========================================================
# CROSCEK (QUERY LENGKAP SESUAI PERMINTAAN) - OPTIMIZED
# ===========================================================
@app.route("/api/croscek-karyawan", methods=["GET", "POST"])
def proses_croscek():
    conn = db()
    cur = conn.cursor(dictionary=True)
    if request.method == "GET":
        try:
            # 🔥 OPTIMIZATION 1: Check if data already exists
            cur.execute("SELECT COUNT(*) as count FROM croscek")
            existing_count = cur.fetchone()["count"]
            
            if existing_count > 0:
                # Data sudah ada, ambil langsung dari tabel croscek (jauh lebih cepat)
                cur.execute("""
                    SELECT
                        Nama,
                        Tanggal,
                        Kode_Shift,
                        Jabatan,
                        Departemen,
                        id_karyawan,
                        NIK,
                        Jadwal_Masuk,
                        Jadwal_Pulang,
                        Actual_Masuk,
                        Actual_Pulang,
                        Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang,
                        Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis,
                        Status_Kehadiran,
                        Status_Masuk,
                        Status_Pulang
                    FROM croscek
                    ORDER BY Nama, Tanggal
                """)
                
                result_rows = cur.fetchall()
                
                # Convert TIME/DATE fields to strings for JSON serialization
                for row in result_rows:
                    if row['Jadwal_Masuk'] is not None:
                        row['Jadwal_Masuk'] = str(row['Jadwal_Masuk'])
                    if row['Jadwal_Pulang'] is not None:
                        row['Jadwal_Pulang'] = str(row['Jadwal_Pulang'])
                    if row['Actual_Masuk'] is not None:
                        row['Actual_Masuk'] = str(row['Actual_Masuk'])
                    if row['Actual_Pulang'] is not None:
                        row['Actual_Pulang'] = str(row['Actual_Pulang'])
                    if isinstance(row['Tanggal'], date):
                        row['Tanggal'] = str(row['Tanggal'])
                
                cur.close()
                conn.close()
                
                return jsonify({
                    "data": result_rows,
                    "summary": {
                        "total": len(result_rows),
                        "inserted": 0,
                        "skipped": 0,
                        "from_cache": True
                    }
                })
            
            # Data belum ada, proses dengan query lengkap
            query = """
                        /* ===============================================
                        🚀 OPTIMIZED QUERY - DURATION-BASED STATUS
                        ✅ UPDATED: Match by id_absen (PIN) instead of nama
                        =============================================== */

                        WITH 
                        used_scan_pulang_malam AS (
                        -- Part 1: Shift lintas hari normal (non-ACCOUNTING/SALES)
                        -- ✅ PERBAIKAN: Join dengan PIN (id_absen) bukan nama
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
                            ON kk.pin = k.id_absen  -- ✅ MATCH by PIN (id_absen)
                        WHERE
                            k.dept NOT IN ('ACCOUNTING', 'SALES & MARKETING')
                            AND ij.jam_pulang < ij.jam_masuk
                            AND DATE(kk.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                            AND kk.tanggal_scan BETWEEN
                                CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang) - INTERVAL 4 HOUR
                                AND CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang) + INTERVAL 6 HOUR
                        
                        UNION
                        
                        -- Part 2: ACCOUNTING & SALES - Shift lintas hari (2A jam 16:00-00:00)
                        -- ✅ PERBAIKAN: Join dengan PIN (id_absen) bukan nama
                        SELECT DISTINCT
                            kk.pin,
                            kk.tanggal_scan
                        FROM jadwal_karyawan jk
                        JOIN karyawan k
                            ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'karyawan'
                        JOIN informasi_jadwal ij
                            ON ij.kode = jk.kode_shift
                        JOIN kehadiran_karyawan kk
                            ON kk.pin = k.id_absen  -- ✅ MATCH by PIN (id_absen)
                        WHERE
                            k.dept IN ('ACCOUNTING', 'SALES & MARKETING')
                            AND ij.jam_pulang < ij.jam_masuk  -- Shift lintas hari seperti 2A
                            AND DATE(kk.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                            AND kk.tanggal_scan BETWEEN
                                CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang) - INTERVAL 4 HOUR
                                AND CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang) + INTERVAL 6 HOUR
                        
                        UNION
                        
                        -- Part 3: ACCOUNTING & SALES - Shift NORMAL tapi pulang LEWAT TENGAH MALAM
                        -- ✅ PERBAIKAN: Join dengan PIN (id_absen) bukan nama
                        SELECT DISTINCT
                            kk.pin,
                            kk.tanggal_scan
                        FROM jadwal_karyawan jk
                        JOIN karyawan k
                            ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'karyawan'
                        JOIN informasi_jadwal ij
                            ON ij.kode = jk.kode_shift
                        JOIN kehadiran_karyawan kk
                            ON kk.pin = k.id_absen  -- ✅ MATCH by PIN (id_absen)
                        WHERE
                            k.dept IN ('ACCOUNTING', 'SALES & MARKETING')
                            AND ij.jam_pulang >= ij.jam_masuk
                            AND DATE(kk.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                            AND TIME(kk.tanggal_scan) BETWEEN '00:00:00' AND '05:59:59'
                            
                            AND TIMESTAMPDIFF(
                                HOUR,
                                CONCAT(jk.tanggal, ' ', ij.jam_pulang),
                                kk.tanggal_scan
                            ) BETWEEN -4 AND 6
                            
                            AND EXISTS (
                                SELECT 1
                                FROM kehadiran_karyawan kk_in
                                WHERE kk_in.pin = k.id_absen  -- ✅ MATCH by PIN
                                AND DATE(kk_in.tanggal_scan) = jk.tanggal
                                AND kk_in.tanggal_scan BETWEEN
                                    CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                    AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                            )
                            
                            AND NOT EXISTS (
                                SELECT 1
                                FROM jadwal_karyawan jk_next
                                JOIN informasi_jadwal ij_next ON ij_next.kode = jk_next.kode_shift
                                WHERE jk_next.id_karyawan = jk.id_karyawan
                                AND jk_next.tanggal = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                AND jk_next.kode_shift NOT IN ('CT','CTT','EO','OF1','CTB','X')

                                -- 🔧 hanya block jika benar-benar dekat jam masuk shift berikutnya
                                AND ABS(
                                    TIMESTAMPDIFF(
                                        MINUTE,
                                        kk.tanggal_scan,
                                        CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij_next.jam_masuk)
                                    )
                                ) <= 60
                            )

                    ),

                        /* CTE 1: Scan Data per Karyawan per Tanggal */
                        -- ✅ PERBAIKAN: Ubah struktur untuk support PIN matching
                        scan_data AS (
                            SELECT
                                k.id_absen AS pin,
                                k.id_karyawan,
                                k.nama,
                                DATE(kk.tanggal_scan) AS tanggal,
                                MIN(kk.tanggal_scan) AS scan_masuk,
                                MAX(kk.tanggal_scan) AS scan_pulang
                            FROM kehadiran_karyawan kk
                            JOIN karyawan k ON k.id_absen = kk.pin AND k.kategori = 'karyawan'
                            LEFT JOIN used_scan_pulang_malam u 
                                ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
                            WHERE u.tanggal_scan IS NULL
                            GROUP BY k.id_absen, k.id_karyawan, k.nama, DATE(kk.tanggal_scan)
                        ),

                        /* CTE 2: Historical Frequency per Shift */
                        historical_freq AS (
                            SELECT 
                                jk.id_karyawan,
                                jk.kode_shift,
                                COUNT(*) AS freq_count
                            FROM jadwal_karyawan jk
                            JOIN karyawan k
                                ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'karyawan'
                            WHERE jk.tanggal >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                            GROUP BY jk.id_karyawan, jk.kode_shift
                        ),

                        /* CTE 3: Base Data dengan Actual Masuk/Pulang + DURATION VALIDATION */
                        -- ✅ PERBAIKAN: Join dengan PIN (id_absen) bukan nama
                        base_data AS (
                            SELECT
                                jk.nama AS Nama,
                                jk.tanggal AS Tanggal,
                                jk.kode_shift AS Kode_Shift,
                                k.jabatan AS Jabatan,
                                k.dept AS Departemen,
                                k.id_karyawan,
                                k.nik AS NIK,
                                k.id_absen,
                                ij.jam_masuk,
                                ij.jam_pulang,
                                
                                CASE
                                    WHEN ij.jam_pulang < ij.jam_masuk THEN
                                        TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ADDTIME(ij.jam_pulang, '24:00:00'))
                                    ELSE
                                        TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang)
                                END AS expected_duration_minutes,
                                
                                /* ===== ACTUAL MASUK - FIXED UNTUK 3A ===== */
                                CASE
                                    WHEN jk.kode_shift IN ('CT','CTT','EO','OF1','CTB','X') THEN NULL
                                    
                                    WHEN jk.kode_shift = '3A' THEN (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND (
                                            (
                                                # DATE(kk.tanggal_scan) = jk.tanggal
                                                # AND TIME(kk.tanggal_scan) >= '22:00:00'
                                                kk.tanggal_scan >= jk.tanggal
                                                AND kk.tanggal_scan < DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                AND TIME(kk.tanggal_scan) >= '22:00:00'
                                            )
                                            OR
                                            (
                                                DATE(kk.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                AND TIME(kk.tanggal_scan) <= '03:00:00'
                                            )
                                        )
                                    )
                                    
                                    WHEN ij.jam_pulang < ij.jam_masuk THEN (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        LEFT JOIN used_scan_pulang_malam u
                                            ON u.pin = kk.pin
                                            AND u.tanggal_scan = kk.tanggal_scan
                                        WHERE kk.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND u.tanggal_scan IS NULL
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                            AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                    )
                                    ELSE (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        LEFT JOIN used_scan_pulang_malam u
                                            ON u.pin = kk.pin
                                            AND u.tanggal_scan = kk.tanggal_scan
                                        WHERE kk.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND u.tanggal_scan IS NULL
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                            AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                        -- 🔥 FILTER TAMBAHAN (ANTI NYERET)
                                        AND ABS(
                                            TIMESTAMPDIFF(
                                                MINUTE,
                                                kk.tanggal_scan,
                                                CONCAT(jk.tanggal, ' ', ij.jam_masuk)
                                            )
                                        ) <= 240
                                        AND NOT EXISTS (
                                            SELECT 1
                                            FROM jadwal_karyawan jk_prev
                                            JOIN informasi_jadwal ij_prev ON ij_prev.kode = jk_prev.kode_shift
                                            WHERE jk_prev.id_karyawan = jk.id_karyawan
                                            AND jk_prev.tanggal = DATE_SUB(jk.tanggal, INTERVAL 1 DAY)
                                            AND jk_prev.kode_shift NOT IN ('CT','CTT','EO','OF1','CTB','X')
                                            AND ij_prev.jam_pulang < ij_prev.jam_masuk
                                            AND kk.tanggal_scan BETWEEN
                                                CONCAT(jk.tanggal, ' ', ij_prev.jam_pulang) - INTERVAL 2 HOUR
                                                AND CONCAT(jk.tanggal, ' ', ij_prev.jam_pulang) + INTERVAL 2 HOUR
                                        )
                                    )
                                END AS Actual_Masuk,
                                
                                /* ===== ACTUAL PULANG - FIXED DENGAN DURATION VALIDATION ===== */
                                CASE
                                    WHEN jk.kode_shift IN ('CT','CTT','EO','OF1','CTB','X') THEN NULL
                                    WHEN jk.kode_shift = '3A' THEN (
                                        COALESCE(
                                            /* LOGIC UTAMA (TIDAK DIUBAH) */
                                            (
                                                SELECT kk_out.tanggal_scan
                                                FROM kehadiran_karyawan kk_out
                                                WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                                AND DATE(kk_out.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                AND kk_out.tanggal_scan BETWEEN
                                                    CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang)
                                                    AND CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang) + INTERVAL 75 MINUTE
                                                AND kk_out.tanggal_scan != COALESCE((
                                                    SELECT MIN(kk_in.tanggal_scan)
                                                    FROM kehadiran_karyawan kk_in
                                                    WHERE kk_in.pin = k.id_absen
                                                    AND (
                                                        (DATE(kk_in.tanggal_scan) = jk.tanggal
                                                        AND TIME(kk_in.tanggal_scan) >= '22:00:00')
                                                        OR
                                                        (DATE(kk_in.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                        AND TIME(kk_in.tanggal_scan) <= '03:00:00')
                                                    )
                                                ), '1900-01-01')
                                                AND TIMESTAMPDIFF(MINUTE, 
                                                    COALESCE((
                                                        SELECT MIN(kk_in.tanggal_scan)
                                                        FROM kehadiran_karyawan kk_in
                                                        WHERE kk_in.pin = k.id_absen
                                                        AND (
                                                            (DATE(kk_in.tanggal_scan) = jk.tanggal
                                                            AND TIME(kk_in.tanggal_scan) >= '22:00:00')
                                                            OR
                                                            (DATE(kk_in.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                            AND TIME(kk_in.tanggal_scan) <= '03:00:00')
                                                        )
                                                    ), kk_out.tanggal_scan),
                                                    kk_out.tanggal_scan
                                                ) >= (
                                                    CASE
                                                        WHEN ij.jam_pulang < ij.jam_masuk THEN
                                                            TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ADDTIME(ij.jam_pulang, '24:00:00'))
                                                        ELSE
                                                            TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang)
                                                    END * 0.5
                                                )
                                                ORDER BY kk_out.tanggal_scan DESC
                                                LIMIT 1
                                            ),
                                            
                                            -- ✅ TAMBAHAN BARU: Khusus kasus masuk jam 00:00 di tanggal itu sendiri
                                            -- (bukan dari malam sebelumnya), sehingga pulang pun di hari yang sama
                                            (
                                                SELECT kk_out.tanggal_scan
                                                FROM kehadiran_karyawan kk_out
                                                WHERE kk_out.pin = k.id_absen
                                                AND DATE(kk_out.tanggal_scan) = jk.tanggal
                                                AND kk_out.tanggal_scan BETWEEN
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang) - INTERVAL 75 MINUTE
                                                    AND CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 75 MINUTE
                                                AND kk_out.tanggal_scan != COALESCE((
                                                    SELECT MIN(tanggal_scan)
                                                    FROM kehadiran_karyawan
                                                    WHERE pin = k.id_absen
                                                    AND DATE(tanggal_scan) = jk.tanggal
                                                    AND TIME(tanggal_scan) <= '03:00:00'
                                                ), '1900-01-01')
                                                ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk_out.tanggal_scan,
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang)))
                                                LIMIT 1
                                            ),

                                            /* 🔧 FALLBACK KHUSUS 3A (BARU) */
                                            (
                                                SELECT MAX(kk_out.tanggal_scan)
                                                FROM kehadiran_karyawan kk_out
                                                WHERE kk_out.pin = k.id_absen
                                                AND DATE(kk_out.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                AND TIME(kk_out.tanggal_scan) BETWEEN '05:00:00' AND '12:00:00'
                                            )
                                        )
                                    )

                                    
                                    WHEN k.dept IN ('ACCOUNTING', 'SALES & MARKETING') THEN (
                                        CASE
                                            WHEN ij.jam_pulang < ij.jam_masuk THEN (
                                                SELECT kk_out.tanggal_scan
                                                FROM kehadiran_karyawan kk_out
                                                WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                                AND kk_out.tanggal_scan BETWEEN 
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY - INTERVAL 4 HOUR
                                                    AND CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY + INTERVAL 12 HOUR
                                                AND kk_out.tanggal_scan != COALESCE((
                                                    SELECT MIN(tanggal_scan) FROM kehadiran_karyawan 
                                                    WHERE pin = k.id_absen
                                                    AND tanggal_scan BETWEEN CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                        AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                ), '1900-01-01')
                                                AND (
                                                    (
                                                        SELECT MIN(kk_in.tanggal_scan)
                                                        FROM kehadiran_karyawan kk_in
                                                        WHERE kk_in.pin = k.id_absen
                                                        AND kk_in.tanggal_scan BETWEEN
                                                            CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                            AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                    ) IS NULL
                                                    OR TIMESTAMPDIFF(
                                                        MINUTE,
                                                        (
                                                            SELECT MIN(kk_in.tanggal_scan)
                                                            FROM kehadiran_karyawan kk_in
                                                            WHERE kk_in.pin = k.id_absen
                                                            AND kk_in.tanggal_scan BETWEEN
                                                                CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                        ),
                                                        kk_out.tanggal_scan
                                                        ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ADDTIME(ij.jam_pulang,'24:00:00')) * 0.5)
                                                )
                                                ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk_out.tanggal_scan, 
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY))
                                                LIMIT 1
                                            )
                                            ELSE (
                                                SELECT kk_out.tanggal_scan
                                                FROM kehadiran_karyawan kk_out
                                                WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                                AND kk_out.tanggal_scan BETWEEN 
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang) - INTERVAL 4 HOUR
                                                    AND CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 12 HOUR
                                                AND kk_out.tanggal_scan != COALESCE((
                                                    SELECT MIN(tanggal_scan) FROM kehadiran_karyawan 
                                                    WHERE pin = k.id_absen
                                                    AND tanggal_scan BETWEEN CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                        AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                ), '1900-01-01')
                                                
                                                AND (
                                                    (
                                                        SELECT MIN(kk_in.tanggal_scan)
                                                        FROM kehadiran_karyawan kk_in
                                                        WHERE kk_in.pin = k.id_absen
                                                        AND kk_in.tanggal_scan BETWEEN
                                                            CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                            AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                    ) IS NULL
                                                    OR TIMESTAMPDIFF(
                                                        MINUTE,
                                                        (
                                                            SELECT MIN(kk_in.tanggal_scan)
                                                            FROM kehadiran_karyawan kk_in
                                                            WHERE kk_in.pin = k.id_absen
                                                            AND kk_in.tanggal_scan BETWEEN
                                                                CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                        ),
                                                        kk_out.tanggal_scan
                                                    ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang) * 0.5)
                                                )
                                                
                                                AND (
                                                    -- PRIORITAS 1: Durasi sangat valid → override conflict
                                                    TIMESTAMPDIFF(
                                                        MINUTE,
                                                        (
                                                            SELECT MIN(kk_in.tanggal_scan)
                                                            FROM kehadiran_karyawan kk_in
                                                            WHERE kk_in.pin = k.id_absen
                                                            AND kk_in.tanggal_scan BETWEEN
                                                                CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                        ),
                                                        kk_out.tanggal_scan
                                                    ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang) * 0.8)

                                                    OR

                                                    -- PRIORITAS 2: Jika durasi biasa saja, tetap cek conflict
                                                    NOT EXISTS (
                                                        SELECT 1
                                                        FROM jadwal_karyawan jk_next
                                                        JOIN informasi_jadwal ij_next 
                                                            ON ij_next.kode = jk_next.kode_shift
                                                        WHERE jk_next.id_karyawan = jk.id_karyawan
                                                        AND jk_next.tanggal = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                        AND jk_next.kode_shift NOT IN ('CT','CTT','EO','OF1','CTB','X')
                                                        AND ABS(
                                                            TIMESTAMPDIFF(
                                                                MINUTE,
                                                                kk_out.tanggal_scan,
                                                                CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij_next.jam_masuk)
                                                            )
                                                        ) <= 60
                                                    )
                                                )

                                                ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk_out.tanggal_scan, 
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang)))
                                                LIMIT 1
                                            )
                                        END
                                    )
                                    
                                    WHEN ij.jam_pulang < ij.jam_masuk THEN (
                                        SELECT kk_out.tanggal_scan
                                        FROM kehadiran_karyawan kk_out
                                        WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND kk_out.tanggal_scan BETWEEN 
                                            CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY - INTERVAL 4 HOUR
                                            AND CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY + INTERVAL 6 HOUR
                                        AND kk_out.tanggal_scan != COALESCE((
                                            SELECT MIN(tanggal_scan) FROM kehadiran_karyawan 
                                            WHERE pin = k.id_absen
                                            AND tanggal_scan BETWEEN CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                        ), '1900-01-01')
                                        AND (
                                            (
                                                SELECT MIN(kk_in.tanggal_scan)
                                                FROM kehadiran_karyawan kk_in
                                                WHERE kk_in.pin = k.id_absen
                                                AND kk_in.tanggal_scan BETWEEN
                                                    CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                    AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                            ) IS NULL
                                            OR TIMESTAMPDIFF(
                                                MINUTE,
                                                (
                                                    SELECT MIN(kk_in.tanggal_scan)
                                                    FROM kehadiran_karyawan kk_in
                                                    WHERE kk_in.pin = k.id_absen
                                                    AND kk_in.tanggal_scan BETWEEN
                                                        CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                        AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                ),
                                                kk_out.tanggal_scan
                                            ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ADDTIME(ij.jam_pulang,'24:00:00')) * 0.5)
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk_out.tanggal_scan, 
                                            CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY))
                                        LIMIT 1
                                    )
                                    ELSE (
                                        SELECT kk_out.tanggal_scan
                                        FROM kehadiran_karyawan kk_out
                                        WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND kk_out.tanggal_scan BETWEEN 
                                            CONCAT(jk.tanggal, ' ', ij.jam_pulang) - INTERVAL 4 HOUR
                                            AND CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 7 HOUR
                                        AND kk_out.tanggal_scan != COALESCE((
                                            SELECT MIN(tanggal_scan) FROM kehadiran_karyawan 
                                            WHERE pin = k.id_absen
                                            AND tanggal_scan BETWEEN CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                        ), '1900-01-01')
                                        AND (
                                            (
                                                SELECT MIN(kk_in.tanggal_scan)
                                                FROM kehadiran_karyawan kk_in
                                                WHERE kk_in.pin = k.id_absen
                                                AND kk_in.tanggal_scan BETWEEN
                                                    CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                    AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                            ) IS NULL
                                            OR TIMESTAMPDIFF(
                                                MINUTE,
                                                (
                                                    SELECT MIN(kk_in.tanggal_scan)
                                                    FROM kehadiran_karyawan kk_in
                                                    WHERE kk_in.pin = k.id_absen
                                                    AND kk_in.tanggal_scan BETWEEN
                                                        CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                        AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                ),
                                                kk_out.tanggal_scan
                                            ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang) * 0.5)
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk_out.tanggal_scan, 
                                            CONCAT(jk.tanggal, ' ', ij.jam_pulang)))
                                        LIMIT 1
                                    )
                                END AS Actual_Pulang
                                
                            # FROM jadwal_karyawan jk
                            # LEFT JOIN karyawan k ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'karyawan'
                            FROM jadwal_karyawan jk
                            JOIN karyawan k
                                ON k.id_karyawan = jk.id_karyawan
                            AND k.kategori = 'karyawan'
                            LEFT JOIN informasi_jadwal ij ON ij.kode = jk.kode_shift
                        ),

                        /* CTE 4: Add Actual Duration Calculation */
                        base_with_duration AS (
                            SELECT
                                base.*,
                                CASE
                                    WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL
                                    THEN TIMESTAMPDIFF(MINUTE, base.Actual_Masuk, base.Actual_Pulang)
                                    ELSE NULL
                                END AS actual_duration_minutes
                            FROM base_data base
                        ),

                        /* CTE 5: Prediksi Shift */
                        -- ✅ PERBAIKAN: Update untuk mendukung PIN matching
                        prediction_data AS (
                            SELECT
                                s.id_karyawan,
                                s.pin,
                                s.nama,
                                s.tanggal,
                                ij2.kode AS kode_shift,
                                
                                CASE
                                    WHEN ij2.kode = '3A' THEN (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = s.pin
                                        AND (
                                            (
                                                DATE(kk.tanggal_scan) = s.tanggal
                                                AND TIME(kk.tanggal_scan) >= '20:00:00'
                                            )
                                            OR (
                                                DATE(kk.tanggal_scan) = DATE_ADD(s.tanggal, INTERVAL 1 DAY)
                                                AND TIME(kk.tanggal_scan) <= '05:00:00'
                                            )
                                        )
                                    )
                                    WHEN ij2.jam_pulang < ij2.jam_masuk THEN (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        LEFT JOIN used_scan_pulang_malam u 
                                            ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
                                        WHERE kk.pin = s.pin
                                        AND u.tanggal_scan IS NULL
                                        AND DATE(kk.tanggal_scan) BETWEEN DATE_SUB(s.tanggal, INTERVAL 1 DAY) AND s.tanggal
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(s.tanggal, ' ', ij2.jam_masuk) - INTERVAL 6 HOUR
                                            AND CONCAT(s.tanggal, ' ', ij2.jam_masuk) + INTERVAL 4 HOUR
                                    )
                                    ELSE (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        LEFT JOIN used_scan_pulang_malam u 
                                            ON u.pin = kk.pin AND u.tanggal_scan = kk.tanggal_scan
                                        WHERE kk.pin = s.pin
                                        AND u.tanggal_scan IS NULL
                                        AND DATE(kk.tanggal_scan) = s.tanggal
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(s.tanggal, ' ', ij2.jam_masuk) - INTERVAL 6 HOUR
                                            AND CONCAT(s.tanggal, ' ', ij2.jam_masuk) + INTERVAL 4 HOUR
                                    )
                                END AS pred_actual_masuk,

                                CASE
                                    WHEN ij2.kode = '3A' THEN (
                                        SELECT kk.tanggal_scan
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = s.pin
                                        AND DATE(kk.tanggal_scan) = DATE_ADD(s.tanggal, INTERVAL 1 DAY)
                                        AND TIME(kk.tanggal_scan) >= '05:00:00'
                                        AND TIME(kk.tanggal_scan) <= '12:00:00'
                                        AND kk.tanggal_scan != COALESCE(s.scan_masuk, '1900-01-01')
                                        AND TIMESTAMPDIFF(
                                            MINUTE,
                                            COALESCE(s.scan_masuk, CONCAT(s.tanggal, ' 22:00:00')),
                                            kk.tanggal_scan
                                        ) BETWEEN (
                                            CASE
                                                WHEN ij2.jam_pulang < ij2.jam_masuk
                                                THEN TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ADDTIME(ij2.jam_pulang, '24:00:00'))
                                                ELSE TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ij2.jam_pulang)
                                            END * 0.4
                                        ) AND (
                                            CASE
                                                WHEN ij2.jam_pulang < ij2.jam_masuk
                                                THEN TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ADDTIME(ij2.jam_pulang, '24:00:00'))
                                                ELSE TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ij2.jam_pulang)
                                            END * 1.6
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(
                                            MINUTE,
                                            kk.tanggal_scan,
                                            CONCAT(DATE_ADD(s.tanggal, INTERVAL 1 DAY), ' ', ij2.jam_pulang)
                                        ))
                                        LIMIT 1
                                    )
                                    WHEN ij2.jam_pulang < ij2.jam_masuk THEN (
                                        SELECT kk.tanggal_scan
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = s.pin
                                        AND DATE(kk.tanggal_scan) BETWEEN s.tanggal AND DATE_ADD(s.tanggal, INTERVAL 1 DAY)
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(s.tanggal, ' ', ij2.jam_pulang) + INTERVAL 1 DAY - INTERVAL 4 HOUR
                                            AND CONCAT(s.tanggal, ' ', ij2.jam_pulang) + INTERVAL 1 DAY + INTERVAL 12 HOUR
                                        AND kk.tanggal_scan != COALESCE(s.scan_masuk, '1900-01-01')
                                        AND TIMESTAMPDIFF(
                                            MINUTE,
                                            COALESCE(s.scan_masuk, CONCAT(s.tanggal, ' ', ij2.jam_masuk)),
                                            kk.tanggal_scan
                                        ) BETWEEN (
                                            TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ADDTIME(ij2.jam_pulang, '24:00:00')) * 0.5
                                        ) AND (
                                            TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ADDTIME(ij2.jam_pulang, '24:00:00')) * 1.5
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(
                                            MINUTE,
                                            kk.tanggal_scan,
                                            CONCAT(s.tanggal, ' ', ij2.jam_pulang) + INTERVAL 1 DAY
                                        ))
                                        LIMIT 1
                                    )
                                    ELSE (
                                        SELECT kk.tanggal_scan
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = s.pin
                                        AND DATE(kk.tanggal_scan) = s.tanggal
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(s.tanggal, ' ', ij2.jam_pulang) - INTERVAL 4 HOUR
                                            AND CONCAT(s.tanggal, ' ', ij2.jam_pulang) + INTERVAL 12 HOUR
                                        AND kk.tanggal_scan != COALESCE(s.scan_masuk, '1900-01-01')
                                        AND TIMESTAMPDIFF(
                                            MINUTE,
                                            COALESCE(s.scan_masuk, CONCAT(s.tanggal, ' ', ij2.jam_masuk)),
                                            kk.tanggal_scan
                                        ) BETWEEN (
                                            TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ij2.jam_pulang) * 0.5
                                        ) AND (
                                            TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ij2.jam_pulang) * 1.5
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(
                                            MINUTE,
                                            kk.tanggal_scan,
                                            CONCAT(s.tanggal, ' ', ij2.jam_pulang)
                                        ))
                                        LIMIT 1
                                    )
                                END AS pred_actual_pulang,
                                
                                (
                                    0.7 * CASE 
                                        WHEN s.scan_masuk IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk))
                                        ELSE 999 
                                    END +
                                    0.3 * CASE 
                                        WHEN s.scan_pulang IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang))
                                        ELSE 999 
                                    END
                                ) - COALESCE(hf.freq_count * 5, 0) AS final_score,
                                
                                CASE 
                                    WHEN s.scan_masuk IS NOT NULL AND s.scan_pulang IS NOT NULL
                                    THEN ROUND(100 * (1 - ((
                                        0.7 * ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) +
                                        0.3 * ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang))
                                    ) / 180)), 2)
                                    WHEN s.scan_masuk IS NOT NULL 
                                    THEN ROUND(50 * (1 - (ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) / 90)), 2)
                                    WHEN s.scan_pulang IS NOT NULL 
                                    THEN ROUND(50 * (1 - (ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) / 90)), 2)
                                    ELSE 0
                                END AS probabilitas,
                                
                                CASE 
                                    WHEN (0.7 * CASE WHEN s.scan_masuk IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) ELSE 999 END +
                                        0.3 * CASE WHEN s.scan_pulang IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) ELSE 999 END
                                    ) <= 45 THEN 'Sangat Tinggi'
                                    WHEN (0.7 * CASE WHEN s.scan_masuk IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) ELSE 999 END +
                                        0.3 * CASE WHEN s.scan_pulang IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) ELSE 999 END
                                    ) <= 90 THEN 'Tinggi'
                                    WHEN (0.7 * CASE WHEN s.scan_masuk IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) ELSE 999 END +
                                        0.3 * CASE WHEN s.scan_pulang IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) ELSE 999 END
                                    ) <= 180 THEN 'Sedang'
                                    ELSE 'Rendah'
                                END AS confidence_score,
                                
                                COALESCE(hf.freq_count, 0) AS freq_shift,
                                
                                ROW_NUMBER() OVER (
                                    PARTITION BY s.id_karyawan, s.tanggal
                                    ORDER BY (
                                        0.7 * CASE WHEN s.scan_masuk IS NOT NULL 
                                            THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) ELSE 999 END +
                                        0.3 * CASE WHEN s.scan_pulang IS NOT NULL 
                                            THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) ELSE 999 END
                                    ) - COALESCE(hf.freq_count * 5, 0) ASC
                                ) AS rn
                                
                            FROM scan_data s
                            CROSS JOIN informasi_jadwal ij2
                            LEFT JOIN historical_freq hf ON hf.id_karyawan = s.id_karyawan AND hf.kode_shift = ij2.kode
                            WHERE ij2.kode NOT IN ('CT','CTT','EO','OF1','CTB','X')
                            AND ij2.lokasi_kerja = 'Ciater'
                        )

                        /* ===== MAIN SELECT ===== */
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
                            CASE 
                                WHEN base.actual_duration_minutes IS NOT NULL THEN
                                    CONCAT(
                                        FLOOR(base.actual_duration_minutes / 60), ' jam ',
                                        MOD(base.actual_duration_minutes, 60), ' menit'
                                    )
                                ELSE NULL
                            END AS Durasi_Kerja_Aktual,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.kode_shift 
                            END AS Prediksi_Shift,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.pred_actual_masuk 
                            END AS Prediksi_Actual_Masuk,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.pred_actual_pulang 
                            END AS Prediksi_Actual_Pulang,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.probabilitas 
                            END AS Probabilitas_Prediksi,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.confidence_score 
                            END AS Confidence_Score,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.freq_shift 
                            END AS Frekuensi_Shift_Historis,
                            
                            CASE
                                WHEN base.Kode_Shift IN ('CT','CTT','EO','OF1','CTB','X') THEN ij.keterangan
                                WHEN base.Actual_Masuk IS NULL AND base.Actual_Pulang IS NULL THEN 'Tidak Hadir'
                                ELSE 'Hadir'
                            END AS Status_Kehadiran,
                            
                            CASE
                                WHEN base.Actual_Masuk IS NULL
                                    AND base.actual_duration_minutes IS NOT NULL
                                    AND base.actual_duration_minutes >= (base.expected_duration_minutes * 0.9)
                                    THEN 'Masuk Tepat Waktu'
                                
                                WHEN base.Actual_Masuk IS NULL THEN 'Tidak scan masuk'
                                
                                WHEN base.Departemen NOT IN ('ACCOUNTING', 'SALES & MARKETING')
                                    AND base.Actual_Masuk IS NOT NULL
                                    AND TIME(base.Actual_Masuk) <= ADDTIME(ij.jam_masuk, '00:15:00')
                                    THEN 'Masuk Tepat Waktu'

                                WHEN base.Departemen IN ('ACCOUNTING', 'SALES & MARKETING')
                                    AND base.Kode_Shift = '3A'
                                    AND base.Actual_Masuk IS NOT NULL
                                    AND base.Actual_Pulang IS NOT NULL
                                    THEN
                                    CASE
                                        WHEN DATE(base.Actual_Masuk) = DATE(base.Tanggal)
                                            AND TIME(base.Actual_Masuk) >= '22:00:00'
                                            AND TIME(base.Actual_Masuk) <= '23:59:59'
                                            THEN 'Masuk Tepat Waktu'
                                        
                                        WHEN DATE(base.Actual_Masuk) = DATE_ADD(DATE(base.Tanggal), INTERVAL 1 DAY)
                                            AND (
                                                base.actual_duration_minutes >= 540
                                                OR 
                                                TIMESTAMPDIFF(MINUTE, 
                                                    CONCAT(DATE_ADD(base.Tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang),
                                                    base.Actual_Pulang
                                                ) >= 60
                                            )
                                            THEN 'Masuk Tepat Waktu'
                                        
                                        ELSE 'Masuk Telat'
                                    END
                                
                                WHEN base.Departemen IN ('ACCOUNTING', 'SALES & MARKETING')
                                    AND base.Kode_Shift != '3A'
                                    AND base.Actual_Masuk IS NOT NULL
                                    AND base.Actual_Pulang IS NOT NULL
                                    AND (
                                        base.actual_duration_minutes >= 540
                                        OR 
                                        (
                                            CASE 
                                                WHEN ij.jam_pulang < ij.jam_masuk THEN
                                                    TIMESTAMPDIFF(MINUTE, 
                                                        CONCAT(DATE_ADD(base.Tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang),
                                                        base.Actual_Pulang
                                                    )
                                                ELSE
                                                    TIMESTAMPDIFF(MINUTE, 
                                                        CONCAT(base.Tanggal, ' ', ij.jam_pulang),
                                                        base.Actual_Pulang
                                                    )
                                            END >= 60
                                        )
                                    )
                                    THEN 'Masuk Tepat Waktu'
                                
                                WHEN base.Kode_Shift = '3A' THEN 
                                    CASE
                                        WHEN DATE(base.Actual_Masuk) = DATE(base.Tanggal)
                                            AND TIME(base.Actual_Masuk) >= '22:00:00'
                                            AND TIME(base.Actual_Masuk) <= '23:59:59'
                                            THEN 'Masuk Tepat Waktu'
                                        WHEN DATE(base.Actual_Masuk) = DATE_ADD(DATE(base.Tanggal), INTERVAL 1 DAY)
                                            AND TIME(base.Actual_Masuk) <= '00:15:00'
                                            THEN 'Masuk Tepat Waktu'
                                        ELSE 'Masuk Telat'
                                    END
                                    
                                WHEN ij.jam_pulang < ij.jam_masuk THEN 
                                    CASE
                                        WHEN DATE(base.Actual_Masuk) = DATE(base.Tanggal) 
                                            AND TIME(base.Actual_Masuk) <= ADDTIME(ij.jam_masuk, '00:15:00')
                                            THEN 'Masuk Tepat Waktu'
                                        WHEN DATE(base.Actual_Masuk) = DATE_SUB(DATE(base.Tanggal), INTERVAL 1 DAY)
                                            AND TIME(base.Actual_Masuk) >= TIME(ij.jam_masuk) 
                                            THEN 'Masuk Tepat Waktu'
                                        ELSE 'Masuk Telat'
                                    END
                                ELSE 
                                    CASE
                                        WHEN TIME(base.Actual_Masuk) <= ADDTIME(ij.jam_masuk, '00:15:00') 
                                            THEN 'Masuk Tepat Waktu'
                                        ELSE 'Masuk Telat'
                                    END
                            END AS Status_Masuk,

                            CASE
                                WHEN base.Actual_Pulang IS NULL THEN 'Tidak scan pulang'
                                
                                WHEN base.Departemen NOT IN ('ACCOUNTING', 'SALES & MARKETING') THEN
                                    CASE
                                        WHEN TIME(base.Actual_Pulang) >= ij.jam_pulang
                                            THEN 'Pulang Tepat Waktu'
                                        WHEN base.actual_duration_minutes >= (base.expected_duration_minutes * 0.9) 
                                            THEN 'Pulang Tepat Waktu'
                                        ELSE 'Pulang Terlalu Cepat'
                                    END
                                
                                WHEN base.Departemen IN ('ACCOUNTING', 'SALES & MARKETING')
                                    AND base.Actual_Masuk IS NOT NULL
                                    AND base.Actual_Pulang IS NOT NULL THEN
                                    CASE
                                        WHEN base.actual_duration_minutes >= 540
                                            OR 
                                            (
                                                CASE 
                                                    WHEN ij.jam_pulang < ij.jam_masuk THEN
                                                        TIMESTAMPDIFF(MINUTE, 
                                                            CONCAT(DATE_ADD(base.Tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang),
                                                            base.Actual_Pulang
                                                        )
                                                    ELSE
                                                        TIMESTAMPDIFF(MINUTE, 
                                                            CONCAT(base.Tanggal, ' ', ij.jam_pulang),
                                                            base.Actual_Pulang
                                                        )
                                                END >= 60
                                            )
                                            THEN 'Pulang Tepat Waktu'
                                        WHEN TIME(base.Actual_Pulang) >= ij.jam_pulang
                                            THEN 'Pulang Tepat Waktu'
                                        ELSE 'Pulang Terlalu Cepat'
                                    END
                                
                                ELSE 'Pulang Terlalu Cepat'
                                
                            END AS Status_Pulang

                        FROM base_with_duration base
                        LEFT JOIN informasi_jadwal ij ON ij.kode = base.Kode_Shift
                        LEFT JOIN prediction_data pred ON pred.id_karyawan = base.id_karyawan
                            AND pred.tanggal = base.Tanggal 
                            AND pred.rn = 1

                        ORDER BY base.Nama, base.Tanggal;
                        """
            cur.execute(query)
            rows = cur.fetchall()

            inserted_count = 0
            skipped_count = 0

            # 🔥 OPTIMIZATION 2: Batch insert dengan bulk insert
            batch_data = []
            batch_size = 100

            for row in rows:
                batch_data.append((
                    row["Nama"],
                    row["Tanggal"],
                    row["Kode_Shift"],
                    row["Jabatan"],
                    row["Departemen"],
                    row["id_karyawan"],
                    row["NIK"],
                    row["Jadwal_Masuk"],
                    row["Jadwal_Pulang"],
                    row["Actual_Masuk"],
                    row["Actual_Pulang"],
                    row["Prediksi_Shift"],
                    row["Prediksi_Actual_Masuk"],
                    row["Prediksi_Actual_Pulang"],
                    row["Probabilitas_Prediksi"],
                    row["Confidence_Score"],
                    row["Frekuensi_Shift_Historis"],
                    row["Status_Kehadiran"],
                    row["Status_Masuk"],
                    row["Status_Pulang"],
                ))
                if cur.rowcount == 1:
                    inserted_count += 1
                elif cur.rowcount == 2:
                    updated_count += 1


                # Insert dalam batch
                if len(batch_data) >= batch_size:
                    upsert_sql = """
                        INSERT INTO croscek (
                            Nama, Tanggal, Kode_Shift,
                            Jabatan, Departemen,
                            id_karyawan, NIK,
                            Jadwal_Masuk, Jadwal_Pulang,
                            Actual_Masuk, Actual_Pulang,
                            Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang,
                            Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis,
                            Status_Kehadiran, Status_Masuk, Status_Pulang
                        ) VALUES (%s,%s,%s,%s,%s,
                                %s,%s,
                                %s,%s,
                                %s,%s,
                                %s,%s,%s,
                                %s,%s,%s,
                                %s,%s,%s)
                        ON DUPLICATE KEY UPDATE
                            Kode_Shift = VALUES(Kode_Shift),
                            Jabatan = VALUES(Jabatan),
                            Departemen = VALUES(Departemen),
                            id_karyawan = VALUES(id_karyawan),
                            NIK = VALUES(NIK),
                            Jadwal_Masuk = VALUES(Jadwal_Masuk),
                            Jadwal_Pulang = VALUES(Jadwal_Pulang),
                            Actual_Masuk = VALUES(Actual_Masuk),
                            Actual_Pulang = VALUES(Actual_Pulang),
                            Status_Kehadiran = VALUES(Status_Kehadiran),
                            Status_Masuk = VALUES(Status_Masuk),
                            Status_Pulang = VALUES(Status_Pulang)
                        """

                    for data in batch_data:
                        cur.execute(upsert_sql, data)

                    conn.commit()
                    batch_data = []

            # Insert sisa data
            if batch_data:
                upsert_sql = """
                    INSERT INTO croscek (
                        Nama, Tanggal, Kode_Shift,
                        Jabatan, Departemen,
                        id_karyawan, NIK,
                        Jadwal_Masuk, Jadwal_Pulang,
                        Actual_Masuk, Actual_Pulang,
                        Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang,
                        Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis,
                        Status_Kehadiran, Status_Masuk, Status_Pulang
                    ) VALUES (%s,%s,%s,%s,%s,
                            %s,%s,
                            %s,%s,
                            %s,%s,
                            %s,%s,%s,
                            %s,%s,%s,
                            %s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                        Kode_Shift = VALUES(Kode_Shift),
                        Jabatan = VALUES(Jabatan),
                        Departemen = VALUES(Departemen),
                        id_karyawan = VALUES(id_karyawan),
                        NIK = VALUES(NIK),
                        Jadwal_Masuk = VALUES(Jadwal_Masuk),
                        Jadwal_Pulang = VALUES(Jadwal_Pulang),
                        Actual_Masuk = VALUES(Actual_Masuk),
                        Actual_Pulang = VALUES(Actual_Pulang),
                        Status_Kehadiran = VALUES(Status_Kehadiran),
                        Status_Masuk = VALUES(Status_Masuk),
                        Status_Pulang = VALUES(Status_Pulang)
                    """

                for data in batch_data:
                    cur.execute(upsert_sql, data)
                
                conn.commit()

            # Fetch data terbaru dari tabel croscek
            cur.execute("""
                SELECT
                    Nama,
                    Tanggal,
                    Kode_Shift,
                    Jabatan,
                    Departemen,
                    id_karyawan,
                    NIK,
                    Jadwal_Masuk,
                    Jadwal_Pulang,
                    Actual_Masuk,
                    Actual_Pulang,
                    Status_Kehadiran,
                    Status_Masuk,
                    Status_Pulang
                FROM croscek
                ORDER BY Nama, Tanggal
            """)
            
            result_rows = cur.fetchall()

            # Convert TIME/DATE fields to strings
            for row in result_rows:
                if row['Jadwal_Masuk'] is not None:
                    row['Jadwal_Masuk'] = str(row['Jadwal_Masuk'])
                if row['Jadwal_Pulang'] is not None:
                    row['Jadwal_Pulang'] = str(row['Jadwal_Pulang'])
                if row['Actual_Masuk'] is not None:
                    row['Actual_Masuk'] = str(row['Actual_Masuk'])
                if row['Actual_Pulang'] is not None:
                    row['Actual_Pulang'] = str(row['Actual_Pulang'])
                if isinstance(row['Tanggal'], date):
                    row['Tanggal'] = str(row['Tanggal'])

            cur.close()
            conn.close()

            return jsonify({
                "data": result_rows,
                "summary": {
                    "total": len(rows),
                    "inserted": inserted_count,
                    "skipped": skipped_count,
                    "from_cache": False
                }
            })
        except Exception as e:
            print("ERROR CROSCEK:", e)
            return jsonify({"error": str(e)}), 500
        
    # ======================
    # SIMPAN / UPDATE DATA
    # ======================
    if request.method == "POST":
        try:
            data = request.json
            if not data:
                return jsonify({"error": "Payload kosong"}), 400

            insert_sql = """
            INSERT INTO croscek (
                Nama, Tanggal, Kode_Shift, Jabatan, Departemen,
                id_karyawan, NIK,
                Jadwal_Masuk, Jadwal_Pulang,
                Actual_Masuk, Actual_Pulang,
                Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang,
                Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis,
                Status_Kehadiran, Status_Masuk, Status_Pulang
            ) VALUES (
                %s,%s,%s,%s,%s,
                %s,%s,
                %s,%s,
                %s,%s,
                %s,%s,%s,
                %s,%s,%s,
                %s,%s,%s
            )
            ON DUPLICATE KEY UPDATE
                Kode_Shift       = VALUES(Kode_Shift),
                Jabatan          = VALUES(Jabatan),
                Departemen       = VALUES(Departemen),
                Jadwal_Masuk     = VALUES(Jadwal_Masuk),
                Jadwal_Pulang    = VALUES(Jadwal_Pulang),
                Actual_Masuk     = VALUES(Actual_Masuk),
                Actual_Pulang    = VALUES(Actual_Pulang),
                Status_Kehadiran = VALUES(Status_Kehadiran),
                Status_Masuk     = VALUES(Status_Masuk),
                Status_Pulang    = VALUES(Status_Pulang)
            """

            inserted = 0
            updated_rows = []
            inserted_data = []

            for row in data:

                raw_tgl = row["Tanggal"]

                if isinstance(raw_tgl, str):
                    try:
                        # ISO: 2024-11-01
                        tgl = datetime.fromisoformat(raw_tgl[:10]).date()
                    except:
                        try:
                            # JS Date: Sat, 01 Nov 2024
                            tgl = datetime.strptime(raw_tgl[:16], "%a, %d %b %Y").date()
                        except:
                            raise ValueError(f"Format tanggal tidak dikenali: {raw_tgl}")
                else:
                    tgl = raw_tgl

                cur.execute("""
                    SELECT Status_Kehadiran, Status_Masuk, Status_Pulang
                    FROM croscek
                    WHERE id_karyawan=%s AND Tanggal=%s
                """, (row["id_karyawan"], tgl))

                old = cur.fetchone()
                changed_fields = []

                if old:
                    if old["Status_Kehadiran"] != row["Status_Kehadiran"]:
                        changed_fields.append("Status_Kehadiran")
                    if old["Status_Masuk"] != row["Status_Masuk"]:
                        changed_fields.append("Status_Masuk")
                    if old["Status_Pulang"] != row["Status_Pulang"]:
                        changed_fields.append("Status_Pulang")

                if old and not changed_fields:
                    continue  # 🔥 hemat DB

                cur.execute(insert_sql, (
                    row["Nama"],
                    tgl,
                    row["Kode_Shift"],
                    row["Jabatan"],
                    row["Departemen"],
                    row["id_karyawan"],
                    row["NIK"],
                    row["Jadwal_Masuk"],
                    row["Jadwal_Pulang"],
                    row["Actual_Masuk"],
                    row["Actual_Pulang"],
                    row["Prediksi_Shift"],
                    row["Prediksi_Actual_Masuk"],
                    row["Prediksi_Actual_Pulang"],
                    row["Probabilitas_Prediksi"],
                    row["Confidence_Score"],
                    row["Frekuensi_Shift_Historis"],
                    row["Status_Kehadiran"],
                    row["Status_Masuk"],
                    row["Status_Pulang"],
                ))

                if old and changed_fields:
                    updated_rows.append({
                        "Nama": row["Nama"],
                        "Tanggal": str(tgl),
                        "Fields": changed_fields
                    })

                inserted += 1

            conn.commit()

            # 🔥 AMBIL DATA TERBARU DARI DATABASE UNTUK DITAMPILKAN DI UI
            cur.execute("""
                SELECT
                    Nama,
                    Tanggal,
                    Kode_Shift,
                    Jabatan,
                    Departemen,
                    id_karyawan,
                    NIK,
                    Jadwal_Masuk,
                    Jadwal_Pulang,
                    Actual_Masuk,
                    Actual_Pulang,
                    Status_Kehadiran,
                    Status_Masuk,
                    Status_Pulang
                FROM croscek
                ORDER BY Tanggal DESC, Nama ASC
            """)
            
            inserted_data = cur.fetchall()
            
            # Convert TIME/DATE fields to strings untuk JSON serialization
            for row in inserted_data:
                if row['Jadwal_Masuk'] is not None:
                    row['Jadwal_Masuk'] = str(row['Jadwal_Masuk'])
                if row['Jadwal_Pulang'] is not None:
                    row['Jadwal_Pulang'] = str(row['Jadwal_Pulang'])
                if row['Actual_Masuk'] is not None:
                    row['Actual_Masuk'] = str(row['Actual_Masuk'])
                if row['Actual_Pulang'] is not None:
                    row['Actual_Pulang'] = str(row['Actual_Pulang'])
                if isinstance(row['Tanggal'], date):
                    row['Tanggal'] = str(row['Tanggal'])

            cur.close()
            conn.close()

            return jsonify({
                "success": True,
                "total": len(data),
                "inserted": inserted,
                "updated": len(updated_rows),
                "updated_rows": updated_rows,
                "data": inserted_data
            })

        except Exception as e:
            conn.rollback()
            print("ERROR:", e)
            return jsonify({"error": str(e)}), 500

from datetime import datetime, date, timedelta
@app.route("/api/croscek-karyawan/final", methods=["GET"])
def get_croscek_final():
    conn = db()
    cur = conn.cursor(dictionary=True)

    def serialize_row(row):
        result = {}
        for k, v in row.items():
            if isinstance(v, timedelta):
                total_seconds = int(v.total_seconds())
                hours = total_seconds // 3600
                minutes = (total_seconds % 3600) // 60
                seconds = total_seconds % 60
                result[k] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
            elif isinstance(v, (datetime, date)):
                result[k] = v.isoformat()
            else:
                result[k] = v
        return result

    try:
        cur.execute("""
            SELECT
                Nama,
                Tanggal,
                Kode_Shift,
                Jabatan,
                Departemen,
                id_karyawan,
                NIK,
                Jadwal_Masuk,
                Jadwal_Pulang,
                Actual_Masuk,
                Actual_Pulang,
                Status_Kehadiran,
                Status_Masuk,
                Status_Pulang
            FROM croscek
            ORDER BY Tanggal, Nama
        """)

        rows = cur.fetchall()
        data = [serialize_row(row) for row in rows]

        return jsonify({
            "success": True,
            "data": data
        })

    except Exception as e:
        print("ERROR FETCH FINAL:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/croscek-dw", methods=["GET", "POST"])
def proses_croscek_dw():
    conn = db()
    cur = conn.cursor(dictionary=True)
    if request.method == "GET":
        try:
            # 🔥 OPTIMIZATION 1: Check if data already exists
            cur.execute("SELECT COUNT(*) as count FROM croscek_dw")
            existing_count = cur.fetchone()["count"]
            
            if existing_count > 0:
                # Data sudah ada, ambil langsung dari tabel croscek (jauh lebih cepat)
                cur.execute("""
                    SELECT
                        Nama,
                        Tanggal,
                        Kode_Shift,
                        Jabatan,
                        Departemen,
                        id_karyawan,
                        NIK,
                        Jadwal_Masuk,
                        Jadwal_Pulang,
                        Actual_Masuk,
                        Actual_Pulang,
                        Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang,
                        Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis,
                        Status_Kehadiran,
                        Status_Masuk,
                        Status_Pulang
                    FROM croscek_dw
                    ORDER BY Nama, Tanggal
                """)
                
                result_rows = cur.fetchall()
                
                # Convert TIME/DATE fields to strings for JSON serialization
                for row in result_rows:
                    if row['Jadwal_Masuk'] is not None:
                        row['Jadwal_Masuk'] = str(row['Jadwal_Masuk'])
                    if row['Jadwal_Pulang'] is not None:
                        row['Jadwal_Pulang'] = str(row['Jadwal_Pulang'])
                    if row['Actual_Masuk'] is not None:
                        row['Actual_Masuk'] = str(row['Actual_Masuk'])
                    if row['Actual_Pulang'] is not None:
                        row['Actual_Pulang'] = str(row['Actual_Pulang'])
                    if isinstance(row['Tanggal'], date):
                        row['Tanggal'] = str(row['Tanggal'])
                
                cur.close()
                conn.close()
                
                return jsonify({
                    "data": result_rows,
                    "summary": {
                        "total": len(result_rows),
                        "inserted": 0,
                        "skipped": 0,
                        "from_cache": True
                    }
                })

            query = """
                        /* ===============================================
                        🚀 OPTIMIZED QUERY - DURATION-BASED STATUS
                        ✅ UPDATED: Match by id_absen (PIN) instead of nama
                        =============================================== */

                        WITH 
                        used_scan_pulang_malam AS (
                        -- Part 1: Shift lintas hari normal (non-ACCOUNTING/SALES)
                        -- ✅ PERBAIKAN: Join dengan PIN (id_absen) bukan nama
                        SELECT DISTINCT
                            kk.pin,
                            kk.tanggal_scan
                        FROM jadwal_karyawan jk
                        JOIN karyawan k
                            ON k.id_karyawan = jk.id_karyawan
                            AND k.kategori = 'dw'
                        JOIN informasi_jadwal ij
                            ON ij.kode = jk.kode_shift
                        JOIN kehadiran_karyawan kk
                            ON kk.pin = k.id_absen  -- ✅ MATCH by PIN (id_absen)
                        WHERE
                            k.dept NOT IN ('ACCOUNTING', 'SALES & MARKETING')
                            AND ij.jam_pulang < ij.jam_masuk
                            AND DATE(kk.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                            AND kk.tanggal_scan BETWEEN
                                CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang) - INTERVAL 4 HOUR
                                AND CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang) + INTERVAL 6 HOUR
                        
                        UNION
                        
                        -- Part 2: ACCOUNTING & SALES - Shift lintas hari (2A jam 16:00-00:00)
                        -- ✅ PERBAIKAN: Join dengan PIN (id_absen) bukan nama
                        SELECT DISTINCT
                            kk.pin,
                            kk.tanggal_scan
                        FROM jadwal_karyawan jk
                        JOIN karyawan k
                            ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'dw'
                        JOIN informasi_jadwal ij
                            ON ij.kode = jk.kode_shift
                        JOIN kehadiran_karyawan kk
                            ON kk.pin = k.id_absen  -- ✅ MATCH by PIN (id_absen)
                        WHERE
                            k.dept IN ('ACCOUNTING', 'SALES & MARKETING')
                            AND ij.jam_pulang < ij.jam_masuk  -- Shift lintas hari seperti 2A
                            AND DATE(kk.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                            AND kk.tanggal_scan BETWEEN
                                CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang) - INTERVAL 4 HOUR
                                AND CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang) + INTERVAL 6 HOUR
                        
                        UNION
                        
                        -- Part 3: ACCOUNTING & SALES - Shift NORMAL tapi pulang LEWAT TENGAH MALAM
                        -- ✅ PERBAIKAN: Join dengan PIN (id_absen) bukan nama
                        SELECT DISTINCT
                            kk.pin,
                            kk.tanggal_scan
                        FROM jadwal_karyawan jk
                        JOIN karyawan k
                            ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'dw'
                        JOIN informasi_jadwal ij
                            ON ij.kode = jk.kode_shift
                        JOIN kehadiran_karyawan kk
                            ON kk.pin = k.id_absen  -- ✅ MATCH by PIN (id_absen)
                        WHERE
                            k.dept IN ('ACCOUNTING', 'SALES & MARKETING')
                            AND ij.jam_pulang >= ij.jam_masuk
                            AND DATE(kk.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                            AND TIME(kk.tanggal_scan) BETWEEN '00:00:00' AND '05:59:59'
                            
                            AND TIMESTAMPDIFF(
                                HOUR,
                                CONCAT(jk.tanggal, ' ', ij.jam_pulang),
                                kk.tanggal_scan
                            ) BETWEEN -4 AND 6
                            
                            AND EXISTS (
                                SELECT 1
                                FROM kehadiran_karyawan kk_in
                                WHERE kk_in.pin = k.id_absen  -- ✅ MATCH by PIN
                                AND DATE(kk_in.tanggal_scan) = jk.tanggal
                                AND kk_in.tanggal_scan BETWEEN
                                    CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                    AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                            )
                            
                            AND NOT EXISTS (
                                SELECT 1
                                FROM jadwal_karyawan jk_next
                                JOIN informasi_jadwal ij_next ON ij_next.kode = jk_next.kode_shift
                                WHERE jk_next.id_karyawan = jk.id_karyawan
                                AND jk_next.tanggal = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                AND jk_next.kode_shift NOT IN ('CT','CTT','EO','OF1','CTB','X')
                                AND ij_next.jam_masuk < '10:00:00'
                            )
                    ),

                        /* CTE 1: Scan Data per Karyawan per Tanggal */
                        -- ✅ PERBAIKAN: Ubah struktur untuk support PIN matching
                        scan_data AS (
                            SELECT
                                k.id_absen AS pin,
                                k.id_karyawan,
                                k.nama,
                                DATE(kk.tanggal_scan) AS tanggal,
                                MIN(kk.tanggal_scan) AS scan_masuk,
                                MAX(kk.tanggal_scan) AS scan_pulang
                            FROM kehadiran_karyawan kk
                            JOIN karyawan k ON k.id_absen = kk.pin AND k.kategori = 'dw'  -- ✅ MATCH by PIN
                            LEFT JOIN used_scan_pulang_malam u
                                ON u.pin = kk.pin
                                AND u.tanggal_scan = kk.tanggal_scan
                            WHERE u.tanggal_scan IS NULL
                            GROUP BY k.id_absen, k.id_karyawan, k.nama, DATE(kk.tanggal_scan)
                        ),

                        /* CTE 2: Historical Frequency per Shift */
                        historical_freq AS (
                            SELECT 
                                jk.id_karyawan,
                                jk.kode_shift,
                                COUNT(*) AS freq_count
                            FROM jadwal_karyawan jk
                            JOIN karyawan k
                                ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'dw'
                            WHERE jk.tanggal >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                            GROUP BY jk.id_karyawan, jk.kode_shift
                        ),

                        /* CTE 3: Base Data dengan Actual Masuk/Pulang + DURATION VALIDATION */
                        -- ✅ PERBAIKAN: Join dengan PIN (id_absen) bukan nama
                        base_data AS (
                            SELECT
                                jk.nama AS Nama,
                                jk.tanggal AS Tanggal,
                                jk.kode_shift AS Kode_Shift,
                                k.jabatan AS Jabatan,
                                k.dept AS Departemen,
                                k.id_karyawan,
                                k.nik AS NIK,
                                k.id_absen,
                                ij.jam_masuk,
                                ij.jam_pulang,
                                
                                CASE
                                    WHEN ij.jam_pulang < ij.jam_masuk THEN
                                        TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ADDTIME(ij.jam_pulang, '24:00:00'))
                                    ELSE
                                        TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang)
                                END AS expected_duration_minutes,
                                
                                /* ===== ACTUAL MASUK - FIXED UNTUK 3A ===== */
                                CASE
                                    WHEN jk.kode_shift IN ('CT','CTT','EO','OF1','CTB','X') THEN NULL
                                    
                                    WHEN jk.kode_shift = '3A' THEN (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND (
                                            (
                                                # DATE(kk.tanggal_scan) = jk.tanggal
                                                # AND TIME(kk.tanggal_scan) >= '22:00:00'
                                                kk.tanggal_scan >= jk.tanggal
                                                AND kk.tanggal_scan < DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                AND TIME(kk.tanggal_scan) >= '22:00:00'
                                            )
                                            OR
                                            (
                                                DATE(kk.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                AND TIME(kk.tanggal_scan) <= '03:00:00'
                                            )
                                        )
                                    )
                                    
                                    WHEN ij.jam_pulang < ij.jam_masuk THEN (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        LEFT JOIN used_scan_pulang_malam u
                                            ON u.pin = kk.pin
                                            AND u.tanggal_scan = kk.tanggal_scan
                                        WHERE kk.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND u.tanggal_scan IS NULL
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                            AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                    )
                                    ELSE (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        LEFT JOIN used_scan_pulang_malam u
                                            ON u.pin = kk.pin
                                            AND u.tanggal_scan = kk.tanggal_scan
                                        WHERE kk.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND u.tanggal_scan IS NULL
                                        AND DATE(kk.tanggal_scan) = jk.tanggal
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(jk.tanggal, ' 02:00:00')
                                            AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                        AND NOT EXISTS (
                                            SELECT 1
                                            FROM jadwal_karyawan jk_prev
                                            JOIN informasi_jadwal ij_prev ON ij_prev.kode = jk_prev.kode_shift
                                            WHERE jk_prev.id_karyawan = jk.id_karyawan
                                            AND jk_prev.tanggal = DATE_SUB(jk.tanggal, INTERVAL 1 DAY)
                                            AND jk_prev.kode_shift NOT IN ('CT','CTT','EO','OF1','CTB','X')
                                            AND ij_prev.jam_pulang < ij_prev.jam_masuk
                                            AND kk.tanggal_scan BETWEEN
                                                CONCAT(jk.tanggal, ' ', ij_prev.jam_pulang) - INTERVAL 2 HOUR
                                                AND CONCAT(jk.tanggal, ' ', ij_prev.jam_pulang) + INTERVAL 2 HOUR
                                        )
                                    )
                                END AS Actual_Masuk,
                                
                                /* ===== ACTUAL PULANG - FIXED DENGAN DURATION VALIDATION ===== */
                                CASE
                                    WHEN jk.kode_shift IN ('CT','CTT','EO','OF1','CTB','X') THEN NULL
                                    WHEN jk.kode_shift = '3A' THEN (
                                        COALESCE(
                                            /* LOGIC UTAMA (TIDAK DIUBAH) */
                                            (
                                                SELECT kk_out.tanggal_scan
                                                FROM kehadiran_karyawan kk_out
                                                WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                                AND DATE(kk_out.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                AND TIME(kk_out.tanggal_scan) >= '06:00:00'
                                                AND TIME(kk_out.tanggal_scan) <= '11:00:00'
                                                AND kk_out.tanggal_scan != COALESCE((
                                                    SELECT MIN(kk_in.tanggal_scan)
                                                    FROM kehadiran_karyawan kk_in
                                                    WHERE kk_in.pin = k.id_absen
                                                    AND (
                                                        (DATE(kk_in.tanggal_scan) = jk.tanggal
                                                        AND TIME(kk_in.tanggal_scan) >= '22:00:00')
                                                        OR
                                                        (DATE(kk_in.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                        AND TIME(kk_in.tanggal_scan) <= '03:00:00')
                                                    )
                                                ), '1900-01-01')
                                                AND TIMESTAMPDIFF(MINUTE, 
                                                    COALESCE((
                                                        SELECT MIN(kk_in.tanggal_scan)
                                                        FROM kehadiran_karyawan kk_in
                                                        WHERE kk_in.pin = k.id_absen
                                                        AND (
                                                            (DATE(kk_in.tanggal_scan) = jk.tanggal
                                                            AND TIME(kk_in.tanggal_scan) >= '22:00:00')
                                                            OR
                                                            (DATE(kk_in.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                            AND TIME(kk_in.tanggal_scan) <= '03:00:00')
                                                        )
                                                    ), kk_out.tanggal_scan),
                                                    kk_out.tanggal_scan
                                                ) >= (
                                                    CASE
                                                        WHEN ij.jam_pulang < ij.jam_masuk THEN
                                                            TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ADDTIME(ij.jam_pulang, '24:00:00'))
                                                        ELSE
                                                            TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang)
                                                    END * 0.5
                                                )
                                                ORDER BY kk_out.tanggal_scan DESC
                                                LIMIT 1
                                            ),

                                            /* 🔧 FALLBACK KHUSUS 3A (BARU) */
                                            (
                                                SELECT MAX(kk_out.tanggal_scan)
                                                FROM kehadiran_karyawan kk_out
                                                WHERE kk_out.pin = k.id_absen
                                                AND DATE(kk_out.tanggal_scan) = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                AND TIME(kk_out.tanggal_scan) BETWEEN '05:00:00' AND '12:00:00'
                                            )
                                        )
                                    )

                                    
                                    WHEN k.dept IN ('ACCOUNTING', 'SALES & MARKETING') THEN (
                                        CASE
                                            WHEN ij.jam_pulang < ij.jam_masuk THEN (
                                                SELECT kk_out.tanggal_scan
                                                FROM kehadiran_karyawan kk_out
                                                WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                                AND kk_out.tanggal_scan BETWEEN 
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY - INTERVAL 4 HOUR
                                                    AND CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY + INTERVAL 12 HOUR
                                                AND kk_out.tanggal_scan != COALESCE((
                                                    SELECT MIN(tanggal_scan) FROM kehadiran_karyawan 
                                                    WHERE pin = k.id_absen
                                                    AND tanggal_scan BETWEEN CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                        AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                ), '1900-01-01')
                                                AND (
                                                    (
                                                        SELECT MIN(kk_in.tanggal_scan)
                                                        FROM kehadiran_karyawan kk_in
                                                        WHERE kk_in.pin = k.id_absen
                                                        AND kk_in.tanggal_scan BETWEEN
                                                            CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                            AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                    ) IS NULL
                                                    OR TIMESTAMPDIFF(
                                                        MINUTE,
                                                        (
                                                            SELECT MIN(kk_in.tanggal_scan)
                                                            FROM kehadiran_karyawan kk_in
                                                            WHERE kk_in.pin = k.id_absen
                                                            AND kk_in.tanggal_scan BETWEEN
                                                                CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                        ),
                                                        kk_out.tanggal_scan
                                                        ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ADDTIME(ij.jam_pulang,'24:00:00')) * 0.5)
                                                )
                                                ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk_out.tanggal_scan, 
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY))
                                                LIMIT 1
                                            )
                                            ELSE (
                                                SELECT kk_out.tanggal_scan
                                                FROM kehadiran_karyawan kk_out
                                                WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                                AND kk_out.tanggal_scan BETWEEN 
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang) - INTERVAL 4 HOUR
                                                    AND CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 12 HOUR
                                                AND kk_out.tanggal_scan != COALESCE((
                                                    SELECT MIN(tanggal_scan) FROM kehadiran_karyawan 
                                                    WHERE pin = k.id_absen
                                                    AND tanggal_scan BETWEEN CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                        AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                ), '1900-01-01')
                                                
                                                AND (
                                                    (
                                                        SELECT MIN(kk_in.tanggal_scan)
                                                        FROM kehadiran_karyawan kk_in
                                                        WHERE kk_in.pin = k.id_absen
                                                        AND kk_in.tanggal_scan BETWEEN
                                                            CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                            AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                    ) IS NULL
                                                    OR TIMESTAMPDIFF(
                                                        MINUTE,
                                                        (
                                                            SELECT MIN(kk_in.tanggal_scan)
                                                            FROM kehadiran_karyawan kk_in
                                                            WHERE kk_in.pin = k.id_absen
                                                            AND kk_in.tanggal_scan BETWEEN
                                                                CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                        ),
                                                        kk_out.tanggal_scan
                                                    ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang) * 0.5)
                                                )
                                                
                                                AND (
                                                    -- PRIORITAS 1: Durasi sangat valid → override conflict
                                                    TIMESTAMPDIFF(
                                                        MINUTE,
                                                        (
                                                            SELECT MIN(kk_in.tanggal_scan)
                                                            FROM kehadiran_karyawan kk_in
                                                            WHERE kk_in.pin = k.id_absen
                                                            AND kk_in.tanggal_scan BETWEEN
                                                                CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                        ),
                                                        kk_out.tanggal_scan
                                                    ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang) * 0.8)

                                                    OR

                                                    -- PRIORITAS 2: Jika durasi biasa saja, tetap cek conflict
                                                    NOT EXISTS (
                                                        SELECT 1
                                                        FROM jadwal_karyawan jk_next
                                                        JOIN informasi_jadwal ij_next 
                                                            ON ij_next.kode = jk_next.kode_shift
                                                        WHERE jk_next.id_karyawan = jk.id_karyawan
                                                        AND jk_next.tanggal = DATE_ADD(jk.tanggal, INTERVAL 1 DAY)
                                                        AND jk_next.kode_shift NOT IN ('CT','CTT','EO','OF1','CTB','X')
                                                        AND ABS(
                                                            TIMESTAMPDIFF(
                                                                MINUTE,
                                                                kk_out.tanggal_scan,
                                                                CONCAT(DATE_ADD(jk.tanggal, INTERVAL 1 DAY), ' ', ij_next.jam_masuk)
                                                            )
                                                        ) <= 60
                                                    )
                                                )


                                                ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk_out.tanggal_scan, 
                                                    CONCAT(jk.tanggal, ' ', ij.jam_pulang)))
                                                LIMIT 1
                                            )
                                        END
                                    )
                                    
                                    WHEN ij.jam_pulang < ij.jam_masuk THEN (
                                        SELECT kk_out.tanggal_scan
                                        FROM kehadiran_karyawan kk_out
                                        WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND kk_out.tanggal_scan BETWEEN 
                                            CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY - INTERVAL 4 HOUR
                                            AND CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY + INTERVAL 6 HOUR
                                        AND kk_out.tanggal_scan != COALESCE((
                                            SELECT MIN(tanggal_scan) FROM kehadiran_karyawan 
                                            WHERE pin = k.id_absen
                                            AND tanggal_scan BETWEEN CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                        ), '1900-01-01')
                                        AND (
                                            (
                                                SELECT MIN(kk_in.tanggal_scan)
                                                FROM kehadiran_karyawan kk_in
                                                WHERE kk_in.pin = k.id_absen
                                                AND kk_in.tanggal_scan BETWEEN
                                                    CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                    AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                            ) IS NULL
                                            OR TIMESTAMPDIFF(
                                                MINUTE,
                                                (
                                                    SELECT MIN(kk_in.tanggal_scan)
                                                    FROM kehadiran_karyawan kk_in
                                                    WHERE kk_in.pin = k.id_absen
                                                    AND kk_in.tanggal_scan BETWEEN
                                                        CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                        AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                ),
                                                kk_out.tanggal_scan
                                            ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ADDTIME(ij.jam_pulang,'24:00:00')) * 0.5)
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk_out.tanggal_scan, 
                                            CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 1 DAY))
                                        LIMIT 1
                                    )
                                    ELSE (
                                        SELECT kk_out.tanggal_scan
                                        FROM kehadiran_karyawan kk_out
                                        WHERE kk_out.pin = k.id_absen  -- ✅ MATCH by PIN
                                        AND kk_out.tanggal_scan BETWEEN 
                                            CONCAT(jk.tanggal, ' ', ij.jam_pulang) - INTERVAL 4 HOUR
                                            AND CONCAT(jk.tanggal, ' ', ij.jam_pulang) + INTERVAL 7 HOUR
                                        AND kk_out.tanggal_scan != COALESCE((
                                            SELECT MIN(tanggal_scan) FROM kehadiran_karyawan 
                                            WHERE pin = k.id_absen
                                            AND tanggal_scan BETWEEN CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                        ), '1900-01-01')
                                        AND (
                                            (
                                                SELECT MIN(kk_in.tanggal_scan)
                                                FROM kehadiran_karyawan kk_in
                                                WHERE kk_in.pin = k.id_absen
                                                AND kk_in.tanggal_scan BETWEEN
                                                    CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                    AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                            ) IS NULL
                                            OR TIMESTAMPDIFF(
                                                MINUTE,
                                                (
                                                    SELECT MIN(kk_in.tanggal_scan)
                                                    FROM kehadiran_karyawan kk_in
                                                    WHERE kk_in.pin = k.id_absen
                                                    AND kk_in.tanggal_scan BETWEEN
                                                        CONCAT(jk.tanggal, ' ', ij.jam_masuk) - INTERVAL 6 HOUR
                                                        AND CONCAT(jk.tanggal, ' ', ij.jam_masuk) + INTERVAL 4 HOUR
                                                ),
                                                kk_out.tanggal_scan
                                            ) >= (TIMESTAMPDIFF(MINUTE, ij.jam_masuk, ij.jam_pulang) * 0.5)
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk_out.tanggal_scan, 
                                            CONCAT(jk.tanggal, ' ', ij.jam_pulang)))
                                        LIMIT 1
                                    )
                                END AS Actual_Pulang
                                
                            # FROM jadwal_karyawan jk
                            # LEFT JOIN karyawan k ON k.id_karyawan = jk.id_karyawan AND k.kategori = 'dw'
                            FROM jadwal_karyawan jk
                            JOIN karyawan k
                                ON k.id_karyawan = jk.id_karyawan
                            AND k.kategori = 'dw'
                            LEFT JOIN informasi_jadwal ij ON ij.kode = jk.kode_shift
                        ),

                        /* CTE 4: Add Actual Duration Calculation */
                        base_with_duration AS (
                            SELECT
                                base.*,
                                CASE
                                    WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL
                                    THEN TIMESTAMPDIFF(MINUTE, base.Actual_Masuk, base.Actual_Pulang)
                                    ELSE NULL
                                END AS actual_duration_minutes
                            FROM base_data base
                        ),

                        /* CTE 5: Prediksi Shift */
                        -- ✅ PERBAIKAN: Update untuk mendukung PIN matching
                        prediction_data AS (
                            SELECT
                                s.id_karyawan,
                                s.pin,
                                s.nama,
                                s.tanggal,
                                ij2.kode AS kode_shift,
                                
                                CASE
                                    WHEN ij2.kode = '3A' THEN (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = s.pin  -- ✅ MATCH by PIN
                                        AND (
                                            (
                                                DATE(kk.tanggal_scan) = s.tanggal
                                                AND TIME(kk.tanggal_scan) >= '22:00:00'
                                            )
                                            OR
                                            (
                                                DATE(kk.tanggal_scan) = DATE_ADD(s.tanggal, INTERVAL 1 DAY)
                                                AND TIME(kk.tanggal_scan) <= '03:00:00'
                                            )
                                        )
                                    )
                                    
                                    WHEN ij2.jam_pulang < ij2.jam_masuk THEN (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        LEFT JOIN used_scan_pulang_malam u
                                            ON u.pin = kk.pin
                                            AND u.tanggal_scan = kk.tanggal_scan
                                        WHERE kk.pin = s.pin  -- ✅ MATCH by PIN
                                        AND u.tanggal_scan IS NULL
                                        AND DATE(kk.tanggal_scan) BETWEEN DATE_SUB(s.tanggal, INTERVAL 1 DAY) AND s.tanggal
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(s.tanggal, ' ', ij2.jam_masuk) - INTERVAL 6 HOUR
                                            AND CONCAT(s.tanggal, ' ', ij2.jam_masuk) + INTERVAL 4 HOUR
                                    )
                                    ELSE (
                                        SELECT MIN(kk.tanggal_scan)
                                        FROM kehadiran_karyawan kk
                                        LEFT JOIN used_scan_pulang_malam u
                                            ON u.pin = kk.pin
                                            AND u.tanggal_scan = kk.tanggal_scan
                                        WHERE kk.pin = s.pin  -- ✅ MATCH by PIN
                                        AND u.tanggal_scan IS NULL
                                        AND DATE(kk.tanggal_scan) = s.tanggal
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(s.tanggal, ' ', ij2.jam_masuk) - INTERVAL 6 HOUR
                                            AND CONCAT(s.tanggal, ' ', ij2.jam_masuk) + INTERVAL 4 HOUR
                                    )
                                END AS pred_actual_masuk,
                                
                                CASE
                                    WHEN ij2.kode = '3A' THEN (
                                        SELECT kk.tanggal_scan
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = s.pin  -- ✅ MATCH by PIN
                                        AND DATE(kk.tanggal_scan) = DATE_ADD(s.tanggal, INTERVAL 1 DAY)
                                        AND TIME(kk.tanggal_scan) >= '06:00:00'
                                        AND TIME(kk.tanggal_scan) <= '11:00:00'
                                        AND kk.tanggal_scan != s.scan_masuk
                                        AND TIMESTAMPDIFF(MINUTE, s.scan_masuk, kk.tanggal_scan) BETWEEN (
                                            CASE
                                                WHEN ij2.jam_pulang < ij2.jam_masuk THEN
                                                    TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ADDTIME(ij2.jam_pulang, '24:00:00'))
                                                ELSE
                                                    TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ij2.jam_pulang)
                                            END * 0.5
                                        ) AND (
                                            CASE
                                                WHEN ij2.jam_pulang < ij2.jam_masuk THEN
                                                    TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ADDTIME(ij2.jam_pulang, '24:00:00'))
                                                ELSE
                                                    TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ij2.jam_pulang)
                                            END * 1.5
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk.tanggal_scan, 
                                            CONCAT(s.tanggal, ' 06:00:00') + INTERVAL 1 DAY))
                                        LIMIT 1
                                    )
                                    
                                    WHEN ij2.jam_pulang < ij2.jam_masuk THEN (
                                        SELECT kk.tanggal_scan
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = s.pin  -- ✅ MATCH by PIN
                                        AND DATE(kk.tanggal_scan) BETWEEN s.tanggal AND DATE_ADD(s.tanggal, INTERVAL 1 DAY)
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(s.tanggal, ' ', ij2.jam_pulang) + INTERVAL 1 DAY - INTERVAL 4 HOUR
                                            AND CONCAT(s.tanggal, ' ', ij2.jam_pulang) + INTERVAL 1 DAY + INTERVAL 12 HOUR
                                        AND kk.tanggal_scan != s.scan_masuk
                                        AND TIMESTAMPDIFF(MINUTE, s.scan_masuk, kk.tanggal_scan) BETWEEN (
                                            TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ADDTIME(ij2.jam_pulang, '24:00:00')) * 0.5
                                        ) AND (
                                            TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ADDTIME(ij2.jam_pulang, '24:00:00')) * 1.5
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk.tanggal_scan, 
                                            CONCAT(s.tanggal, ' ', ij2.jam_pulang) + INTERVAL 1 DAY))
                                        LIMIT 1
                                    )
                                    ELSE (
                                        SELECT kk.tanggal_scan
                                        FROM kehadiran_karyawan kk
                                        WHERE kk.pin = s.pin  -- ✅ MATCH by PIN
                                        AND DATE(kk.tanggal_scan) = s.tanggal
                                        AND kk.tanggal_scan BETWEEN 
                                            CONCAT(s.tanggal, ' ', ij2.jam_pulang) - INTERVAL 4 HOUR
                                            AND CONCAT(s.tanggal, ' ', ij2.jam_pulang) + INTERVAL 12 HOUR
                                        AND kk.tanggal_scan != s.scan_masuk
                                        AND TIMESTAMPDIFF(MINUTE, s.scan_masuk, kk.tanggal_scan) BETWEEN (
                                            TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ij2.jam_pulang) * 0.5
                                        ) AND (
                                            TIMESTAMPDIFF(MINUTE, ij2.jam_masuk, ij2.jam_pulang) * 1.5
                                        )
                                        ORDER BY ABS(TIMESTAMPDIFF(MINUTE, kk.tanggal_scan, 
                                            CONCAT(s.tanggal, ' ', ij2.jam_pulang)))
                                        LIMIT 1
                                    )
                                END AS pred_actual_pulang,
                                
                                (
                                    0.7 * CASE 
                                        WHEN s.scan_masuk IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk))
                                        ELSE 999 
                                    END +
                                    0.3 * CASE 
                                        WHEN s.scan_pulang IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang))
                                        ELSE 999 
                                    END
                                ) - COALESCE(hf.freq_count * 5, 0) AS final_score,
                                
                                CASE 
                                    WHEN s.scan_masuk IS NOT NULL AND s.scan_pulang IS NOT NULL
                                    THEN ROUND(100 * (1 - ((
                                        0.7 * ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) +
                                        0.3 * ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang))
                                    ) / 180)), 2)
                                    WHEN s.scan_masuk IS NOT NULL 
                                    THEN ROUND(50 * (1 - (ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) / 90)), 2)
                                    WHEN s.scan_pulang IS NOT NULL 
                                    THEN ROUND(50 * (1 - (ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) / 90)), 2)
                                    ELSE 0
                                END AS probabilitas,
                                
                                CASE 
                                    WHEN (0.7 * CASE WHEN s.scan_masuk IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) ELSE 999 END +
                                        0.3 * CASE WHEN s.scan_pulang IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) ELSE 999 END
                                    ) <= 45 THEN 'Sangat Tinggi'
                                    WHEN (0.7 * CASE WHEN s.scan_masuk IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) ELSE 999 END +
                                        0.3 * CASE WHEN s.scan_pulang IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) ELSE 999 END
                                    ) <= 90 THEN 'Tinggi'
                                    WHEN (0.7 * CASE WHEN s.scan_masuk IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) ELSE 999 END +
                                        0.3 * CASE WHEN s.scan_pulang IS NOT NULL 
                                        THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) ELSE 999 END
                                    ) <= 180 THEN 'Sedang'
                                    ELSE 'Rendah'
                                END AS confidence_score,
                                
                                COALESCE(hf.freq_count, 0) AS freq_shift,
                                
                                ROW_NUMBER() OVER (
                                    PARTITION BY s.id_karyawan, s.tanggal
                                    ORDER BY (
                                        0.7 * CASE WHEN s.scan_masuk IS NOT NULL 
                                            THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_masuk), ij2.jam_masuk)) ELSE 999 END +
                                        0.3 * CASE WHEN s.scan_pulang IS NOT NULL 
                                            THEN ABS(TIMESTAMPDIFF(MINUTE, TIME(s.scan_pulang), ij2.jam_pulang)) ELSE 999 END
                                    ) - COALESCE(hf.freq_count * 5, 0) ASC
                                ) AS rn
                                
                            FROM scan_data s
                            CROSS JOIN informasi_jadwal ij2
                            LEFT JOIN historical_freq hf ON hf.id_karyawan = s.id_karyawan AND hf.kode_shift = ij2.kode
                            WHERE ij2.kode NOT IN ('CT','CTT','EO','OF1','CTB','X')
                            AND ij2.lokasi_kerja = 'Ciater'
                        )

                        /* ===== MAIN SELECT ===== */
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
                            CASE 
                                WHEN base.actual_duration_minutes IS NOT NULL THEN
                                    CONCAT(
                                        FLOOR(base.actual_duration_minutes / 60), ' jam ',
                                        MOD(base.actual_duration_minutes, 60), ' menit'
                                    )
                                ELSE NULL
                            END AS Durasi_Kerja_Aktual,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.kode_shift 
                            END AS Prediksi_Shift,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.pred_actual_masuk 
                            END AS Prediksi_Actual_Masuk,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.pred_actual_pulang 
                            END AS Prediksi_Actual_Pulang,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.probabilitas 
                            END AS Probabilitas_Prediksi,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.confidence_score 
                            END AS Confidence_Score,
                            
                            CASE 
                                WHEN base.Actual_Masuk IS NOT NULL AND base.Actual_Pulang IS NOT NULL 
                                THEN NULL ELSE pred.freq_shift 
                            END AS Frekuensi_Shift_Historis,
                            
                            CASE
                                WHEN base.Kode_Shift IN ('CT','CTT','EO','OF1','CTB','X') THEN ij.keterangan
                                WHEN base.Actual_Masuk IS NULL AND base.Actual_Pulang IS NULL THEN 'Tidak Hadir'
                                ELSE 'Hadir'
                            END AS Status_Kehadiran,
                            
                            CASE
                                WHEN base.Actual_Masuk IS NULL
                                    AND base.actual_duration_minutes IS NOT NULL
                                    AND base.actual_duration_minutes >= (base.expected_duration_minutes * 0.9)
                                    THEN 'Masuk Tepat Waktu'
                                
                                WHEN base.Actual_Masuk IS NULL THEN 'Tidak scan masuk'
                                
                                WHEN base.Departemen NOT IN ('ACCOUNTING', 'SALES & MARKETING')
                                    AND base.Actual_Masuk IS NOT NULL
                                    AND TIME(base.Actual_Masuk) <= ADDTIME(ij.jam_masuk, '00:15:00')
                                    THEN 'Masuk Tepat Waktu'

                                WHEN base.Departemen IN ('ACCOUNTING', 'SALES & MARKETING')
                                    AND base.Kode_Shift = '3A'
                                    AND base.Actual_Masuk IS NOT NULL
                                    AND base.Actual_Pulang IS NOT NULL
                                    THEN
                                    CASE
                                        WHEN DATE(base.Actual_Masuk) = DATE(base.Tanggal)
                                            AND TIME(base.Actual_Masuk) >= '22:00:00'
                                            AND TIME(base.Actual_Masuk) <= '23:59:59'
                                            THEN 'Masuk Tepat Waktu'
                                        
                                        WHEN DATE(base.Actual_Masuk) = DATE_ADD(DATE(base.Tanggal), INTERVAL 1 DAY)
                                            AND (
                                                base.actual_duration_minutes >= 540
                                                OR 
                                                TIMESTAMPDIFF(MINUTE, 
                                                    CONCAT(DATE_ADD(base.Tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang),
                                                    base.Actual_Pulang
                                                ) >= 60
                                            )
                                            THEN 'Masuk Tepat Waktu'
                                        
                                        ELSE 'Masuk Telat'
                                    END
                                
                                WHEN base.Departemen IN ('ACCOUNTING', 'SALES & MARKETING')
                                    AND base.Kode_Shift != '3A'
                                    AND base.Actual_Masuk IS NOT NULL
                                    AND base.Actual_Pulang IS NOT NULL
                                    AND (
                                        base.actual_duration_minutes >= 540
                                        OR 
                                        (
                                            CASE 
                                                WHEN ij.jam_pulang < ij.jam_masuk THEN
                                                    TIMESTAMPDIFF(MINUTE, 
                                                        CONCAT(DATE_ADD(base.Tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang),
                                                        base.Actual_Pulang
                                                    )
                                                ELSE
                                                    TIMESTAMPDIFF(MINUTE, 
                                                        CONCAT(base.Tanggal, ' ', ij.jam_pulang),
                                                        base.Actual_Pulang
                                                    )
                                            END >= 60
                                        )
                                    )
                                    THEN 'Masuk Tepat Waktu'
                                
                                WHEN base.Kode_Shift = '3A' THEN 
                                    CASE
                                        WHEN DATE(base.Actual_Masuk) = DATE(base.Tanggal)
                                            AND TIME(base.Actual_Masuk) >= '22:00:00'
                                            AND TIME(base.Actual_Masuk) <= '23:59:59'
                                            THEN 'Masuk Tepat Waktu'
                                        WHEN DATE(base.Actual_Masuk) = DATE_ADD(DATE(base.Tanggal), INTERVAL 1 DAY)
                                            AND TIME(base.Actual_Masuk) <= '00:15:00'
                                            THEN 'Masuk Tepat Waktu'
                                        ELSE 'Masuk Telat'
                                    END
                                    
                                WHEN ij.jam_pulang < ij.jam_masuk THEN 
                                    CASE
                                        WHEN DATE(base.Actual_Masuk) = DATE(base.Tanggal) 
                                            AND TIME(base.Actual_Masuk) <= ADDTIME(ij.jam_masuk, '00:15:00')
                                            THEN 'Masuk Tepat Waktu'
                                        WHEN DATE(base.Actual_Masuk) = DATE_SUB(DATE(base.Tanggal), INTERVAL 1 DAY)
                                            AND TIME(base.Actual_Masuk) >= TIME(ij.jam_masuk) 
                                            THEN 'Masuk Tepat Waktu'
                                        ELSE 'Masuk Telat'
                                    END
                                ELSE 
                                    CASE
                                        WHEN TIME(base.Actual_Masuk) <= ADDTIME(ij.jam_masuk, '00:15:00') 
                                            THEN 'Masuk Tepat Waktu'
                                        ELSE 'Masuk Telat'
                                    END
                            END AS Status_Masuk,

                            CASE
                                WHEN base.Actual_Pulang IS NULL THEN 'Tidak scan pulang'
                                
                                WHEN base.Departemen NOT IN ('ACCOUNTING', 'SALES & MARKETING') THEN
                                    CASE
                                        WHEN TIME(base.Actual_Pulang) >= ij.jam_pulang
                                            THEN 'Pulang Tepat Waktu'
                                        WHEN base.actual_duration_minutes >= (base.expected_duration_minutes * 0.9) 
                                            THEN 'Pulang Tepat Waktu'
                                        ELSE 'Pulang Terlalu Cepat'
                                    END
                                
                                WHEN base.Departemen IN ('ACCOUNTING', 'SALES & MARKETING')
                                    AND base.Actual_Masuk IS NOT NULL
                                    AND base.Actual_Pulang IS NOT NULL THEN
                                    CASE
                                        WHEN base.actual_duration_minutes >= 540
                                            OR 
                                            (
                                                CASE 
                                                    WHEN ij.jam_pulang < ij.jam_masuk THEN
                                                        TIMESTAMPDIFF(MINUTE, 
                                                            CONCAT(DATE_ADD(base.Tanggal, INTERVAL 1 DAY), ' ', ij.jam_pulang),
                                                            base.Actual_Pulang
                                                        )
                                                    ELSE
                                                        TIMESTAMPDIFF(MINUTE, 
                                                            CONCAT(base.Tanggal, ' ', ij.jam_pulang),
                                                            base.Actual_Pulang
                                                        )
                                                END >= 60
                                            )
                                            THEN 'Pulang Tepat Waktu'
                                        WHEN TIME(base.Actual_Pulang) >= ij.jam_pulang
                                            THEN 'Pulang Tepat Waktu'
                                        ELSE 'Pulang Terlalu Cepat'
                                    END
                                
                                ELSE 'Pulang Terlalu Cepat'
                                
                            END AS Status_Pulang

                        FROM base_with_duration base
                        LEFT JOIN informasi_jadwal ij ON ij.kode = base.Kode_Shift
                        LEFT JOIN prediction_data pred ON pred.id_karyawan = base.id_karyawan
                            AND pred.tanggal = base.Tanggal 
                            AND pred.rn = 1

                        ORDER BY base.Nama, base.Tanggal;
                        """
          
            cur.execute(query)
            rows = cur.fetchall()

            inserted_count = 0
            skipped_count = 0

            # 🔥 OPTIMIZATION 2: Batch insert dengan bulk insert
            batch_data = []
            batch_size = 100

            for row in rows:
                batch_data.append((
                    row["Nama"],
                    row["Tanggal"],
                    row["Kode_Shift"],
                    row["Jabatan"],
                    row["Departemen"],
                    row["id_karyawan"],
                    row["NIK"],
                    row["Jadwal_Masuk"],
                    row["Jadwal_Pulang"],
                    row["Actual_Masuk"],
                    row["Actual_Pulang"],
                    row["Prediksi_Shift"],
                    row["Prediksi_Actual_Masuk"],
                    row["Prediksi_Actual_Pulang"],
                    row["Probabilitas_Prediksi"],
                    row["Confidence_Score"],
                    row["Frekuensi_Shift_Historis"],
                    row["Status_Kehadiran"],
                    row["Status_Masuk"],
                    row["Status_Pulang"],
                ))
                if cur.rowcount == 1:
                    inserted_count += 1
                elif cur.rowcount == 2:
                    updated_count += 1


                # Insert dalam batch
                if len(batch_data) >= batch_size:
                    upsert_sql = """
                        INSERT INTO croscek_dw (
                            Nama, Tanggal, Kode_Shift,
                            Jabatan, Departemen,
                            id_karyawan, NIK,
                            Jadwal_Masuk, Jadwal_Pulang,
                            Actual_Masuk, Actual_Pulang,
                            Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang,
                            Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis,
                            Status_Kehadiran, Status_Masuk, Status_Pulang
                        ) VALUES (%s,%s,%s,%s,%s,
                                %s,%s,
                                %s,%s,
                                %s,%s,
                                %s,%s,%s,
                                %s,%s,%s,
                                %s,%s,%s)
                        ON DUPLICATE KEY UPDATE
                            Kode_Shift = VALUES(Kode_Shift),
                            Jabatan = VALUES(Jabatan),
                            Departemen = VALUES(Departemen),
                            id_karyawan = VALUES(id_karyawan),
                            NIK = VALUES(NIK),
                            Jadwal_Masuk = VALUES(Jadwal_Masuk),
                            Jadwal_Pulang = VALUES(Jadwal_Pulang),
                            Actual_Masuk = VALUES(Actual_Masuk),
                            Actual_Pulang = VALUES(Actual_Pulang),
                            Status_Kehadiran = VALUES(Status_Kehadiran),
                            Status_Masuk = VALUES(Status_Masuk),
                            Status_Pulang = VALUES(Status_Pulang)
                        """

                    for data in batch_data:
                        cur.execute(upsert_sql, data)

                    conn.commit()
                    batch_data = []

            # Insert sisa data
            if batch_data:
                upsert_sql = """
                    INSERT INTO croscek_dw (
                        Nama, Tanggal, Kode_Shift,
                        Jabatan, Departemen,
                        id_karyawan, NIK,
                        Jadwal_Masuk, Jadwal_Pulang,
                        Actual_Masuk, Actual_Pulang,
                        Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang,
                        Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis,
                        Status_Kehadiran, Status_Masuk, Status_Pulang
                    ) VALUES (%s,%s,%s,%s,%s,
                            %s,%s,
                            %s,%s,
                            %s,%s,
                            %s,%s,%s,
                            %s,%s,%s,
                            %s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                        Kode_Shift = VALUES(Kode_Shift),
                        Jabatan = VALUES(Jabatan),
                        Departemen = VALUES(Departemen),
                        id_karyawan = VALUES(id_karyawan),
                        NIK = VALUES(NIK),
                        Jadwal_Masuk = VALUES(Jadwal_Masuk),
                        Jadwal_Pulang = VALUES(Jadwal_Pulang),
                        Actual_Masuk = VALUES(Actual_Masuk),
                        Actual_Pulang = VALUES(Actual_Pulang),
                        Status_Kehadiran = VALUES(Status_Kehadiran),
                        Status_Masuk = VALUES(Status_Masuk),
                        Status_Pulang = VALUES(Status_Pulang)
                    """

                for data in batch_data:
                    cur.execute(upsert_sql, data)
                
                conn.commit()

            # Fetch data terbaru dari tabel croscek
            cur.execute("""
                SELECT
                    Nama,
                    Tanggal,
                    Kode_Shift,
                    Jabatan,
                    Departemen,
                    id_karyawan,
                    NIK,
                    Jadwal_Masuk,
                    Jadwal_Pulang,
                    Actual_Masuk,
                    Actual_Pulang,
                    Status_Kehadiran,
                    Status_Masuk,
                    Status_Pulang
                FROM croscek_dw
                ORDER BY Nama, Tanggal
            """)
            
            result_rows = cur.fetchall()

            # Convert TIME/DATE fields to strings
            for row in result_rows:
                if row['Jadwal_Masuk'] is not None:
                    row['Jadwal_Masuk'] = str(row['Jadwal_Masuk'])
                if row['Jadwal_Pulang'] is not None:
                    row['Jadwal_Pulang'] = str(row['Jadwal_Pulang'])
                if row['Actual_Masuk'] is not None:
                    row['Actual_Masuk'] = str(row['Actual_Masuk'])
                if row['Actual_Pulang'] is not None:
                    row['Actual_Pulang'] = str(row['Actual_Pulang'])
                if isinstance(row['Tanggal'], date):
                    row['Tanggal'] = str(row['Tanggal'])

            cur.close()
            conn.close()

            return jsonify({
                "data": result_rows,
                "summary": {
                    "total": len(rows),
                    "inserted": inserted_count,
                    "skipped": skipped_count,
                    "from_cache": False
                }
            })
        except Exception as e:
            print("ERROR CROSCEK:", e)
            return jsonify({"error": str(e)}), 500
        
    # ======================
    # SIMPAN / UPDATE DATA
    # ======================
    if request.method == "POST":
        try:
            data = request.json
            if not data:
                return jsonify({"error": "Payload kosong"}), 400

            insert_sql = """
            INSERT INTO croscek_dw (
                Nama, Tanggal, Kode_Shift, Jabatan, Departemen,
                id_karyawan, NIK,
                Jadwal_Masuk, Jadwal_Pulang,
                Actual_Masuk, Actual_Pulang,
                Prediksi_Shift, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang,
                Probabilitas_Prediksi, Confidence_Score, Frekuensi_Shift_Historis,
                Status_Kehadiran, Status_Masuk, Status_Pulang
            ) VALUES (
                %s,%s,%s,%s,%s,
                %s,%s,
                %s,%s,
                %s,%s,
                %s,%s,%s,
                %s,%s,%s,
                %s,%s,%s
            )
            ON DUPLICATE KEY UPDATE
                Kode_Shift       = VALUES(Kode_Shift),
                Jabatan          = VALUES(Jabatan),
                Departemen       = VALUES(Departemen),
                Jadwal_Masuk     = VALUES(Jadwal_Masuk),
                Jadwal_Pulang    = VALUES(Jadwal_Pulang),
                Actual_Masuk     = VALUES(Actual_Masuk),
                Actual_Pulang    = VALUES(Actual_Pulang),
                Status_Kehadiran = VALUES(Status_Kehadiran),
                Status_Masuk     = VALUES(Status_Masuk),
                Status_Pulang    = VALUES(Status_Pulang)
            """

            inserted = 0
            updated_rows = []
            inserted_data = []

            for row in data:

                raw_tgl = row["Tanggal"]

                if isinstance(raw_tgl, str):
                    try:
                        # ISO: 2024-11-01
                        tgl = datetime.fromisoformat(raw_tgl[:10]).date()
                    except:
                        try:
                            # JS Date: Sat, 01 Nov 2024
                            tgl = datetime.strptime(raw_tgl[:16], "%a, %d %b %Y").date()
                        except:
                            raise ValueError(f"Format tanggal tidak dikenali: {raw_tgl}")
                else:
                    tgl = raw_tgl

                cur.execute("""
                    SELECT Status_Kehadiran, Status_Masuk, Status_Pulang
                    FROM croscek_dw
                    WHERE id_karyawan=%s AND Tanggal=%s
                """, (row["id_karyawan"], tgl))

                old = cur.fetchone()
                changed_fields = []

                if old:
                    if old["Status_Kehadiran"] != row["Status_Kehadiran"]:
                        changed_fields.append("Status_Kehadiran")
                    if old["Status_Masuk"] != row["Status_Masuk"]:
                        changed_fields.append("Status_Masuk")
                    if old["Status_Pulang"] != row["Status_Pulang"]:
                        changed_fields.append("Status_Pulang")

                if old and not changed_fields:
                    continue  # 🔥 hemat DB

                cur.execute(insert_sql, (
                    row["Nama"],
                    tgl,
                    row["Kode_Shift"],
                    row["Jabatan"],
                    row["Departemen"],
                    row["id_karyawan"],
                    row["NIK"],
                    row["Jadwal_Masuk"],
                    row["Jadwal_Pulang"],
                    row["Actual_Masuk"],
                    row["Actual_Pulang"],
                    row["Prediksi_Shift"],
                    row["Prediksi_Actual_Masuk"],
                    row["Prediksi_Actual_Pulang"],
                    row["Probabilitas_Prediksi"],
                    row["Confidence_Score"],
                    row["Frekuensi_Shift_Historis"],
                    row["Status_Kehadiran"],
                    row["Status_Masuk"],
                    row["Status_Pulang"],
                ))

                if old and changed_fields:
                    updated_rows.append({
                        "Nama": row["Nama"],
                        "Tanggal": str(tgl),
                        "Fields": changed_fields
                    })

                inserted += 1

            conn.commit()

            # 🔥 AMBIL DATA TERBARU DARI DATABASE UNTUK DITAMPILKAN DI UI
            cur.execute("""
                SELECT
                    Nama,
                    Tanggal,
                    Kode_Shift,
                    Jabatan,
                    Departemen,
                    id_karyawan,
                    NIK,
                    Jadwal_Masuk,
                    Jadwal_Pulang,
                    Actual_Masuk,
                    Actual_Pulang,
                    Status_Kehadiran,
                    Status_Masuk,
                    Status_Pulang
                FROM croscek_dw
                ORDER BY Tanggal DESC, Nama ASC
            """)
            
            inserted_data = cur.fetchall()
            
            # Convert TIME/DATE fields to strings untuk JSON serialization
            for row in inserted_data:
                if row['Jadwal_Masuk'] is not None:
                    row['Jadwal_Masuk'] = str(row['Jadwal_Masuk'])
                if row['Jadwal_Pulang'] is not None:
                    row['Jadwal_Pulang'] = str(row['Jadwal_Pulang'])
                if row['Actual_Masuk'] is not None:
                    row['Actual_Masuk'] = str(row['Actual_Masuk'])
                if row['Actual_Pulang'] is not None:
                    row['Actual_Pulang'] = str(row['Actual_Pulang'])
                if isinstance(row['Tanggal'], date):
                    row['Tanggal'] = str(row['Tanggal'])

            cur.close()
            conn.close()

            return jsonify({
                "success": True,
                "total": len(data),
                "inserted": inserted,
                "updated": len(updated_rows),
                "updated_rows": updated_rows,
                "data": inserted_data
            })

        except Exception as e:
            conn.rollback()
            print("ERROR:", e)
            return jsonify({"error": str(e)}), 500

from datetime import datetime, date, timedelta
@app.route("/api/croscek-dw/final", methods=["GET"])
def get_croscek_dw_final():
    conn = db()
    cur = conn.cursor(dictionary=True)

    def serialize_row(row):
        result = {}
        for k, v in row.items():
            if isinstance(v, timedelta):
                total_seconds = int(v.total_seconds())
                hours = total_seconds // 3600
                minutes = (total_seconds % 3600) // 60
                seconds = total_seconds % 60
                result[k] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
            elif isinstance(v, (datetime, date)):
                result[k] = v.isoformat()
            else:
                result[k] = v
        return result

    try:
        cur.execute("""
            SELECT
                Nama,
                Tanggal,
                Kode_Shift,
                Jabatan,
                Departemen,
                id_karyawan,
                NIK,
                Jadwal_Masuk,
                Jadwal_Pulang,
                Actual_Masuk,
                Actual_Pulang,
                Status_Kehadiran,
                Status_Masuk,
                Status_Pulang
            FROM croscek_dw
            ORDER BY Tanggal, Nama
        """)

        rows = cur.fetchall()
        data = [serialize_row(row) for row in rows]

        return jsonify({
            "success": True,
            "data": data
        })

    except Exception as e:
        print("ERROR FETCH FINAL:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/karyawan-select")
def karyawan_select():
    try:
        conn = db()
        cur = conn.cursor(dictionary=True)

        cur.execute("""
            SELECT id_absen, nama
            FROM karyawan
            WHERE id_absen IS NOT NULL AND id_absen != ''
            ORDER BY nama ASC
        """)
        
        rows = cur.fetchall()
        cur.close()
        conn.close()

        result = [
            {
                "label": f"{r['nama']} - {r['id_absen']}",
                "value": r["id_absen"]
            }
            for r in rows
        ]

        return jsonify(result)
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/rekap-hod")
def rekap_hod():
    try:
        id_absen = request.args.get("id_absen")
        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")

        if not id_absen or not start_date or not end_date:
            return jsonify({"error": "Parameter tidak lengkap"}), 400

        conn = db()
        cur = conn.cursor(dictionary=True)

        query = """
            SELECT 
                k.id_absen,
                DATE_FORMAT(c.Tanggal, '%d-%m-%Y') AS tanggal,
                c.Nama AS nama,
                c.Jabatan AS jabatan,
                c.Departemen AS departemen,
                c.Kode_Shift AS shift,
                c.Actual_Masuk AS check_in,
                c.Actual_Pulang AS check_out,
                c.Status_Kehadiran AS status_kehadiran
            FROM croscek c
            JOIN karyawan k ON c.id_karyawan = k.id_karyawan
            WHERE k.id_absen = %s
            AND c.Tanggal BETWEEN %s AND %s
            ORDER BY c.Tanggal ASC, c.Actual_Masuk ASC
        """

        cur.execute(query, (id_absen, start_date, end_date))
        data = cur.fetchall()

        cur.close()
        conn.close()

        return jsonify(data)
    
    except Exception as e:
        print(f"Error in rekap_hod: {str(e)}")
        return jsonify({"error": str(e)}), 500




# # Helper function yang bikin error
# def parse_month_year(month_year_str):
#     dt = datetime.strptime(month_year_str, '%B %Y')
#     return dt.year, dt.month

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)