import { Request, Response, NextFunction } from 'express';
import { expressjwt } from 'express-jwt';
import jwksRsa from 'jwks-rsa';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  auth?: { oid?: string; preferred_username?: string; name?: string };
  employee?: { id: string; isPayrollAdmin: boolean; company: string };
}

// ============================================================
// Azure AD JWT validation
// ============================================================

const tenantId  = process.env.AZURE_TENANT_ID!;
const clientId  = process.env.AZURE_CLIENT_ID!;

export const jwtCheck = expressjwt({
  secret: jwksRsa.expressJwtSecret({
    cache:              true,
    rateLimit:          true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  }) as any,
  audience: clientId,
  issuer: [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
  ],
  algorithms: ['RS256'],
});

// ============================================================
// Resolve employee from Azure AD OID
// ============================================================

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  // 1. Validate JWT
  await new Promise<void>((resolve, reject) => {
    jwtCheck(req, res, (err) => (err ? reject(err) : resolve()));
  }).catch(() => {
    return res.status(401).json({ error: 'Unauthorized' });
  });

  if (res.headersSent) return;

  // 2. Lookup employee by Azure AD OID (rtm_s_adid in CRM)
  const adId = req.auth?.oid;
  if (!adId) return res.status(401).json({ error: 'Missing Azure AD OID' });

  const employee = await prisma.employee.findUnique({
    where: { adId },
    select: { id: true, isPayrollAdmin: true, company: true, isActive: true },
  });

  if (!employee)        return res.status(403).json({ error: 'עובד לא נמצא במערכת' });
  if (!employee.isActive) return res.status(403).json({ error: 'חשבון לא פעיל' });

  req.employee = employee;
  next();
}

// ============================================================
// Payroll admin guard
// ============================================================

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
