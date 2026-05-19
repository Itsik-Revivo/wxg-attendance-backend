import { Router, Response } from 'express';
import { AuthRequest, requirePayrollAdmin } from '../middleware/auth';
import {
  approveMonthlyReport,
  exportMonthToHilan,
  recalculateMonthlyReport,
  HilanColumnMap,
} from '../services/monthlyReport.service';
import { PrismaClient } from '@prisma/client';

const router  = Router();
const prisma  = new PrismaClient();

// Default Hilan column map — update when you share the actual format
const DEFAULT_HILAN_MAP: HilanColumnMap = {
  employeeId:    'מספר עובד',
  employeeName:  'שם עובד',
  month:         'חודש',
  totalHours:    'שעות עבודה',
  overtimeHours: 'שעות נוספות',
  vacationDays:  'ימי חופשה',
  sickDays:      'ימי מחלה',
  reserveDays:   'ימי מילואים',
};

// ============================================================
// GET /api/reports?year=2026&month=5  — list all reports
// (payroll admin sees all; employee sees only their own)
// ============================================================

router.get('/', async (req: AuthRequest, res: Response) => {
  const year  = parseInt(req.query.year  as string) || new Date().getFullYear();
  const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;

  const where = req.employee?.isPayrollAdmin
    ? { year, month }
    : { year, month, employeeId: req.employee!.id };

  const reports = await prisma.monthlyReport.findMany({
    where,
    include: { employee: { select: { fullName: true, company: true, jobTitle: true } } },
    orderBy: { employee: { fullName: 'asc' } },
  });

  res.json(reports);
});

// ============================================================
// GET /api/reports/:id  — single report detail
// ============================================================

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const report = await prisma.monthlyReport.findUnique({
    where: { id: req.params.id },
    include: {
      employee: true,
      timeEntries: {
        include: { project: { select: { name: true, projectCode: true } } },
        orderBy: { startTime: 'asc' },
      },
      absences: true,
    },
  });

  if (!report) return res.status(404).json({ error: 'דוח לא נמצא' });

  // Employee can only see their own
  if (!req.employee?.isPayrollAdmin && report.employeeId !== req.employee!.id) {
    return res.status(403).json({ error: 'אין הרשאה' });
  }

  res.json(report);
});

// ============================================================
// POST /api/reports/:id/approve  — payroll admin only
// ============================================================

router.post(
  '/:id/approve',
  requirePayrollAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const report = await approveMonthlyReport(
        req.params.id,
        req.employee!.id,
        req.body.note
      );
      res.json(report);
    } catch (err: any) {
      if (err.message === 'REPORT_NOT_FOUND')   return res.status(404).json({ error: 'דוח לא נמצא' });
      if (err.message === 'REPORT_NOT_PENDING') return res.status(409).json({ error: 'הדוח אינו ממתין לאישור' });
      throw err;
    }
  }
);

// ============================================================
// POST /api/reports/recalculate — recalculate one employee's report
// ============================================================

router.post('/recalculate', requirePayrollAdmin, async (req: AuthRequest, res: Response) => {
  const { employeeId, year, month } = req.body;
  const report = await recalculateMonthlyReport(employeeId, year, month);
  res.json(report);
});

// ============================================================
// GET /api/reports/export?year=2026&month=5  — download Hilan Excel
// ============================================================

router.get(
  '/export',
  requirePayrollAdmin,
  async (req: AuthRequest, res: Response) => {
    const year  = parseInt(req.query.year  as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;

    const buffer = await exportMonthToHilan(year, month, DEFAULT_HILAN_MAP);

    res.setHeader('Content-Disposition', `attachment; filename=hilan-${year}-${month}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  }
);

export default router;
