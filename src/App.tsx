import { useEffect, useState, useMemo } from "react";

import { type KnowledgeBase } from "./data/schema";
import { loadKnowledgeBase, syncUnitsToDB } from "./data/loader";

import { type ReviewUnit } from "./review/units";
import { Rating } from "./review/fsrsScheduler";
import { getKnowledgeKey } from "./review/progression";
import { buildDailyCandidatePools } from "./review/dailyPlanning";

import { db } from "./db/db";

import Dashboard from "./pages/Dashboard";
import WrongBook from "./pages/WrongBook";
import PracticeLab from "./pages/PracticeLab";
import WrongBookSandbox from "./pages/WrongBookSandbox";

import QuestionRenderer from "./components/QuestionRenderer";

import { useReviewSession, DAILY_LIMIT } from "./hooks/useReviewSession";

type View =
    | "home"
    | "quiz"
    | "summary"
    | "wrongbook"
    | "practice";



export default function App() {
    const [kb, setKb] = useState<KnowledgeBase | null>(null);
    const [units, setUnits] = useState<Record<string, ReviewUnit>>({});
    const [view, setView] = useState<View>("home");
    const [error, setError] = useState("");

    useEffect(() => {
        loadKnowledgeBase()
            .then(async (k) => {
                setKb(k);
                const syncedUnits = await syncUnitsToDB(k);
                setUnits(syncedUnits);
            })
            .catch(e => setError("加载失败：" + e.message));
    }, []);

    const allUnits = Object.values(units);


    const completedFillKeys = useMemo(() => {
        const completed = new Set<string>();

        for (const unit of Object.values(units)) {
            if (
                unit.itemType !== "vocab" ||
                unit.direction !== "fill"
            ) {
                continue;
            }

            // 固定算法保持原有 stage >= 1 的行为
            const algorithm =
                unit.schedulingAlgorithm ?? "fixed";

            const completedFill =
                algorithm === "fsrs"
                    ? unit.seen > 0 &&
                    unit.seen > unit.lapses
                    : unit.stage >= 1;

            if (completedFill) {
                completed.add(getKnowledgeKey(unit));
            }
        }

        return completed;
    }, [units]);


    const isAnswerable = (unit: ReviewUnit) => {
        if (
            unit.itemType === "vocab" &&
            unit.direction !== "fill" &&
            completedFillKeys.has(getKnowledgeKey(unit))
        ) {
            return false;
        }

        return true;
    };

    const session = useReviewSession(kb, units, setUnits);




    const dailyPools = buildDailyCandidatePools(
        allUnits,
        session.learnedItems,
        isAnswerable,
        DAILY_LIMIT
    );

    const dueCount = dailyPools.due.length;

    const actualNewUnitCount = new Set(
        dailyPools.fresh.map(getKnowledgeKey)
    ).size;


    useEffect(() => {
        if (view === "quiz" && !session.current && session.answeredCount > 0) {
            setView("summary");
        }
    }, [view, session.current, session.answeredCount]);

    if (error) return <div style={{ padding: 40, color: "red" }}>{error}</div>;
    if (!kb) return <div style={{ padding: 40 }}>加载中…</div>;

    if (
        import.meta.env.DEV &&
        new URLSearchParams(
            window.location.search
        ).has("wrongbook-test")
    ) {
        return <WrongBookSandbox kb={kb} />;
    }

    if (view === "home") {
        return (
            <Dashboard
                kb={kb} units={units} dueReviewCount={dueCount} newUnitCount={actualNewUnitCount}
                onStart={(mode) => {
                    const started = session.startSession(
                        mode,
                        allUnits,
                        isAnswerable
                    );

                    if (started) {
                        setView("quiz");
                    }
                }}
                onWrongBook={() => setView("wrongbook")}
                onPractice={() => setView("practice")}
                onReset={async () => {
                    await db.units.clear(); await db.logs.clear();
                    localStorage.clear();
                    setUnits(await syncUnitsToDB(kb));
                    session.setLearnedItems([]);
                }}
            />
        );
    }

    if (view === "wrongbook") {
        return (
            <WrongBook
                kb={kb}
                onBack={() => {
                    void db.units.toArray()
                        .then(rows => {
                            const latestUnits =
                                Object.fromEntries(
                                    rows.map(unit => [
                                        unit.key,
                                        unit
                                    ])
                                );

                            setUnits(latestUnits);
                            setView("home");
                        })
                        .catch(error => {
                            console.error(
                                "刷新学习进度失败：",
                                error
                            );
                            setError(
                                "刷新学习进度失败，请重新加载页面。"
                            );
                        });
                }}
            />
        );
    }

    if (view === "practice") {
        return (
            <PracticeLab
                kb={kb}
                onBack={() => setView("home")}
            />
        );
    }

    if (view === "quiz") {
        // 👇 兜底：如果因为某种原因没有题目了，不要白屏
        if (!session.current) {
            return (
                <div className="app">
                    <div className="card" style={{ textAlign: "center", marginTop: 40 }}>
                        <h2>没有可用的题目</h2>
                        <p style={{ color: "#86868b", margin: "16px 0" }}>可能是因为数据异常或已完成。</p>
                        <button className="btn" onClick={() => setView("home")}>返回面板</button>
                    </div>
                </div>
            );
        }
        const q = session.current.q;
        return (
            <div className="app">

                <header>
                    <h1>第 {session.answeredCount + 1} 题</h1>
                    <button className="btn secondary" style={{ width: "auto", padding: "8px 14px", fontSize: 14, margin: 0 }} onClick={() => { session.endSession(); setView("home"); }}>结束</button>
                </header>

                <div className="card">
                    <QuestionRenderer
                        question={q}
                        questionKey={session.current.key}
                        answered={session.answerLocked}
                        onAnswer={session.handleAnswer}
                    />
                </div>

                {session.pendingRating && (
                    <div className="card">
                        <div className="feedback ok">
                            ✅ 回答正确！
                        </div>

                        <p style={{
                            marginTop: 14,
                            marginBottom: 14,
                            fontSize: 14
                        }}>
                            这次回忆对你来说有多难？
                        </p>

                        <div style={{
                            display: "grid",
                            gridTemplateColumns:
                                "repeat(3, minmax(0, 1fr))",
                            gap: 10
                        }}>
                            <button
                                className="btn secondary"
                                disabled={session.saving}
                                onClick={() =>
                                    session.confirmRating(Rating.Hard)
                                }
                            >
                                Hard
                                <small style={{ display: "block" }}>
                                    有点吃力
                                </small>
                            </button>

                            <button
                                className="btn"
                                disabled={session.saving}
                                onClick={() =>
                                    session.confirmRating(Rating.Good)
                                }
                            >
                                Good
                                <small style={{ display: "block" }}>
                                    正常回忆
                                </small>
                            </button>

                            <button
                                className="btn secondary"
                                disabled={session.saving}
                                onClick={() =>
                                    session.confirmRating(Rating.Easy)
                                }
                            >
                                Easy
                                <small style={{ display: "block" }}>
                                    非常轻松
                                </small>
                            </button>
                        </div>

                        <p style={{
                            marginTop: 12,
                            fontSize: 12,
                            color: "#86868b"
                        }}>
                            选择评分后保存本次复习记录
                        </p>
                    </div>
                )}

                {session.saving && (
                    <div className="card">
                        <p role="status">
                            正在保存答题结果…
                        </p>
                    </div>
                )}

                {session.saveError && (
                    <div className="card">
                        <p
                            role="alert"
                            style={{ color: "#d93025" }}
                        >
                            {session.saveError}
                        </p>
                    </div>
                )}
                {session.answered && (
                    <div className="card">
                        {session.current.lastCorrect === false ? (
                            <>
                                <div className="feedback bad">❌ 答错了</div>
                                <p style={{ fontSize: 14, color: "#86868b", whiteSpace: "pre-wrap", marginTop: 12 }}>{q.explanation}</p>
                                <button className="btn" style={{ marginTop: 14 }} onClick={session.nextQuestion} disabled={session.saving}>下一题 →</button>
                            </>
                        ) : (
                            <div className="feedback ok">✅ 正确，即将进入下一题…</div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    if (view === "summary") {
        return (
            <div className="app">
                <div className="card" style={{ textAlign: "center" }}>
                    <h1 style={{ fontSize: 20, marginBottom: 12 }}>复习完成</h1>
                    <div style={{ fontSize: 48, fontWeight: 700, color: "#007aff" }}>
                        {session.correctCount} / {session.answeredCount}
                    </div>
                    <p style={{ color: "#86868b", marginTop: 8 }}>
                        正确率 {session.answeredCount > 0 ? Math.round(session.correctCount / session.answeredCount * 100) : 0}%
                    </p>
                    <button className="btn" style={{ marginTop: 20 }} onClick={() => setView("home")}>返回面板</button>
                </div>
            </div>
        );
    }

    return null;
}