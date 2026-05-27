import { PrismaClient, AttendanceSource } from '@prisma/client';
import { resolveLocation, Coordinate } from './geo.service';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export interface ClockInPayload {
  employeeId: string;
  projectId:  string;
  coord?:     Coordinate;
  source:     AttendanceSource;
  isRetroactive?: boolean;
  retroactiveNote?: string;
  retroactiveTime?: Date;  // if retroactive, the actual time
}

export interface ClockOutPayload {
  employeeId: string;
  coord?:     Coordinate;
  source:     AttendanceSource;
  isRetroactive?: boolean;
  retroactiveNote?: string;
  retroactiveTime?: Date;
}

// ============================================================
// Clock In
// ============================================================

export async function clockIn(payload: ClockInPayload) {
  const { employeeId, projectId, coord, source, isRetroactive, retroactiveNote, retroactiveTime } = payload;

  // 1. Verify employee has access to this project
  const access = await prisma.employeeProject.findFirst({
    where: { employeeId, projectId, isActive: true },
  });
  if (!access) {
    throw new Error('UNAUTHORIZED_PROJECT');
  }

  // 2. Check for open entry (already clocked in)
  const openEntry = await getOpenEntry(employeeId);
  if (openEntry) {
    throw new Error('ALREADY_CLOCKED_IN');
  }

  // 3. Resolve location
  const timestamp = retroactiveTime ?? new Date();
  let locationName: string | null = null;
  let insidePolygon = false;

  if (coord) {
    const employeeProjectIds = await getEmployeeProjectIds(employeeId);
    const location = await resolveLocation(coord, employeeProjectIds);
    locationName  = location.locationName;
    insidePolygon = location.insidePolygon;
  }

  // 4. Create attendance log (raw entry)
  const log = await prisma.attendanceLog.create({
    data: {
      employeeId,
      timestamp,
      isEntry: true,
      lat:     coord?.lat,
      lng:     coord?.lng,
      locationName,
      isInsidePolygon: insidePolygon,
      source,
      isRetroactive:   isRetroactive ?? false,
      retroactiveNote: retroactiveNote ?? null,
    },
  });

  // 5. Create open time entry for this project
  const timeEntry = await prisma.timeEntry.create({
    data: {
      employeeId,
      projectId,
      date:      new Date(timestamp.toDateString()),
      startTime: timestamp,
      isRetroactive:   isRetroactive ?? false,
      retroactiveNote: retroactiveNote ?? null,
    },
  });

  logger.info(`Clock in: employee=${employeeId} project=${projectId} retroactive=${isRetroactive}`);
  return { log, timeEntry };
}

// ============================================================
// Clock Out
// ============================================================

export async function clockOut(payload: ClockOutPayload) {
  const { employeeId, coord, source, isRetroactive, retroactiveNote, retroactiveTime } = payload;

  // 1. Find open time entry
  const openEntry = await getOpenEntry(employeeId);
  if (!openEntry) {
    throw new Error('NOT_CLOCKED_IN');
  }

  const timestamp = retroactiveTime ?? new Date();
  const totalMinutes = Math.floor(
    (timestamp.getTime() - openEntry.startTime.getTime()) / 60_000
  );

  // 2. Resolve location
  let locationName: string | null = null;
  let insidePolygon = false;

  if (coord) {
    const employeeProjectIds = await getEmployeeProjectIds(employeeId);
    const location = await resolveLocation(coord, employeeProjectIds);
    locationName  = location.locationName;
    insidePolygon = location.insidePolygon;
  }

  // 3. Create exit attendance log
  const log = await prisma.attendanceLog.create({
    data: {
      employeeId,
      timestamp,
      isEntry: false,
      lat:     coord?.lat,
      lng:     coord?.lng,
      locationName,
      isInsidePolygon: insidePolygon,
      source,
      isRetroactive:   isRetroactive ?? false,
      retroactiveNote: retroactiveNote ?? null,
    },
  });

  // 4. Close time entry
  const timeEntry = await prisma.timeEntry.update({
    where: { id: openEntry.id },
    data: {
      endTime:      timestamp,
      totalMinutes,
    },
  });

  logger.info(`Clock out: employee=${employeeId} duration=${totalMinutes}min`);
  return { log, timeEntry };
}

// ============================================================
// Get current open entry for employee
// ============================================================

async function getOpenEntry(employeeId: string) {
  return prisma.timeEntry.findFirst({
    where: {
      employeeId,
      endTime: null,
    },
    orderBy: { startTime: 'desc' },
  });
}

// ============================================================
// Get employee's accessible project IDs
// ============================================================

async function getEmployeeProjectIds(employeeId: string): Promise<string[]> {
  const access = await prisma.employeeProject.findMany({
    where: { employeeId, isActive: true },
    select: { projectId: true },
  });
  return access.map(a => a.projectId);
}

// ============================================================
// Get today's attendance for an employee
// ============================================================

export async function getTodayAttendance(employeeId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [logs, entries] = await Promise.all([
    prisma.attendanceLog.findMany({
      where: { employeeId, timestamp: { gte: today, lt: tomorrow } },
      orderBy: { timestamp: 'asc' },
    }),
    prisma.timeEntry.findMany({
      where: { employeeId, date: today },
      include: { project: { select: { id: true, name: true, projectCode: true } } },
      orderBy: { startTime: 'asc' },
    }),
  ]);

  const isCurrentlyClockedIn = entries.some(e => !e.endTime);

  return { logs, entries, isCurrentlyClockedIn };
}
