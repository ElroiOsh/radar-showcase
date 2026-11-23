/**
 * Title relevance via config/search-profile.json (include + hard exclude).
 */
import { evaluateTitleRelevance } from "./relevance-filter.js";

export function titleHasAllowSignal(title: string): boolean {
  return evaluateTitleRelevance(title).keep;
}

export function titleIsBlocked(title: string): boolean {
  const r = evaluateTitleRelevance(title);
  return Boolean(r.excludeHits.length);
}

export function titleLacksTrack(title: string): boolean {
  return !titleHasAllowSignal(title);
}
