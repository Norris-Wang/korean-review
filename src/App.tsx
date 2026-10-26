import { useEffect, useMemo, useState, useRef } from "react";
import { parse } from "yaml";
import { KnowledgeBaseSchema, type KnowledgeBase } from "./data/schema";
import { buildUnitsForLesson, type ReviewUnit } from "./review/units";
import { schedule } from "./review/scheduler";
import { generateFor, normalize, shuffle } from "./generators";
import type { GeneratedQuestion } from "./generators/types";
import { db } from "./db/db";
import WrongBook from "./pages/WrongBook";
import Stats from "./pages/Stats";
import Dashboard from "./pages/Dashboard";

type View = "home" | "quiz" | "summary" | "wrongbook" | "stats";
type Mode = "due" | "vocab" | "grammar" | "topic" | "mix";

export default function App() {
    const [kb, setKb] = useState<KnowledgeBase | null>(null);
    const [units, setUnits] = useState<Record<string, ReviewUnit>>({});
    const [view, setView] = useState<View>("home");
    const [queue, setQueue] = useState<string[]>([]);
    const [index, setIndex] = useState(0);
    const [current, setCurrent] = useState<{
        key: string;
        unit: ReviewUnit;
        q: GeneratedQuestion;
        lastCorrect?: boolean;
    } | null>(null);
    const [answered, setAnswered] = useState(false);
    const [correctCount, setCorrectCount] = useState(0);
    const [error, setError] = useState("");
    const [answeredCount, setAnsweredCount] = useState(0);
    const autoNextRef = useRef<number | null>(null);
    const nextQuestionRef = useRef<() => void>(() => { });

    // 加载 YAML + 初始化复习单元
    useEffect(() => {
        (async () => {
            try {
                const files: string[] = await fetch("/data/index.json").then(r => r.json());
                const allLessons = [];
                for (const f of files) {
                    const text = await fetch(`/data/${f}`).then(r => r.text());
                    const parsed = KnowledgeBaseSchema.parse(parse(text));
                    allLessons.push(...parsed.lessons);
                }
                const kbMerged: KnowledgeBase = { version: "1.0", lessons: allLessons };
                setKb(kbMerged);

                const stored = await db.units.toArray();
                const map: Record<string, ReviewUnit> = {};
                for (const u of stored) map[u.key] = u;

                for (const lesson of kbMerged.lessons) {
                    for (const u of buildUnitsForLesson(lesson)) {
                        if (!map[u.key]) {
                            map[u.key] = u;
                            await db.units.put(u);
                        }
                    }
                }
                setUnits(map);
            } catch (e: any) {
                setError("加载失败：" + e.message);
            }
        })();
    }, []);

    const masteredFillIds = useMemo(() => {
        const s = new Set<string>();
        for (const u of Object.values(units)) {
            if (u.itemType === "vocab" && u.direction === "fill" && u.stage >= 1) {
                s.add(u.itemId);
            }
        }
        return s;
    }, [units]);

    if (error) return <div style={{ padding: 40, color: "red" }}>{error}</div>;
    if (!kb) return <div style={{ padding: 40 }}>加载中…</div>;

    const allUnits = Object.values(units);
    const isAnswerable = (u: ReviewUnit) => {
        if (u.itemType === "vocab" && u.direction !== "fill" && masteredFillIds.has(u.itemId)) {
            return false;
        }
        return true;
    };
    const dueCount = allUnits.filter(u => u.dueAt <= Date.now() && isAnswerable(u)).length;


    function startSession(mode: Mode) {

        let pool = allUnits;
        if (mode === "due") {
            const due = allUnits.filter(u => u.dueAt <= Date.now() && isAnswerable(u));
            if (due.length === 0) {
                alert("太棒了！今天的复习任务已经全部完成 🎉\n\n可以点击「混合练习」自由加练，或者去学新课。");
                return;
            }
            pool = due;
        } else if (mode === "vocab") {
            pool = allUnits.filter(u => u.itemType === "vocab" && isAnswerable(u));
        } else if (mode === "grammar") {
            pool = allUnits.filter(u => u.itemType === "grammar" && isAnswerable(u));
        } else if (mode === "topic") {
            pool = allUnits.filter(u => u.itemType === "topic" && isAnswerable(u));
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
        setView("quiz");
        loadQuestion(keys[0]);
    }

    function loadQuestion(key: string) {
        const unit = units[key];
        if (!unit) return;
        const q = generateFor(kb!, unit);
        if (!q) return;
        setCurrent({ key, unit, q, lastCorrect: undefined });
        setAnswered(false);
    }

    async function handleAnswer(correct: boolean) {
        if (!current || answered) return;
        setAnswered(true);
        setAnsweredCount(c => c + 1);
        if (correct) setCorrectCount(c => c + 1);
        setCurrent(prev => prev ? { ...prev, lastCorrect: correct } : prev);

        const updated = { ...current.unit };
        schedule(updated, correct);
        setUnits(prev => ({ ...prev, [current.key]: updated }));
        await db.units.put(updated);
        await db.logs.add({ unitKey: current.key, correct, at: Date.now(), type: current.q.type });

        if (correct) {
            if (autoNextRef.current) window.clearTimeout(autoNextRef.current);
            autoNextRef.current = window.setTimeout(() => {
                autoNextRef.current = null;
                nextQuestionRef.current();
            }, 900);
        }
    }

    function nextQuestion() {
        let nextIdx = index + 1;
        while (nextIdx < queue.length) {
            const key = queue[nextIdx];
            const u = units[key];
            if (u && u.itemType === "vocab" && u.direction !== "fill") {
                const fillKey = `${u.lessonId}|vocab|${u.itemId}|fill`;
                const fillUnit = units[fillKey];
                if (fillUnit && fillUnit.stage >= 1) {
                    nextIdx++;
                    continue;
                }
            }
            break;
        }
        if (nextIdx >= queue.length) { setView("summary"); return; }
        setIndex(nextIdx);
        loadQuestion(queue[nextIdx]);
    }
    nextQuestionRef.current = nextQuestion;

    function endSession() {
        if (autoNextRef.current) window.clearTimeout(autoNextRef.current);
        autoNextRef.current = null;
        setView("home");
        setCurrent(null);
    }

    if (view === "home") {
        return (
            <Dashboard
                kb={kb}
                units={units}
                dueCount={dueCount}
                onStart={startSession}
                onWrongBook={() => setView("wrongbook")}
                onReset={async () => {
                    await db.units.clear();
                    await db.logs.clear();
                    const map: Record<string, ReviewUnit> = {};
                    for (const lesson of kb.lessons) {
                        for (const u of buildUnitsForLesson(lesson)) {
                            map[u.key] = u;
                            await db.units.put(u);
                        }
                    }
                    setUnits(map);
                }}
            />
        );
    }

    if (view === "summary") {
        return (
            <div className="app">
                <div className="card" style={{ textAlign: "center" }}>
                    <h1 style={{ fontSize: 20, marginBottom: 12 }}>复习完成</h1>
                    <div style={{ fontSize: 48, fontWeight: 700, color: "#007aff" }}>
                        {correctCount} / {answeredCount}
                    </div>
                    <p style={{ color: "#86868b", marginTop: 8 }}>
                        正确率 {answeredCount > 0 ? Math.round(correctCount / answeredCount * 100) : 0}%
                    </p>
                    <button className="btn" style={{ marginTop: 20 }} onClick={() => setView("home")}>
                        返回首页
                    </button>
                </div>
            </div>
        );
    }

    if (view === "wrongbook") {
        return <WrongBook kb={kb} onBack={() => setView("home")} />;
    }

    if (view === "stats") {
        return <Stats kb={kb} onBack={() => setView("home")} />;
    }

    if (!current) return null;
    const q = current.q;

    return (
        <div className="app">
            <header>
                <h1>第 {index + 1} / {queue.length} 题</h1>
                <button className="btn secondary" style={{ width: "auto", padding: "8px 14px", fontSize: 14, margin: 0 }} onClick={endSession}>
                    结束
                </button>
            </header>

            <div className="card">
                {q.type === "topic_order" ? (
                    <OrderQuestion key={current.key} q={q} answered={answered} onAnswer={handleAnswer} />
                ) : q.choices ? (
                    <MCQuestion key={current.key} q={q} answered={answered} onAnswer={handleAnswer} />
                ) : (
                    <FillQuestion key={current.key} q={q} answered={answered} onAnswer={handleAnswer} />
                )}
            </div>

            {answered && (
                <div className="card">
                    {current.lastCorrect === false ? (
                        <>
                            <div className="feedback bad">❌ 答错了</div>
                            <p style={{ fontSize: 14, color: "#86868b", whiteSpace: "pre-wrap", marginTop: 12 }}>
                                {q.explanation}
                            </p>
                            <button className="btn" style={{ marginTop: 14 }} onClick={nextQuestion}>
                                {index + 1 >= queue.length ? "查看结果" : "下一题 →"}
                            </button>
                        </>
                    ) : (
                        <div className="feedback ok">✅ 正确，即将进入下一题…</div>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------- 组件 ----------------


function MCQuestion({ q, answered, onAnswer }: {
    q: GeneratedQuestion;
    answered: boolean;
    onAnswer: (correct: boolean) => void;
}) {
    const [picked, setPicked] = useState<string | null>(null);
    const choices = q.choices || [];
    return (
        <>
            <div className={`prompt ${q.type === "grammar_mc" ? "small" : ""}`}>{q.prompt}</div>
            <div>
                {choices.map(c => {
                    let cls = "option";
                    if (answered) {
                        if (c === q.answer) cls += " correct";
                        else if (c === picked) cls += " wrong";
                    }
                    return (
                        <button
                            key={c}
                            className={cls}
                            disabled={answered}
                            onClick={() => { setPicked(c); onAnswer(c === q.answer); }}
                        >
                            {c}
                        </button>
                    );
                })}
            </div>
        </>
    );
}

function FillQuestion({ q, answered, onAnswer }: {
    q: GeneratedQuestion;
    answered: boolean;
    onAnswer: (correct: boolean) => void;
}) {
    const [val, setVal] = useState("");
    function submit() {
        if (answered) return;
        const pool = [q.answer, ...(q.accept || [])].map(normalize);
        onAnswer(pool.includes(normalize(val)));
    }
    return (
        <>
            <div className="prompt small">{q.prompt}</div>
            <input
                type="text"
                value={val}
                disabled={answered}
                onChange={e => setVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submit(); }}
                autoFocus
                autoComplete="off"
            />
            <button className="btn" disabled={answered} onClick={submit}>提交</button>
        </>
    );
}

function OrderQuestion({ q, answered, onAnswer }: {
    q: GeneratedQuestion;
    answered: boolean;
    onAnswer: (correct: boolean) => void;
}) {
    const turns = q.turns || [];
    const [order, setOrder] = useState<number[]>([]);
    const correctSeq = useMemo(() => q.answer.split("|"), [q.answer]);

    function toggle(i: number) {
        if (answered) return;
        setOrder(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
    }
    function submit() {
        if (answered) return;
        const userSeq = order.map(i => turns[i].text);
        const correct = userSeq.every((t, i) => t === correctSeq[i]);
        onAnswer(correct);
    }
    return (
        <>
            <div className="prompt small">{q.prompt}</div>
            {turns.map((t, i) => {
                const pos = order.indexOf(i);
                let cls = "topic-turn";
                if (pos >= 0) cls += " selected";
                if (answered) {
                    const correctIdx = correctSeq.indexOf(t.text);
                    const userIdx = order.indexOf(i);
                    cls += correctIdx === userIdx ? " correct" : " wrong";
                }
                return (
                    <div key={i} className={cls} onClick={() => toggle(i)}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flex: 1 }}>
                            <span style={{ fontWeight: 600, color: "#86868b", fontSize: 13, minWidth: 52 }}>{t.speaker}</span>
                            <span>{t.text}</span>
                        </div>
                        {pos >= 0 && <span className="order-num">{pos + 1}</span>}
                    </div>
                );
            })}
            <button className="btn" disabled={answered || order.length !== turns.length} onClick={submit}>
                提交顺序
            </button>
        </>
    );
}

