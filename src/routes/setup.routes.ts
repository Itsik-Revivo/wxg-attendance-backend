import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.post('/init', async (req: Request, res: Response) => {
  try {
    const { email, fullName } = req.body;

    // צור טבלאות אם לא קיימות
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Employee" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "crmId" TEXT UNIQUE NOT NULL,
        "adId" TEXT UNIQUE,
        "crmNumerator" TEXT,
        "fullName" TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        "idNumber" TEXT,
        "jobTitle" TEXT,
        company TEXT NOT NULL DEFAULT 'WAXMAN_GROUP',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "isPayrollAdmin" BOOLEAN NOT NULL DEFAULT false,
        "lastSyncedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // הוסף עובד
    const result = await prisma.$executeRawUnsafe(`
      INSERT INTO "Employee" (id, "crmId", "fullName", email, company, "isActive", "isPayrollAdmin", "updatedAt")
      VALUES (gen_random_uuid()::text, 'admin-001', '${fullName}', '${email}', 'WAXMAN_GROUP', true, true, NOW())
      ON CONFLICT ("crmId") DO UPDATE SET email = '${email}', "fullName" = '${fullName}', "updatedAt" = NOW()
    `);

    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;