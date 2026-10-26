import { useEffect, useMemo, useState } from "react";
import { db, type AnswerLog } from "../db/db";
import type { ReviewUnit } from "../review/units";
import type { KnowledgeBase } from "../data/schema";

interface LessonStat {
    lessonId: string;
    title: string;
    total: number;
    correct: number;
}

interface GrammarStat {
    grammarId: string;
    name: string;
    lessonTitle: string;
    total: number;
    correct: number;
    wrongRate: number;
}

interface DayStat {
    label: string;
    date: string;
    total: number;
    correct: number;
}

export default function Stats({ kb, onBack }: { kb: KnowledgeBase; onBack: () => void }) {
    const [logs, setLogs] = useState<AnswerLog[]>([]);
    const [units, setUnits] = useState<ReviewUnit[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => { load(); }, []);

    async function load() {
        setLoading(true);
        const [l, u] = await Promise.all([
            db.logs.toArray(),
            db.units.toArray(),
        ]);
        setLogs(l);
        setUnits(u);
        setLoading(false);
    }

    // ---------- 总览 ----------
    const overview = useMemo(() => {
        const total = logs.length;
        const correct = logs.filter(l => l.correct).length;
        const accuracy = total > 0 ? correct / total : 0;
        const mastered = units.filter(u => u.stage >= 4).length;
        const due = units.filter(u => u.dueAt <= Date.now()).length;
        return { total, correct, accuracy, mastered, due, unitTotal: units.length };
    }, [logs, units]);

    // ---------- 各课正确率 ----------
    const lessonStats: LessonStat[] = useMemo(() => {
        const map = new Map<string, { total: number; correct: number }>();
        for (const log of logs) {
            // unitKey 格式：lessonId|itemType|itemId|direction
            const lessonId = log.unitKey.split("|")[0];
            const cur = map.get(lessonId) ?? { total: 0, correct: 0 };
            cur.total++;
            if (log.correct) cur.correct++;
            map.set(lessonId, cur);
        }
        return [...map.entries()].map(([lessonId, s]) => {
            const lesson = kb.lessons.find(l => l.id === lessonId);
            return {
                lessonId,
                title: lesson ? lesson.title : lessonId,
                total: s.total,
                correct: s.correct,
            };
        }).sort((a, b) => a.lessonId.localeCompare(b.lessonId));
    }, [logs, kb]);

    // ---------- 薄弱语法 Top 5 ----------
    const grammarStats: GrammarStat[] = useMemo(() => {
        const map = new Map<string, { total: number; correct: number; lessonId: string }>();
        for (const log of logs) {
            const parts = log.unitKey.split("|");
            if (parts[1] !== "grammar") continue;
            const grammarId = parts[2];
            const lessonId = parts[0];
            const cur = map.get(grammarId) ?? { total: 0, correct: 0, lessonId };
            cur.total++;
            if (log.correct) cur.correct++;
            map.set(grammarId, cur);
        }
        const list: GrammarStat[] = [];
        for (const [grammarId, s] of map.entries()) {
            const lesson = kb.lessons.find(l => l.id === s.lessonId);
            const grammar = lesson?.grammars.find(g => g.id === grammarId);
            list.push({
                grammarId,
                name: grammar ? grammar.name : grammarId,
                lessonTitle: lesson ? lesson.title : s.lessonId,
                total: s.total,
                correct: s.correct,
                wrongRate: s.total > 0 ? 1 - s.correct / s.total : 0,
            });
        }
        return list
            .filter(g => g.total >= 2)          // 至少答过 2 次才纳入排名
            .sort((a, b) => b.wrongRate - a.wrongRate)
            .slice(0, 5);
    }, [logs, kb]);

    // ---------- 最近 7 天 ----------
    // ---------- 最近 7 天 ----------
    const last7: DayStat[] = useMemo(() => {
        const localKey = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
        };

        const days: DayStat[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            days.push({
                label: `${d.getMonth() + 1}/${d.getDate()}`,
                date: localKey(d),
                total: 0,
                correct: 0,
            });
        }
        const byDate = new Map(days.map(d => [d.date, d]));
        for (const log of logs) {
            const dateKey = localKey(new Date(log.at));
            const d = byDate.get(dateKey);
            if (!d) continue;
            d.total++;
            if (d.correct !== undefined && log.correct) d.correct++;
        }
        return days;
    }, [logs]);

    const maxDayTotal = Math.max(1, ...last7.map(d => d.total));

    if (loading) return <div className="app"><p>加载中…</p></div>;

    return (
        <div className="app">
            <header>
                <h1>统计</h1>
                <button className="btn secondary" style={{ width: "auto", padding: "8px 14px", fontSize: 14, margin: 0 }}
                    onClick={onBack}>
                    返回
                </button>
            </header>

            {/* 总览 */}
            <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="stat">
                    <div className="num">{overview.total}</div>
                    <div className="label">总答题数</div>
                </div>
                <div className="stat">
                    <div className="num">{Math.round(overview.accuracy * 100)}%</div>
                    <div className="label">总正确率</div>
                </div>
                <div className="stat">
                    <div className="num">{overview.mastered} / {overview.unitTotal}</div>
                    <div className="label">已掌握知识点</div>
                </div>
                <div className="stat">
                    <div className="num">{overview.due}</div>
                    <div className="label">待复习</div>
                </div>
            </div>

            {/* 最近 7 天 */}
            <div className="card">
                <h2 style={{ fontSize: 16, marginBottom: 16 }}>最近 7 天</h2>
                {overview.total === 0 ? (
                    <p style={{ fontSize: 14, color: "#86868b" }}>还没有答题记录。</p>
                ) : (
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 140 }}>
                        {last7.map(d => {
                            const h = d.total > 0 ? Math.max(8, (d.total / maxDayTotal) * 120) : 0;
                            const acc = d.total > 0 ? d.correct / d.total : 0;
                            return (
                                <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                                    <div style={{ fontSize: 11, color: "#86868b", height: 16 }}>
                                        {d.total > 0 ? d.total : ""}
                                    </div>
                                    <div style={{
                                        width: "100%", maxWidth: 36, height: h, minHeight: d.total > 0 ? 8 : 2,
                                        background: d.total === 0 ? "#e5e5ea" : "#007aff",
                                        borderRadius: 6, transition: "height .2s",
                                        position: "relative", overflow: "hidden",
                                    }}>
                                        {d.total > 0 && (
                                            <div style={{
                                                position: "absolute", bottom: 0, left: 0, right: 0,
                                                height: `${acc * 100}%`, background: "#34c759",
                                            }} />
                                        )}
                                    </div>
                                    <div style={{ fontSize: 11, color: "#86868b" }}>{d.label}</div>
                                </div>
                            );
                        })}
                    </div>
                )}
                <p style={{ fontSize: 12, color: "#86868b", marginTop: 10 }}>
                    柱高 = 答题数，绿色部分 = 正确比例
                </p>
            </div>

            {/* 各课正确率 */}
            <div className="card">
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>各课正确率</h2>
                {lessonStats.length === 0 ? (
                    <p style={{ fontSize: 14, color: "#86868b" }}>暂无数据。</p>
                ) : (
                    lessonStats.map(s => {
                        const acc = s.total > 0 ? s.correct / s.total : 0;
                        return (
                            <div key={s.lessonId} style={{ marginBottom: 12 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
                                    <span>{s.title}</span>
                                    <span style={{ color: "#86868b" }}>
                                        {s.correct}/{s.total} · {Math.round(acc * 100)}%
                                    </span>
                                </div>
                                <div style={{ height: 8, background: "#e5e5ea", borderRadius: 4, overflow: "hidden" }}>
                                    <div style={{
                                        width: `${acc * 100}%`, height: "100%",
                                        background: acc >= 0.8 ? "#34c759" : acc >= 0.5 ? "#ff9500" : "#ff3b30",
                                        transition: "width .3s",
                                    }} />
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* 薄弱语法 */}
            <div className="card">
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>薄弱语法 Top 5</h2>
                {grammarStats.length === 0 ? (
                    <p style={{ fontSize: 14, color: "#86868b" }}>
                        暂无足够数据（每个语法至少答 2 次才纳入排名）。
                    </p>
                ) : (
                    grammarStats.map((g, i) => (
                        <div key={g.grammarId} style={{ marginBottom: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
                                <span>
                                    <span style={{ color: "#86868b", marginRight: 6 }}>#{i + 1}</span>
                                    {g.name}
                                </span>
                                <span style={{ color: "#ff3b30", fontWeight: 600 }}>
                                    {Math.round(g.wrongRate * 100)}% 错误
                                </span>
                            </div>
                            <div style={{ fontSize: 12, color: "#86868b", marginBottom: 4 }}>
                                {g.lessonTitle} · 答 {g.total} 次，对 {g.correct} 次
                            </div>
                            <div style={{ height: 6, background: "#e5e5ea", borderRadius: 3, overflow: "hidden" }}>
                                <div style={{
                                    width: `${g.wrongRate * 100}%`, height: "100%", background: "#ff3b30",
                                }} />
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}