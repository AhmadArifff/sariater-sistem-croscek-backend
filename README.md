# 🚀 Croscek Kehadiran Karyawan - Backend API

Backend REST API berbasis Flask & Python untuk manajemen data kehadiran karyawan dengan integrasi database PostgreSQL.

---

## 📋 Daftar Isi
- [Tentang Aplikasi](#tentang-aplikasi)
- [Tools & Persyaratan](#tools--persyaratan)
- [Instalasi](#instalasi)
- [Konfigurasi Database](#konfigurasi-database)
- [Menjalankan Aplikasi](#menjalankan-aplikasi)
- [Workflow Aplikasi](#workflow-aplikasi)
- [API Endpoints](#api-endpoints)
- [Struktur Folder](#struktur-folder)
- [Deployment](#deployment)

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

## 🗄️ Konfigurasi Database

### Struktur Database

```sql
-- Tabel Utama
├── users                    # User login
├── karyawan                 # Data karyawan
├── jadwal                   # Jadwal kerja
├── jadwal_karyawan          # Jadwal per karyawan
├── kehadiran                # Data kehadiran
└── croscek_result           # Hasil croscek
```

### Connection String PostgreSQL
```python
# Di src/config/supabase.js atau .env
DATABASE_URL=postgresql://postgres:password@localhost:5432/croscek_db
```

### Seed Data
```bash
# Import sample data
psql -U postgres -d croscek_db -f sql/02_seed_users.sql
```

---

## 🚀 Menjalankan Aplikasi

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

## 🔄 Workflow Aplikasi

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

## 📡 API Endpoints

### Authentication
```
POST   /api/auth/login              # Login user
POST   /api/auth/register           # Register admin
POST   /api/auth/logout             # Logout (optional)
POST   /api/auth/refresh-token      # Refresh JWT token
```

### Karyawan (Employees)
```
GET    /api/karyawan                # Get all employees
GET    /api/karyawan/<id>           # Get employee detail
POST   /api/karyawan                # Create employee
PUT    /api/karyawan/<id>           # Update employee
DELETE /api/karyawan/<id>           # Delete employee
GET    /api/karyawan/search?q=      # Search by NIK/name
```

### Jadwal (Schedule)
```
GET    /api/jadwal                  # Get all schedules
GET    /api/jadwal/<id>             # Get schedule detail
POST   /api/jadwal                  # Create schedule
PUT    /api/jadwal/<id>             # Update schedule
DELETE /api/jadwal/<id>             # Delete schedule
GET    /api/informasi-jadwal/list   # Get shift info
```

### Jadwal Karyawan (Employee Schedule)
```
GET    /api/jadwal-karyawan/list    # Get all employee schedules
GET    /api/jadwal-karyawan/<id>    # Get detail
POST   /api/jadwal-karyawan         # Create assignment
PUT    /api/jadwal-karyawan/<id>    # Update assignment
DELETE /api/jadwal-karyawan/<id>    # Delete assignment
```

### Kehadiran (Attendance)
```
GET    /api/kehadiran               # Get all attendance
GET    /api/kehadiran/<id>          # Get detail
POST   /api/kehadiran               # Create attendance
PUT    /api/kehadiran/<id>          # Update attendance
DELETE /api/kehadiran/<id>          # Delete attendance
GET    /api/kehadiran/date/<date>   # Get by date
```

### Croscek
```
POST   /api/croscek/upload          # Upload & process attendance
GET    /api/croscek/results         # Get croscek results
GET    /api/croscek/results/<id>    # Get result detail
POST   /api/croscek/export          # Export to Excel
```

### Analytics
```
GET    /api/analytics/summary       # Get summary stats
GET    /api/analytics/daily         # Daily trends
GET    /api/analytics/monthly       # Monthly trends
GET    /api/analytics/department    # Department breakdown
GET    /api/analytics/top-latecomers # Top latecomers list
```

### User Management (Admin Only)
```
GET    /api/users                   # Get all users
GET    /api/users/<id>              # Get user detail
POST   /api/users                   # Create user
PUT    /api/users/<id>              # Update user
DELETE /api/users/<id>              # Delete user
```

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
**Maintained By**: Backend Team
