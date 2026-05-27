import { Router, Response } from 'express';
import { PrismaClient, WorkAgreementType } from '@prisma/client';
import { AuthRequest, requirePayrollAdmin } from '../middleware/auth';
import { body, validationResult } from 'express-validator';
import { runSync } from '../services/crmSync.service';

const router = Router();
const prisma = new PrismaClient();

// POST /api/admin/sync — manually trigger CRM sync
router.post('/sync', requirePayrollAdmin, async (_req: AuthRequest, res: Response) => {
  const full = _req.query.full === 'true';
  // Run async — don't block response
  runSync(full).catch(console.error);
  res.json({ message: `סנכרון ${full ? 'מלא' : 'אינקרמנטלי'} הופעל` });
});

// POST /api/admin/work-agreements — set work agreement for employee
router.post(
  '/work-agreements',
  requirePayrollAdmin,
  [
    body('employeeId').isUUID(),
    body('agreementType').isIn(Object.values(WorkAgreementType)),
    body('validFrom').isISO8601(),
    body('validTo').optional().isISO8601(),
    body('dailyHours').optional().isFloat({ min: 0, max: 24 }),
    body('weeklyHours').optional().isFloat({ min: 0, max: 168 }),
    body('monthlyHours').optional().isFloat({ min: 0 }),
    body('overtime125From').optional().isFloat(),
    body('overtime150From').optional().isFloat(),
    body('breakMinutes').optional().isInt({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { employeeId, agreementType, validFrom, validTo, ...rest } = req.body;

    // Deactivate previous agreement
    await prisma.workAgreement.updateMany({
      where: { employeeId, isActive: true },
      data: { isActive: false, validTo: new Date(validFrom) },
    });

    const agreement = await prisma.workAgreement.create({
      data: {
        employeeId,
        agreementType,
        validFrom: new Date(validFrom),
        validTo:   validTo ? new Date(validTo) : null,
        ...rest,
      },
    });

    res.status(201).json(agreement);
  }
);

// GET /api/admin/sync-log — last sync statuses
router.get('/sync-log', requirePayrollAdmin, async (_req: AuthRequest, res: Response) => {
  const logs = await prisma.crmSyncLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
  res.json(logs);
});

export default router;
