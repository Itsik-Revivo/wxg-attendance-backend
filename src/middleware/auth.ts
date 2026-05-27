import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  employee?: { id: string; isPayrollAdmin: boolean; company: string };
}

// ── Auth middleware — תומך ב-JWT פשוט (demo) ──────────────────
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);

  try {
    // JWT פשוט (גרסת demo)
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { employeeId: string };

    const employee = await prisma.employee.findUnique({
      where:  { id: payload.employeeId },
      select: { id: true, isPayrollAdmin: true, company: true, isActive: true },
    });

    if (!employee)          return res.status(403).json({ error: 'עובד לא נמצא' });
    if (!employee.isActive) return res.status(403).json({ error: 'חשבון לא פעיל' });

    req.employee = employee;
    next();
  } catch {
    return res.status(401).json({ error: 'Token לא תקין' });
  }
}

// ── Payroll admin guard ────────────────────────────────────────
export function requirePayrollAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.employee?.isPayrollAdmin) {
    return res.status(403).json({ error: 'נדרשת הרשאת חשב/ת שכר' });
  }
  next();
}
