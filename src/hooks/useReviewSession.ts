import { useState, useRef, useCallback } from "react";
import type { KnowledgeBase } from "../data/schema";
import type { ReviewUnit } from "../review/units";
import { selectSessionUnits, selectDailyUnits } from "../review/selector";
import { getEligibleUnits, getKnowledgeKey } from "../review/progression";
import { generateFor } from "../generators";
import { saveAnswer } from "../db/answerService";
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

    const submittingRef = useRef(false);
    const sessionIdRef = useRef(0);

    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

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
        if (autoNextRef.current !== null) {
            window.clearTimeout(autoNextRef.current);
            autoNextRef.current = null;
        }
        let nextIdx = index + 1;
        while (nextIdx < queue.length) {
            const key = queue[nextIdx];

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


    const handleAnswer = useCallback(
        async (correct: boolean) => {
            if (
                !current ||
                answered ||
                submittingRef.current
            ) {
                return;
            }

            submittingRef.current = true;
            setSaving(true);
            setSaveError("");

            const sessionId = sessionIdRef.current;
            const { key, q } = current;

            try {
                // 先完成数据库事务
                const updated = await saveAnswer(
                    key,
                    correct,
                    q.type
                );

                // 即使用户退出了当前会话，
                // 也需要让内存中的学习状态与数据库保持一致
                setUnits((prev: Record<string, ReviewUnit>) => ({
                    ...prev,
                    [key]: updated
                }));

                // 旧会话已结束：不再修改答题界面
                if (sessionId !== sessionIdRef.current) {
                    return;
                }

                // 记录今天首次接触的知识点
                const itemKey =
                    `${updated.itemType}_${updated.itemId}`;

                if (updated.seen === 1) {
                    setLearnedItems(prev => {
                        if (prev.includes(itemKey)) {
                            return prev;
                        }

                        const next = [...prev, itemKey];

                        localStorage.setItem(
                            `kr_learned_items_${getTodayStr()}`,
                            JSON.stringify(next)
                        );

                        return next;
                    });
                }

                // 数据库保存成功后才更新统计
                setAnswered(true);
                setAnsweredCount(c => c + 1);

                if (correct) {
                    setCorrectCount(c => c + 1);
                }

                setCurrent(prev =>
                    prev && prev.key === key
                        ? { ...prev, lastCorrect: correct }
                        : prev
                );

                // 只有答对后自动跳到下一题
                if (correct) {
                    if (autoNextRef.current !== null) {
                        window.clearTimeout(
                            autoNextRef.current
                        );
                    }

                    autoNextRef.current =
                        window.setTimeout(() => {
                            autoNextRef.current = null;
                            nextQuestionRef.current();
                        }, 900);
                }
            } catch (error) {
                console.error("答题保存失败：", error);

                if (sessionId === sessionIdRef.current) {
                    setSaveError(
                        "答题结果保存失败，请重试。"
                    );
                }
            } finally {
                if (sessionId === sessionIdRef.current) {
                    submittingRef.current = false;
                    setSaving(false);
                }
            }
        },
        [current, answered, setUnits]
    );

    const startSession = useCallback((mode: Mode, allUnits: ReviewUnit[], isAnswerable: (u: ReviewUnit) => boolean) => {
        sessionIdRef.current += 1;
        submittingRef.current = false;

        setSaving(false);
        setSaveError("");

        if (autoNextRef.current !== null) {
            window.clearTimeout(autoNextRef.current);
            autoNextRef.current = null;
        }

        const eligibleUnits = getEligibleUnits(
            allUnits.filter(isAnswerable)
        );

        let pool = eligibleUnits;
        if (mode === "vocab") pool = eligibleUnits.filter(u => u.itemType === "vocab" && isAnswerable(u));
        else if (mode === "grammar") pool = eligibleUnits.filter(u => u.itemType === "grammar" && isAnswerable(u));
        else if (mode === "topic") pool = eligibleUnits.filter(u => u.itemType === "topic" && isAnswerable(u));
        else if (mode === "due") {
            const availableUnits = eligibleUnits;


            const allKnowledgeKeys = new Set(
                allUnits
                    .filter(u => u.seen > 0)
                    .map(getKnowledgeKey)
            );

            const dueReviews = availableUnits.filter(
                u => u.seen > 0 && u.dueAt <= Date.now()
            );

            const unstartedUnits = availableUnits.filter(
                u => u.seen === 0
            );

            // 已学过的知识点，现在开放了新的题型
            // 不占用每日新增知识点配额
            const progressionUnits = unstartedUnits.filter(
                u => allKnowledgeKeys.has(getKnowledgeKey(u))
            );

            // 真正从未接触过的新知识
            const newUnits = unstartedUnits.filter(
                u => !allKnowledgeKeys.has(getKnowledgeKey(u))
            );

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

            const newUnitsToAdd = newUnits.filter(u =>
                allowedNewItems.has(`${u.itemType}_${u.itemId}`)
            );

            const dailyCandidates = {
                due: dueReviews,
                progression: progressionUnits,
                fresh: newUnitsToAdd
            };

            const dailySelected = selectDailyUnits(
                dailyCandidates,
                20
            );

            if (dailySelected.length === 0) {
                alert("今日复习任务已完成 🎉\n明天再来吧！");
                return false;
            }

            pool = dailySelected;
        } else if (mode === "mix") {
            pool = eligibleUnits.filter(isAnswerable);
        }

        if (pool.length === 0) { alert("没有可复习的题目。"); return false; }

        // 每日复习：到期优先、题型平衡、新知识补位
        // 其他模式：按题型平衡选择
        const selected =
            mode === "due"
                ? pool
                : selectSessionUnits(
                    pool,
                    mode,
                    Date.now(),
                    20
                );

        // 仅在开发环境中输出选题结果
        if (import.meta.env.DEV) {
            console.table(
                selected.map((u, index) => ({
                    no: index + 1,
                    lesson: u.lessonId,
                    type: u.itemType,
                    itemId: u.itemId,
                    direction: u.direction,
                    seen: u.seen,
                    stage: u.stage,
                    dueAt: new Date(u.dueAt).toLocaleString()
                }))
            );
        }

        const keys = selected.map(u => u.key);

        setQueue(keys);
        setIndex(0);
        setCorrectCount(0);
        setAnsweredCount(0);

        let startIdx = 0;

        while (startIdx < keys.length) {
            if (loadQuestion(keys[startIdx])) {
                setIndex(startIdx);
                return true;
            }

            startIdx++;
        }

        // 复习单元存在，但没有任何一条能够生成题目
        setCurrent(null);
        setQueue([]);
        setIndex(0);

        alert("当前没有可生成的题目，请检查课程数据。");

        return false;
    }, [learnedItems, loadQuestion]);

    const endSession = useCallback(() => {
        sessionIdRef.current += 1;

        if (autoNextRef.current !== null) {
            window.clearTimeout(autoNextRef.current);
        }

        autoNextRef.current = null;

        setQueue([]);
        setIndex(0);
        setCurrent(null);
        setAnswered(false);

        setSaving(false);
        setSaveError("");
    }, []);

    return {
        queue, index, current, answered, correctCount, answeredCount,
        startSession, handleAnswer, nextQuestion, endSession,
        learnedItems, setLearnedItems,
        saving, saveError,
    };
}