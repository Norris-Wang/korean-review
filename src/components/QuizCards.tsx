import { useState, useMemo } from "react";
import type { GeneratedQuestion } from "../generators/types";
import { normalize } from "../generators/utils";

export function MCQuestion({ q, answered, onAnswer }: {
    q: GeneratedQuestion; answered: boolean; onAnswer: (correct: boolean) => void;
}) {
    const [picked, setPicked] = useState<string | null>(null);
    return (
        <>
            <div className={`prompt ${q.type === "grammar_mc" ? "small" : ""}`}>{q.prompt}</div>
            <div>
                {q.choices?.map(c => {
                    let cls = "option";
                    if (answered) {
                        if (c === q.answer) cls += " correct";
                        else if (c === picked) cls += " wrong";
                    }
                    return (
                        <button key={c} className={cls} disabled={answered}
                            onClick={() => { setPicked(c); onAnswer(c === q.answer); }}>
                            {c}
                        </button>
                    );
                })}
            </div>
        </>
    );
}

export function FillQuestion({ q, answered, onAnswer }: {
    q: GeneratedQuestion; answered: boolean; onAnswer: (correct: boolean) => void;
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
            <input type="text" value={val} disabled={answered}
                onChange={e => setVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submit(); }}
                autoFocus autoComplete="off" />
            <button className="btn" disabled={answered} onClick={submit}>提交</button>
        </>
    );
}

export function OrderQuestion({ q, answered, onAnswer }: {
    q: GeneratedQuestion; answered: boolean; onAnswer: (correct: boolean) => void;
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