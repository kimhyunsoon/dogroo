// 해시 라우터 유틸 - 경로/쿼리 분해, 정렬 상태의 URL 기록, 마지막 탭 기억

const LAST_TAB_KEY = 'groo:last-tab';
const TAB_PATHS = ['#/today', '#/plants', '#/settings'];

// '#/plants?view=list&sort=water' → { path: '#/plants', params }
export function parseHash(hash: string): { path: string; params: URLSearchParams } {
  const q = hash.indexOf('?');
  if (q === -1) return { path: hash, params: new URLSearchParams() };
  return { path: hash.slice(0, q), params: new URLSearchParams(hash.slice(q + 1)) };
}

/**
 * 현재 히스토리 엔트리의 해시 쿼리만 교체한다 (hashchange 미발생 → 뷰 유지).
 * history.state를 보존해 pushModal의 {modal} 마커를 지우지 않는다.
 * @param params 값이 null이면 해당 키 제거
 */
export function replaceHashQuery(path: string, params: Record<string, string | null>): void {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) search.set(key, value);
  }
  const qs = search.toString();
  history.replaceState(history.state, '', `${location.pathname}${qs ? `${path}?${qs}` : path}`);
}

// 앱 시작 라우트: 해시가 없으면 마지막 접속 탭으로 (딥링크는 그대로 존중)
export function initialRoute(): string {
  if (location.hash && location.hash !== '#/') return location.hash;
  const last = localStorage.getItem(LAST_TAB_KEY);
  const route = last && TAB_PATHS.includes(last) ? last : '#/today';
  history.replaceState(history.state, '', `${location.pathname}${route}`);
  return route;
}

export function rememberTab(path: string): void {
  if (TAB_PATHS.includes(path)) localStorage.setItem(LAST_TAB_KEY, path);
}
