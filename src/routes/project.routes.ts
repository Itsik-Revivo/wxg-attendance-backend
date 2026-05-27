import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest, requirePayrollAdmin } from '../middleware/auth';
import { body, validationResult } from 'express-validator';
import { polygonCentroid } from '../services/geo.service';

const router = Router();
const prisma = new PrismaClient();

// GET /api/projects — employee sees only their authorized projects
router.get('/', async (req: AuthRequest, res: Response) => {
  const employeeId = req.employee!.id;

  const access = await prisma.employeeProject.findMany({
    where: { employeeId, isActive: true },
    include: {
      project: {
        include: { location: true },
      },
    },
  });

  const projects = access
    .filter(a => a.project.isActive)
    .map(a => ({
      ...a.project,
      hasPolygon: !!a.project.location,
    }));

  res.json(projects);
});

// POST /api/projects/:id/polygon — admin sets polygon for a project
router.post(
  '/:id/polygon',
  requirePayrollAdmin,
  [
    body('polygon').isArray({ min: 3 }),
    body('polygon.*.lat').isFloat({ min: 29, max: 34 }), // Israel bounds
    body('polygon.*.lng').isFloat({ min: 34, max: 36 }),
    body('name').isString().notEmpty(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'פרויקט לא נמצא' });

    const { polygon, name } = req.body;
    const center = polygonCentroid(polygon);

    const location = await prisma.projectLocation.upsert({
      where: { projectId: req.params.id },
      create: {
        projectId:  req.params.id,
        name,
        polygon,
        centerLat:  center.lat,
        centerLng:  center.lng,
      },
      update: { name, polygon, centerLat: center.lat, centerLng: center.lng },
    });

    res.json(location);
  }
);

// POST /api/projects/offices — admin manages office locations
router.post(
  '/offices',
  requirePayrollAdmin,
  [
    body('name').isString().notEmpty(),
    body('polygon').isArray({ min: 3 }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, polygon } = req.body;
    const center = polygonCentroid(polygon);

    const office = await prisma.officeLocation.create({
      data: { name, polygon, centerLat: center.lat, centerLng: center.lng },
    });

    res.status(201).json(office);
  }
);

export default router;
