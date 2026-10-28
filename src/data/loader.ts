import { parse } from "yaml";
import { KnowledgeBaseSchema, type KnowledgeBase } from "./schema";
import { db } from "../db/db";
import { buildUnitsForLesson, type ReviewUnit } from "../review/units";
import { assertVocabularyDisambiguation } from "./vocabValidation";

export async function loadKnowledgeBase(): Promise<KnowledgeBase> {
    const files: string[] = await fetch(`./data/index.json?t=${Date.now()}`).then(r => r.json());
    const allLessons = [];

    for (const f of files) {
        const text = await fetch(`./data/${f}?t=${Date.now()}`).then(r => r.text());
        const parsed = KnowledgeBaseSchema.parse(parse(text));
        allLessons.push(...parsed.lessons);
    }

    const kb: KnowledgeBase = {
        version: "1.0",
        lessons: allLessons
    };

    assertVocabularyDisambiguation(kb);

    return kb;
}

export async function syncUnitsToDB(kb: KnowledgeBase): Promise<Record<string, ReviewUnit>> {
    const stored = await db.units.toArray();
    const map: Record<string, ReviewUnit> = {};
    for (const u of stored) map[u.key] = u;

    for (const lesson of kb.lessons) {
        for (const u of buildUnitsForLesson(lesson)) {
            if (!map[u.key]) {
                map[u.key] = u;
                await db.units.put(u);
            }
        }
    }
    return map;
}