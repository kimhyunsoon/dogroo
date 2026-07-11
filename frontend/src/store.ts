import { api } from './api.js';
import type { PlantSummary } from './types.js';

// 식물 목록 캐시 (stale-while-revalidate)
// 캐시가 있으면 즉시 렌더하고 백그라운드로 갱신 → 탭 전환 시 스켈레톤은 첫 로드만
const plantsCache = new Map<string, PlantSummary[]>();

// 키: 쿼리스트링 ('' | '?archived=1')
export function cachedPlants(query = ''): PlantSummary[] | null {
  return plantsCache.get(query) ?? null;
}

export async function loadPlants(query = ''): Promise<PlantSummary[]> {
  const list = await api<PlantSummary[]>(`/api/plants${query}`);
  plantsCache.set(query, list);
  return list;
}

// 뮤테이션(물주기·분갈이·저장·보관·실행취소) 후 캐시된 모든 키를 재조회
export async function refreshPlants(): Promise<void> {
  await Promise.all([...plantsCache.keys()].map((query) => loadPlants(query)));
}

// 탭별 스크롤 위치 (뷰 재생성 시 복원용)
const scrollPositions = new Map<string, number>();

export const scrollStore = {
  save(path: string, y: number): void {
    scrollPositions.set(path, y);
  },
  get(path: string): number {
    return scrollPositions.get(path) ?? 0;
  },
};
