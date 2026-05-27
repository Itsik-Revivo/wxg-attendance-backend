// src/routes/employee.routes.ts
import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest, requirePayrollAdmin } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// GET /api/employees/me — current employee profile
router.get('/me', async (req: AuthRequest, res: Response) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.employee!.id },
    include: {
      workAgreements: { where: { isActive: true } },
      projectAccess:  { where: { isActive: true }, include: { project: { select: { id: true, name: true } } } },
    },
  });
  res.json(employee);
});

// GET /api/employees — payroll admin only
router.get('/', requirePayrollAdmin, async (_req: AuthRequest, res: Response) => {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: { fullName: 'asc' },
    include: { workAgreements: { where: { isActive: true } } },
  });
  res.json(employees);
});

export default router;
