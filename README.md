# 🚀 Croscek Kehadiran Karyawan - Backend API

Backend REST API berbasis Flask & Python untuk manajemen data kehadiran karyawan dengan integrasi database PostgreSQL.

---

## 📋 Daftar Isi

### Getting Started
- [Tentang Aplikasi](#tentang-aplikasi)
- [Tools & Persyaratan](#tools--persyaratan)
- [Instalasi](#instalasi)
- [Konfigurasi Database](#konfigurasi-database)
- [Menjalankan Aplikasi](#menjalankan-aplikasi)

### Technical Documentation ⭐
- [Database Schema](#database-schema)
- [Business Logic & Croscek Algorithm](#business-logic--croscek-algorithm)
- [Excel Upload Format](#excel-upload-format)

### API & Implementation
- [Workflow Aplikasi](#workflow-aplikasi)
- [API Endpoints](#api-endpoints)
- [API Request/Response Examples](#api-requestresponse-examples)
- [Error Handling](#error-handling)

### Operations & Deployment
- [Struktur Folder](#struktur-folder)
- [Performance Optimization](#performance-optimization)
- [Security Best Practices](#security-best-practices)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## 💼 Tentang Aplikasi

### Guna & Manfaat
**Backend Croscek Kehadiran Karyawan** menyediakan:

✅ **REST API untuk Manajemen Kehadiran**
- CRUD operations untuk data kehadiran
- Real-time data processing
- Database PostgreSQL yang robust

✅ **Authentication & Authorization**
- JWT token-based authentication
- Role-based access control (Admin/Staff)
- User session management

✅ **Data Management**
- Karyawan database (NIK, nama, dept, jabatan)
- Jadwal kerja & shift management
- Kehadiran & absensi tracking

✅ **Business Logic**
- Automatic keterlambatan calculation
- Shift validation & mapping
- Data warehouse integration
- Report generation (Excel export)

✅ **Analytics & Reporting**
- Historical data tracking
- Trend analysis
- Department-based analytics
- Export to multiple formats

---

## 🛠 Tools & Persyaratan

### Tools yang Harus Disiapkan

| Tools | Version | Kegunaan |
|-------|---------|----------|
| **Python** | 3.10+ | Runtime |
| **pip** | Latest | Package manager |
| **PostgreSQL** | 12+ | Database |
| **Git** | Latest | Version control |
| **Postman/VS Code** | Latest | API testing (optional) |

### Dependensi Python Utama

```
Flask==3.0.0
Flask-CORS==4.0.0
python-dotenv==1.0.0
psycopg2-binary==2.9.9
SQLAlchemy==2.0.0
PyJWT==2.8.0
python-dateutil==2.8.2
openpyxl==3.1.0
```

---

## 📦 Instalasi

### 1. Clone Repository
```bash
cd d:\Magang\ Hub\croscek-absen
git clone <repository-url>
cd absen-backend
```

### 2. Buat Virtual Environment
```bash
# Windows
python -m venv venv
venv\Scripts\activate

# Linux/Mac
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

Jika `requirements.txt` belum ada, install manual:
```bash
pip install flask flask-cors python-dotenv psycopg2-binary sqlalchemy pyjwt python-dateutil openpyxl
```

### 4. Konfigurasi Environment
Buat file `.env` di root backend folder:

```env
# Flask Configuration
FLASK_APP=app.py
FLASK_ENV=development
DEBUG=True
SECRET_KEY=your-secret-key-here-change-in-production

# Database PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=croscek_db
DB_USER=postgres
DB_PASSWORD=your-db-password

# JWT Configuration
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRATION=86400

# CORS Configuration
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# API Configuration
API_PORT=5000
API_HOST=0.0.0.0
```

### 5. Setup Database
```bash
# Buat database PostgreSQL
createdb croscek_db

# Run SQL migrations
psql -U postgres -d croscek_db -f sql/01_create_users_table.sql
psql -U postgres -d croscek_db -f sql/Database_Croscek.sql
```

---

## 🗄️ DATABASE SCHEMA - Complete Reference

### Database Architecture

**Entity Relationship Diagram (ERD):**

```
┌─────────────────────────────────────────────────────────────────┐
│                    CROSCEK KEHADIRAN DATABASE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  users ──────────────────────────┐                             │
│  • id (PK)                       │                             │
│  • username (UNIQUE)             │                             │
│  • password (hashed)             │                             │
│  • is_admin                      │                             │
│  • is_active                     │                             │
│                                  │                             │
│                                  ▼                             │
│                          ┌────────────────────┐                │
│                          │ karyawan (Master)  │                │
│                          │ • id_karyawan (PK) │                │
│                          │ • nik (UNIQUE)     │                │
│                          │ • nama             │                │
│                          │ • departemen       │                │
│                          │ • jabatan          │                │
│                          │ • id_absen (PIN)   │◄───┐           │
│                          │ • kategori         │    │           │
│                          └────────┬───────────┘    │           │
│                                   │                │           │
│                                   │ 1:N            │           │
│                                   ▼                │           │
│                          ┌─────────────────────┐   │           │
│                          │ jadwal_karyawan     │   │           │
│                          │ • id (PK)           │   │           │
│                          │ • id_karyawan (FK)  │   │           │
│                          │ • kode_shift (FK)   │   │           │
│                          │ • tanggal           │   │           │
│                          │ • jam_masuk         │   │           │
│                          │ • jam_pulang        │   │           │
│                          └─────────┬───────────┘   │           │
│                                    │                │           │
│                                    │ N:1            │           │
│                                    ▼                │           │
│                          ┌──────────────────────┐   │           │
│                          │informasi_jadwal      │   │           │
│                          │• kode (PK)           │   │           │
│                          │• nama_shift          │   │           │
│                          │• jam_masuk           │   │           │
│                          │• jam_pulang          │   │           │
│                          │• lintas_hari         │   │           │
│                          └──────────────────────┘   │           │
│                                                     │           │
│  kehadiran_karyawan ──────────────────────────────┘           │
│  • id (PK)                                                     │
│  • nik (matches id_absen) ◄──┐                                │
│  • pin_masuk, jam_masuk       │                                │
│  • pin_pulang, jam_pulang     │                                │
│  • tanggal                    │                                │
│  • sumber                     ▼                                │
│                     ┌──────────────────┐                       │
│                     │ croscek (Results)│                       │
│                     │ • id (PK)        │                       │
│                     │ • id_karyawan(FK)│                       │
│                     │ • tanggal        │                       │
│                     │ • kode_shift     │                       │
│                     │ • status         │                       │
│                     │ • actual_masuk   │                       │
│                     │ • actual_pulang  │                       │
│                     │ • durasi_terlambat
│                     │ • shift_predicted│                       │
│                     └──────────────────┘                       │
│                                                                 │
│  croscek_dw ─────── (Daily Worker Version - Same Structure)   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 📋 8 Database Tables - Detailed Documentation

#### **1️⃣ users** - Authentication
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-increment user ID |
| username | VARCHAR(50) | UNIQUE, NOT NULL | Login username (min 5 chars) |
| password | VARCHAR(255) | NOT NULL | Bcrypt hashed (min 8 chars) |
| nama | VARCHAR(100) | - | Full name |
| is_admin | BOOLEAN | DEFAULT false | Admin role flag |
| is_active | BOOLEAN | DEFAULT true | Active/inactive status |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last update timestamp |

**Indexes:**
```sql
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_is_admin ON users(is_admin);
```

---

#### **2️⃣ karyawan** - Employee Master Data
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id_karyawan | SERIAL | PRIMARY KEY | Auto-increment employee ID |
| nik | VARCHAR(20) | UNIQUE, NOT NULL | National ID (for data matching) |
| nama | VARCHAR(100) | NOT NULL | Full name |
| departemen | VARCHAR(50) | - | Department name |
| jabatan | VARCHAR(100) | - | Job title |
| id_absen | VARCHAR(20) | - | Attendance machine PIN (for attendance matching) |
| kategori | VARCHAR(10) | DEFAULT 'karyawan' | Type: 'karyawan' or 'dw' (Daily Worker) |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation timestamp |

**Indexes:**
```sql
CREATE INDEX idx_karyawan_nik ON karyawan(nik);
CREATE INDEX idx_karyawan_kategori ON karyawan(kategori);
```

**Key Point:** `id_absen` used to match `kehadiran_karyawan.nik` records

---

#### **3️⃣ informasi_jadwal** - Shift Definitions
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| kode | VARCHAR(20) | PRIMARY KEY | Shift code (PAGI, SIANG, MALAM, etc) |
| nama_shift | VARCHAR(50) | NOT NULL | Shift name |
| jam_masuk | TIME | NOT NULL | Check-in time (HH:MM:SS) |
| jam_pulang | TIME | NOT NULL | Check-out time (HH:MM:SS) |
| lintas_hari | BOOLEAN | DEFAULT false | TRUE if shift crosses midnight (22:00→06:00) |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation timestamp |

**Example Data:**
```
kode  | nama_shift | jam_masuk | jam_pulang | lintas_hari
------|------------|-----------|------------|------------
PAGI  | Pagi       | 07:00     | 15:00      | false
SIANG | Siang      | 15:00     | 23:00      | false
MALAM | Malam      | 22:00     | 06:00      | true ⚠️
```

---

#### **4️⃣ jadwal_karyawan** - Employee Schedule Assignments
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Schedule assignment ID |
| id_karyawan | INT | FK → karyawan (CASCADE) | Employee reference |
| kode_shift | VARCHAR(20) | FK → informasi_jadwal | Shift reference |
| tanggal | DATE | NOT NULL | Date of assignment |
| jam_masuk | TIME | - | Override check-in time (null = use shift default) |
| jam_pulang | TIME | - | Override check-out time (null = use shift default) |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation timestamp |

**Indexes:**
```sql
CREATE INDEX idx_jadwal_karyawan_id_tanggal 
  ON jadwal_karyawan(id_karyawan, tanggal);
CREATE INDEX idx_jadwal_karyawan_kode_shift 
  ON jadwal_karyawan(kode_shift);
```

---

#### **5️⃣ kehadiran_karyawan** - Raw Attendance Records (from machines)
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Record ID |
| nik | VARCHAR(20) | NOT NULL | Employee ID from machine (matches karyawan.id_absen) |
| pin_masuk | VARCHAR(20) | - | Check-in PIN/ID |
| jam_masuk | TIMESTAMP | - | Check-in datetime |
| pin_pulang | VARCHAR(20) | - | Check-out PIN/ID |
| jam_pulang | TIMESTAMP | - | Check-out datetime |
| tanggal | DATE | NOT NULL | Attendance date |
| sumber | VARCHAR(50) | DEFAULT 'fingerprint' | Source device (fingerprint, rfid, manual, etc) |
| created_at | TIMESTAMP | DEFAULT NOW() | Record timestamp |

**Indexes:**
```sql
CREATE INDEX idx_kehadiran_nik_tanggal 
  ON kehadiran_karyawan(nik, tanggal);
CREATE INDEX idx_kehadiran_jam_masuk 
  ON kehadiran_karyawan(jam_masuk);
```

**Important:** `nik` must match `karyawan.id_absen` for correct employee linking

---

#### **6️⃣ shift_info** - Additional Shift Configuration
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| shift_id | SERIAL | PRIMARY KEY | Shift info ID |
| kode_shift | VARCHAR(20) | FK → informasi_jadwal | Shift reference |
| lintas_hari | BOOLEAN | - | Overnight shift flag |
| grace_period | INT | DEFAULT 10 | Grace period (minutes) before marking late |
| lateness_threshold | INT | DEFAULT 15 | Minutes late threshold for "Terlambat" status |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation timestamp |

---

#### **7️⃣ croscek** - Processed Attendance Results (Karyawan)
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Result ID |
| id_karyawan | INT | FK → karyawan (SET NULL) | Employee reference |
| tanggal | DATE | NOT NULL | Attendance date |
| kode_shift | VARCHAR(20) | FK → informasi_jadwal | Assigned shift |
| status | VARCHAR(30) | - | Status: Hadir \| Absen \| Terlambat \| Pulang Awal |
| actual_masuk | TIMESTAMP | - | Actual check-in time |
| actual_pulang | TIMESTAMP | - | Actual check-out time |
| durasi_terlambat | INT | - | Minutes late (only if Terlambat) |
| shift_predicted | VARCHAR(20) | - | Predicted alternative shift (if auto-corrected) |
| keterangan | TEXT | - | Notes/remarks |
| created_at | TIMESTAMP | DEFAULT NOW() | Generation timestamp |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last update timestamp |

**Indexes:**
```sql
CREATE INDEX idx_croscek_id_karyawan_tanggal 
  ON croscek(id_karyawan, tanggal);
CREATE INDEX idx_croscek_status ON croscek(status);
CREATE INDEX idx_croscek_tanggal ON croscek(tanggal);
```

**Status Values:**
- `Hadir` - Present on time
- `Absen` - Absent (no check-in record)
- `Terlambat` - Late arrival
- `Pulang Awal` - Early checkout

---

#### **8️⃣ croscek_dw** - Results (Daily Workers)
Same structure as `croscek` but for employees with kategori='dw'

---

### Foreign Key & Cascade Behavior

```sql
-- Delete karyawan → DELETE jadwal_karyawan & SET NULL in croscek
ALTER TABLE jadwal_karyawan 
ADD CONSTRAINT fk_jadwal_karyawan
FOREIGN KEY (id_karyawan) REFERENCES karyawan(id_karyawan) 
  ON DELETE CASCADE;

-- Delete shift → SET NULL in jadwal_karyawan & croscek
ALTER TABLE jadwal_karyawan
ADD CONSTRAINT fk_jadwal_shift
FOREIGN KEY (kode_shift) REFERENCES informasi_jadwal(kode) 
  ON DELETE SET NULL;

-- Delete kehadiran → no cascade (independent records)
-- Delete croscek → no cascade (historical records)
```

---

### Sample Data Flow

```
1. Upload Karyawan via Excel
   → INSERT INTO karyawan (nik, nama, departemen, id_absen, kategori)

2. Upload Shift/Jadwal
   → INSERT INTO informasi_jadwal (kode, nama_shift, jam_masuk, jam_pulang)
   → INSERT INTO jadwal_karyawan (id_karyawan, kode_shift, tanggal)

3. Upload Attendance from Machine
   → INSERT INTO kehadiran_karyawan (nik, jam_masuk, jam_pulang, tanggal)

4. Process Croscek (Matching & Calculation)
   → SELECT kehadiran WHERE nik matches karyawan.id_absen
   → Calculate status based on jadwal_karyawan + kehadiran
   → INSERT/UPDATE INTO croscek (status, actual_masuk, actual_pulang, etc)

5. Generate Analytics
   → SELECT FROM croscek + jadwal_karyawan + karyawan
   → Aggregate by departemen, tanggal, status
   → Return summary metrics
```

---

## 🧠 BUSINESS LOGIC & CROSCEK ALGORITHM

### High-Level 4-Phase Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: DATA COLLECTION                                  │
├─────────────────────────────────────────────────────────────┤
│ • Upload kehadiran_karyawan dari attendance machine         │
│ • Upload jadwal_karyawan dari HR system                    │
│ • Validate format & schema                                 │
│ • Store raw data in database                               │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: DATA NORMALIZATION                               │
├─────────────────────────────────────────────────────────────┤
│ • Clean PIN/NIK values (trim spaces, normalize)            │
│ • Match kehadiran.nik → karyawan.id_absen                 │
│ • Parse datetime strings to timestamps                     │
│ • Validate data types & ranges                             │
│ • Flag records with matching issues                        │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: CROSCEK PROCESSING (Core Business Logic)         │
├─────────────────────────────────────────────────────────────┤
│ For each jadwal_karyawan record:                            │
│                                                             │
│ 1. Lookup kehadiran records for matching nik & date        │
│ 2. Extract actual_masuk & actual_pulang                    │
│ 3. Calculate status (Hadir/Absen/Terlambat)               │
│ 4. Calculate durasi_terlambat if applicable               │
│ 5. Handle lintas_hari (overnight shifts)                  │
│ 6. Predict alternative shift if needed                     │
│ 7. Insert/update croscek table                             │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4: ANALYTICS & REPORTING                            │
├─────────────────────────────────────────────────────────────┤
│ • Aggregate croscek data by date/department                │
│ • Calculate KPI metrics (attendance rate, tardiness, etc)  │
│ • Generate trend analysis                                  │
│ • Export to Excel/PDF                                      │
└─────────────────────────────────────────────────────────────┘
```

---

### PIN Matching Algorithm

**Purpose:** Link attendance machine records to employee database

```
INPUT: kehadiran_karyawan.nik (e.g., "030")
PROCESS:
  1. SELECT * FROM karyawan WHERE id_absen = input_nik
  2. IF found → get id_karyawan
  3. IF NOT found → try fuzzy matching (edit distance)
  4. IF still NOT found → flag as "UNMATCHED"
OUTPUT: id_karyawan or NULL
```

**Example:**
```
kehadiran_karyawan.nik = "030"
    ↓ lookup
karyawan.id_absen = "030" ✓ MATCH
    ↓ return
karyawan.id_karyawan = 15
```

---

### Actual_Masuk Calculation (Check-in Logic)

**Multi-branch Decision Tree:**

```python
def calculate_actual_masuk(kehadiran, jadwal, shift_info):
    """
    Determine actual check-in time based on attendance records
    and schedule information
    """
    
    # Step 1: Check if kehadiran exists for date
    if not kehadiran:
        return None, "Absen"  # No attendance record = Absent
    
    # Step 2: Get schedule time (from jadwal or default from shift)
    if jadwal.jam_masuk:
        schedule_time = jadwal.jam_masuk
    else:
        schedule_time = shift_info.jam_masuk
    
    # Step 3: Get actual check-in from attendance machine
    actual_time = kehadiran.jam_masuk
    
    # Step 4: Handle lintas_hari (overnight shifts)
    if shift_info.lintas_hari:
        # Shift: 22:00 → 06:00 (crosses midnight)
        # If actual_time is between 00:00-06:00, it belongs to "next day"
        if actual_time.time() < datetime.time(6, 0):
            # Move to previous day
            actual_time = actual_time - timedelta(days=1)
    
    # Step 5: Calculate lateness
    grace_period = shift_info.grace_period or 10  # minutes
    lateness_threshold = shift_info.lateness_threshold or 15
    
    time_diff = (actual_time - schedule_time).total_seconds() / 60
    
    # Step 6: Determine status
    if time_diff <= grace_period:
        status = "Hadir"  # Within grace period
    elif time_diff <= lateness_threshold:
        status = "Hadir"  # Within threshold but logged as warning
    else:
        status = "Terlambat"  # Late
    
    return actual_time, status
```

**Possible Outcomes:**
- ✅ **Hadir** - Check-in before grace period
- 🟡 **Hadir (dengan warning)** - Check-in within lateness threshold
- 🟡 **Terlambat** - Check-in after lateness threshold
- 🔴 **Absen** - No check-in record found

---

### Actual_Pulang Calculation (Check-out Logic)

**Same logic as Actual_Masuk but for check-out:**

```python
def calculate_actual_pulang(kehadiran, jadwal, shift_info):
    """
    Determine actual check-out time
    """
    
    if not kehadiran:
        return None  # No attendance record
    
    # Get schedule checkout time
    if jadwal.jam_pulang:
        schedule_time = jadwal.jam_pulang
    else:
        schedule_time = shift_info.jam_pulang
    
    actual_time = kehadiran.jam_pulang
    
    # Handle lintas_hari for checkout
    if shift_info.lintas_hari:
        # If checkout is before 12:00, it's same date (early checkout)
        # If after 12:00, it's next day
        if actual_time.time() < datetime.time(12, 0):
            actual_time = actual_time + timedelta(days=1)
    
    # Check for early departure
    if actual_time < schedule_time:
        status = "Pulang Awal"
    else:
        status = "Pulang OK"
    
    return actual_time, status
```

---

### Status Determination Logic

**Final Status based on Both Masuk & Pulang:**

```
IF actual_masuk == NULL:
    status = "Absen" (completely absent)
ELIF actual_masuk.status == "Terlambat":
    status = "Terlambat"
    durasi_terlambat = (actual_masuk - schedule_masuk) in minutes
ELIF actual_pulang.status == "Pulang Awal":
    status = "Pulang Awal"
ELSE:
    status = "Hadir"
```

**Example Scenarios:**

| Scenario | Check-in | Check-out | Result | durasi_terlambat |
|----------|----------|-----------|--------|------------------|
| Normal | 07:05 | 15:00 | Hadir | - |
| Late | 08:30 | 15:00 | Terlambat | 90 min |
| No Show | - | - | Absen | - |
| Early Leave | 07:00 | 14:00 | Pulang Awal | - |
| Late & Leave Early | 08:30 | 14:00 | Terlambat | 90 min |

---

### Lintas Hari (Overnight Shift) Handling

**Challenge:** Shift 22:00→06:00 crosses midnight (next calendar day)

**Solution:**

```
SCHEDULE:       ATTENDANCE:           MATCHING:
Date: 2026-05-20    Date: 2026-05-20      ✓ Same date
22:00→06:00         22:00 (check-in)
                    
                    Date: 2026-05-21      ✓ Matches (normalized)
                    03:00 (check-out)     → Subtract 1 day → 2026-05-20 03:00
```

**Algorithm:**
```python
if shift_info.lintas_hari:
    # For check-in between 00:00-11:00, treat as previous day
    if jam_masuk.hour < 12:
        jam_masuk = jam_masuk - timedelta(days=1)
    
    # For check-out between 00:00-11:00, treat as same-day (next calendar)
    if jam_pulang.hour < 12:
        jam_pulang = jam_pulang + timedelta(days=1)
```

---

### Predictive Shift Inference

**When to use:** Employee absent from assigned shift but present in different time window

**Algorithm:**
```python
def predict_shift(actual_masuk_time, available_shifts):
    """
    Find shift that best matches actual check-in time
    """
    
    min_distance = float('inf')
    best_shift = None
    
    for shift in available_shifts:
        # Calculate distance between actual & shift time
        distance = abs((actual_masuk_time - shift.jam_masuk).total_seconds())
        
        if distance < min_distance:
            min_distance = distance
            best_shift = shift
    
    # Only suggest if within 2 hours
    if min_distance <= 7200:  # 2 hours in seconds
        return best_shift.kode
    else:
        return None
```

**Example:**
```
Assigned: PAGI (07:00-15:00)
Actual Check-in: 14:50
Available shifts:
  - PAGI: 07:00-15:00 (distance: 7h 50m) ✗
  - SIANG: 15:00-23:00 (distance: 10m) ✓ BEST MATCH

Result: shift_predicted = "SIANG"
```

---

### Complete Croscek Processing Example

**Scenario:** Employee ID 15, Date 2026-05-20, Assigned PAGI shift

```
1. SELECT jadwal_karyawan WHERE id_karyawan=15 AND tanggal='2026-05-20'
   Result: kode_shift=PAGI, jam_masuk=07:00, jam_pulang=15:00

2. SELECT informasi_jadwal WHERE kode='PAGI'
   Result: jam_masuk=07:00, jam_pulang=15:00, lintas_hari=false

3. SELECT kehadiran_karyawan WHERE id_absen=(SELECT id_absen FROM karyawan WHERE id_karyawan=15) AND tanggal='2026-05-20'
   Result: jam_masuk=08:30, jam_pulang=15:05

4. Calculate actual_masuk:
   - schedule_time = 07:00
   - actual_time = 08:30
   - time_diff = 90 minutes
   - status = "Terlambat" (exceeds threshold)
   - durasi_terlambat = 90

5. Calculate actual_pulang:
   - schedule_time = 15:00
   - actual_time = 15:05
   - status = "Pulang OK" (within tolerance)

6. Determine final status:
   - actual_masuk.status = "Terlambat" → FINAL STATUS = "Terlambat"

7. INSERT INTO croscek:
   id_karyawan=15
   tanggal='2026-05-20'
   kode_shift='PAGI'
   status='Terlambat'
   actual_masuk='2026-05-20 08:30'
   actual_pulang='2026-05-20 15:05'
   durasi_terlambat=90
   shift_predicted=NULL
```

---

## 📊 EXCEL UPLOAD FORMAT

### File Format Specifications

**Accepted Formats:**
- ✅ `.xlsx` (Microsoft Excel 2007+) - **Recommended**
- ✅ `.csv` (Comma-separated values)
- ❌ `.xls` (Old Excel format - not supported)

**File Size Limits:**
- Max: 10 MB per file
- Recommended: < 5 MB
- Estimated capacity: 10,000 rows per file

---

### 1️⃣ Karyawan Upload Format

**Template Columns (Required):**

| Column | Nama | Tipe | Format | Required | Notes |
|--------|------|------|--------|----------|-------|
| A | NAMA | String | Text | ✅ | Full name (max 100 chars) |
| B | NIK | String | Numeric | ✅ | Unique identifier (5-20 digits) |
| C | DEPARTEMEN | String | Text | ❌ | Department name |
| D | JABATAN | String | Text | ❌ | Job title |
| E | ID_ABSEN | String | Numeric | ✅ | Machine PIN (for attendance matching) |
| F | KATEGORI | String | 'karyawan' or 'dw' | ❌ | Employee type (default: 'karyawan') |

**Example Excel (Sheet 1):**
```
NAMA              | NIK  | DEPARTEMEN  | JABATAN         | ID_ABSEN | KATEGORI
------------------|------|-------------|-----------------|----------|----------
Ahmad Arif        | 0001 | IT          | Developer       | 030      | karyawan
Budi Santoso      | 0002 | HR          | Manager         | 031      | karyawan
Citra Dewi        | 0003 | Finance     | Accountant      | 032      | karyawan
Dani Kurniawan    | 0004 | Operations  | Staff           | 033      | dw
```

**Data Cleaning Rules:**
- ✅ Trim whitespace from all fields
- ✅ NIK: Remove leading zeros, validate numeric-only
- ✅ KATEGORI: Convert to lowercase, validate 'karyawan' or 'dw'
- ✅ Duplicate check: If NIK exists, UPDATE instead of INSERT
- ❌ Block: Missing NAMA or NIK fields
- ❌ Block: Duplicate NIK in same upload

**Upload Endpoint:**
```bash
POST /api/karyawan/upload
Content-Type: multipart/form-data

Body:
  file: [binary xlsx file]
```

**Response (Success):**
```json
{
  "status": "success",
  "message": "Upload sukses",
  "summary": {
    "total_rows": 4,
    "inserted": 3,
    "updated": 1,
    "errors": 0,
    "warnings": 0
  },
  "details": [
    {
      "row": 1,
      "nama": "Ahmad Arif",
      "action": "inserted",
      "id_karyawan": 1
    },
    {
      "row": 2,
      "nama": "Budi Santoso",
      "action": "inserted",
      "id_karyawan": 2
    },
    {
      "row": 4,
      "nama": "Dani Kurniawan",
      "action": "updated",
      "id_karyawan": 4,
      "previous_kategori": "karyawan",
      "new_kategori": "dw"
    }
  ]
}
```

**Response (Error):**
```json
{
  "status": "error",
  "message": "Format tidak sesuai",
  "errors": [
    {
      "row": 3,
      "column": "NIK",
      "error": "Duplikat NIK di baris 1 dan 3"
    },
    {
      "row": 5,
      "column": "NAMA",
      "error": "Field wajib diisi"
    }
  ]
}
```

---

### 2️⃣ Jadwal Upload Format

**Sheet 1: Shift Definitions**

| Column | Nama | Format | Required | Notes |
|--------|------|--------|----------|-------|
| A | KODE | String | ✅ | Shift code (PAGI, SIANG, MALAM) |
| B | NAMA_SHIFT | String | ✅ | Shift name |
| C | JAM_MASUK | Time | ✅ | HH:MM format (07:00) |
| D | JAM_PULANG | Time | ✅ | HH:MM format (15:00) |
| E | LINTAS_HARI | Boolean | ❌ | 'Y' or 'N' (default: 'N') |

**Example - Sheet 1 (Shifts):**
```
KODE  | NAMA_SHIFT | JAM_MASUK | JAM_PULANG | LINTAS_HARI
------|------------|-----------|------------|-------------
PAGI  | Pagi       | 07:00     | 15:00      | N
SIANG | Siang      | 15:00     | 23:00      | N
MALAM | Malam      | 22:00     | 06:00      | Y
```

**Sheet 2: Employee Schedule Assignments**

| Column | Nama | Format | Required | Notes |
|--------|------|--------|----------|-------|
| A | NIK | String | ✅ | Must match karyawan.nik |
| B | TANGGAL | Date | ✅ | YYYY-MM-DD format |
| C | KODE_SHIFT | String | ✅ | Must match informasi_jadwal.kode |
| D | JAM_MASUK_OVERRIDE | Time | ❌ | Optional override |
| E | JAM_PULANG_OVERRIDE | Time | ❌ | Optional override |

**Example - Sheet 2 (Assignments):**
```
NIK  | TANGGAL    | KODE_SHIFT | JAM_MASUK_OVERRIDE | JAM_PULANG_OVERRIDE
-----|------------|------------|-------------------|--------------------
0001 | 2026-05-20 | PAGI       | (empty)            | (empty)
0002 | 2026-05-20 | SIANG      | (empty)            | (empty)
0003 | 2026-05-20 | MALAM      | (empty)            | (empty)
0001 | 2026-05-21 | PAGI       | 07:30              | 15:30
```

**Upload Endpoint:**
```bash
POST /api/jadwal/upload
Content-Type: multipart/form-data

Body:
  file: [binary xlsx with 2 sheets]
```

---

### 3️⃣ Kehadiran (Attendance) Upload Format

**Column Requirements:**

| Column | Nama | Format | Required | Notes |
|--------|------|--------|----------|-------|
| A | NIK | String | ✅ | Employee ID from machine (must match id_absen) |
| B | PIN_MASUK | String | ❌ | Check-in PIN (usually same as NIK) |
| C | JAM_MASUK | DateTime | ✅ | YYYY-MM-DD HH:MM:SS or YYYY-MM-DD HH:MM |
| D | PIN_PULANG | String | ❌ | Check-out PIN |
| E | JAM_PULANG | DateTime | ✅ | YYYY-MM-DD HH:MM:SS |
| F | SUMBER | String | ❌ | Source device (default: 'fingerprint') |

**Example Excel:**
```
NIK  | PIN_MASUK | JAM_MASUK           | PIN_PULANG | JAM_PULANG          | SUMBER
-----|-----------|---------------------|-----------|---------------------|----------
030  | 030       | 2026-05-20 07:05:00 | 030       | 2026-05-20 15:02:00 | fingerprint
031  | 031       | 2026-05-20 08:30:00 | 031       | 2026-05-20 15:05:00 | fingerprint
032  | 032       | 2026-05-20 06:55:00 | 032       | 2026-05-20 14:55:00 | fingerprint
033  | 033       | (empty)             | (empty)   | (empty)             | (empty)
```

**Data Cleaning Rules:**
- ✅ Normalize datetime: Remove milliseconds, standardize format
- ✅ Validate NIK exists in karyawan.id_absen
- ✅ Validate datetime format (ISO 8601: YYYY-MM-DD HH:MM:SS)
- ✅ Validate JAM_MASUK < JAM_PULANG (if both present)
- ❌ Block: Missing JAM_MASUK date portion
- ⚠️ Warn: NIK not found in karyawan table (will be skipped)

**Upload Endpoint:**
```bash
POST /api/kehadiran/upload
Content-Type: multipart/form-data

Body:
  file: [binary xlsx file]
```

**Response (Success):**
```json
{
  "status": "success",
  "message": "Attendance upload berhasil",
  "summary": {
    "total_rows": 4,
    "inserted": 3,
    "skipped": 1,
    "errors": 0
  },
  "skipped_details": [
    {
      "row": 4,
      "nik": "033",
      "reason": "Jam masuk/pulang kosong"
    }
  ]
}
```

---

### Datetime Format Guidelines

**Supported Formats:**

```
✅ ISO 8601:     2026-05-20 07:00:00
✅ ISO 8601:     2026-05-20T07:00:00
✅ Excel Date:   5/20/2026 7:00:00 AM (auto-convert)
✅ Date only:    2026-05-20 (use 00:00:00 as time)

❌ European:     20/05/2026 07:00:00 (ambiguous)
❌ US Short:     05/20/26 (ambiguous year)
❌ Without date: 07:00:00 (missing date)
```

**Best Practice:** Always use YYYY-MM-DD HH:MM:SS format

---

### Download Templates

**Available endpoints:**

```bash
GET /api/karyawan/template          # Download Karyawan template
GET /api/jadwal/template            # Download Jadwal template  
GET /api/kehadiran/template         # Download Kehadiran template
```

Each template includes:
- Column headers with data types
- 3-5 example rows
- Validation notes
- Color coding for required fields

---



### Development Mode
```bash
# Aktifkan virtual environment terlebih dahulu
python app.py
```

Server akan berjalan di: `http://localhost:5000`

### Production Mode (Gunicorn)
```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### Testing API Endpoints
```bash
# Gunakan Postman atau curl
curl -X GET http://localhost:5000/api/karyawan
```

---

## � Technical Documentation

### 🎯 Core Documentation Files

Sistem Croscek memiliki dokumentasi teknis komprehensif yang terbagi menjadi 3 file utama:

#### 1. **[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)** - Complete Database Reference
Database documentation lengkap dengan:
- **ERD (Entity Relationship Diagram)** - Visualisasi relasi antar tabel
- **8 Table Definitions** - users, karyawan, jadwal, jadwal_karyawan, kehadiran, shift_info, croscek, croscek_dw
- **Field Specifications** - Tipe data, constraints, validasi untuk setiap field
- **Foreign Keys & Relationships** - Hubungan antar tabel dengan ON DELETE behavior
- **Unique Constraints** - Prevent duplikasi data
- **Indexing Strategy** - Query optimization recommendations
- **Data Flow Diagram** - Aliran data dari input hingga hasil croscek

✅ **Use this when:**
- Memahami struktur database
- Setup database baru
- Troubleshoot data issues
- Optimize queries

#### 2. **[BUSINESS_LOGIC.md](./BUSINESS_LOGIC.md)** - Croscek Algorithm & Core Logic
Dokumentasi algoritma dan business rules:
- **High-Level Workflow** - 4 fase: Collection → Normalization → Processing → Analytics
- **PIN Matching Algorithm** - Cara mencocokkan attendance machine records ke employee database
- **Actual_Masuk Calculation** - Multi-branch decision tree untuk find check-in time
- **Actual_Pulang Calculation** - Similar logic untuk check-out time
- **Status Determination** - Logika penentuan: Hadir/Absen/Terlambat/Pulang Awal
- **Lintas Hari (Overnight Shifts)** - Special handling untuk shift yang melewati tengah malam
- **Predictive Shift Inference** - Machine learning untuk prediksi shift alternatif
- **Performance Optimization** - Time/space complexity, scalability recommendations
- **Troubleshooting Guide** - Solusi untuk common issues

✅ **Use this when:**
- Memahami cara kerja croscek
- Debug attendance matching issues
- Optimize algorithm performance
- Extend dengan business rules baru

#### 3. **[EXCEL_UPLOAD_FORMAT.md](./EXCEL_UPLOAD_FORMAT.md)** - Data Input Specifications
Panduan lengkap untuk upload data via Excel:
- **Karyawan/DW Upload** - Format kolom (NAMA, NIK, JABATAN, DEPT, ID ABSEN), data cleaning rules, insert vs update logic
- **Jadwal Upload** - Shift definitions + employee schedule assignments, lintas hari detection
- **Kehadiran Upload** - Raw attendance records, PIN matching, datetime normalization
- **Upload Response Examples** - Status codes, error messages, success metrics
- **Troubleshooting** - Common errors & solutions
- **API Endpoints** - POST /api/karyawan/upload, /api/jadwal/upload, /api/kehadiran/upload
- **Templates** - Downloadable Excel templates dengan sample data

✅ **Use this when:**
- Preparing Excel files untuk upload
- Troubleshoot upload errors
- Integrating data dari external systems
- Setting up bulk data import

---

## �🔄 Workflow Aplikasi

### 1️⃣ User Authentication
```
┌─────────────────────────────┐
│   POST /api/auth/login      │
├─────────────────────────────┤
│ Input: email, password      │
│ Output: JWT token, user     │
└──────────┬──────────────────┘
           │
           ├─→ Token stored in localStorage (frontend)
           ├─→ Used for subsequent API calls
           └─→ Token expires after 24 hours
```

### 2️⃣ Data Management Flow
```
┌──────────────────────────┐
│  Frontend Upload File    │
└──────────┬───────────────┘
           │
           ├─→ Send to Backend API
           │
           ├─→ Parse & Validate Data
           │
           ├─→ Transform Format
           │
           ├─→ Save to PostgreSQL
           │
           └─→ Return Success/Error Response
```

### 3️⃣ Croscek Processing
```
┌──────────────────────────┐
│  Upload Attendance Data  │
└──────────┬───────────────┘
           │
           ├─→ Validate Format
           │
           ├─→ Map dengan Schedule
           │
           ├─→ Calculate Lateness
           │   ├─ Jam masuk > schedule jam masuk?
           │   ├─ Set status "Terlambat"
           │   └─ Calculate duration
           │
           ├─→ Determine Absence Status
           │   ├─ Hadir/Terlambat
           │   ├─ Izin/Sakit
           │   └─ Alpha
           │
           ├─→ Save Results
           │
           └─→ Generate Report
```

### 4️⃣ Analytics Processing
```
┌────────────────────────┐
│  Request Analytics     │
└────────────┬───────────┘
             │
             ├─→ Query Database
             │
             ├─→ Aggregate Data
             │   ├─ Total hadir
             │   ├─ Total terlambat
             │   ├─ By department
             │   └─ By date range
             │
             ├─→ Calculate Metrics
             │
             └─→ Return JSON Response
```

---

## � Workflow Aplikasi

### 1️⃣ User Authentication
```
┌─────────────────────────────┐
│   POST /api/auth/login      │
├─────────────────────────────┤
│ Input: email, password      │
│ Output: JWT token, user     │
└──────────┬──────────────────┘
           │
           ├─→ Token stored in localStorage (frontend)
           ├─→ Used for subsequent API calls
           └─→ Token expires after 24 hours
```

### 2️⃣ Data Management Flow
```
┌──────────────────────────┐
│  Frontend Upload File    │
└──────────┬───────────────┘
           │
           ├─→ Send to Backend API
           │
           ├─→ Parse & Validate Data
           │
           ├─→ Transform Format
           │
           ├─→ Save to PostgreSQL
           │
           └─→ Return Success/Error Response
```

### 3️⃣ Croscek Processing
```
┌──────────────────────────┐
│  Upload Attendance Data  │
└──────────┬───────────────┘
           │
           ├─→ Validate Format
           │
           ├─→ Map dengan Schedule
           │
           ├─→ Calculate Lateness
           │   ├─ Jam masuk > schedule jam masuk?
           │   ├─ Set status "Terlambat"
           │   └─ Calculate duration
           │
           ├─→ Determine Absence Status
           │   ├─ Hadir/Terlambat
           │   ├─ Izin/Sakit
           │   └─ Alpha
           │
           ├─→ Save Results
           │
           └─→ Generate Report
```

### 4️⃣ Analytics Processing
```
┌────────────────────────┐
│  Request Analytics     │
└────────────┬───────────┘
             │
             ├─→ Query Database
             │
             ├─→ Aggregate Data
             │   ├─ Total hadir
             │   ├─ Total terlambat
             │   ├─ By department
             │   └─ By date range
             │
             ├─→ Calculate Metrics
             │
             └─→ Return JSON Response
```

---

## 📡 API ENDPOINTS - Complete Reference

### 🔐 Authentication Endpoints

#### 1️⃣ **POST /api/auth/login**
User login dengan credentials

**Request:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "stafsariater2026",
    "password": "staf12345"
  }'
```

**Response (Success - 200):**
```json
{
  "status": "success",
  "message": "Login berhasil",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "stafsariater2026",
    "nama": "Staff Sariater",
    "is_admin": true
  }
}
```

---

#### 2️⃣ **POST /api/auth/register**
Register admin account (admin only)

**Request:**
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "username": "admin2",
    "password": "newpassword123",
    "nama": "Admin User"
  }'
```

**Response (Success - 201):**
```json
{
  "status": "success",
  "message": "User berhasil dibuat",
  "user": {
    "id": 5,
    "username": "admin2",
    "nama": "Admin User",
    "is_admin": true
  }
}
```

---

### 👥 Karyawan Endpoints

#### 3️⃣ **GET /api/karyawan** (paginated)
List semua employees

**Request:**
```bash
curl -X GET "http://localhost:5000/api/karyawan?page=1&limit=10" \
  -H "Authorization: Bearer {token}"
```

**Response (200):**
```json
{
  "status": "success",
  "data": [
    {
      "id_karyawan": 1,
      "nik": "0001",
      "nama": "Ahmad Arif",
      "departemen": "IT",
      "jabatan": "Developer",
      "id_absen": "030",
      "kategori": "karyawan"
    }
  ],
  "pagination": {
    "page": 1,
    "total": 150
  }
}
```

---

#### 4️⃣ **POST /api/karyawan/upload**
Upload karyawan via Excel

**Request:**
```bash
curl -X POST http://localhost:5000/api/karyawan/upload \
  -H "Authorization: Bearer {token}" \
  -F "file=@karyawan.xlsx"
```

**Response (201):**
```json
{
  "status": "success",
  "summary": {
    "total_rows": 4,
    "inserted": 3,
    "updated": 1,
    "errors": 0
  }
}
```

---

### 📅 Jadwal Endpoints

#### 5️⃣ **POST /api/jadwal/upload**
Upload jadwal & shift assignments

**Request:**
```bash
curl -X POST http://localhost:5000/api/jadwal/upload \
  -H "Authorization: Bearer {token}" \
  -F "file=@jadwal.xlsx"
```

---

### 📊 Croscek Endpoints

#### 6️⃣ **POST /api/croscek/upload**
Upload attendance & process croscek

**Request:**
```bash
curl -X POST http://localhost:5000/api/croscek/upload \
  -H "Authorization: Bearer {token}" \
  -F "file=@attendance.xlsx"
```

**Response (201):**
```json
{
  "status": "success",
  "summary": {
    "processed": 150,
    "hadir": 145,
    "terlambat": 4,
    "absen": 1
  }
}
```

---

#### 7️⃣ **GET /api/croscek/results**
Get croscek results (paginated)

**Request:**
```bash
curl -X GET "http://localhost:5000/api/croscek/results?page=1&status=Terlambat" \
  -H "Authorization: Bearer {token}"
```

**Response (200):**
```json
{
  "status": "success",
  "data": [
    {
      "id": 1,
      "nama": "Ahmad Arif",
      "tanggal": "2026-05-20",
      "status": "Terlambat",
      "actual_masuk": "2026-05-20T08:30:00",
      "durasi_terlambat": 90
    }
  ],
  "pagination": {
    "page": 1,
    "total": 456
  }
}
```

---

### 📈 Analytics Endpoints

#### 8️⃣ **GET /api/analytics/summary**
Get attendance summary metrics

**Request:**
```bash
curl -X GET "http://localhost:5000/api/analytics/summary" \
  -H "Authorization: Bearer {token}"
```

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "attendance_rate": 93.5,
    "tardiness_rate": 5.2,
    "absence_rate": 1.3,
    "top_latecomers": [
      {
        "nama": "Citra Dewi",
        "tardiness_count": 12,
        "avg_minutes": 25
      }
    ]
  }
}
```

---

#### 9️⃣ **GET /api/analytics/daily**
Daily attendance trends (last 30 days)

**Request:**
```bash
curl -X GET "http://localhost:5000/api/analytics/daily?limit=30" \
  -H "Authorization: Bearer {token}"
```

---

## ❌ ERROR HANDLING

### HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | OK | Success |
| 201 | Created | Resource created |
| 400 | Bad Request | Invalid format |
| 401 | Unauthorized | Missing token |
| 403 | Forbidden | Not admin |
| 404 | Not Found | Resource missing |
| 409 | Conflict | Duplicate NIK |
| 500 | Server Error | Internal error |

---

### Common Error Codes

| Code | HTTP | Cause | Solution |
|------|------|-------|----------|
| INVALID_CREDENTIALS | 401 | Wrong password | Check credentials |
| TOKEN_EXPIRED | 401 | Token expired (24h) | Re-login |
| UNAUTHORIZED | 403 | Not admin | Use admin account |
| DUPLICATE_NIK | 409 | NIK exists | Use different NIK |
| VALIDATION_ERROR | 422 | Field invalid | Check field values |
| DATABASE_ERROR | 500 | Query error | Check logs |

---

## 🔒 SECURITY BEST PRACTICES

### Authentication
✅ JWT token-based (24h expiration)
✅ Password hashed with bcrypt (min 8 chars)
✅ Role-based access control (Admin/Staff)
✅ Verify token on every request

---

### Data Protection
✅ HTTPS/TLS required in production
✅ CORS configured for known origins only
✅ SQL injection prevention (parameterized queries)
✅ Input validation & sanitization
✅ Sensitive data never logged
✅ Secrets stored in environment variables

---

## ⚡ PERFORMANCE OPTIMIZATION

### Database
✅ **Indexes** (8 composite indexes for fast queries)
✅ **Batch processing** (1000 records/batch)
✅ **Pagination** (max 100 records per page)
✅ **Connection pooling** (reuse database connections)

---

### Caching
✅ Shift definitions cached (refresh hourly)
✅ Employee list cached (refresh daily)
✅ Analytics cached (TTL: 1 hour)

---

### Monitoring
✅ Structured logging with context
✅ Track API response times
✅ Alert if response > 2000ms
✅ Health check endpoint: `GET /api/health`

---



---

## 📁 Struktur Folder

```
absen-backend/
├── src/
│   ├── config/
│   │   └── supabase.js             # Database connection
│   ├── controllers/
│   │   ├── authController.js       # Auth logic
│   │   ├── karyawanController.js   # Employee management
│   │   ├── jadwalController.js     # Schedule management
│   │   ├── jadwalkaryawanController.js  # Employee schedule
│   │   ├── kehadiranController.js  # Attendance management
│   │   ├── croscekController.js    # Croscek processing
│   │   └── analyticsController.js  # Analytics & reporting
│   ├── middleware/
│   │   ├── auth.js                 # JWT middleware
│   │   └── errorHandler.js         # Error handling
│   ├── routes/
│   │   ├── auth.js
│   │   ├── karyawan.js
│   │   ├── jadwal.js
│   │   ├── kehadiran.js
│   │   ├── croscek.js
│   │   └── analytics.js
│   └── utils/
│       └── cleansing.js            # Data cleaning utilities
├── sql/
│   ├── 01_create_users_table.sql
│   ├── 02_seed_users.sql
│   ├── Database_Croscek.sql
│   ├── croscek_postgres_full_view.sql
│   └── sp_croscek_generate.sql
├── api/
│   └── index.js                    # Vercel serverless entry
├── app.py                          # Main Flask app
├── package.json
├── .env.example
├── .gitignore
├── requirements.txt
└── README.md
```

---

## 🌐 Deployment

### Deploy ke Vercel (Recommended untuk Serverless)

#### 1. Setup Vercel Deployment
```bash
# Pastikan sudah ada api/index.js yang export Flask app
npm install -g vercel
vercel login
```

#### 2. Configure vercel.json
```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "api/index.js"
    }
  ],
  "env": {
    "DB_HOST": "@db_host",
    "DB_USER": "@db_user",
    "DB_PASSWORD": "@db_password",
    "DB_NAME": "@db_name"
  }
}
```

#### 3. Deploy
```bash
git push
# Vercel will auto-deploy on push
```

### Deploy Lokal (Production)
```bash
# Install gunicorn
pip install gunicorn

# Run with gunicorn (4 workers)
gunicorn -w 4 -b 0.0.0.0:5000 app:app

# Or use production server
python -m flask run --host=0.0.0.0 --port=5000
```

### Environment Variables untuk Production
```env
FLASK_ENV=production
DEBUG=False
SECRET_KEY=<strong-secret-key>
JWT_SECRET=<jwt-secret>
DB_HOST=<postgresql-host>
DB_USER=<db-user>
DB_PASSWORD=<db-password>
CORS_ORIGINS=https://yourdomain.com
```

---

## 🔐 Security Best Practices

### 1. Authentication
- ✅ Use JWT tokens with expiration
- ✅ Hash passwords with bcrypt
- ✅ Validate token pada setiap request

### 2. Database
- ✅ Use parameterized queries
- ✅ Validate input data
- ✅ Implement SQL injection prevention

### 3. API
- ✅ Enable CORS selectively
- ✅ Rate limiting on endpoints
- ✅ Log security events

### 4. Secrets
- ✅ Never commit `.env` file
- ✅ Use environment variables
- ✅ Rotate secrets regularly

---

## 🐛 Troubleshooting

### Error: "could not connect to server"
**Solusi**: 
- Pastikan PostgreSQL running
- Check DB_HOST, DB_PORT di .env
- Verify database exists: `createdb croscek_db`

### Error: "No module named 'flask'"
**Solusi**:
```bash
pip install -r requirements.txt
# atau manual
pip install flask flask-cors
```

### Port 5000 sudah digunakan
```bash
# Gunakan port lain
python app.py --port=5001
```

### CORS Error saat request dari frontend
**Solusi**: Di app.py tambahkan
```python
CORS(app, 
  origins=["http://localhost:5173", "https://yourdomain.com"],
  supports_credentials=True
)
```

### Database connection timeout
```python
# Increase connection timeout di src/config/supabase.js
connect_timeout=10
```

---

## 📊 Database Queries Useful

```sql
-- Total kehadiran hari ini
SELECT COUNT(*) FROM kehadiran WHERE DATE(tanggal) = CURRENT_DATE;

-- Top latecomers
SELECT nik, COUNT(*) as total_terlambat 
FROM kehadiran 
WHERE status = 'Terlambat' 
GROUP BY nik 
ORDER BY total_terlambat DESC 
LIMIT 10;

-- Department summary
SELECT departemen, COUNT(*) as total_karyawan
FROM karyawan
GROUP BY departemen;

-- Attendance trend by date
SELECT tanggal, status, COUNT(*) as count
FROM kehadiran
GROUP BY tanggal, status
ORDER BY tanggal;
```

---

## 📞 Support & Kontribusi

- 📧 Email: backend-support@yourdomain.com
- 🐛 Report bugs: GitHub Issues
- 💡 Feature request: Discussions

---

## 📄 License

MIT License © 2026

---

## 📝 Changelog

### v1.0.0 (Current)
- ✅ REST API endpoints
- ✅ JWT authentication
- ✅ Database integration
- ✅ Croscek processing logic
- ✅ Analytics endpoints
- ✅ Excel export functionality

---

**Last Updated**: April 2026
**Maintained By**: Ahmad Arif
