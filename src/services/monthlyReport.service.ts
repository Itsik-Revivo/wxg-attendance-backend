import { PrismaClient, ReportStatus, WorkAgreementType } from '@prisma/client';
import { startOfMonth, endOfMonth, getDaysInMonth, isWeekend } from 'date-fns';
import * as XLSX from 'xlsx';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// ============================================================
// Create or get monthly report for employee
// ============================================================

export async function getOrCreateMonthlyReport(
  employeeId: string,
  year: number,
  month: number
) {
  return prisma.monthlyReport.upsert({
    where: { employeeId_year_month: { employeeId, year, month } },
    create: { employeeId, year, month },
    update: {},
  });
}

// ============================================================
// Calculate and update monthly totals
// ============================================================

export async function recalculateMonthlyReport(
  employeeId: string,
  year: number,
  month: number
) {
  const report = await getOrCreateMonthlyReport(employeeId, year, month);

  if (report.status === ReportStatus.LOCKED) {
    throw new Error('REPORT_LOCKED');
  }

  const monthStart = startOfMonth(new Date(year, month - 1));
  const monthEnd   = endOfMonth(new Date(year, month - 1));

  // Sum all time entries for the month
  const entries = await prisma.timeEntry.findMany({
    where: {
      employeeId,
      date: { gte: monthStart, lte: monthEnd },
    },
  });

  const totalWorkedMinutes = entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);

  // Get work agreement for expected hours
  const agreement = await getActiveAgreement(employeeId, monthStart);
  const expectedMinutes = calculateExpectedMinutes(agreement, year, month);

  const overtimeMinutes = Math.max(0, totalWorkedMinutes - expectedMinutes);

  // Sum absences
  const absences = await prisma.absence.findMany({
    where: {
      employeeId,
      startDate: { gte: monthStart },
      endDate:   { lte: monthEnd },
    },
  });
  const absenceMinutes = absences.reduce((sum, a) => sum + a.totalDays * 60 * 8, 0);

  // Link entries to report
  await prisma.timeEntry.updateMany({
    where: { employeeId, date: { gte: monthStart, lte: monthEnd } },
    data: { monthlyReportId: report.id },
  });

  await prisma.absence.updateMany({
    where: { employeeId, startDate: { gte: monthStart } },
    data: { monthlyReportId: report.id },
  });

  return prisma.monthlyReport.update({
    where: { id: report.id },
    data: { totalWorkedMinutes, expectedMinutes, overtimeMinutes, absenceMinutes },
  });
}

// ============================================================
// Lock month (called automatically on 2nd of each month)
// ============================================================

export async function lockMonth(year: number, month: number) {
  const previousMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

  logger.info(`Locking month ${previousMonth.year}/${previousMonth.month}`);

  // Recalculate all reports before locking
  const reports = await prisma.monthlyReport.findMany({
    where: {
      year:  previousMonth.year,
      month: previousMonth.month,
      status: { not: ReportStatus.LOCKED },
    },
  });

  for (const report of reports) {
    await recalculateMonthlyReport(report.employeeId, previousMonth.year, previousMonth.month);
  }

  // Set all to PENDING (waiting for payroll admin approval)
  await prisma.monthlyReport.updateMany({
    where: { year: previousMonth.year, month: previousMonth.month, status: ReportStatus.OPEN },
    data: { status: ReportStatus.PENDING },
  });

  logger.info(`Month locked: ${reports.length} reports set to PENDING`);
}

// ============================================================
// Approve monthly report (payroll admin)
// ============================================================

export async function approveMonthlyReport(
  reportId: string,
  payrollAdminId: string,
  note?: string
) {
  const report = await prisma.monthlyReport.findUnique({ where: { id: reportId } });

  if (!report) throw new Error('REPORT_NOT_FOUND');
  if (report.status !== ReportStatus.PENDING) throw new Error('REPORT_NOT_PENDING');

  return prisma.monthlyReport.update({
    where: { id: reportId },
    data: {
      status:      ReportStatus.APPROVED,
      approvedBy:  payrollAdminId,
      approvedAt:  new Date(),
      approvalNote: note ?? null,
    },
  });
}

// ============================================================
// Export to Hilan Excel format
// ============================================================

export async function exportMonthToHilan(
  year: number,
  month: number,
  hilanTemplate: HilanColumnMap
): Promise<Buffer> {
  const reports = await prisma.monthlyReport.findMany({
    where: { year, month, status: ReportStatus.APPROVED },
    include: {
      employee: true,
      timeEntries: {
        include: { project: { select: { name: true, projectCode: true } } },
      },
      absences: true,
    },
  });

  const rows: any[] = [];

  for (const report of reports) {
    const emp = report.employee;

    // Build row according to the Hilan format template
    // The hilanTemplate maps our fields to the expected column names
    const row: Record<string, any> = {};

    row[hilanTemplate.employeeId]    = emp.idNumber ?? emp.crmNumerator ?? '';
    row[hilanTemplate.employeeName]  = emp.fullName;
    row[hilanTemplate.month]         = `${month}/${year}`;
    row[hilanTemplate.totalHours]    = +(report.totalWorkedMinutes / 60).toFixed(2);
    row[hilanTemplate.overtimeHours] = +(report.overtimeMinutes / 60).toFixed(2);
    row[hilanTemplate.vacationDays]  = report.absences
      .filter(a => a.absenceType === 'VACATION')
      .reduce((s, a) => s + a.totalDays, 0);
    row[hilanTemplate.sickDays]      = report.absences
      .filter(a => a.absenceType === 'SICK')
      .reduce((s, a) => s + a.totalDays, 0);
    row[hilanTemplate.reserveDays]   = report.absences
      .filter(a => a.absenceType === 'RESERVE')
      .reduce((s, a) => s + a.totalDays, 0);

    rows.push(row);
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${month}-${year}`);

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // Mark as exported
  await prisma.monthlyReport.updateMany({
    where: { year, month, status: ReportStatus.APPROVED },
    data: { exportedAt: new Date() },
  });

  return buffer;
}

// ============================================================
// Hilan column map — filled in when you provide the format
// ============================================================

export interface HilanColumnMap {
  employeeId:    string;
  employeeName:  string;
  month:         string;
  totalHours:    string;
  overtimeHours: string;
  vacationDays:  string;
  sickDays:      string;
  reserveDays:   string;
  // add more columns as needed once you share the format
}

// ============================================================
// Helpers
// ============================================================

async function getActiveAgreement(employeeId: string, date: Date) {
  return prisma.workAgreement.findFirst({
    where: {
      employeeId,
      isActive:  true,
      validFrom: { lte: date },
      OR: [{ validTo: null }, { validTo: { gte: date } }],
    },
    orderBy: { validFrom: 'desc' },
  });
}

function calculateExpectedMinutes(agreement: any, year: number, month: number): number {
  if (!agreement) return 0;

  if (agreement.agreementType === WorkAgreementType.GLOBAL) {
    return (agreement.monthlyHours ?? 0) * 60;
  }

  // For hourly/shifts: count working days × daily hours
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  let workingDays = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    // Sunday (0) is a work day in Israel, Saturday (6) is not
    // Adjust as needed for your company's work week
    if (date.getDay() !== 6) workingDays++;
  }

  return workingDays * (agreement.dailyHours ?? 0) * 60;
}
