import type { PlantSummary } from './types.js';

// '2026-06-28' → '6/28'
export function fmtDate(date: string | null): string {
  if (!date) return '-';
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

// 오늘 기준 상대 시간: 오늘/어제/n일 전(1개월 미만) → n개월 전 → n년 n개월 전
export function fmtRel(date: string | null, base: string): string | null {
  if (!date) return null;
  const d = date.slice(0, 10);
  const days = Math.round((Date.parse(`${base}T00:00:00`) - Date.parse(`${d}T00:00:00`)) / 86400000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  // 개월 계산은 fmtTogether와 같은 달력 기준
  const s = new Date(`${d}T00:00:00`);
  const b = new Date(`${base}T00:00:00`);
  let months = (b.getFullYear() - s.getFullYear()) * 12 + (b.getMonth() - s.getMonth());
  if (b.getDate() < s.getDate()) months--;
  if (months < 1) return `${days}일 전`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${months}개월 전`;
  return rem === 0 ? `${years}년 전` : `${years}년 ${rem}개월 전`;
}

// 학명 축약: 'Monstera deliciosa' → 'M. deliciosa' (한 단어면 그대로)
export function abbrevSci(name: string | null): string | null {
  if (!name) return null;
  const parts = name.split(' ');
  if (parts.length < 2 || !/^[A-Z][a-z]+$/.test(parts[0] ?? '')) return name;
  return `${parts[0]![0]}. ${parts.slice(1).join(' ')}`;
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
