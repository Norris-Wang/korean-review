import type { ReviewUnit } from "./units";

const INTERVALS = [1, 3, 7, 14, 30, 60]; // 天

export function schedule(unit: ReviewUnit, correct: boolean): void {
  if (correct) {
    unit.stage = Math.min(unit.stage + 1, INTERVALS.length - 1);
    unit.streak += 1;
  } else {
    unit.stage = Math.max(unit.stage - 1, 0);
    unit.streak = 0;
    unit.lapses += 1;
  }
  unit.seen += 1;
  unit.dueAt = Date.now() + INTERVALS[unit.stage] * 86400000;
}