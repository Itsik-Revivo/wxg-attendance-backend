import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const router = Router();
const prisma = new PrismaClient();

// endpoint זמני לאתחול DB — למחוק אחרי השימוש!
router.post('/init', async (req: Request, res: Response) => {
  try {
    // הרץ migrations
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });

    // צור עובד ראשון
    const { email, fullName } = req.body;

    const employee = await prisma.employee.upsert({
      where: { crmId: 'admin-001' },
      create: {
        crmId:    'admin-001',
        fullName: fullName || 'מנהל מערכת',
        email:    email,
        company:  'WAXMAN_GROUP',
        isActive: true,
        isPayrollAdmin: true,
      },
      update: { email, fullName },
    });

    res.json({ success: true, employee });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;