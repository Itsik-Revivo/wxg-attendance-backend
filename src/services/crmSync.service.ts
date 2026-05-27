import axios from 'axios';
import { PrismaClient, CompanyEntity, SyncStatus } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// ============================================================
// GraphQL Queries
// ============================================================

const EMPLOYEES_QUERY = `
  query GetEmployees($since: Unix) {
    rtm_wxg_empl(since: $since, active: true) {
      rtm_wxg_emplid
      rtm_name
      rtm_s_adid
      rtm_s_mail
      rtm_s_telephone
      rtm_s_id_employee
      rtm_s_title
      rtm_nu_crm_employee
      rtm_id_companyclass_wxg
      statecode
    }
  }
`;

const PROJECTS_QUERY = `
  query GetProjects($since: Unix) {
    rtm_projects(since: $since) {
      rtm_projectsid
      rtm_name
      rtm_s_project
      rtm_auto_code
      rtm_s_description
      rtm_id_department
      statecode
    }
  }
`;

const CONNECTIONS_QUERY = `
  query GetConnections($since: Unix) {
    connection(since: $since, table1: "rtm_wxg_empl", table2: "rtm_projects") {
      connectionid
      record1id
      record2id
      statecode
    }
  }
`;

// ============================================================
// Company mapping from CRM reference to our enum
// ============================================================

// rtm_id_companyclass_wxg holds a reference ID — map it to CompanyEntity
// You'll need to populate this map based on your CRM's actual company type IDs
const COMPANY_MAP: Record<string, CompanyEntity> = {
  // These keys are the CRM reference IDs for each company entity
  // TODO: Fill in actual CRM IDs after first sync
  'waxman-group-id':           CompanyEntity.WAXMAN_GROUP,
  'waxman-consultants-id':     CompanyEntity.WAXMAN_CONSULTANTS,
  'waxman-management-id':      CompanyEntity.WAXMAN_MANAGEMENT,
  'waxman-infrastructure-id':  CompanyEntity.WAXMAN_INFRASTRUCTURE,
};

function mapCompany(crmRef: any): CompanyEntity {
  if (!crmRef) return CompanyEntity.WAXMAN_GROUP;
  const id = typeof crmRef === 'object' ? crmRef.id || crmRef.logicalName : crmRef;
  return COMPANY_MAP[id] ?? CompanyEntity.WAXMAN_GROUP;
}

// ============================================================
// GraphQL client
// ============================================================

async function crmQuery<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
  const response = await axios.post(
    process.env.CRM_GRAPHQL_URL!,
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CRM_API_KEY!,
      },
      timeout: 30_000,
    }
  );

  if (response.data.errors) {
    throw new Error(`CRM GraphQL error: ${JSON.stringify(response.data.errors)}`);
  }

  return response.data.data as T;
}

// ============================================================
// Sync employees
// ============================================================

async function syncEmployees(since?: Date): Promise<{ processed: number; failed: number }> {
  const sinceUnix = since ? Math.floor(since.getTime() / 1000) : undefined;
  
  const data = await crmQuery<{ rtm_wxg_empl: any[] }>(
    EMPLOYEES_QUERY,
    sinceUnix ? { since: sinceUnix } : {}
  );

  const employees = data.rtm_wxg_empl ?? [];
  let processed = 0;
  let failed = 0;

  for (const emp of employees) {
    try {
      await prisma.employee.upsert({
        where: { crmId: emp.rtm_wxg_emplid },
        create: {
          crmId:        emp.rtm_wxg_emplid,
          adId:         emp.rtm_s_adid || null,
          crmNumerator: emp.rtm_nu_crm_employee || null,
          fullName:     emp.rtm_name,
          email:        emp.rtm_s_mail || null,
          phone:        emp.rtm_s_telephone || null,
          idNumber:     emp.rtm_s_id_employee || null,
          jobTitle:     emp.rtm_s_title || null,
          company:      mapCompany(emp.rtm_id_companyclass_wxg),
          isActive:     emp.statecode?.value === 0, // 0 = Active in Dynamics
          lastSyncedAt: new Date(),
        },
        update: {
          adId:         emp.rtm_s_adid || null,
          fullName:     emp.rtm_name,
          email:        emp.rtm_s_mail || null,
          phone:        emp.rtm_s_telephone || null,
          idNumber:     emp.rtm_s_id_employee || null,
          jobTitle:     emp.rtm_s_title || null,
          company:      mapCompany(emp.rtm_id_companyclass_wxg),
          isActive:     emp.statecode?.value === 0,
          lastSyncedAt: new Date(),
        },
      });
      processed++;
    } catch (err) {
      logger.error(`Failed to sync employee ${emp.rtm_wxg_emplid}`, err);
      failed++;
    }
  }

  return { processed, failed };
}

// ============================================================
// Sync projects
// ============================================================

async function syncProjects(since?: Date): Promise<{ processed: number; failed: number }> {
  const sinceUnix = since ? Math.floor(since.getTime() / 1000) : undefined;

  const data = await crmQuery<{ rtm_projects: any[] }>(
    PROJECTS_QUERY,
    sinceUnix ? { since: sinceUnix } : {}
  );

  const projects = data.rtm_projects ?? [];
  let processed = 0;
  let failed = 0;

  for (const proj of projects) {
    try {
      const isActive = proj.statecode?.value === 0;
      
      await prisma.project.upsert({
        where: { crmId: proj.rtm_projectsid },
        create: {
          crmId:       proj.rtm_projectsid,
          projectCode: proj.rtm_s_project || proj.rtm_auto_code || null,
          name:        proj.rtm_name,
          description: proj.rtm_s_description || null,
          isActive,
          lastSyncedAt: new Date(),
        },
        update: {
          projectCode: proj.rtm_s_project || proj.rtm_auto_code || null,
          name:        proj.rtm_name,
          description: proj.rtm_s_description || null,
          isActive,
          lastSyncedAt: new Date(),
        },
      });
      processed++;
    } catch (err) {
      logger.error(`Failed to sync project ${proj.rtm_projectsid}`, err);
      failed++;
    }
  }

  return { processed, failed };
}

// ============================================================
// Sync connections (employee ↔ project permissions)
// ============================================================

async function syncConnections(since?: Date): Promise<{ processed: number; failed: number }> {
  const sinceUnix = since ? Math.floor(since.getTime() / 1000) : undefined;

  const data = await crmQuery<{ connection: any[] }>(
    CONNECTIONS_QUERY,
    sinceUnix ? { since: sinceUnix } : {}
  );

  const connections = data.connection ?? [];
  let processed = 0;
  let failed = 0;

  for (const conn of connections) {
    try {
      // record1id = employee, record2id = project (or vice versa — handle both)
      const record1 = conn.record1id?.id;
      const record2 = conn.record2id?.id;

      if (!record1 || !record2) continue;

      // Find matching employee and project (either direction)
      const [employee, project] = await Promise.all([
        prisma.employee.findFirst({ where: { crmId: { in: [record1, record2] } } }),
        prisma.project.findFirst({ where: { crmId: { in: [record1, record2] } } }),
      ]);

      if (!employee || !project) continue;

      const isActive = conn.statecode?.value === 0;

      await prisma.employeeProject.upsert({
        where: { crmConnectionId: conn.connectionid },
        create: {
          crmConnectionId: conn.connectionid,
          employeeId: employee.id,
          projectId:  project.id,
          isActive,
        },
        update: {
          isActive,
        },
      });
      processed++;
    } catch (err) {
      logger.error(`Failed to sync connection ${conn.connectionid}`, err);
      failed++;
    }
  }

  return { processed, failed };
}

// ============================================================
// Main sync runner
// ============================================================

export async function runSync(fullSync = false): Promise<void> {
  logger.info(`Starting CRM sync (${fullSync ? 'full' : 'incremental'})`);

  // Get last successful sync time for incremental
  const since = fullSync ? undefined : await getLastSyncTime();

  for (const entity of ['employees', 'projects', 'connections'] as const) {
    const logEntry = await prisma.crmSyncLog.create({
      data: { entity, status: SyncStatus.PENDING, startedAt: new Date() },
    });

    try {
      let result = { processed: 0, failed: 0 };

      if (entity === 'employees')   result = await syncEmployees(since);
      if (entity === 'projects')    result = await syncProjects(since);
      if (entity === 'connections') result = await syncConnections(since);

      await prisma.crmSyncLog.update({
        where: { id: logEntry.id },
        data: {
          status: result.failed > 0 ? SyncStatus.FAILED : SyncStatus.SUCCESS,
          recordsProcessed: result.processed,
          recordsFailed:    result.failed,
          completedAt:      new Date(),
        },
      });

      logger.info(`Sync ${entity}: ${result.processed} ok, ${result.failed} failed`);
    } catch (err: any) {
      await prisma.crmSyncLog.update({
        where: { id: logEntry.id },
        data: {
          status:       SyncStatus.FAILED,
          errorMessage: err.message,
          completedAt:  new Date(),
        },
      });
      logger.error(`Sync ${entity} failed`, err);
    }
  }

  logger.info('CRM sync complete');
}

async function getLastSyncTime(): Promise<Date | undefined> {
  const last = await prisma.crmSyncLog.findFirst({
    where: { status: SyncStatus.SUCCESS },
    orderBy: { completedAt: 'desc' },
  });
  return last?.completedAt ?? undefined;
}
