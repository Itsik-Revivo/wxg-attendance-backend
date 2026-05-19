import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { AttendanceSource } from '@prisma/client';
import { clockIn, clockOut, getTodayAttendance } from '../services/attendance.service';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// ============================================================
// POST /api/attendance/clock-in
// ============================================================

router.post(
  '/clock-in',
  [
    body('projectId').isUUID(),
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('source').optional().isIn(Object.values(AttendanceSource)),
    body('isRetroactive').optional().isBoolean(),
    body('retroactiveNote').optional().isString().isLength({ max: 500 }),
    body('retroactiveTime').optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { projectId, lat, lng, source, isRetroactive, retroactiveNote, retroactiveTime } = req.body;

      const result = await clockIn({
        employeeId: req.employee!.id,
        projectId,
        coord: lat !== undefined ? { lat, lng } : undefined,
        source: source ?? AttendanceSource.APP,
        isRetroactive,
        retroactiveNote,
        retroactiveTime: retroactiveTime ? new Date(retroactiveTime) : undefined,
      });

      res.status(201).json(result);
    } catch (err: any) {
      if (err.message === 'UNAUTHORIZED_PROJECT') return res.status(403).json({ error: 'אין הרשאה לפרויקט זה' });
      if (err.message === 'ALREADY_CLOCKED_IN')   return res.status(409).json({ error: 'כבר מחתים נוכחות' });
      throw err;
    }
  }
);

// ============================================================
// POST /api/attendance/clock-out
// ============================================================

router.post(
  '/clock-out',
  [
    body('lat').optional().isFloat(),
    body('lng').optional().isFloat(),
    body('source').optional().isIn(Object.values(AttendanceSource)),
    body('isRetroactive').optional().isBoolean(),
    body('retroactiveTime').optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { lat, lng, source, isRetroactive, retroactiveNote, retroactiveTime } = req.body;

      const result = await clockOut({
        employeeId: req.employee!.id,
        coord: lat !== undefined ? { lat, lng } : undefined,
        source: source ?? AttendanceSource.APP,
        isRetroactive,
        retroactiveNote,
        retroactiveTime: retroactiveTime ? new Date(retroactiveTime) : undefined,
      });

      res.json(result);
    } catch (err: any) {
      if (err.message === 'NOT_CLOCKED_IN') return res.status(409).json({ error: 'אין חתימת כניסה פתוחה' });
      throw err;
    }
  }
);

// ============================================================
// GET /api/attendance/today
// ============================================================

router.get('/today', async (req: AuthRequest, res: Response) => {
  const result = await getTodayAttendance(req.employee!.id);
  res.json(result);
});

// ============================================================
// GET /api/attendance/month?year=2026&month=5
// ============================================================

router.get('/month', async (req: AuthRequest, res: Response) => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const year  = parseInt(req.query.year as string)  || new Date().getFullYear();
  const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 0);

  const entries = await prisma.timeEntry.findMany({
    where: {
      employeeId: req.employee!.id,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: { project: { select: { id: true, name: true, projectCode: true } } },
    orderBy: { startTime: 'asc' },
  });

  res.json(entries);
});

export default router;
