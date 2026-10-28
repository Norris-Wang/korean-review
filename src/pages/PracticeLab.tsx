import { useState } from "react";
import type { KnowledgeBase } from "../data/schema";
import type { GeneratedQuestion } from "../generators/types";

import { genGrammar } from "../generators/grammar";
import { genTopic } from "../generators/topic";
import { genVocabFill, genVocabKr2Zh, genVocabZh2Kr } from "../generators/vocab";

import QuestionRenderer from "../components/QuestionRenderer";

type ItemType = "grammar" | "vocab" | "topic";

type Direction =
    | "fill"
    | "mc"
    | "kr2zh"
    | "zh2kr"
    | "order";

export default function PracticeLab({
    kb,
    onBack
}: {
    kb: KnowledgeBase;
    onBack: () => void;
}) {
    const [lessonId, setLessonId] =
        useState(kb.lessons[0].id);

    const [kind, setKind] =
        useState<ItemType>("grammar");

    const [itemIndex, setItemIndex] = useState(0);
    const [exampleIndex, setExampleIndex] = useState(0);

    const [direction, setDirection] =
        useState<Direction>("fill");

    const [question, setQuestion] =
        useState<GeneratedQuestion | null>(null);

    const [questionVersion, setQuestionVersion] = useState(0);
    const [answered, setAnswered] = useState(false);
    const [lastCorrect, setLastCorrect] =
        useState<boolean | null>(null);

    // 根据当前选择获取课程内容
    const lesson =
        kb.lessons.find(l => l.id === lessonId)
        ?? kb.lessons[0];

    const vocabs = lesson.vocabGroups.flatMap(g => g.items);

    const items =
        kind === "grammar"
            ? lesson.grammars.map(g => g.name)
            : kind === "vocab"
                ? vocabs.map(v => `${v.word} — ${v.meaning}`)
                : lesson.topics.map(t => t.title);

    const selectedGrammar =
        kind === "grammar"
            ? lesson.grammars[itemIndex]
            : undefined;

    const selectedExample =
        selectedGrammar?.examples[exampleIndex];

    const canStart =
        items.length > 0 &&
        (kind !== "grammar" || !!selectedExample);

    // 切换课程或类型时重置选择
    function resetChoice() {
        setItemIndex(0);
        setExampleIndex(0);
        setDirection("fill");
        setQuestion(null);
        setAnswered(false);
        setLastCorrect(null);
    }

    // 生成当前指定的题目
    function makeQuestion() {
        let q: GeneratedQuestion | null = null;

        if (kind === "grammar" && selectedGrammar) {
            q = genGrammar(
                selectedGrammar,
                direction,
                exampleIndex
            );
        } else if (kind === "vocab") {
            const v = vocabs[itemIndex];

            if (v) {
                if (direction === "kr2zh") {
                    q = genVocabKr2Zh(v, kb);
                } else if (direction === "zh2kr") {
                    q = genVocabZh2Kr(v, kb);
                } else {
                    q = genVocabFill(v, kb);
                }
            }
        } else if (kind === "topic") {
            const topic = lesson.topics[itemIndex];

            if (topic) {
                q = genTopic(topic);
            }
        }

        if (!q) return;

        setQuestion(q);
        setQuestionVersion(v => v + 1);
        setAnswered(false);
        setLastCorrect(null);
    }

    // 处理答案：仅用于定点练习，不更新数据库
    function handleAnswer(correct: boolean) {
        if (answered) return;
        setAnswered(true);
        setLastCorrect(correct);
    }

    return (
        <div className="app">
            <header>
                <h1>🎯 定点练习</h1>
                <button
                    className="btn secondary"
                    style={{ width: "auto", margin: 0 }}
                    onClick={onBack}
                >
                    返回首页
                </button>
            </header>

            <div
                className="card"
                style={{ maxWidth: 720, margin: "0 auto" }}
            >
                <p
                    className="subtitle"
                    style={{ marginBottom: 20 }}
                >
                    精确选择知识点和例句。
                    此模式不更新复习进度和错题记录。
                </p>

                {question ? (
                    <>
                        <QuestionRenderer
                            question={question}
                            questionKey={questionVersion}
                            answered={answered}
                            onAnswer={handleAnswer}
                        />

                        {answered && (
                            <div
                                className={`feedback ${lastCorrect ? "ok" : "bad"
                                    }`}
                            >
                                <strong>
                                    {lastCorrect
                                        ? "✅ 回答正确"
                                        : `❌ 正确答案：${question.answer}`}
                                </strong>

                                <p
                                    style={{
                                        marginTop: 8,
                                        whiteSpace: "pre-wrap"
                                    }}
                                >
                                    {question.explanation}
                                </p>
                            </div>
                        )}

                        <button
                            className="btn"
                            onClick={makeQuestion}
                        >
                            再做一次
                        </button>

                        <button
                            className="btn secondary"
                            onClick={() => setQuestion(null)}
                        >
                            重新选择知识点
                        </button>
                    </>
                ) : (
                    <>
                        <label htmlFor="practice-lesson">
                            课程
                        </label>

                        <select
                            id="practice-lesson"
                            className="practice-select"
                            value={lessonId}
                            onChange={e => {
                                setLessonId(e.target.value);
                                resetChoice();
                            }}
                        >
                            {kb.lessons.map(l => (
                                <option key={l.id} value={l.id}>
                                    {l.title}
                                </option>
                            ))}
                        </select>

                        <label htmlFor="practice-kind">
                            知识类型
                        </label>

                        <select
                            id="practice-kind"
                            className="practice-select"
                            value={kind}
                            onChange={e => {
                                setKind(e.target.value as ItemType);
                                resetChoice();
                            }}
                        >
                            <option value="grammar">语法</option>
                            <option value="vocab">词汇</option>
                            <option value="topic">话题对话</option>
                        </select>

                        <label htmlFor="practice-item">
                            具体知识点
                        </label>

                        <select
                            id="practice-item"
                            className="practice-select"
                            value={items.length ? itemIndex : ""}
                            onChange={e => {
                                setItemIndex(Number(e.target.value));
                                setExampleIndex(0);
                                setDirection("fill");
                            }}
                        >
                            {items.length === 0 && (
                                <option value="">
                                    暂无可用知识点
                                </option>
                            )}
                            {items.map((label, i) => (
                                <option key={i} value={i}>
                                    {label}
                                </option>
                            ))}
                        </select>

                        {kind === "grammar" && selectedGrammar && (
                            <>
                                <label htmlFor="practice-example">
                                    具体例句
                                </label>

                                <select
                                    id="practice-example"
                                    className="practice-select"
                                    value={selectedExample ? exampleIndex : ""}
                                    onChange={e => {
                                        setExampleIndex(Number(e.target.value));
                                        setDirection("fill");
                                    }}
                                >
                                    {selectedGrammar.examples.length === 0 && (
                                        <option value="">
                                            这条语法暂无例句
                                        </option>
                                    )}

                                    {selectedGrammar.examples.map((ex, i) => (
                                        <option key={i} value={i}>
                                            {i + 1}. {ex.sentence}
                                        </option>
                                    ))}
                                </select>
                            </>
                        )}

                        {kind !== "topic" && (
                            <>
                                <label htmlFor="practice-direction">
                                    题型
                                </label>

                                <select
                                    id="practice-direction"
                                    className="practice-select"
                                    value={direction}
                                    onChange={e => setDirection(
                                        e.target.value as Direction
                                    )}
                                >
                                    {kind === "grammar" ? (
                                        <>
                                            <option value="fill">
                                                语法填空
                                            </option>

                                            {selectedExample?.choices?.length ? (
                                                <option value="mc">
                                                    语法选择
                                                </option>
                                            ) : null}
                                        </>
                                    ) : (
                                        <>
                                            <option value="fill">
                                                韩语拼写
                                            </option>
                                            <option value="kr2zh">
                                                韩语 → 中文
                                            </option>
                                            <option value="zh2kr">
                                                中文 → 韩语
                                            </option>
                                        </>
                                    )}
                                </select>
                            </>
                        )}

                        <button
                            className="btn"
                            disabled={!canStart}
                            onClick={makeQuestion}
                        >
                            开始练习
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}