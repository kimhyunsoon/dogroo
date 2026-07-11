import { db } from './db.js';
import { addDays, addMonths, diffDays } from './dates.js';
import { recommendedWaterDays, recommendedRepotMonths, type PotSize } from './recommend.js';

interface PlantRow {
  id: number;
  name: string;
  species_id: number | null;
  started_at: string | null;
  pot_size: PotSize;
  pot_type: string | null;
  water_interval_days: number | null;
  repot_interval_months: number | null;
  memo: string | null;
  archived_at: string | null;
  species_name: string | null;
  species_name_en: string | null;
  group_name: string | null;
  water_summer_days: number | null;
  water_winter_days: number | null;
  repot_months: number | null;
  last_watered_at: string | null;
  last_repotted_at: string | null;
  photo: string | null;
}

export interface EnrichedPlant extends PlantRow {
  recommended_water_days: number | null;
  recommended_repot_months: number | null;
  effective_water_days: number | null;
  effective_repot_months: number | null;
  next_water_at: string | null;
  next_repot_at: string | null;
  water_dday: number | null; // 음수 = 지남, 0 = 오늘
  repot_dday: number | null;
}

const LIST_SQL = `
SELECT p.*, s.name AS species_name, s.name_en AS species_name_en, s.group_name,
  s.water_summer_days, s.water_winter_days, s.repot_months,
  (SELECT MAX(watered_at) FROM watering_logs w WHERE w.plant_id = p.id) AS last_watered_at,
  (SELECT MAX(repotted_at) FROM repotting_logs r WHERE r.plant_id = p.id) AS last_repotted_at,
  (SELECT path FROM photos ph WHERE ph.plant_id = p.id
    ORDER BY ph.is_primary DESC, ph.taken_at DESC, ph.id DESC LIMIT 1) AS photo
FROM plants p LEFT JOIN species s ON s.id = p.species_id`;

function enrich(row: PlantRow, today: string): EnrichedPlant {
  const species = row.species_id
    ? {
        water_summer_days: row.water_summer_days,
        water_winter_days: row.water_winter_days,
        repot_months: row.repot_months,
      }
    : null;
  const recWater = recommendedWaterDays(species, row.pot_size, today);
  const recRepot = recommendedRepotMonths(species);
  const waterDays = row.water_interval_days ?? recWater;
  const repotMonths = row.repot_interval_months ?? recRepot;

  const lastWatered = row.last_watered_at ? row.last_watered_at.slice(0, 10) : null;
  const nextWater = lastWatered && waterDays ? addDays(lastWatered, waterDays) : null;
  const repotBase = row.last_repotted_at ? row.last_repotted_at.slice(0, 10) : row.started_at;
  const nextRepot = repotBase && repotMonths ? addMonths(repotBase.slice(0, 10), repotMonths) : null;

  return {
    ...row,
    recommended_water_days: recWater,
    recommended_repot_months: recRepot,
    effective_water_days: waterDays,
    effective_repot_months: repotMonths,
    next_water_at: nextWater,
    next_repot_at: nextRepot,
    water_dday: nextWater ? diffDays(nextWater, today) : null,
    repot_dday: nextRepot ? diffDays(nextRepot, today) : null,
  };
}

export function listPlants(today: string, includeArchived: boolean): EnrichedPlant[] {
  const where = includeArchived ? '' : ' WHERE p.archived_at IS NULL';
  const rows = db.prepare(LIST_SQL + where + ' ORDER BY p.name').all() as PlantRow[];
  return rows.map((r) => enrich(r, today));
}

export function getPlant(id: number | string, today: string): EnrichedPlant | null {
  const row = db.prepare(LIST_SQL + ' WHERE p.id = ?').get(id) as PlantRow | undefined;
  return row ? enrich(row, today) : null;
}
