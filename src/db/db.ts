import Dexie, { type Table } from "dexie";
import type { ReviewUnit } from "../review/units";

export interface AnswerLog {
  id?: number;
  unitKey: string;
  correct: boolean;
  at: number;
  type: string;
}

export class ReviewDB extends Dexie {
  units!: Table<ReviewUnit, string>;
  logs!: Table<AnswerLog, number>;

  constructor() {
    super("korean-review");
    this.version(1).stores({
      units: "key, lessonId, itemType, dueAt, lapses, stage",
      logs: "++id, unitKey, at, correct",
    });
  }
}

export const db = new ReviewDB();