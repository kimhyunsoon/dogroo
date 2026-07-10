import type { PlantSummary } from './types.js';

export interface Badge {
  label: string;
  cls: 'over' | 'today' | 'ok' | 'none';
}

function ddayBadge(dday: number | null, hasInterval: boolean): Badge | null {
  if (dday === null) return hasInterval ? { label: '기록 없음', cls: 'none' } : null;
  if (dday < 0) return { label: `${-dday}일 지남`, cls: 'over' };
  if (dday === 0) return { label: '오늘', cls: 'today' };
  return { label: `D-${dday}`, cls: 'ok' };
}

export function waterBadge(p: PlantSummary): Badge | null {
  return ddayBadge(p.water_dday, p.effective_water_days !== null);
}

export function repotBadge(p: PlantSummary): Badge | null {
  // 분갈이는 주기·기준일이 있을 때만 표시 (물주기 대비 부차 정보)
  return p.repot_dday === null ? null : ddayBadge(p.repot_dday, true);
}

// '2026-06-28' → '6/28'
export function fmtDate(date: string | null): string {
  if (!date) return '-';
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

// '2026-06-28' → '26.6.28' (연 단위 주기용)
export function fmtDateY(date: string | null): string {
  if (!date) return '-';
  return `${date.slice(2, 4)}.${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
}

// 함께한 기간: n년 n개월 (1개월 미만이면 n일)
export function fmtTogether(start: string, base: string): string {
  const s = new Date(`${start}T00:00:00`);
  const b = new Date(`${base}T00:00:00`);
  let months = (b.getFullYear() - s.getFullYear()) * 12 + (b.getMonth() - s.getMonth());
  if (b.getDate() < s.getDate()) months--;
  if (months < 1) {
    const days = Math.floor((b.getTime() - s.getTime()) / 86400000) + 1;
    return `${Math.max(days, 1)}일`;
  }
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${months}개월`;
  return rem === 0 ? `${years}년` : `${years}년 ${rem}개월`;
}

export function isDue(p: PlantSummary): boolean {
  return (p.water_dday !== null && p.water_dday <= 0) || (p.repot_dday !== null && p.repot_dday <= 0);
}

export const POT_LABEL: Record<'S' | 'M' | 'L', string> = { S: '소형', M: '중형', L: '대형' };

// ── 주기 추천 미리보기 (백엔드 recommend.ts와 동일 로직) ──
const POT_FACTOR: Record<'S' | 'M' | 'L', number> = { S: 0.8, M: 1.0, L: 1.3 };
const FALLBACK = { summer: 7, winter: 10, repot: 12 };

interface SpeciesIntervals {
  water_summer_days: number | null;
  water_winter_days: number | null;
  repot_months: number | null;
}

export function seasonLabel(): '여름' | '겨울' {
  const month = new Date().getMonth() + 1;
  return month >= 4 && month <= 9 ? '여름' : '겨울';
}

export function previewRecommend(
  species: SpeciesIntervals | null,
  potSize: 'S' | 'M' | 'L',
): { water: number; repot: number } {
  const summer = seasonLabel() === '여름';
  const base =
    (summer ? species?.water_summer_days : species?.water_winter_days) ??
    (summer ? FALLBACK.summer : FALLBACK.winter);
  return {
    water: Math.max(1, Math.round(base * POT_FACTOR[potSize])),
    repot: species?.repot_months ?? FALLBACK.repot,
  };
}
