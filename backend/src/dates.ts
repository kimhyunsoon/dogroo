// YYYY-MM-DD 문자열 기반 날짜 유틸 - 타임존 이슈를 피하기 위해 문자열로만 다룬다

export function todayStr(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// a - b (일 단위)
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

export function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}
