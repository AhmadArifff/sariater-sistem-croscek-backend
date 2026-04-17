import { supabase } from '../config/supabase.js';

/**
 * Helper function: Fetch data in batches (Supabase limit is 1000 rows per request)
 */
async function fetchAllRows(query, batchSize = 1000) {
  let allData = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await query
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allData = allData.concat(data);
      if (data.length < batchSize) {
        hasMore = false;
      }
      offset += batchSize;
    }
  }

  return allData;
}

/**
 * GET /api/analytics/summary
 * Daily attendance summary with optional date range filter
 * Query: ?startDate=2026-04-01&endDate=2026-04-15&month=2026-04&filterType=today|range|month
 */
export async function getSummary(req, res) {
  try {
    const { startDate, endDate, month, filterType = 'today' } = req.query;
    
    let dateStart, dateEnd;

    if (filterType === 'month' && month) {
      // Parse YYYY-MM format
      const [year, monthNum] = month.split('-');
      dateStart = new Date(year, monthNum - 1, 1).toISOString();
      dateEnd = new Date(year, monthNum, 0, 23, 59, 59, 999).toISOString();
    } else if (filterType === 'range' && startDate && endDate) {
      dateStart = new Date(startDate).toISOString();
      dateEnd = new Date(new Date(endDate).getTime() + 86399999).toISOString(); // End of day
    } else {
      // Today (default)
      dateStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      dateEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();
    }

    let query = supabase
      .from('kehadiran_karyawan')
      .select('*')
      .gte('tanggal_scan', dateStart)
      .lt('tanggal_scan', dateEnd)
      .order('tanggal_scan', { ascending: false });

    let attendanceData = [];
    try {
      attendanceData = await fetchAllRows(query);
    } catch (err) {
      console.error('Attendance query error:', err);
      return res.status(500).json({ message: 'Error fetching attendance data' });
    }

    const totalRecords = attendanceData.length;
    const uniqueEmployees = new Set(attendanceData.map(item => item.id_karyawan));
    const checkIns = attendanceData.filter(item => item.io === 1).length;
    const checkOuts = attendanceData.filter(item => item.io === 2).length;

    // Compare with yesterday for trend
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStart = new Date(yesterday.setHours(0, 0, 0, 0)).toISOString();
    const yesterdayEnd = new Date(yesterday.setHours(23, 59, 59, 999)).toISOString();

    const { data: yesterdayData } = await supabase
      .from('kehadiran_karyawan')
      .select('id_karyawan, io')
      .gte('tanggal_scan', yesterdayStart)
      .lt('tanggal_scan', yesterdayEnd);
    
    const yesterdayCheckIns = yesterdayData?.filter(item => item.io === 1).length || 0;
    const yesterdayCheckOuts = yesterdayData?.filter(item => item.io === 2).length || 0;

    res.json({
      total_records: totalRecords,
      unique_employees: uniqueEmployees.size,
      check_ins: checkIns,
      check_outs: checkOuts,
      trends: {
        check_ins: checkIns - yesterdayCheckIns,
        check_outs: checkOuts - yesterdayCheckOuts,
        employees: uniqueEmployees.size
      }
    });
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ message: 'Server error fetching summary' });
  }
}

/**
 * GET /api/analytics/monthly
 * Monthly attendance trend
 * Query: ?year=2026&month=4
 */
export async function getMonthlyTrend(req, res) {
  try {
    const { year, month } = req.query;
    
    if (!year || !month) {
      return res.status(400).json({ message: 'Year and month required' });
    }

    const monthStart = new Date(year, month - 1, 1).toISOString();
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999).toISOString();

    let query = supabase
      .from('kehadiran_karyawan')
      .select('tanggal_scan, io')
      .gte('tanggal_scan', monthStart)
      .lte('tanggal_scan', monthEnd)
      .order('tanggal_scan', { ascending: true });

    let attendanceData = await fetchAllRows(query);

    const dailyStats = {};
    const lastDay = new Date(year, month, 0).getDate();
    
    for (let day = 1; day <= lastDay; day++) {
      const dateStr = new Date(year, month - 1, day).toISOString().split('T')[0];
      dailyStats[dateStr] = { check_in: 0, check_out: 0 };
    }

    attendanceData.forEach(record => {
      const dateStr = record.tanggal_scan.split('T')[0];
      if (dailyStats[dateStr]) {
        if (record.io === 1) dailyStats[dateStr].check_in++;
        else if (record.io === 2) dailyStats[dateStr].check_out++;
      }
    });

    const result = Object.entries(dailyStats).map(([date, stats]) => ({
      date,
      check_in: stats.check_in,
      check_out: stats.check_out
    }));

    res.json(result);
  } catch (error) {
    console.error('Monthly trend error:', error);
    res.status(500).json({ message: 'Server error fetching monthly trend' });
  }
}

/**
 * GET /api/analytics/by-department
 * Department breakdown of attendance
 */
export async function getByDepartment(req, res) {
  try {
    const { filterType = 'today', startDate, endDate, month } = req.query;
    
    let dateStart, dateEnd;
    
    if (filterType === 'month' && month) {
      const [year, monthNum] = month.split('-');
      dateStart = new Date(year, monthNum - 1, 1).toISOString();
      dateEnd = new Date(year, monthNum, 0, 23, 59, 59, 999).toISOString();
    } else if (filterType === 'range' && startDate && endDate) {
      dateStart = new Date(startDate).toISOString();
      dateEnd = new Date(new Date(endDate).getTime() + 86399999).toISOString();
    } else {
      // Default: today
      dateStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      dateEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();
    }

    let query = supabase
      .from('kehadiran_karyawan')
      .select('id_karyawan, departemen, io')
      .gte('tanggal_scan', dateStart)
      .lt('tanggal_scan', dateEnd);

    let attendanceData = await fetchAllRows(query);

    const deptStats = {};
    
    attendanceData.forEach(record => {
      const dept = record.departemen || 'Unknown';
      
      if (!deptStats[dept]) {
        deptStats[dept] = { 
          department: dept, 
          total: 0,
          check_in: 0, 
          check_out: 0,
          employees: new Set()
        };
      }
      
      deptStats[dept].total++;
      deptStats[dept].employees.add(record.id_karyawan);
      
      if (record.io === 1) deptStats[dept].check_in++;
      else if (record.io === 2) deptStats[dept].check_out++;
    });

    const result = Object.values(deptStats).map(stat => ({
      department: stat.department,
      total_records: stat.total,
      check_ins: stat.check_in,
      check_outs: stat.check_out,
      unique_employees: stat.employees.size
    }));

    res.json(result);
  } catch (error) {
    console.error('Department breakdown error:', error);
    res.status(500).json({ message: 'Server error fetching department breakdown' });
  }
}

/**
 * GET /api/analytics/attendance-trends
 * 12-month attendance trend
 */
export async function getAttendanceTrends(req, res) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 11);
    startDate.setDate(1);

    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    let query = supabase
      .from('kehadiran_karyawan')
      .select('tanggal_scan, io')
      .gte('tanggal_scan', startISO)
      .lte('tanggal_scan', endISO)
      .order('tanggal_scan', { ascending: true });

    let attendanceData = await fetchAllRows(query);

    const monthlyStats = {};
    
    attendanceData.forEach(record => {
      const date = new Date(record.tanggal_scan);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyStats[monthKey]) {
        monthlyStats[monthKey] = { check_in: 0, check_out: 0, total: 0 };
      }
      
      monthlyStats[monthKey].total++;
      if (record.io === 1) monthlyStats[monthKey].check_in++;
      else if (record.io === 2) monthlyStats[monthKey].check_out++;
    });

    const result = Object.entries(monthlyStats)
      .sort()
      .map(([month, stats]) => ({
        month,
        check_ins: stats.check_in,
        check_outs: stats.check_out,
        total_records: stats.total
      }));

    res.json(result);
  } catch (error) {
    console.error('Attendance trends error:', error);
    res.status(500).json({ message: 'Server error fetching attendance trends' });
  }
}

/**
 * GET /api/analytics/daily-detail
 * Today's detailed attendance
 */
export async function getDailyDetail(req, res) {
  try {
    const { filterType = 'today', startDate, endDate, month } = req.query;
    
    let dateStart, dateEnd;
    
    if (filterType === 'month' && month) {
      const [year, monthNum] = month.split('-');
      dateStart = new Date(year, monthNum - 1, 1).toISOString();
      dateEnd = new Date(year, monthNum, 0, 23, 59, 59, 999).toISOString();
    } else if (filterType === 'range' && startDate && endDate) {
      dateStart = new Date(startDate).toISOString();
      dateEnd = new Date(new Date(endDate).getTime() + 86399999).toISOString();
    } else {
      // Default: today
      dateStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      dateEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();
    }

    let query = supabase
      .from('kehadiran_karyawan')
      .select('*')
      .gte('tanggal_scan', dateStart)
      .lt('tanggal_scan', dateEnd)
      .order('tanggal_scan', { ascending: false });

    let attendanceData = await fetchAllRows(query);

    const formatted = attendanceData.map(item => ({
      id: item.id,
      employee_id: item.id_karyawan,
      nama: item.nama,
      department: item.departemen,
      position: item.jabatan,
      scan_time: new Date(item.tanggal_scan).toLocaleTimeString('id-ID'),
      status: item.io === 1 ? 'check_in' : 'check_out',
      io_type: item.io === 1 ? 'Check In' : 'Check Out',
      timestamp: item.tanggal_scan
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Daily detail error:', error);
    res.status(500).json({ message: 'Server error fetching daily detail' });
  }
}
/**
 * Helper: Detect check-in from Actual_Masuk or Prediksi_Actual_Masuk
 */
function getCheckInTime(record) {
  if (record.Actual_Masuk) return record.Actual_Masuk;
  if (record.Prediksi_Actual_Masuk) return record.Prediksi_Actual_Masuk;
  return null;
}

/**
 * Helper: Detect check-out from Actual_Pulang or Prediksi_Actual_Pulang
 * Rule: If Prediksi_Actual_Masuk === Prediksi_Actual_Pulang, don't count as check-out
 */
function getCheckOutTime(record) {
  // If prediksi masuk dan pulang sama, jangan hitung sebagai checkout
  if (record.Prediksi_Actual_Masuk && record.Prediksi_Actual_Pulang) {
    if (record.Prediksi_Actual_Masuk === record.Prediksi_Actual_Pulang) {
      return null;
    }
  }
  
  // Use Actual_Pulang if available
  if (record.Actual_Pulang) return record.Actual_Pulang;
  
  // Fallback to Prediksi_Actual_Pulang if Actual_Pulang is null
  if (record.Prediksi_Actual_Pulang) return record.Prediksi_Actual_Pulang;
  
  return null;
}

/**
 * GET /api/analytics/croscek-daily-trend
 * Line chart data: Daily check-in/check-out trend for 1 month per department
 * Query: ?year=2026&month=04&department=IT (optional)
 */
export async function getCroscekDailyTrend(req, res) {
  try {
    let { year, month, department } = req.query;
    
    // Parse parameters - handle both '2026' and '2026-04' formats
    if (!year) year = new Date().getFullYear();
    if (!month) month = new Date().getMonth() + 1;
    
    year = parseInt(year);
    if (typeof month === 'string' && month.includes('-')) {
      month = parseInt(month.split('-')[1]);
    } else {
      month = parseInt(month);
    }
    
    const monthStart = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const monthEnd = new Date(year, month, 0).toISOString().split('T')[0];

    // Try croscek table
    let croscekData = [];
    let query = supabase
      .from('croscek')
      .select('*')
      // table uses quoted column "Tanggal" (case-sensitive), so reference exact name
      .gte('"Tanggal"', monthStart)
      .lte('"Tanggal"', monthEnd);

    if (department) {
      query = query.ilike('"Departemen"', `%${department}%`);
    }

    try {
      croscekData = await fetchAllRows(query);
    } catch (err) {
      console.error('Error fetching croscek:', err);
      croscekData = [];
    }

    // Group by date and department
    const dailyTrend = {};
    
    croscekData.forEach(record => {
      let date = record.tanggal || record.Tanggal;
      if (typeof date === 'object') {
        date = new Date(date).toISOString().split('T')[0];
      } else {
        date = String(date).split('T')[0];
      }
      
      const dept = (record.departemen || record.Departemen || 'Unknown').trim();
      const empId = record.id_karyawan || record.ID_Karyawan;
      
      const key = `${date}-${dept}`;
      
      if (!dailyTrend[key]) {
        dailyTrend[key] = {
          date,
          department: dept,
          check_in: 0,
          check_out: 0,
          employees: new Set()
        };
      }
      
      if (empId) {
        dailyTrend[key].employees.add(empId);
      }
      
      // Detect check-in
      if (getCheckInTime(record)) {
        dailyTrend[key].check_in++;
      }
      
      // Detect check-out
      if (getCheckOutTime(record)) {
        dailyTrend[key].check_out++;
      }
    });

    // Format for line chart - fill all dates in range
    const allDates = [];
    for (let d = new Date(year, month - 1, 1); d <= new Date(year, month, 0); d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().split('T')[0]);
    }

    const result = allDates.map(date => {
      const dayRecords = Object.values(dailyTrend).filter(t => t.date === date);
      if (dayRecords.length === 0) {
        return {
          date,
          check_in: 0,
          check_out: 0,
          label: new Date(date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' })
        };
      }
      
      return {
        date,
        check_in: dayRecords.reduce((sum, r) => sum + r.check_in, 0),
        check_out: dayRecords.reduce((sum, r) => sum + r.check_out, 0),
        label: new Date(date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' })
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Croscek daily trend error:', error);
    res.status(500).json({ message: 'Server error fetching croscek daily trend' });
  }
}

/**
 * GET /api/analytics/croscek-departments
 * Get list of unique departments for filter tabs
 * Query: ?year=2026&month=04
 */
export async function getCroscekDepartments(req, res) {
  try {
    let { year, month } = req.query;
    
    // Parse parameters
    if (!year) year = new Date().getFullYear();
    if (!month) month = new Date().getMonth() + 1;
    
    year = parseInt(year);
    if (typeof month === 'string' && month.includes('-')) {
      month = parseInt(month.split('-')[1]);
    } else {
      month = parseInt(month);
    }
    
    const monthStart = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const monthEnd = new Date(year, month, 0).toISOString().split('T')[0];

    // use exact case-sensitive column name from croscek table
    let query = supabase
      .from('croscek')
      .select('"Departemen"')
      // reference exact date column name
      .gte('"Tanggal"', monthStart)
      .lte('"Tanggal"', monthEnd);
    let data = [];
    try {
      data = await fetchAllRows(query);
    } catch (err) {
      console.error('Error fetching croscek departments with batch fetch:', err?.message || err);
      // Fallback: try a simpler non-paginated query with reasonable limit
      try {
          const { data: fallbackData, error: fallbackErr } = await supabase
            .from('croscek')
            .select('"Departemen"')
            .gte('"Tanggal"', monthStart)
            .lte('"Tanggal"', monthEnd)
            .limit(10000);

        if (fallbackErr) throw fallbackErr;
        data = fallbackData || [];
      } catch (fallbackErr) {
        console.error('Fallback fetch croscek departments failed:', fallbackErr?.message || fallbackErr);
        return res.status(500).json({ message: 'Error fetching departments', detail: fallbackErr?.message || String(fallbackErr) });
      }
    }

    const departments = [...new Set(
      data
        .map(d => (d.Departemen || d.departemen || '').trim())
        .filter(Boolean)
    )].sort();

    res.json(departments || []);
  } catch (error) {
    console.error('Croscek departments error:', error);
    res.status(500).json({ message: 'Server error fetching departments' });
  }
}

/**
 * GET /api/analytics/croscek-summary
 * Enhanced summary with proper check-in/check-out detection
 * Query: ?year=2026&month=04
 */
export async function getCroscekSummary(req, res) {
  try {
    let { year, month } = req.query;
    
    // Parse parameters
    if (!year) year = new Date().getFullYear();
    if (!month) month = new Date().getMonth() + 1;
    
    year = parseInt(year);
    if (typeof month === 'string' && month.includes('-')) {
      month = parseInt(month.split('-')[1]);
    } else {
      month = parseInt(month);
    }
    
    const monthStart = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const monthEnd = new Date(year, month, 0).toISOString().split('T')[0];

    let query = supabase
      .from('croscek')
      .select('*')
      // use exact quoted column name for date
      .gte('"Tanggal"', monthStart)
      .lte('"Tanggal"', monthEnd);

    let croscekData = await fetchAllRows(query);

    let totalCheckIn = 0;
    let totalCheckOut = 0;
    const uniqueEmployees = new Set();

    croscekData.forEach(record => {
      const empId = record.id_karyawan || record.ID_Karyawan;
      if (empId) {
        uniqueEmployees.add(empId);
      }
      
      if (getCheckInTime(record)) {
        totalCheckIn++;
      }
      
      if (getCheckOutTime(record)) {
        totalCheckOut++;
      }
    });

    res.json({
      total_records: croscekData.length,
      unique_employees: uniqueEmployees.size,
      check_ins: totalCheckIn,
      check_outs: totalCheckOut,
      year,
      month
    });
  } catch (error) {
    console.error('Croscek summary error:', error);
    res.status(500).json({ message: 'Server error fetching croscek summary' });
  }
}

/**
 * Helper: Determine indicator status based on croscek status
 * Rule: Hijau (valid) if Status_Kehadiran is "Hadir" or has green indicator
 * Orange (warning) if Status_Kehadiran shows terlambat/absence or has orange indicator
 */
/**
 * Helper: Determine check-in indicator (Masuk)
 * Rule: Hijau (on-time) vs Orange (late)
 */
function getDelayIndicator(record) {
  const status = (record.Status_Kehadiran || '').toLowerCase();
  
  // Orange indicators (late, warning) - CHECK THESE FIRST before 'masuk' or 'hadir'
  // Because "Masuk Terlambat" contains 'masuk' but should be orange, not green!
  if (status.includes('terlambat') || status.includes('late')) {
    return 'orange';
  }
  
  if (status.includes('sakit') || status.includes('izin') || status.includes('cuti')) {
    return 'orange';
  }
  
  // Green indicators (on-time, valid) - check these AFTER orange/late checks
  if (status.includes('hadir') || status.includes('masuk') || status.includes('valid')) {
    return 'green';
  }
  
  // Check actual vs schedule
  const actualMasuk = record.Actual_Masuk;
  const scheduleMasuk = record.Jadwal_Masuk;
  
  if (actualMasuk && scheduleMasuk) {
    // If actual after schedule = orange (late)
    return 'orange';
  }
  
  // If prediction exists, prioritize actual, then prediction
  if (record.Prediksi_Actual_Masuk) {
    return 'orange'; // prediction means validation needed
  }
  
  return 'green'; // default to green
}

/**
 * Helper: Parse time string "HH:MM" or "HH:MM:SS" or datetime â†’ total minutes
 * Returns null if invalid
 */
function toMinutes(t) {
  if (!t) return null;
  const str = String(t).trim();
  
  // Extract HH:MM or HH:MM:SS
  const match = str.match(/(\d{1,2}):(\d{2}):?(\d{2})?/);
  if (!match) return null;
  
  const hh = parseInt(match[1]);
  const mm = parseInt(match[2]);
  const ss = parseInt(match[3]) || 0;
  
  return hh * 60 + mm + (ss > 0 ? 1 : 0); // round up seconds
}

/**
 * Helper: Normalize selisih lintas hari (for overnight shifts)
 */
function normalizeDayDiff(diff) {
  let d = diff;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}

/**
 * Helper: Get fallback schedule by shift code.
 * Used only if Jadwal_Masuk/Jadwal_Pulang in row are empty.
 */
function getScheduleByShiftCode(shiftCode) {
  const scheduleMap = {
    '1': { masuk: 390, pulang: 930 },      // 06:30 - 15:30
    '1A': { masuk: 390, pulang: 930 },     // 06:30 - 15:30
    'E1': { masuk: 390, pulang: 930 },     // 06:30 - 15:30
    'E2': { masuk: 660, pulang: 1140 },    // 11:00 - 19:00
    'E3': { masuk: 390, pulang: 930 },     // 06:30 - 15:30
    'OFF': { masuk: 0, pulang: 0 },
    'CT': { masuk: 390, pulang: 930 },     // 06:30 - 15:30
  };
  
  const code = (shiftCode || '').trim().toUpperCase();
  return scheduleMap[code] || { masuk: 390, pulang: 930 }; // default 06:30-15:30
}

/**
 * Helper: Resolve effective schedule minutes.
 * Priority: Jadwal_Masuk/Jadwal_Pulang from croscek row, fallback to shift mapping.
 */
function getEffectiveScheduleMinutes(row) {
  const byShift = getScheduleByShiftCode(row.Kode_Shift);
  const jadwalMasuk = toMinutes(row.Jadwal_Masuk);
  const jadwalPulang = toMinutes(row.Jadwal_Pulang);

  return {
    masuk: jadwalMasuk ?? byShift.masuk,
    pulang: jadwalPulang ?? byShift.pulang
  };
}

/**
 * Helper: Calculate actual check-in time minus scheduled check-in time (in minutes)
 * Positive = late, Negative = early
 */
function getSelisihMasukMenit(row) {
  const actualMasukMin = toMinutes(row.Actual_Masuk);
  if (actualMasukMin === null) return null;

  const schedule = getEffectiveScheduleMinutes(row);
  return normalizeDayDiff(actualMasukMin - schedule.masuk);
}

/**
 * Helper: Calculate actual check-out time minus scheduled check-out time (in minutes)
 * Positive = later checkout, Negative = early checkout
 */
function getSelisihPulangMenit(row) {
  const actualPulangMin = toMinutes(row.Actual_Pulang);
  if (actualPulangMin === null) return null;

  const schedule = getEffectiveScheduleMinutes(row);
  return normalizeDayDiff(actualPulangMin - schedule.pulang);
}

/**
 * Helper: Get late minutes (hanya positif)
 * Jika selisih < 0 (masuk lebih awal), return 0
 */
function getTelatMasukMenit(row) {
  const selisih = getSelisihMasukMenit(row);
  if (selisih === null) return 0;
  return Math.max(0, selisih);
}

/**
 * Helper: Determine telat category based on actual check-in vs schedule
 * Return: "late_1_60" | "late_61_120" | "late_120_plus" | ""
 */
function getTLKategoriByTime(row) {
  const telatMin = getTelatMasukMenit(row);
  if (telatMin <= 0) return ''; // not late
  if (telatMin <= 60) return 'late_1_60';
  if (telatMin <= 120) return 'late_61_120';
  return 'late_120_plus';
}

/**
 * Helper: Check if employee is "TIDAK HADIR" (no check-in record at all)
 */
function isTidakHadir(row) {
  const status = (row.Status_Kehadiran || '').toUpperCase();
  return ['TIDAK HADIR', 'ALPA', 'SAKIT', 'IZIN', 'DINAS LUAR'].includes(status);
}

/**
 * Helper: Detect keterlambatan dari Status_Masuk field (PRIORITAS)
 * Returns: boolean - true jika termasuk kategori terlambat
 * 
 * Menggunakan STRICT pattern matching sama seperti Croscek.jsx
 * Format TL: "TL 1-5", "TL 5-10", "TL 10", "TL 1 5", "TL 5 10", dll
 */
function isTerlambatByStatusMasuk(statusMasuk) {
  if (!statusMasuk) return false;
  const st = String(statusMasuk).toUpperCase().trim();

  // Explicit text markers used in legacy/manual status values.
  if (st.includes('TELAT') || st.includes('TERLAMBAT')) return true;

  // Strict TL code parser: TL + number, with optional range (space or dash).
  // Example: TL 1 5, TL 5-10, TL10
  const tlPattern = /\bTL\b\s*(\d+)(?:\s*[-–]?\s*(\d+))?/i;
  return tlPattern.test(st);
}

/**
 * Helper: HADIR tapi salah satu actual scan kosong => kategori kuning (bukan telat).
 */
function isActualKosongHadir(row) {
  const status = String(row.Status_Kehadiran || '').toUpperCase().trim();
  if (status !== 'HADIR') return false;
  return !row.Actual_Masuk || !row.Actual_Pulang;
}


/**
 * Helper: Determine if this is a legitimate late arrival
 * RULES (sama dengan exportRekapKehadiran di Croscek.jsx):
 * 1. PRIORITAS: Check Status_Masuk field - jika ada TL code, maka terlambat
 * 2. FALLBACK: Check actual check-in time vs scheduled time
 * 
 * Requirements:
 * - Must have "Hadir" status
 * - Must have actual check-in time
 * - Check-in time must be after scheduled time (only used as fallback)
 */
function isLateArrival(row) {
  // Must have "Hadir" status
  const status = String(row.Status_Kehadiran || '').toUpperCase().trim();
  if (status !== 'HADIR') return false;

  // Kategori kuning (scan kosong) bukan terlambat.
  if (isActualKosongHadir(row)) return false;

  const selisihMasuk = getSelisihMasukMenit(row);
  const selisihPulang = getSelisihPulangMenit(row);

  // Jika waktu bisa dihitung, ikuti rule indikator:
  // - >120 menit = ungu (bukan bucket telat dashboard)
  // - telat <=0 = tidak telat
  // - telat positif tapi kompensasi pulang terpenuhi = hijau
  if (selisihMasuk !== null) {
    if (Math.abs(selisihMasuk) > 120) return false;

    const telatMin = Math.max(0, selisihMasuk);
    if (telatMin <= 4) return false;

    const kompensasiPulangMenit = Math.ceil(telatMin / 60) * 60;
    if (selisihPulang !== null && selisihPulang >= kompensasiPulangMenit) {
      return false;
    }

    return true;
  }

  // Fallback status text hanya jika perhitungan waktu tidak tersedia.
  // Untuk kasus ini, ikuti marker status dari data croscek.
  return isTerlambatByStatusMasuk(row.Status_Masuk);
}

/**
 * Helper: Determine check-out indicator
 * Rule: Hijau (on-time/valid) vs Anomali (too early/tidak sesuai rule hijau)
 */
function getCheckOutIndicator(record) {
  const statusPulang = (record.Status_Pulang || '').toLowerCase();
  const statusKehadiran = (record.Status_Kehadiran || '').toLowerCase();
  
  // Green indicators (on-time, valid)
  if (statusPulang.includes('pulang') && statusPulang.includes('tepat')) {
    return 'green';
  }
  if (statusPulang.includes('valid')) {
    return 'green';
  }
  if (statusKehadiran.includes('hadir')) {
    return 'green';
  }
  
  // If we reach here, it means the checkout status doesn't match green rule
  // This indicates anomaly - too early or irregular checkout
  return 'anomaly'; // represents too early or doesn't match expected pattern
}

/**
 * GET /api/analytics/croscek-delays
 * Line chart data: Daily delays (late) for check-in/check-out per department
 * Query: ?year=2026&month=04&department=IT (optional)
 */
export async function getCroscekDelays(req, res) {
  try {
    let { year, month, department } = req.query;
    
    // Parse parameters
    if (!year) year = new Date().getFullYear();
    if (!month) month = new Date().getMonth() + 1;
    
    year = parseInt(year);
    if (typeof month === 'string' && month.includes('-')) {
      month = parseInt(month.split('-')[1]);
    } else {
      month = parseInt(month);
    }
    
    const monthStart = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const monthEnd = new Date(year, month, 0).toISOString().split('T')[0];

    // Fetch croscek data
    let croscekData = [];
    let query = supabase
      .from('croscek')
      .select('*')
      .gte('"Tanggal"', monthStart)
      .lte('"Tanggal"', monthEnd);

    if (department) {
      query = query.ilike('"Departemen"', `%${department}%`);
    }

    try {
      croscekData = await fetchAllRows(query);
    } catch (err) {
      console.error('Error fetching croscek for delays:', err);
      croscekData = [];
    }

    // Group by date and department with indicators
    const dailyDelays = {};
    
    croscekData.forEach(record => {
      let date = record.Tanggal || record.tanggal;
      if (typeof date === 'object') {
        date = new Date(date).toISOString().split('T')[0];
      } else {
        date = String(date).split('T')[0];
      }
      
      const dept = (record.Departemen || record.departemen || 'Unknown').trim();
      
      const key = `${date}-${dept}`;
      
      if (!dailyDelays[key]) {
        dailyDelays[key] = {
          date,
          department: dept,
          delay_masuk_green: 0,      // On-time check-in (green)
          delay_masuk_orange: 0,     // Late check-in (orange)
          delay_pulang_green: 0,     // On-time check-out (green)
          delay_pulang_anomaly: 0    // Anomaly check-out: too early (tidak sesuai rule)
        };
      }
      
      // Check-in indicator (Actual_Masuk or Prediksi_Actual_Masuk)
      if (record.Actual_Masuk || record.Prediksi_Actual_Masuk) {
        const masukIndicator = getDelayIndicator({
          ...record,
          Status_Kehadiran: record.Status_Masuk || record.Status_Kehadiran
        });
        
        if (masukIndicator === 'green') {
          dailyDelays[key].delay_masuk_green++;
        } else {
          dailyDelays[key].delay_masuk_orange++;
        }
      }
      
      // Check-out indicator (Actual_Pulang or Prediksi_Actual_Pulang)
      // Skip if Prediksi_Actual_Masuk === Prediksi_Actual_Pulang (no actual checkout)
      if (record.Prediksi_Actual_Masuk && record.Prediksi_Actual_Pulang) {
        if (record.Prediksi_Actual_Masuk === record.Prediksi_Actual_Pulang) {
          // No checkout - don't count
        } else if (record.Actual_Pulang || record.Prediksi_Actual_Pulang) {
          const pulangIndicator = getCheckOutIndicator({
            ...record,
            Status_Pulang: record.Status_Pulang || record.Status_Kehadiran
          });
          
          if (pulangIndicator === 'green') {
            dailyDelays[key].delay_pulang_green++;
          } else {
            dailyDelays[key].delay_pulang_anomaly++;
          }
        }
      } else if (record.Actual_Pulang || record.Prediksi_Actual_Pulang) {
        const pulangIndicator = getCheckOutIndicator({
          ...record,
          Status_Pulang: record.Status_Pulang || record.Status_Kehadiran
        });
        
        if (pulangIndicator === 'green') {
          dailyDelays[key].delay_pulang_green++;
        } else {
          dailyDelays[key].delay_pulang_anomaly++;
        }
      }
    });

    // Format for line chart - fill all dates in range
    const allDates = [];
    for (let d = new Date(year, month - 1, 1); d <= new Date(year, month, 0); d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().split('T')[0]);
    }

    const result = allDates.map(date => {
      const dayRecords = Object.values(dailyDelays).filter(t => t.date === date);
      if (dayRecords.length === 0) {
        return {
          date,
          delay_masuk_green: 0,
          delay_masuk_orange: 0,
          delay_pulang_green: 0,
          delay_pulang_anomaly: 0,
          label: new Date(date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' })
        };
      }
      
      return {
        date,
        delay_masuk_green: dayRecords.reduce((sum, r) => sum + r.delay_masuk_green, 0),
        delay_masuk_orange: dayRecords.reduce((sum, r) => sum + r.delay_masuk_orange, 0),
        delay_pulang_green: dayRecords.reduce((sum, r) => sum + r.delay_pulang_green, 0),
        delay_pulang_anomaly: dayRecords.reduce((sum, r) => sum + r.delay_pulang_anomaly, 0),
        label: new Date(date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' })
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Croscek delays error:', error);
    res.status(500).json({ message: 'Server error fetching croscek delays' });
  }
}

/**
 * GET /api/analytics/attendance-rate
 * Attendance rate (%) with breakdown: Present, Late, Absent
 * Query: ?filterType=today|range|month&startDate=2026-04-01&endDate=2026-04-15&month=2026-04
 */
export async function getAttendanceRate(req, res) {
  try {
    const { filterType = 'today', startDate, endDate, month } = req.query;
    
    let dateStart, dateEnd;

    if (filterType === 'month' && month) {
      const [year, monthNum] = month.split('-');
      dateStart = new Date(year, monthNum - 1, 1).toISOString().split('T')[0];
      dateEnd = new Date(year, monthNum, 0).toISOString().split('T')[0];
    } else if (filterType === 'range' && startDate && endDate) {
      dateStart = new Date(startDate).toISOString().split('T')[0];
      dateEnd = new Date(endDate).toISOString().split('T')[0];
    } else {
      // Today (default)
      dateStart = new Date().toISOString().split('T')[0];
      dateEnd = dateStart;
    }

    // Fetch from croscek table (processed attendance data)
    let query = supabase
      .from('croscek')
      .select('"Nama", "Departemen", "Status_Kehadiran", "Status_Masuk"')
      .gte('"Tanggal"', dateStart)
      .lte('"Tanggal"', dateEnd);

    let croscekData = await fetchAllRows(query);

    // Count by status
    let present = 0;
    let late = 0;
    let absent = 0;
    const uniqueEmployees = new Set();

    croscekData.forEach(record => {
      const status = (record.Status_Kehadiran || '').toLowerCase();
      
      uniqueEmployees.add(record.Nama);
      
      if (status.includes('hadir')) {
        present++;
      } else if (status.includes('terlambat')) {
        late++;
      } else if (status.includes('sakit') || status.includes('izin') || status.includes('cuti') || status.includes('absen')) {
        absent++;
      }
    });

    const total = present + late + absent;
    const presentRate = total > 0 ? Math.round((present / total) * 100) : 0;
    const lateRate = total > 0 ? Math.round((late / total) * 100) : 0;
    const absentRate = total > 0 ? Math.round((absent / total) * 100) : 0;

    res.json({
      period: {
        start: dateStart,
        end: dateEnd,
        type: filterType
      },
      total_records: total,
      unique_employees: uniqueEmployees.size,
      attendance: {
        present: present,
        present_rate: presentRate,
        late: late,
        late_rate: lateRate,
        absent: absent,
        absent_rate: absentRate
      }
    });
  } catch (error) {
    console.error('Attendance rate error:', error);
    res.status(500).json({ message: 'Server error fetching attendance rate' });
  }
}

/**
 * GET /api/analytics/top-latecomers
 * Top employees with most late arrivals
 * Query: ?limit=10&filterType=today|range|month&startDate=2026-04-01&endDate=2026-04-15&month=2026-04&department=IT (optional)
 * 
 * Validation: Use same logic as getCroscekDelays
 * - Check if Status_Kehadiran or Status_Masuk contains indicators
 * - Priority: Hijau first (hadir), then Orange (terlambat)
 */
export async function getTopLatecomers(req, res) {
  try {
    const { limit = 10, filterType = 'today', startDate, endDate, month, department } = req.query;
    
    let dateStart, dateEnd;

    if (filterType === 'month' && month) {
      const [year, monthNum] = month.split('-');
      dateStart = new Date(year, monthNum - 1, 1).toISOString().split('T')[0];
      dateEnd = new Date(year, monthNum, 0).toISOString().split('T')[0];
    } else if (filterType === 'range' && startDate && endDate) {
      dateStart = new Date(startDate).toISOString().split('T')[0];
      dateEnd = new Date(endDate).toISOString().split('T')[0];
    } else {
      // Today (default)
      dateStart = new Date().toISOString().split('T')[0];
      dateEnd = dateStart;
    }

    console.log('[TOP LATECOMERS DEBUG] Filter:', {
      filterType,
      dateStart,
      dateEnd,
      department: department || 'none'
    });

    let query = supabase
      .from('croscek')
      .select('*')
      .gte('"Tanggal"', dateStart)
      .lte('"Tanggal"', dateEnd);

    if (department) {
      query = query.ilike('"Departemen"', `%${department}%`);
    }

    let croscekData = await fetchAllRows(query);

    console.log('[TOP LATECOMERS] Total records fetched:', croscekData.length);
    
    // Log first 20 sample records for debugging
    if (croscekData.length > 0) {
      console.log('[TOP LATECOMERS] Sample records (first 20):');
      croscekData.slice(0, 20).forEach((record, idx) => {
        console.log(`  [${idx}] Nama="${record.Nama}" | Status_Kehadiran="${record.Status_Kehadiran}" | Status_Masuk="${record.Status_Masuk}" | Actual_Masuk="${record.Actual_Masuk}"`);
      });
    }

    // Group by employee and count lates.
    // Use id_karyawan as primary key to avoid merging employees with same name.
    const latecomers = {};
    let terlambatCount = 0;

    croscekData.forEach(record => {
      const employeeId = record.id_karyawan ?? record.ID_Karyawan ?? null;
      const name = record.Nama || 'Unknown';
      const dept = record.Departemen || 'Unknown';
      const employeeKey = employeeId ? `id:${employeeId}` : `${name}__${dept}`;
      const statusKehadiran = String(record.Status_Kehadiran || '').toUpperCase().trim();
      
      // Total hari kerja untuk ranking ini mengikuti baris HADIR.
      if (statusKehadiran !== 'HADIR') return;
      
      if (!latecomers[employeeKey]) {
        latecomers[employeeKey] = {
          id: employeeId,
          name,
          department: dept,
          late_count: 0,
          total_records: 0,
          late_percentage: 0
        };
      }
      
      latecomers[employeeKey].total_records++;
      
      // Rule telat mengikuti indikator rekap (hijau/orange/ungu/kuning handling).
      const isLate = isLateArrival(record);
      if (isLate) {
        latecomers[employeeKey].late_count++;
        terlambatCount++;
        
        // Debug log for employees with late count > 0
        if (name === 'ANI MERIAM' || name === 'ATE SOBARKAH') {
          console.log(`  [${name}] Tanggal="${record.Tanggal}" | Status_Masuk="${record.Status_Masuk}" | Actual_Masuk="${record.Actual_Masuk}" | Kode_Shift="${record.Kode_Shift}" | isLate=${isLate}`);
        }
      }
    });

    console.log('[TOP LATECOMERS] Total terlambat records found:', terlambatCount);
    console.log('[TOP LATECOMERS] Unique employees with at least 1 late:', Object.values(latecomers).filter(e => e.late_count > 0).length);

    // Calculate percentage and sort by late count
    const sorted = Object.values(latecomers)
      .map(emp => ({
        ...emp,
        late_percentage: emp.total_records > 0 ? Math.round((emp.late_count / emp.total_records) * 100) : 0
      }))
      .filter(emp => emp.late_count > 0)  // Only show employees with at least 1 late
      .sort((a, b) => {
        // Sort by late_count first (descending), then by late_percentage
        if (b.late_count !== a.late_count) {
          return b.late_count - a.late_count;
        }
        return b.late_percentage - a.late_percentage;
      })
      .slice(0, parseInt(limit));

    console.log('[TOP LATECOMERS] Final sorted list count:', sorted.length);
    if (sorted.length > 0) {
      console.log('[TOP LATECOMERS] Top employee:', sorted[0]);
    }

    res.json({
      period: {
        start: dateStart,
        end: dateEnd,
        type: filterType
      },
      total_latecomers: sorted.length,
      latecomers: sorted,
      debug: {
        total_records_fetched: croscekData.length,
        total_terlambat_found: terlambatCount,
        unique_employees_with_late: Object.values(latecomers).filter(e => e.late_count > 0).length
      }
    });
  } catch (error) {
    console.error('Top latecomers error:', error);
    res.status(500).json({ message: 'Server error fetching top latecomers' });
  }
}

/**
 * GET /api/analytics/department-performance
 * Performance ranking by department: attendance rate, on-time rate, etc
 * Query: ?filterType=today|range|month&startDate=2026-04-01&endDate=2026-04-15&month=2026-04
 */
export async function getDepartmentPerformance(req, res) {
  try {
    const { filterType = 'today', startDate, endDate, month } = req.query;
    
    let dateStart, dateEnd;

    if (filterType === 'month' && month) {
      const [year, monthNum] = month.split('-');
      dateStart = new Date(year, monthNum - 1, 1).toISOString().split('T')[0];
      dateEnd = new Date(year, monthNum, 0).toISOString().split('T')[0];
    } else if (filterType === 'range' && startDate && endDate) {
      dateStart = new Date(startDate).toISOString().split('T')[0];
      dateEnd = new Date(endDate).toISOString().split('T')[0];
    } else {
      // Today (default)
      dateStart = new Date().toISOString().split('T')[0];
      dateEnd = dateStart;
    }

    let query = supabase
      .from('croscek')
      .select('"Departemen", "Status_Kehadiran", "Status_Masuk", "Nama"')
      .gte('"Tanggal"', dateStart)
      .lte('"Tanggal"', dateEnd);

    let croscekData = await fetchAllRows(query);

    // Group by department
    const deptStats = {};

    croscekData.forEach(record => {
      const dept = record.Departemen || 'Unknown';
      const status = (record.Status_Kehadiran || '').toLowerCase();
      
      if (!deptStats[dept]) {
        deptStats[dept] = {
          department: dept,
          total_records: 0,
          present: 0,
          late: 0,
          absent: 0,
          unique_employees: new Set()
        };
      }
      
      deptStats[dept].total_records++;
      deptStats[dept].unique_employees.add(record.Nama);
      
      if (status.includes('hadir')) {
        deptStats[dept].present++;
      } else if (status.includes('terlambat')) {
        deptStats[dept].late++;
      } else if (status.includes('sakit') || status.includes('izin') || status.includes('cuti') || status.includes('absen')) {
        deptStats[dept].absent++;
      }
    });

    // Calculate percentages and sort by attendance rate
    const result = Object.values(deptStats)
      .map(stat => {
        const total = stat.present + stat.late + stat.absent;
        return {
          department: stat.department,
          total_records: stat.total_records,
          unique_employees: stat.unique_employees.size,
          attendance_rate: total > 0 ? Math.round((stat.present / total) * 100) : 0,
          on_time_percentage: total > 0 ? Math.round((stat.present / total) * 100) : 0,
          late_percentage: total > 0 ? Math.round((stat.late / total) * 100) : 0,
          absent_percentage: total > 0 ? Math.round((stat.absent / total) * 100) : 0
        };
      })
      .sort((a, b) => b.attendance_rate - a.attendance_rate);

    res.json({
      period: {
        start: dateStart,
        end: dateEnd,
        type: filterType
      },
      total_departments: result.length,
      departments: result
    });
  } catch (error) {
    console.error('Department performance error:', error);
    res.status(500).json({ message: 'Server error fetching department performance' });
  }
}

/**
 * GET /api/analytics/data-quality
 * Data quality metrics: prediction confidence, missing data, anomalies
 * Query: ?filterType=today|range|month&month=2026-04
 */
export async function getDataQuality(req, res) {
  try {
    const { filterType = 'today', startDate, endDate, month } = req.query;
    
    let dateStart, dateEnd;

    if (filterType === 'month' && month) {
      const [year, monthNum] = month.split('-');
      dateStart = new Date(year, monthNum - 1, 1).toISOString().split('T')[0];
      dateEnd = new Date(year, monthNum, 0).toISOString().split('T')[0];
    } else if (filterType === 'range' && startDate && endDate) {
      dateStart = new Date(startDate).toISOString().split('T')[0];
      dateEnd = new Date(endDate).toISOString().split('T')[0];
    } else {
      // Today (default)
      dateStart = new Date().toISOString().split('T')[0];
      dateEnd = dateStart;
    }

    console.log('[DATA QUALITY] Query params - filterType:', filterType, 'dateStart:', dateStart, 'dateEnd:', dateEnd);

    let query = supabase
      .from('croscek')
      .select('Actual_Masuk, Actual_Pulang, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang, Confidence_Score, Probabilitas_Prediksi, Tanggal, Nama')
      .gte('Tanggal', dateStart)
      .lte('Tanggal', dateEnd);

    let croscekData = [];
    try {
      croscekData = await fetchAllRows(query);
      console.log('[DATA QUALITY] Total records fetched:', croscekData.length);
      
      // Sample first 3 records for debug
      if (croscekData.length > 0) {
        console.log('[DATA QUALITY] Sample records:');
        croscekData.slice(0, 3).forEach((rec, idx) => {
          console.log(`  Record ${idx + 1}:`, {
            Nama: rec.Nama,
            Tanggal: rec.Tanggal,
            Confidence_Score: rec.Confidence_Score,
            Actual_Masuk: rec.Actual_Masuk,
            Prediksi_Actual_Masuk: rec.Prediksi_Actual_Masuk
          });
        });
      }
    } catch (fetchError) {
      console.error('[DATA QUALITY] Fetch error - attempting fallback query:', fetchError.message);
      // Fallback: Try simple query without filtering
      const fallbackRes = await supabase
        .from('croscek')
        .select('Actual_Masuk, Actual_Pulang, Prediksi_Actual_Masuk, Prediksi_Actual_Pulang, Confidence_Score, Probabilitas_Prediksi')
        .limit(10000);
      
      if (fallbackRes.error) {
        throw fallbackRes.error;
      }
      croscekData = fallbackRes.data || [];
      console.log('[DATA QUALITY] Fallback fetched:', croscekData.length, 'records');
    }

    // DATA COMPLETENESS ANALYSIS (not confidence score)
    // High Quality: Both actual masuk AND actual pulang present
    // Medium Quality: One actual + one predicted (mixed)
    // Low Quality: Mostly/all predicted or incomplete
    // Missing: No actual or predicted data
    let highQuality = 0;      // Both actual
    let mediumQuality = 0;    // Mixed (one actual + one predicted)
    let lowQuality = 0;       // Mostly predicted
    let missingData = 0;      // No data at all
    let totalPredictedUsed = 0;

    croscekData.forEach(record => {
      const hasMasukActual = !!record.Actual_Masuk;
      const hasPulangActual = !!record.Actual_Pulang;
      const hasMasukPrediksi = !!record.Prediksi_Actual_Masuk;
      const hasPulangPrediksi = !!record.Prediksi_Actual_Pulang;

      // Classify data completeness
      if (hasMasukActual && hasPulangActual) {
        // HIGH: Both actual data present
        highQuality++;
      } else if (
        (hasMasukActual && hasPulangPrediksi) ||
        (hasMasukPrediksi && hasPulangActual)
      ) {
        // MEDIUM: One actual + one predicted
        mediumQuality++;
        totalPredictedUsed += 1;
      } else if (hasMasukPrediksi || hasPulangPrediksi) {
        // LOW: Only predicted data available
        lowQuality++;
        totalPredictedUsed += 2;
      } else {
        // MISSING: No actual or predicted data
        missingData++;
      }
    });

    const total = croscekData.length;
    
    console.log('[DATA QUALITY] Data Completeness Analysis:');
    console.log('  High Quality (both actual):', highQuality);
    console.log('  Medium Quality (mixed):', mediumQuality);
    console.log('  Low Quality (predicted):', lowQuality);
    console.log('  Missing:', missingData);
    
    res.json({
      period: {
        start: dateStart,
        end: dateEnd,
        type: filterType
      },
      total_records: total,
      data_completeness: {
        high: {
          label: 'Lengkap (Actual Masuk & Pulang)',
          count: highQuality,
          percentage: total > 0 ? Math.round((highQuality / total) * 100) : 0,
          description: 'Data check-in dan check-out dari sensor/manual'
        },
        medium: {
          label: 'Sebagian (Actual + Prediksi)',
          count: mediumQuality,
          percentage: total > 0 ? Math.round((mediumQuality / total) * 100) : 0,
          description: 'Salah satu dari actual/prediksi'
        },
        low: {
          label: 'Prediksi (Tidak Ada Actual)',
          count: lowQuality,
          percentage: total > 0 ? Math.round((lowQuality / total) * 100) : 0,
          description: 'Hanya data prediksi, perlu verifikasi manual'
        },
        missing: {
          label: 'Hilang (Tanpa Data)',
          count: missingData,
          percentage: total > 0 ? Math.round((missingData / total) * 100) : 0,
          description: 'Tidak ada actual atau prediksi'
        }
      },
      data_usage: {
        actual_data_pct: total > 0 ? Math.round(((highQuality * 2 + mediumQuality) / (total * 2)) * 100) : 0,
        predicted_data_pct: total > 0 ? Math.round((totalPredictedUsed / (total * 2)) * 100) : 0,
        records_using_prediction: mediumQuality + lowQuality
      },
      summary: {
        data_analyst_ready: highQuality,
        requires_verification: mediumQuality + lowQuality,
        unusable: missingData
      }
    });
  } catch (error) {
    console.error('[DATA QUALITY] Server error:', error.message);
    res.status(500).json({ 
      message: 'Error fetching data quality metrics',
      error: error.message 
    });
  }
}

/**
 * GET /api/analytics/employee/:id_karyawan
 * Individual employee attendance history and trends
 * Query: ?month=2026-04&days=90
 */
export async function getEmployeeDetail(req, res) {
  try {
    const { id_karyawan } = req.params;
    const { month, days = 90 } = req.query;

    if (!id_karyawan) {
      return res.status(400).json({ message: 'Employee ID required' });
    }

    // Fetch employee info
    const { data: employeeData, error: empError } = await supabase
      .from('karyawan')
      .select('*')
      .eq('id_karyawan', parseInt(id_karyawan))
      .single();

    if (empError || !employeeData) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // Calculate date range
    let dateStart, dateEnd;
    if (month) {
      const [year, monthNum] = month.split('-');
      dateStart = new Date(year, monthNum - 1, 1).toISOString().split('T')[0];
      dateEnd = new Date(year, monthNum, 0).toISOString().split('T')[0];
    } else {
      const startDt = new Date();
      startDt.setDate(startDt.getDate() - parseInt(days));
      dateStart = startDt.toISOString().split('T')[0];
      dateEnd = new Date().toISOString().split('T')[0];
    }

    const nowJakarta = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const todayJakarta = `${nowJakarta.getFullYear()}-${String(nowJakarta.getMonth() + 1).padStart(2, '0')}-${String(nowJakarta.getDate()).padStart(2, '0')}`;
    const nowMinutesJakarta = nowJakarta.getHours() * 60 + nowJakarta.getMinutes() + (nowJakarta.getSeconds() / 60);

    const normalizeDateOnly = (value) => {
      if (!value) return '';
      return String(value).split('T')[0].split(' ')[0];
    };

    const isBelumWaktunya = (record) => {
      const dateOnly = normalizeDateOnly(record.Tanggal);
      if (!dateOnly) return false;

      const noScanMasuk = !record.Actual_Masuk;
      const noScanPulang = !record.Actual_Pulang;
      if (!(noScanMasuk && noScanPulang)) return false;

      if (dateOnly > todayJakarta) return true;
      if (dateOnly < todayJakarta) return false;

      const jadwalMasukMin = toMinutes(record.Jadwal_Masuk);
      if (jadwalMasukMin === null) return false;
      return nowMinutesJakarta < jadwalMasukMin;
    };

    const classifyRecord = (record) => {
      if (isBelumWaktunya(record)) {
        return { status: 'pending', status_detail: 'Belum waktunya' };
      }

      const statusKehadiran = String(record.Status_Kehadiran || '').toUpperCase().trim();
      if (statusKehadiran !== 'HADIR') {
        return { status: 'absent', status_detail: record.Status_Kehadiran || 'Absen/Sakit/Izin' };
      }

      const noScanMasuk = !record.Actual_Masuk;
      const noScanPulang = !record.Actual_Pulang;
      if (noScanMasuk && noScanPulang) {
        return { status: 'absent', status_detail: 'Tidak Hadir' };
      }

      if (isLateArrival(record)) {
        return { status: 'late', status_detail: record.Status_Masuk || 'Terlambat' };
      }

      return { status: 'present', status_detail: record.Status_Kehadiran || 'Hadir' };
    };

    // Fetch attendance records
    const attendanceQuery = supabase
      .from('croscek')
      .select('"Nama", "Departemen", "Status_Kehadiran", "Tanggal", "Kode_Shift", "Prediksi_Shift", "Jadwal_Masuk", "Jadwal_Pulang", "Actual_Masuk", "Actual_Pulang", "Prediksi_Actual_Masuk", "Prediksi_Actual_Pulang", "Status_Masuk", "Status_Pulang"')
      .eq('id_karyawan', parseInt(id_karyawan))
      .gte('"Tanggal"', dateStart)
      .lte('"Tanggal"', dateEnd)
      .order('"Tanggal"', { ascending: true });

    const attendanceRecords = await fetchAllRows(attendanceQuery);

    const hasValidPrediksiActualPair = (record) => {
      const predMasuk = toMinutes(record.Prediksi_Actual_Masuk);
      const predPulang = toMinutes(record.Prediksi_Actual_Pulang);
      if (predMasuk === null || predPulang === null) return false;
      return predMasuk !== predPulang;
    };

    const shouldUsePrediksiActual = (record) => {
      const hasActualKosong = !record.Actual_Masuk || !record.Actual_Pulang;
      if (!hasActualKosong) return false;
      return hasValidPrediksiActualPair(record);
    };

    // Calculate statistics
    let totalDays = 0;
    let presentDays = 0;
    let lateDays = 0;
    let absentDays = 0;
    const dailyStats = {};

    attendanceRecords.forEach(record => {
      const date = normalizeDateOnly(record.Tanggal);
      if (!date || dailyStats[date]) return;

      const classification = classifyRecord(record);
      const usePrediksiActual = shouldUsePrediksiActual(record);

      dailyStats[date] = {
        date,
        status: classification.status,
        check_in_time: usePrediksiActual ? record.Prediksi_Actual_Masuk : record.Actual_Masuk,
        check_out_time: usePrediksiActual ? record.Prediksi_Actual_Pulang : record.Actual_Pulang,
        scheduled_in: record.Jadwal_Masuk,
        scheduled_out: record.Jadwal_Pulang,
        kode_shift: record.Kode_Shift || '',
        prediksi_shift: record.Prediksi_Shift || '',
        source_check_time: usePrediksiActual ? 'prediksi' : 'aktual',
        status_detail: classification.status_detail
      };

      if (classification.status === 'pending') return;

      totalDays++;
      if (classification.status === 'present') presentDays++;
      else if (classification.status === 'late') lateDays++;
      else absentDays++;
    });

    const attendanceRate = totalDays > 0 ? Math.round(((presentDays + lateDays) / totalDays) * 100) : 0;
    const lateRate = totalDays > 0 ? Math.round((lateDays / totalDays) * 100) : 0;
    const absentRate = totalDays > 0 ? Math.round((absentDays / totalDays) * 100) : 0;

    // Get 3-month trend (for sparkline)
    const trendStart = new Date();
    trendStart.setMonth(trendStart.getMonth() - 2);
    const trendStartStr = trendStart.toISOString().split('T')[0];

    const { data: trendData } = await supabase
      .from('croscek')
      .select('"Tanggal", "Status_Kehadiran", "Status_Masuk", "Kode_Shift", "Jadwal_Masuk", "Jadwal_Pulang", "Actual_Masuk", "Actual_Pulang"')
      .eq('id_karyawan', parseInt(id_karyawan))
      .gte('"Tanggal"', trendStartStr)
      .order('"Tanggal"', { ascending: true });

    // Group trend data by month
    const monthlyTrend = {};
    (trendData || []).forEach(record => {
      const dateOnly = normalizeDateOnly(record.Tanggal);
      if (!dateOnly) return;

      const monthKey = dateOnly.slice(0, 7);
      const classification = classifyRecord(record);
      if (classification.status === 'pending') return;

      if (!monthlyTrend[monthKey]) {
        monthlyTrend[monthKey] = { month: monthKey, present: 0, late: 0, absent: 0 };
      }

      if (classification.status === 'present') monthlyTrend[monthKey].present++;
      else if (classification.status === 'late') monthlyTrend[monthKey].late++;
      else monthlyTrend[monthKey].absent++;
    });

    const dailyRecordsSorted = Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date));
    const trendArray = Object.values(monthlyTrend).sort((a, b) => a.month.localeCompare(b.month));

    res.json({
      employee: {
        id: employeeData.id_karyawan,
        name: employeeData.nama,
        position: employeeData.jabatan,
        department: employeeData.dept,
        nik: employeeData.nik,
        category: employeeData.kategori
      },
      period: {
        start: dateStart,
        end: dateEnd,
        days: parseInt(days)
      },
      summary: {
        total_days: totalDays,
        present_days: presentDays,
        late_days: lateDays,
        absent_days: absentDays,
        attendance_rate: attendanceRate,
        late_rate: lateRate,
        absent_rate: absentRate
      },
      daily_records: dailyRecordsSorted,
      monthly_trend: trendArray
    });
  } catch (error) {
    console.error('Employee detail error:', error);
    res.status(500).json({ message: 'Server error fetching employee details' });
  }
}

/**
 * DEBUG: GET /api/analytics/debug-sample-croscek
 * Sample data to debug structure
 */
export async function getDebugCroscekSample(req, res) {
  try {
    const { startDate, endDate } = req.query;
    
    const dateStart = startDate || new Date().toISOString().split('T')[0];
    const dateEnd = endDate || new Date().toISOString().split('T')[0];

    // Get sample 10 records
    const { data, error } = await supabase
      .from('croscek')
      .select('"Nama", "Departemen", "Status_Kehadiran", "Status_Masuk", "Actual_Masuk", "Actual_Pulang", "Tanggal"')
      .gte('"Tanggal"', dateStart)
      .lte('"Tanggal"', dateEnd)
      .limit(10);

    if (error) throw error;

    res.json({
      debug: true,
      sample_count: (data || []).length,
      samples: data || []
    });
  } catch (error) {
    console.error('Debug sample error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
}




