export type PotSize = 'S' | 'M' | 'L';

export interface Species {
  id: number;
  name: string;
  name_en: string | null;
  water_summer_days: number | null;
  water_winter_days: number | null;
  repot_months: number | null;
  memo: string | null;
}

export interface PlantSummary {
  id: number;
  name: string;
  species_id: number | null;
  species_name: string | null;
  water_summer_days: number | null;
  water_winter_days: number | null;
  repot_months: number | null;
  started_at: string | null;
  pot_size: PotSize;
  water_interval_days: number | null;
  repot_interval_months: number | null;
  memo: string | null;
  archived_at: string | null;
  last_watered_at: string | null;
  last_repotted_at: string | null;
  photo: string | null;
  recommended_water_days: number | null;
  recommended_repot_months: number | null;
  effective_water_days: number | null;
  effective_repot_months: number | null;
  next_water_at: string | null;
  next_repot_at: string | null;
  water_dday: number | null; // 음수 = 지남, 0 = 오늘
  repot_dday: number | null;
}

export interface Photo {
  id: number;
  path: string;
  taken_at: string;
  is_primary: number;
}

export interface WateringLog {
  id: number;
  watered_at: string;
  memo: string | null;
}

export interface RepottingLog {
  id: number;
  repotted_at: string;
  pot_size: PotSize | null;
  memo: string | null;
}

export interface PlantDetail extends PlantSummary {
  photos: Photo[];
  waterings: WateringLog[];
  repottings: RepottingLog[];
}

export interface NotificationSetting {
  type: 'watering' | 'repotting' | 'reminder';
  enabled: number;
  send_at: string;
}
