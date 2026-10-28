
import { useCallback, useEffect, useRef, useState } from "react";

import { ReviewDB } from "../db/db";
import { saveAnswerToDb } from "../db/answerService";

import type { KnowledgeBase } from "../data/schema";
import { buildUnitsForLesson } from "../review/units";
import { generateFor } from "../generators";

import WrongBook from "./WrongBook";

// 每次打开测试页面创建独立的临时数据库
export default function WrongBookSandbox({
    kb
}: {
    kb: KnowledgeBase;
}) {
    const [database] = useState(() =>
        new ReviewDB(
            `korean-wrongbook-ui-test-${Date.now()}`
        )
    );

    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const [closed, setClosed] = useState(false);

    const failNextSaveRef = useRef(false);
    const [slowSave, setSlowSave] = useState(false);
    const saveCallCountRef = useRef(0);
    const [saveCallCount, setSaveCallCount] = useState(0);


    const testSaveAnswer = useCallback(
        async (
            ...args: Parameters<typeof saveAnswerToDb>
        ) => {
            saveCallCountRef.current += 1;
            setSaveCallCount(saveCallCountRef.current);

            // 只让下一次保存失败一次
            if (failNextSaveRef.current) {
                failNextSaveRef.current = false;

                throw new Error(
                    "[SANDBOX] 模拟数据库保存失败"
                );
            }

            // 模拟慢速保存
            if (slowSave) {
                await new Promise<void>(resolve => {
                    window.setTimeout(resolve, 1500);
                });
            }

            // 其余请求调用真正的保存服务
            return saveAnswerToDb(...args);
        },
        [slowSave]
    );

    useEffect(() => {
        let cancelled = false;

        async function setup() {
            try {
                await database.open();

                // 从真实课程生成复习单元，但不读取正式进度
                const candidates = kb.lessons.flatMap(
                    lesson => buildUnitsForLesson(lesson)
                ).filter(unit =>
                    // 只选可以实际生成题目的单元
                    generateFor(kb, unit) !== null
                );

                const vocab = candidates.find(
                    u => u.itemType === "vocab" &&
                        u.direction === "kr2zh"
                );

                const grammar = candidates.find(
                    u => u.itemType === "grammar" &&
                        u.direction === "fill"
                );

                const topic = candidates.find(
                    u => u.itemType === "topic"
                );

                const selected = [
                    vocab,
                    grammar,
                    topic
                ].filter(
                    (unit): unit is NonNullable<typeof unit> =>
                        unit !== undefined
                );

                if (selected.length === 0) {
                    throw new Error("没有可测试的题目");
                }

                const now = Date.now();

                // 其中词汇和语法使用 FSRS，
                // 对话保留固定算法作为兼容性对照
                const units = selected.map(unit => ({
                    ...unit,
                    schedulingAlgorithm:
                        unit.itemType === "topic"
                            ? "fixed" as const
                            : "fsrs" as const,
                    seen: 0,
                    lapses: 0
                }));

                await database.transaction(
                    "rw",
                    database.units,
                    database.logs,
                    async () => {
                        await database.units.clear();
                        await database.logs.clear();
                    }
                );

                await database.units.bulkPut(units);

                // 制造历史错题，让它们进入错题本
                await database.logs.bulkAdd(
                    units.map(unit => ({
                        unitKey: unit.key,
                        correct: false,
                        at: now - 60_000,
                        type: unit.itemType === "topic"
                            ? "topic_order"
                            : unit.itemType === "grammar"
                                ? "grammar_fill"
                                : "vocab_mc_kr2zh"
                    }))
                );

                if (!cancelled) setReady(true);

            } catch (e) {
                if (!cancelled) {
                    setError(
                        e instanceof Error
                            ? e.message
                            : String(e)
                    );
                }
            }
        }

        void setup();

        return () => {
            cancelled = true;
            // 测试数据库独立存在，不影响正式学习数据
            // 实际删除操作交给下面的清理函数
        };
    }, [database, kb]);

    async function cleanup() {
        await database.delete();
        setClosed(true);
    }

    if (closed) {
        return <p style={{ padding: 30 }}>
            ✅ 测试数据库已删除。
            可以关闭当前页面。
        </p>;
    }

    if (error) {
        return <div style={{ padding: 30 }}>
            <p role="alert">测试初始化失败：{error}</p>
            <button onClick={() => void cleanup()}>
                清理测试数据库
            </button>
        </div>;
    }

    if (!ready) {
        return <p style={{ padding: 30 }}>
            正在初始化独立测试数据…
        </p>;
    }

    return (
        <div>
            <div
                style={{
                    padding: 12,
                    background: "#fff3cd",
                    color: "#594400"
                }}
            >
                🧪 FSRS 隔离 UI 测试环境
                <button
                    style={{ marginLeft: 16 }}
                    onClick={() => void cleanup()}
                >
                    清理并结束测试
                </button>
            </div>


            <div
                className="card"
                style={{ margin: 12 }}
            >
                <strong>🧪 FSRS 保存异常测试</strong>

                <p>
                    测试保存函数调用次数：
                    {saveCallCount}
                </p>

                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 10,
                        marginTop: 12
                    }}
                >
                    <button
                        className="btn secondary"
                        onClick={() => {
                            failNextSaveRef.current = true;
                        }}
                    >
                        下一次保存模拟失败
                    </button>

                    <button
                        className="btn secondary"
                        onClick={() => {
                            setSlowSave(prev => !prev);
                        }}
                    >
                        慢速保存：
                        {slowSave ? "开启" : "关闭"}
                    </button>

                    <button
                        className="btn secondary"
                        onClick={async () => {
                            const logs =
                                await database.logs.toArray();

                            const units =
                                await database.units.toArray();

                            console.table(logs);
                            console.table(
                                units.map(unit => ({
                                    key: unit.key,
                                    seen: unit.seen,
                                    algorithm:
                                        unit.schedulingAlgorithm
                                }))
                            );
                        }}
                    >
                        查看测试数据库
                    </button>
                </div>
            </div>

            <WrongBook
                kb={kb}
                database={database}
                saveAnswerFn={testSaveAnswer}
                onBack={() => void cleanup()}
            />
        </div>
    );
}