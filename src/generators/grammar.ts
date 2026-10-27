import type { Grammar, GrammarExample } from "../data/schema";
import type { GeneratedQuestion } from "./types";
import { shuffle } from "./utils";

export function genGrammar(g: Grammar, direction: string): GeneratedQuestion | null {
    const ex: GrammarExample = g.examples[Math.floor(Math.random() * g.examples.length)];
    if (!ex) return null;

    const hintPrefix = ex.hint ? `【${ex.hint}】\n` : "";
    const dictHint = ex.dictionaryForm ? `（${ex.dictionaryForm}）` : "";
    const promptText = hintPrefix + ex.sentence.replace(ex.focus, `＿＿＿${dictHint}`);
    const explanation = `${g.name}：${g.function}\n例句：${ex.sentence}${ex.translation ? " — " + ex.translation : ""}`;

    if (direction === "mc" && ex.choices && ex.choices.length > 0) {
        return {
            type: "grammar_mc",
            prompt: promptText,
            choices: shuffle([ex.answer, ...ex.choices.filter(c => c !== ex.answer).slice(0, 3)]),
            answer: ex.answer,
            explanation,
        };
    }

    return {
        type: "grammar_fill",
        prompt: promptText,
        answer: ex.answer,
        accept: ex.accept || [ex.answer],
        explanation,
        isFill: true,
    };
}