import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();

// POST /api/auth/email-login
// גרסת demo — כניסה לפי מייל בלבד, ללא סיסמא
// יוחלף ב-Azure AD SSO בגרסה הסופית
router.post('/email-login', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'מייל חסר' });

  const employee = await prisma.employee.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
    select: {
      id: true, fullName: true, email: true,
      jobTitle: true, company: true, isPayrollAdmin: true,
    },
  });

  if (!employee) return res.status(404).json({ error: 'מייל לא נמצא במערכת' });

  const token = jwt.sign(
    { employeeId: employee.id },
    process.env.JWT_SECRET!,
    { expiresIn: '30d' }
  );

  res.json({ token, employee });
});

export default router;
