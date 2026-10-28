import { parse } from "yaml";
import { KnowledgeBaseSchema, type KnowledgeBase } from "./schema";
import { db, type ReviewDB } from "../db/db";
import { buildUnitsForLesson, type ReviewUnit } from "../review/units";
import { getDefaultSchedulingAlgorithm } from "../review/schedulingConfig";
import type { SchedulingAlgorithm } from "../review/schedulingConfig";
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



export async function syncUnitsToDB(
    kb: KnowledgeBase,
    database: ReviewDB = db,
    algorithm: SchedulingAlgorithm =
        getDefaultSchedulingAlgorithm()
): Promise<Record<string, ReviewUnit>> {
    const stored = await database.units.toArray();

    const map: Record<string, ReviewUnit> = {};

    // 首先保留数据库里已经存在的记录
    for (const unit of stored) {
        map[unit.key] = unit;
    }


    for (const lesson of kb.lessons) {
        const generated =
            buildUnitsForLesson(lesson);

        for (const unit of generated) {

            // 旧单元永远不覆盖
            if (map[unit.key]) {
                continue;
            }

            // 仅新创建的单元使用默认配置
            const newUnit: ReviewUnit = {
                ...unit,
                schedulingAlgorithm: algorithm
            };

            await database.units.add(newUnit);

            // 写入成功后才更新内存快照
            map[newUnit.key] = newUnit;
        }
    }

    return map;
}