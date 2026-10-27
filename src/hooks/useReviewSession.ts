import { useState, useRef, useCallback } from "react";
import type { KnowledgeBase } from "../data/schema";
import type { ReviewUnit } from "../review/units";
import { generateFor, shuffle } from "../generators";
import { schedule } from "../review/scheduler";
import { db } from "../db/db";
import type { GeneratedQuestion } from "../generators/types";

export type Mode = "due" | "vocab" | "grammar" | "topic" | "mix";

export const DAILY_LIMIT = { vocab: 20, grammar: 1, topic: 1 };

function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getLearnedItemsToday() {
    const key = `kr_learned_items_${getTodayStr()}`;
    try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}

export function useReviewSession(kb: KnowledgeBase | null, units: Record<string, ReviewUnit>, setUnits: (u: any) => void) {
    const [queue, setQueue] = useState<string[]>([]);
    const [index, setIndex] = useState(0);
    const [current, setCurrent] = useState<{ key: string; unit: ReviewUnit; q: GeneratedQuestion; lastCorrect?: boolean } | null>(null);
    const [answered, setAnswered] = useState(false);
    const [correctCount, setCorrectCount] = useState(0);
    const [answeredCount, setAnsweredCount] = useState(0);
    const [learnedItems, setLearnedItems] = useState<string[]>(getLearnedItemsToday());

    const autoNextRef = useRef<number | null>(null);
    const nextQuestionRef = useRef<() => void>(() => { });

    const loadQuestion = useCallback((key: string): boolean => {
        const unit = units[key];
        if (!unit || !kb) return false;
        const q = generateFor(kb, unit);
        if (!q) return false;
        setCurrent({ key, unit, q, lastCorrect: undefined });
        setAnswered(false);
        return true;
    }, [units, kb]);

    const nextQuestion = useCallback(() => {
        let nextIdx = index + 1;
        while (nextIdx < queue.length) {
            const key = queue[nextIdx];
            const u = units[key];

            if (u && u.itemType === "vocab" && u.direction !== "fill") {
                const fillKey = `${u.lessonId}|vocab|${u.itemId}|fill`;
                const fillUnit = units[fillKey];
                if (fillUnit && fillUnit.stage >= 1) { nextIdx++; continue; }
            }

            if (loadQuestion(key)) {
                setIndex(nextIdx);
                return;
            } else {
                nextIdx++;
                continue;
            }
        }

        setCurrent(null);
    }, [index, queue, units, loadQuestion]);

    nextQuestionRef.current = nextQuestion;

    const handleAnswer = useCallback(async (correct: boolean) => {
        if (!current || answered) return;
        setAnswered(true);
        if (correct) setCorrectCount(c => c + 1);
        setAnsweredCount(c => c + 1);
        setCurrent(prev => prev ? { ...prev, lastCorrect: correct } : prev);

        const updated = { ...current.unit };
        const itemKey = `${updated.itemType}_${updated.itemId}`;

        if (updated.seen === 0 && !learnedItems.includes(itemKey)) {
            const newLearned = [...learnedItems, itemKey];
            setLearnedItems(newLearned);
            localStorage.setItem(`kr_learned_items_${getTodayStr()}`, JSON.stringify(newLearned));
        }

        schedule(updated, correct);
        setUnits((prev: any) => ({ ...prev, [current.key]: updated }));
        await db.units.put(updated);
        await db.logs.add({ unitKey: current.key, correct, at: Date.now(), type: current.q.type });

        if (correct) {
            if (autoNextRef.current) window.clearTimeout(autoNextRef.current);
            autoNextRef.current = window.setTimeout(() => {
                autoNextRef.current = null;
                nextQuestionRef.current();
            }, 900);
        }
    }, [current, answered, learnedItems, setUnits]);

    const startSession = useCallback((mode: Mode, allUnits: ReviewUnit[], isAnswerable: (u: ReviewUnit) => boolean) => {
        let pool = allUnits;
        if (mode === "vocab") pool = allUnits.filter(u => u.itemType === "vocab" && isAnswerable(u));
        else if (mode === "grammar") pool = allUnits.filter(u => u.itemType === "grammar" && isAnswerable(u));
        else if (mode === "topic") pool = allUnits.filter(u => u.itemType === "topic" && isAnswerable(u));
        else if (mode === "due") {
            const availableUnits = allUnits.filter(isAnswerable);
            const startedVocabIds = new Set(availableUnits.filter(u => u.itemType === "vocab" && u.seen > 0).map(u => u.itemId));
            const startedGrammarIds = new Set(availableUnits.filter(u => u.itemType === "grammar" && u.seen > 0).map(u => u.itemId));
            const startedTopicIds = new Set(availableUnits.filter(u => u.itemType === "topic" && u.seen > 0).map(u => u.itemId));

            const dueReviews = availableUnits.filter(u => u.seen > 0 && u.dueAt <= Date.now());
            const newUnits = availableUnits.filter(u => {
                if (u.seen > 0) return false;
                if (u.itemType === "vocab") return !startedVocabIds.has(u.itemId);
                if (u.itemType === "grammar") return !startedGrammarIds.has(u.itemId);
                if (u.itemType === "topic") return !startedTopicIds.has(u.itemId);
                return false;
            });

            const learnedVocab = new Set(learnedItems.filter(i => i.startsWith("vocab_"))).size;
            const learnedGrammar = new Set(learnedItems.filter(i => i.startsWith("grammar_"))).size;
            const learnedTopic = new Set(learnedItems.filter(i => i.startsWith("topic_"))).size;

            const remainVocab = Math.max(0, DAILY_LIMIT.vocab - learnedVocab);
            const remainGrammar = Math.max(0, DAILY_LIMIT.grammar - learnedGrammar);
            const remainTopic = Math.max(0, DAILY_LIMIT.topic - learnedTopic);

            const newVocabIds = Array.from(new Set(newUnits.filter(u => u.itemType === "vocab").map(u => u.itemId))).slice(0, remainVocab);
            const newGrammarIds = Array.from(new Set(newUnits.filter(u => u.itemType === "grammar").map(u => u.itemId))).slice(0, remainGrammar);
            const newTopicIds = Array.from(new Set(newUnits.filter(u => u.itemType === "topic").map(u => u.itemId))).slice(0, remainTopic);

            const allowedNewItems = new Set([
                ...newVocabIds.map(id => `vocab_${id}`),
                ...newGrammarIds.map(id => `grammar_${id}`),
                ...newTopicIds.map(id => `topic_${id}`)
            ]);

            const newUnitsToAdd = newUnits.filter(u => allowedNewItems.has(`${u.itemType}_${u.itemId}`));
            let combinedPool = [...dueReviews, ...newUnitsToAdd];

            if (combinedPool.length === 0) {
                alert("今日复习任务已完成 🎉\n明天再来吧！");
                return;
            }
            pool = combinedPool;
        } else if (mode === "mix") {
            pool = allUnits.filter(isAnswerable);
        }

        if (pool.length === 0) { alert("没有可复习的题目。"); return; }

        const sorted = [...pool].sort((a, b) => {
            if (b.lapses !== a.lapses) return b.lapses - a.lapses;
            if (a.stage !== b.stage) return a.stage - b.stage;
            return a.dueAt - b.dueAt;
        });

        const picked = sorted.slice(0, 20);
        const buckets = new Map<string, ReviewUnit[]>();
        for (const u of picked) {
            const arr = buckets.get(u.itemId) ?? [];
            arr.push(u);
            buckets.set(u.itemId, arr);
        }
        const bucketList = [...buckets.values()].map(arr => shuffle(arr));
        const interleaved: ReviewUnit[] = [];
        let round = 0;
        while (interleaved.length < picked.length) {
            const startLen = interleaved.length;
            for (const b of bucketList) {
                if (b[round]) interleaved.push(b[round]);
            }
            if (interleaved.length === startLen) break;
            round++;
        }
        const keys = interleaved.map(u => u.key);

        setQueue(keys);
        setIndex(0);
        setCorrectCount(0);
        setAnsweredCount(0);

        let startIdx = 0;
        while (startIdx < keys.length) {
            if (loadQuestion(keys[startIdx])) {
                setIndex(startIdx);
                break;
            }
            startIdx++;
        }
        if (startIdx >= keys.length) setCurrent(null);
    }, [learnedItems, loadQuestion]);

    const endSession = useCallback(() => {
        if (autoNextRef.current) window.clearTimeout(autoNextRef.current);
        autoNextRef.current = null;
        setCurrent(null);
    }, []);

    return {
        queue, index, current, answered, correctCount, answeredCount,
        startSession, handleAnswer, nextQuestion, endSession,
        learnedItems, setLearnedItems,
    };
}