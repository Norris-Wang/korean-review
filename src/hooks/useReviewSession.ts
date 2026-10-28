import { useState, useRef, useCallback } from "react";
import type { KnowledgeBase } from "../data/schema";
import type { ReviewUnit } from "../review/units";
import { selectSessionUnits, selectDailyUnits } from "../review/selector";
import { getEligibleUnits, getKnowledgeKey } from "../review/progression";
import { generateFor } from "../generators";
import { saveAnswer } from "../db/answerService";
import type { GeneratedQuestion } from "../generators/types";
import { Rating, type Grade } from "ts-fsrs";

export type Mode = "due" | "vocab" | "grammar" | "topic" | "mix";

type ReviewSessionDependencies = {
    saveAnswerFn?: typeof saveAnswer;
    initialLearnedItems?: string[];
    persistLearnedItems?: (items: string[]) => void;
};

export const DAILY_LIMIT = { vocab: 20, grammar: 1, topic: 1 };

function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getLearnedItemsToday() {
    const key = `kr_learned_items_${getTodayStr()}`;
    try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}

export function useReviewSession(
    kb: KnowledgeBase | null,
    units: Record<string, ReviewUnit>,
    setUnits: (u: any) => void,
    dependencies: ReviewSessionDependencies = {}
) {
    const [queue, setQueue] = useState<string[]>([]);
    const [index, setIndex] = useState(0);
    const [current, setCurrent] = useState<{ key: string; unit: ReviewUnit; q: GeneratedQuestion; lastCorrect?: boolean } | null>(null);
    const [answered, setAnswered] = useState(false);
    const [correctCount, setCorrectCount] = useState(0);
    const [answeredCount, setAnsweredCount] = useState(0);
    const [learnedItems, setLearnedItems] =
        useState<string[]>(() =>
            dependencies.initialLearnedItems ??
            getLearnedItemsToday()
        );

    const autoNextRef = useRef<number | null>(null);
    const nextQuestionRef = useRef<() => void>(() => { });

    const submittingRef = useRef(false);
    const sessionIdRef = useRef(0);

    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const [pendingRating, setPendingRating] = useState<string | null>(null);

    const answerJudgedRef = useRef(false);

    const loadQuestion = useCallback((key: string): boolean => {
        const unit = units[key];
        if (!unit || !kb) return false;
        const q = generateFor(kb, unit);
        if (!q) return false;
        answerJudgedRef.current = false;
        setPendingRating(null);
        setCurrent({ key, unit, q, lastCorrect: undefined });
        setAnswered(false);
        return true;
    }, [units, kb]);

    const nextQuestion = useCallback(() => {
        if (submittingRef.current || pendingRating !== null) {
            return;
        }
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
    }, [index, queue, units, loadQuestion, pendingRating]);

    nextQuestionRef.current = nextQuestion;


    const commitAnswer = useCallback(
        async (
            correct: boolean,
            rating?: Grade
        ) => {
            if (
                !current ||
                answered ||
                submittingRef.current
            ) {
                return;
            }

            const sessionId = sessionIdRef.current;
            const { key, q } = current;
            const knowledgeKey = getKnowledgeKey(current.unit);

            const wasKnownBefore = Object.values(units).some(
                unit =>
                    getKnowledgeKey(unit) === knowledgeKey &&
                    unit.seen > 0
            );

            submittingRef.current = true;
            setSaving(true);
            setSaveError("");

            try {
                // 此时才真正保存答题结果
                const updated = await (
                    dependencies.saveAnswerFn ?? saveAnswer
                )(
                    key,
                    correct,
                    q.type,
                    rating
                );

                // 保持 React 学习状态与数据库一致
                setUnits((prev: Record<string, ReviewUnit>) => ({
                    ...prev,
                    [key]: updated
                }));

                // 会话已切换，不再更新旧会话界面
                if (sessionId !== sessionIdRef.current) {
                    return;
                }

                // 记录首次接触的知识点
                const itemKey = getKnowledgeKey(updated);

                if (updated.seen === 1 && !wasKnownBefore) {
                    setLearnedItems(prev => {
                        if (prev.includes(itemKey)) {
                            return prev;
                        }

                        const next = [...prev, itemKey];

                        if (dependencies.persistLearnedItems) {
                            dependencies.persistLearnedItems(next);
                        } else {
                            localStorage.setItem(
                                `kr_learned_items_${getTodayStr()}`,
                                JSON.stringify(next)
                            );
                        }

                        return next;
                    });
                }

                // 保存成功后才标记完成
                setPendingRating(null);
                setAnswered(true);
                setAnsweredCount(c => c + 1);

                if (correct) {
                    setCorrectCount(c => c + 1);
                }

                setCurrent(prev =>
                    prev?.key === key
                        ? { ...prev, lastCorrect: correct }
                        : prev
                );

                // 正确答案保存成功后自动跳题
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
                        "保存失败，请重试本次提交。"
                    );

                    // 没有等待评分时，允许重新提交答案。
                    // 等待评分时只允许重新点击评分按钮。
                    if (pendingRating === null) {
                        answerJudgedRef.current = false;
                    }
                }

            } finally {
                if (sessionId === sessionIdRef.current) {
                    submittingRef.current = false;
                    setSaving(false);
                }
            }
        },
        [
            current,
            answered,
            pendingRating,
            setUnits,
            units,
            dependencies.saveAnswerFn,
            dependencies.persistLearnedItems
        ]
    );


    const handleAnswer = useCallback(
        (correct: boolean) => {
            if (
                !current ||
                answered ||
                answerJudgedRef.current ||
                submittingRef.current
            ) {
                return;
            }

            // 同步锁定，避免一次作答重复判定
            answerJudgedRef.current = true;

            const algorithm =
                current.unit.schedulingAlgorithm ?? "fixed";

            // FSRS 答对：暂不保存，等待用户评分
            if (algorithm === "fsrs" && correct) {
                setPendingRating(current.key);
                return;
            }

            // FSRS 答错：直接按 Again 保存
            // fixed：仍然使用原有自动保存方式
            void commitAnswer(
                correct,
                algorithm === "fsrs"
                    ? Rating.Again
                    : undefined
            );
        },
        [current, answered, commitAnswer]
    );


    const confirmRating = useCallback(
        (rating: Grade) => {
            if (
                !current ||
                pendingRating !== current.key ||
                !answerJudgedRef.current ||
                submittingRef.current
            ) {
                return;
            }

            // 答对后只能选择 Hard / Good / Easy
            if (
                rating !== Rating.Hard &&
                rating !== Rating.Good &&
                rating !== Rating.Easy
            ) {
                return;
            }

            void commitAnswer(true, rating);
        },
        [current, pendingRating, commitAnswer]
    );

    const startSession = useCallback((mode: Mode, allUnits: ReviewUnit[], isAnswerable: (u: ReviewUnit) => boolean) => {
        sessionIdRef.current += 1;
        submittingRef.current = false;
        answerJudgedRef.current = false;
        setPendingRating(null);

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

            const todayLearnedItems =
                dependencies.initialLearnedItems !== undefined
                    ? learnedItems
                    : getLearnedItemsToday();

            if (dependencies.initialLearnedItems === undefined) {
                setLearnedItems(todayLearnedItems);
            }

            const countLearned = (
                type: ReviewUnit["itemType"]
            ): number => new Set(
                todayLearnedItems.filter((key: string) =>
                    key.startsWith(`${type}_`) ||
                    key.split("|")[1] === type
                )
            ).size;

            const learnedVocab = countLearned("vocab");
            const learnedGrammar = countLearned("grammar");
            const learnedTopic = countLearned("topic");

            const remainVocab = Math.max(0, DAILY_LIMIT.vocab - learnedVocab);
            const remainGrammar = Math.max(0, DAILY_LIMIT.grammar - learnedGrammar);
            const remainTopic = Math.max(0, DAILY_LIMIT.topic - learnedTopic);


            const quotaLeft: Record<
                ReviewUnit["itemType"],
                number
            > = {
                vocab: remainVocab,
                grammar: remainGrammar,
                topic: remainTopic
            };

            // 完整知识点标识：课程 + 类型 + ID
            const allowedNewItems = new Set<string>();

            for (const unit of newUnits) {
                const knowledgeKey = getKnowledgeKey(unit);

                // 同一个知识点的不同方向只占一次配额
                if (allowedNewItems.has(knowledgeKey)) {
                    continue;
                }

                if (quotaLeft[unit.itemType] <= 0) {
                    continue;
                }

                allowedNewItems.add(knowledgeKey);
                quotaLeft[unit.itemType] -= 1;
            }

            const newUnitsToAdd = newUnits.filter(unit =>
                allowedNewItems.has(getKnowledgeKey(unit))
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
    }, [learnedItems, loadQuestion, dependencies.initialLearnedItems]);

    const endSession = useCallback(() => {
        sessionIdRef.current += 1;
        answerJudgedRef.current = false;
        setPendingRating(null);

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
        pendingRating, confirmRating,
        answerLocked: answered || saving || pendingRating !== null,
    };
}