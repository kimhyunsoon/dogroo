export type PotSize = 'S' | 'M' | 'L';

export interface Species {
  id: number;
  name: string; // 별칭 (한국 유통명)
  name_en: string | null; // 학명
  group_name: string | null;
  water_summer_days: number | null;
  water_winter_days: number | null;
  repot_months: number | null;
  memo: string | null;
}

// 화분 재질
export const POT_TYPES = ['슬릿', '토분', '도자기', '플라스틱', '수경'] as const;

export interface PlantSummary {
  id: number;
  name: string; // 이름 (사용자 작성)
  species_id: number | null;
  species_name: string | null; // 별칭
  species_name_en: string | null; // 학명
  group_name: string | null;
  water_summer_days: number | null;
  water_winter_days: number | null;
  repot_months: number | null;
  started_at: string | null;
  pot_size: PotSize;
  pot_type: string | null;
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
