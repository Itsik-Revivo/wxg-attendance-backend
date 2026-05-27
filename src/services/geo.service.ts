import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface LocationMatch {
  insidePolygon: boolean;
  locationName: string | null;
  locationType: 'project' | 'office' | null;
  locationId: string | null;
}

// ============================================================
// Ray casting algorithm — point in polygon
// ============================================================

export function isPointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
  const { lat: y, lng: x } = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

// ============================================================
// Check GPS coordinates against all known locations
// ============================================================

export async function resolveLocation(
  coord: Coordinate,
  projectIds?: string[]  // optional: only check projects employee has access to
): Promise<LocationMatch> {

  // 1. Check office locations first (always available)
  const offices = await prisma.officeLocation.findMany({
    where: { isActive: true },
  });

  for (const office of offices) {
    const polygon = parsePolygon(office.polygon);
    if (isPointInPolygon(coord, polygon)) {
      return {
        insidePolygon: true,
        locationName: office.name,
        locationType: 'office',
        locationId: office.id,
      };
    }
  }

  // 2. Check project polygons (only active projects employee can access)
  const whereClause = projectIds?.length
    ? { projectId: { in: projectIds } }
    : {};

  const projectLocations = await prisma.projectLocation.findMany({
    where: whereClause,
    include: { project: { select: { name: true, isActive: true } } },
  });

  for (const loc of projectLocations) {
    if (!loc.project.isActive) continue;
    const polygon = parsePolygon(loc.polygon);
    if (isPointInPolygon(coord, polygon)) {
      return {
        insidePolygon: true,
        locationName: loc.project.name,
        locationType: 'project',
        locationId: loc.projectId,
      };
    }
  }

  // 3. Not inside any polygon — return coordinates as text
  return {
    insidePolygon: false,
    locationName: null,
    locationType: null,
    locationId: null,
  };
}

// ============================================================
// Parse polygon JSON from DB
// ============================================================

function parsePolygon(raw: any): Coordinate[] {
  // Stored as [[lat, lng], [lat, lng], ...]
  if (Array.isArray(raw)) {
    return raw.map((p: any) => {
      if (Array.isArray(p)) return { lat: p[0], lng: p[1] };
      return { lat: p.lat, lng: p.lng };
    });
  }
  return [];
}

// ============================================================
// Calculate polygon centroid (for DB storage)
// ============================================================

export function polygonCentroid(polygon: Coordinate[]): Coordinate {
  const lat = polygon.reduce((sum, p) => sum + p.lat, 0) / polygon.length;
  const lng = polygon.reduce((sum, p) => sum + p.lng, 0) / polygon.length;
  return { lat, lng };
}
