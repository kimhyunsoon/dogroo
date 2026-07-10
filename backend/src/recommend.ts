import { monthOf } from './dates.js';

export type PotSize = 'S' | 'M' | 'L';

export interface SpeciesIntervals {
  water_summer_days: number | null;
  water_winter_days: number | null;
  repot_months: number | null;
}

// 화분이 작을수록 빨리 마르므로 주기 단축 (docs/overview.html 추천 로직)
const POT_FACTOR: Record<PotSize, number> = { S: 0.8, M: 1.0, L: 1.3 };

// 4~9월 여름 주기, 10~3월 겨울 주기
export function isSummer(date: string): boolean {
  const m = monthOf(date);
  return m >= 4 && m <= 9;
}

// 종 데이터가 없을 때의 기본값 - D-day가 항상 계산되도록 보장
const FALLBACK_WATER = { summer: 7, winter: 10 };
const FALLBACK_REPOT_MONTHS = 12;

export function recommendedWaterDays(
  species: SpeciesIntervals | null,
  potSize: PotSize,
  today: string,
): number {
  const summer = isSummer(today);
  const base =
    (summer ? species?.water_summer_days : species?.water_winter_days) ??
    (summer ? FALLBACK_WATER.summer : FALLBACK_WATER.winter);
  return Math.max(1, Math.round(base * POT_FACTOR[potSize]));
}

export function recommendedRepotMonths(species: SpeciesIntervals | null): number {
  return species?.repot_months ?? FALLBACK_REPOT_MONTHS;
}
