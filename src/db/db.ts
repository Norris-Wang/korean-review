import Dexie, { type Table } from "dexie";
import type { ReviewUnit } from "../review/units";
import type { Grade } from "ts-fsrs";

export interface AnswerLog {
    id?: number;
    unitKey: string;
    correct: boolean;
    at: number;
    type: string;
    algorithm?: "fixed" | "fsrs";
    rating?: Grade;
}

export class ReviewDB extends Dexie {
    units!: Table<ReviewUnit, string>;
    logs!: Table<AnswerLog, number>;

    constructor(name = "korean-review") {
        super(name);
        this.version(1).stores({
            units: "key, lessonId, itemType, dueAt, lapses, stage",
            logs: "++id, unitKey, at, correct",
        });
    }
}

export const db = new ReviewDB();