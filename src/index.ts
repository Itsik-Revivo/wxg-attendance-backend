import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import attendanceRoutes from './routes/attendance.routes';
import employeeRoutes from './routes/employee.routes';
import projectRoutes from './routes/project.routes';
import reportRoutes from './routes/report.routes';
import adminRoutes from './routes/admin.routes';
import emailAuthRoutes from './routes/emailAuth.routes';
import { runSync } from './services/crmSync.service';
import { lockMonth } from './services/monthlyReport.service';
dotenv.config();
const app = express();
const PORT = process.env.PORT ?? 3000;
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));
app.use(express.json());
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));
app.use('/api/auth', emailAuthRoutes);
app.use('/api', authMiddleware);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use(errorHandler);
cron.schedule(process.env.CRM_SYNC_CRON ?? '0 */30 * * * *', async () => {
  try { await runSync(); } catch (err) { logger.error('CRM sync failed', err); }
});
cron.schedule('1 0 2 * *', async () => {
  const now = new Date();
  try { await lockMonth(now.getFullYear(), now.getMonth() + 1); } catch (err) { logger.error('Monthly lock failed', err); }
});
app.listen(PORT, () => {
  logger.info(`WXG Attendance API running on port ${PORT}`);
  runSync().catch(err => logger.error('Initial CRM sync failed', err));
});
export default app;
