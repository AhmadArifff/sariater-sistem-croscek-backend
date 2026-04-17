import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getSummary,
  getMonthlyTrend,
  getByDepartment,
  getAttendanceTrends,
  getDailyDetail,
  getCroscekDailyTrend,
  getCroscekDepartments,
  getCroscekSummary,
  getCroscekDelays,
  getAttendanceRate,
  getTopLatecomers,
  getDepartmentPerformance,
  getDataQuality,
  getEmployeeDetail,
  getDebugCroscekSample
} from '../controllers/analyticsController.js';

const router = express.Router();

/**
 * All analytics endpoints require authentication
 * Staff users get filtered data (their department only)
 * Admin users get full access to all data
 */

// GET /api/analytics/summary
// Daily attendance summary (total, present, absent, late)
router.get('/summary', authenticate, getSummary);

// GET /api/analytics/monthly
// Monthly attendance trend
// Query params: ?year=2026&month=4
router.get('/monthly', authenticate, getMonthlyTrend);

// GET /api/analytics/by-department
// Department breakdown of attendance
router.get('/by-department', authenticate, getByDepartment);

// GET /api/analytics/attendance-trends
// 12-month attendance rate trend
router.get('/attendance-trends', authenticate, getAttendanceTrends);

// GET /api/analytics/daily-detail
// Today's detailed attendance listing
// Query params: ?status=present|absent|late&department_id=dept123
router.get('/daily-detail', authenticate, getDailyDetail);

// Croscek Analysis Endpoints
// GET /api/analytics/croscek-summary
// Enhanced summary with proper check-in/check-out detection from croscek table
// Query params: ?year=2026&month=04
router.get('/croscek-summary', authenticate, getCroscekSummary);

// GET /api/analytics/croscek-daily-trend
// Line chart data: Daily check-in/check-out trend for 1 month
// Query params: ?year=2026&month=04&department=IT (optional)
router.get('/croscek-daily-trend', authenticate, getCroscekDailyTrend);

// GET /api/analytics/croscek-departments
// Get list of unique departments for filter tabs
// Query params: ?year=2026&month=04
router.get('/croscek-departments', authenticate, getCroscekDepartments);

// GET /api/analytics/croscek-delays
// Line chart data: Daily delays (late check-in/check-out) with green/orange indicators
// Query params: ?year=2026&month=04&department=IT (optional)
router.get('/croscek-delays', authenticate, getCroscekDelays);

// GET /api/analytics/attendance-rate
// Attendance rate (%) with breakdown: Present, Late, Absent
// Query params: ?filterType=today|range|month&startDate=2026-04-01&endDate=2026-04-15&month=2026-04
router.get('/attendance-rate', authenticate, getAttendanceRate);

// GET /api/analytics/top-latecomers
// Top employees with most late arrivals
// Query params: ?limit=10&days=30&department=IT (optional)
router.get('/top-latecomers', authenticate, getTopLatecomers);

// GET /api/analytics/department-performance
// Performance ranking by department: attendance rate, on-time rate, etc
// Query params: ?filterType=today|range|month&startDate=2026-04-01&endDate=2026-04-15&month=2026-04
router.get('/department-performance', authenticate, getDepartmentPerformance);

// GET /api/analytics/data-quality
// Data quality metrics: prediction confidence, missing data, anomalies
// Query params: ?filterType=today|range|month&month=2026-04
router.get('/data-quality', authenticate, getDataQuality);

// GET /api/analytics/employee/:id_karyawan
// Individual employee attendance history and trends
// Query params: ?month=2026-04&days=90
router.get('/employee/:id_karyawan', authenticate, getEmployeeDetail);

// DEBUG endpoint - sample data
router.get('/debug/sample', getDebugCroscekSample);

export default router;
