import { useEffect, useState } from "react";
import { db } from "../db/db";
import type { ReviewUnit } from "../review/units";
import type { KnowledgeBase } from "../data/schema";
import type { GeneratedQuestion } from "../generators/types";
import { generateFor } from "../generators";
import { MCQuestion, FillQuestion } from "../components/QuizCards";

interface WrongItem {
    unitKey: string;
    unit: ReviewUnit | null;
    wrongCount: number;
    lastAt: number;
    lastType: string;
}

export default function WrongBook({ kb, onBack }: { kb: KnowledgeBase; onBack: () => void }) {
    const [items, setItems] = useState<WrongItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [reviewing, setReviewing] = useState<{ key: string; q: GeneratedQuestion } | null>(null);
    const [feedback, setFeedback] = useState<{ correct: boolean; answer: string } | null>(null);

    useEffect(() => { load(); }, []);

    async function load() {
        setLoading(true);
        const logs = await db.logs.filter(l => l.correct === false).toArray();
        const units = await db.units.toArray();
        const unitMap = new Map(units.map(u => [u.key, u]));

        const agg = new Map<string, WrongItem>();
        for (const log of logs) {
            const existing = agg.get(log.unitKey);
            if (existing) {
                existing.wrongCount++;
                if (log.at > existing.lastAt) {
                    existing.lastAt = log.at;
                    existing.lastType = log.type;
                }
            } else {
                agg.set(log.unitKey, {
                    unitKey: log.unitKey,
                    unit: unitMap.get(log.unitKey) ?? null,
                    wrongCount: 1,
                    lastAt: log.at,
                    lastType: log.type,
                });
            }
        }

        const list = [...agg.values()].sort((a, b) => b.lastAt - a.lastAt);
        setItems(list);
        setLoading(false);
    }

    function describe(item: WrongItem): string {
        if (!item.unit) return item.unitKey;
        const lesson = kb.lessons.find(l => l.id === item.unit!.lessonId);
        if (!lesson) return item.unitKey;

        if (item.unit.itemType === "vocab") {
            for (const g of lesson.vocabGroups) {
                const v = g.items.find(x => x.id === item.unit!.itemId);
                if (v) {
                    const dirLabel = item.unit.direction === "kr2zh" ? "韩→中"
                        : item.unit.direction === "zh2kr" ? "中→韩" : "拼写";
                    return `${v.word}（${v.meaning}）· ${dirLabel}`;
                }
            }
        }
        if (item.unit.itemType === "grammar") {
            const g = lesson.grammars.find(x => x.id === item.unit!.itemId);
            if (g) {
                const dirLabel = item.unit.direction === "mc" ? "形式选择" : "填空";
                return `${g.name} · ${dirLabel}`;
            }
        }
        if (item.unit.itemType === "topic") {
            const t = lesson.topics.find(x => x.id === item.unit!.itemId);
            if (t) return `${t.title}`;
        }
        return item.unitKey;
    }

    function startReview(item: WrongItem) {
        if (!item.unit) return;
        const q = generateFor(kb, item.unit);
        if (!q) return;
        setReviewing({ key: item.unitKey, q });
        setFeedback(null);
    }

    async function handleAnswer(correct: boolean) {
        if (!reviewing) return;
        const { key, q } = reviewing;
        const unit = await db.units.get(key);
        if (unit) {
            const { schedule } = await import("../review/scheduler");
            const updated = { ...unit };
            schedule(updated, correct);
            await db.units.put(updated);
        }
        await db.logs.add({ unitKey: key, correct, at: Date.now(), type: q.type });
        setFeedback({ correct, answer: q.answer });
        if (correct) {
            // 答对后从错题本移除当前项
            setItems(prev => prev.filter(x => x.unitKey !== key));
        }
    }

    if (loading) return <div className="app"><p>加载中…</p></div>;

    if (reviewing) {
        const { q } = reviewing;
        return (
            <div className="app">
                <header>
                    <h1>错题重做</h1>
                    <button className="btn secondary" style={{ width: "auto", padding: "8px 14px", fontSize: 14, margin: 0 }}
                        onClick={() => { setReviewing(null); setFeedback(null); }}>
                        返回
                    </button>
                </header>
                <div className="card">
                    {q.choices ? (
                        <MCQuestion q={q} answered={!!feedback} onAnswer={handleAnswer} />
                    ) : (
                        <FillQuestion q={q} answered={!!feedback} onAnswer={handleAnswer} />
                    )}
                </div>
                {feedback && (
                    <div className="card">
                        <div className={`feedback ${feedback.correct ? "ok" : "bad"}`}>
                            {feedback.correct ? "✅ 正确！已从错题本移除。" : `❌ 错误。正确答案：${feedback.answer}`}
                        </div>
                        <p style={{ fontSize: 14, color: "#86868b", whiteSpace: "pre-wrap", marginTop: 12 }}>
                            {q.explanation}
                        </p>
                        <button className="btn" style={{ marginTop: 14 }} onClick={() => { setReviewing(null); setFeedback(null); }}>
                            返回错题本
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // 将错题按类型分组
    const vocabItems = items.filter(i => i.unit?.itemType === "vocab");
    const grammarItems = items.filter(i => i.unit?.itemType === "grammar");
    const topicItems = items.filter(i => i.unit?.itemType === "topic");

    // 提取出的单块列表渲染组件
    const renderSection = (title: string, sectionItems: WrongItem[]) => {
        if (sectionItems.length === 0) return null;
        return (
            <div className="card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <h2 style={{ fontSize: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f0f0f0", paddingBottom: 12 }}>
                    <span>{title}</span>
                    <span style={{ fontSize: 13, color: "#86868b", fontWeight: "normal" }}>{sectionItems.length} 项</span>
                </h2>

                {/* 内部滚动区域，防止错题太多撑破页面 */}
                <div style={{ overflowY: "auto", flex: 1, paddingRight: 4, maxHeight: "60vh" }}>
                    {sectionItems.map(item => (
                        <div
                            key={item.unitKey}
                            className="topic-turn"
                            style={{ cursor: "pointer", marginBottom: 10, border: "1px solid #f0f0f0" }}
                            onClick={() => startReview(item)}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={describe(item)}>
                                    {describe(item)}
                                </div>
                                <div style={{ fontSize: 12, color: "#ff3b30" }}>
                                    错 {item.wrongCount} 次 · 最近 {new Date(item.lastAt).toLocaleDateString()}
                                </div>
                            </div>
                            <span style={{ color: "#007aff", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", marginLeft: 8 }}>重做 →</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="app" style={{ maxWidth: 1100 }}> {/* 放宽了最大宽度 */}
            <header>
                <div>
                    <h1>错题本</h1>
                    <p className="subtitle">按知识点分类复习</p>
                </div>
                <button
                    className="btn secondary"
                    style={{ width: "auto", padding: "8px 16px", fontSize: 14, margin: 0 }}
                    onClick={onBack}
                >
                    返回面板
                </button>
            </header>

            {items.length === 0 ? (
                <div className="card" style={{ textAlign: "center", color: "#86868b", padding: 40 }}>
                    <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
                    <p>暂无错题，继续保持！</p>
                </div>
            ) : (
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                    gap: 20,
                    alignItems: "start"
                }}>
                    {renderSection("词汇", vocabItems)}
                    {renderSection("语法", grammarItems)}
                    {renderSection("对话", topicItems)}
                </div>
            )}
        </div>
    );
}
