-- ============================================
-- USERS TABLE - Untuk authentication & role management
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    -- UUID dari Supabase Auth (auto-linked)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Username untuk login (email tidak perlu)
    username VARCHAR(100) NOT NULL UNIQUE,
    
    -- Password hash (bcrypt) - optional, untuk backup/audit
    password_hash VARCHAR(255),
    
    -- User info
    nama VARCHAR(100) NOT NULL,
    
    -- Role-based access control
    -- admin = semua akses
    -- staff = hanya bisa lihat croscek dan karyawan dw
    role VARCHAR(20) NOT NULL DEFAULT 'staff' 
        CHECK (role IN ('admin', 'staff')),
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE (username)
);

-- ============================================
-- Create indexes untuk queries cepat
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================
-- Trigger untuk update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_users_updated_at ON users;
CREATE TRIGGER trigger_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_users_updated_at();

-- ============================================
-- RLS (Row Level Security) - DISABLED untuk development
-- Enable di production jika diperlukan
-- ============================================
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- NOTE: Backend menggunakan Supabase Service Role (authenticated)
-- Jadi RLS policy tidak perlu karena sudah trusted.
-- Uncomment di bawah jika mau enable RLS di production:

/*
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Admin bisa lihat semua users
CREATE POLICY "Admin can view all users"
ON users FOR SELECT
USING (
    auth.uid() IN (
        SELECT id FROM users WHERE role = 'admin'
    )
);

-- User bisa lihat data diri sendiri
CREATE POLICY "Users can view their own data"
ON users FOR SELECT
USING (auth.uid() = id);

-- Admin bisa update semua users
CREATE POLICY "Admin can update all users"
ON users FOR UPDATE
USING (
    auth.uid() IN (
        SELECT id FROM users WHERE role = 'admin'
    )
);

-- User hanya bisa update data diri sendiri
CREATE POLICY "Users can update their own data"
ON users FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (
    -- User tidak boleh ubah role atau is_active (hanya admin)
    role = (SELECT role FROM users WHERE id = auth.uid())
    AND is_active = (SELECT is_active FROM users WHERE id = auth.uid())
);

-- Admin bisa delete users
CREATE POLICY "Admin can delete users"
ON users FOR DELETE
USING (
    auth.uid() IN (
        SELECT id FROM users WHERE role = 'admin'
    )
);
*/
