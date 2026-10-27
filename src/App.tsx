import { useEffect, useState, useMemo } from "react";
import { type KnowledgeBase } from "./data/schema";
import { loadKnowledgeBase, syncUnitsToDB } from "./data/loader";
import { type ReviewUnit } from "./review/units";
import { db } from "./db/db";
import Dashboard from "./pages/Dashboard";
import WrongBook from "./pages/WrongBook";
import { MCQuestion, FillQuestion, OrderQuestion } from "./components/QuizCards";
import { useReviewSession, DAILY_LIMIT } from "./hooks/useReviewSession";

type View = "home" | "quiz" | "summary" | "wrongbook" | "stats";

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

    const masteredFillIds = useMemo(() => {
        const s = new Set<string>();
        for (const u of allUnits) {
            if (u.itemType === "vocab" && u.direction === "fill" && u.stage >= 1) s.add(u.itemId);
        }
        return s;
    }, [units]);

    const isAnswerable = (u: ReviewUnit) => {
        if (u.itemType === "vocab" && u.direction !== "fill" && masteredFillIds.has(u.itemId)) return false;
        return true;
    };

    const session = useReviewSession(kb, units, setUnits);

    const startedVocabIds = new Set(allUnits.filter(u => u.itemType === "vocab" && u.seen > 0).map(u => u.itemId));
    const startedGrammarIds = new Set(allUnits.filter(u => u.itemType === "grammar" && u.seen > 0).map(u => u.itemId));
    const startedTopicIds = new Set(allUnits.filter(u => u.itemType === "topic" && u.seen > 0).map(u => u.itemId));

    const dueCount = allUnits.filter(u => u.seen > 0 && u.dueAt <= Date.now() && isAnswerable(u)).length;
    const pureNewUnits = allUnits.filter(u => {
        if (u.seen > 0) return false;
        if (u.itemType === "vocab") return !startedVocabIds.has(u.itemId);
        if (u.itemType === "grammar") return !startedGrammarIds.has(u.itemId);
        if (u.itemType === "topic") return !startedTopicIds.has(u.itemId);
        return false;
    });
    const learnedVocab = new Set(session.learnedItems.filter(i => i.startsWith("vocab_"))).size;
    const learnedGrammar = new Set(session.learnedItems.filter(i => i.startsWith("grammar_"))).size;
    const learnedTopic = new Set(session.learnedItems.filter(i => i.startsWith("topic_"))).size;
    const remainVocab = Math.max(0, DAILY_LIMIT.vocab - learnedVocab);
    const remainGrammar = Math.max(0, DAILY_LIMIT.grammar - learnedGrammar);
    const remainTopic = Math.max(0, DAILY_LIMIT.topic - learnedTopic);
    const newVocabIds = Array.from(new Set(pureNewUnits.filter(u => u.itemType === "vocab").map(u => u.itemId))).slice(0, remainVocab);
    const newGrammarIds = Array.from(new Set(pureNewUnits.filter(u => u.itemType === "grammar").map(u => u.itemId))).slice(0, remainGrammar);
    const newTopicIds = Array.from(new Set(pureNewUnits.filter(u => u.itemType === "topic").map(u => u.itemId))).slice(0, remainTopic);
    const allowedNewItems = new Set([
        ...newVocabIds.map(id => `vocab_${id}`),
        ...newGrammarIds.map(id => `grammar_${id}`),
        ...newTopicIds.map(id => `topic_${id}`)
    ]);

    const actualNewUnitCount = pureNewUnits.filter(u => allowedNewItems.has(`${u.itemType}_${u.itemId}`)).length;


    useEffect(() => {
        if (view === "quiz" && !session.current && session.answeredCount > 0) {
            setView("summary");
        }
    }, [view, session.current, session.answeredCount]);

    if (error) return <div style={{ padding: 40, color: "red" }}>{error}</div>;
    if (!kb) return <div style={{ padding: 40 }}>加载中…</div>;

    if (view === "home") {
        return (
            <Dashboard
                kb={kb} units={units} dueReviewCount={dueCount} newUnitCount={actualNewUnitCount}
                onStart={(m) => {
                    session.startSession(m, allUnits, isAnswerable);
                    if (m !== "due" || dueCount > 0 || 15 > 0) setView("quiz");
                }}
                onWrongBook={() => setView("wrongbook")}
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
        return <WrongBook kb={kb} onBack={() => setView("home")} />;
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
                    {q.type === "topic_order" ? (
                        <OrderQuestion key={session.current.key} q={q} answered={session.answered} onAnswer={session.handleAnswer} />
                    ) : q.choices ? (
                        <MCQuestion key={session.current.key} q={q} answered={session.answered} onAnswer={session.handleAnswer} />
                    ) : (
                        <FillQuestion key={session.current.key} q={q} answered={session.answered} onAnswer={session.handleAnswer} />
                    )}
                </div>
                {session.answered && (
                    <div className="card">
                        {session.current.lastCorrect === false ? (
                            <>
                                <div className="feedback bad">❌ 答错了</div>
                                <p style={{ fontSize: 14, color: "#86868b", whiteSpace: "pre-wrap", marginTop: 12 }}>{q.explanation}</p>
                                <button className="btn" style={{ marginTop: 14 }} onClick={session.nextQuestion}>下一题 →</button>
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