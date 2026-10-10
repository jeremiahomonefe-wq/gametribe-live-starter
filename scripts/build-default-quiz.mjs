// Turns docs/default-questions.csv into server/src/default-quiz.js, the quiz that ships inside the app.
// Edit the CSV, then run:  npm run default-quiz            (optionally: npm run default-quiz -- "Quiz title")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuizCsv } from '../server/src/quiz-csv.js';
import { validateQuiz } from '../server/src/quiz-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const title = process.argv[2] || 'Game Tribe Quiz';
const parsed = parseQuizCsv(fs.readFileSync(path.join(root, 'docs/default-questions.csv'), 'utf8'), { title });
if (parsed.fatal) { console.error(`docs/default-questions.csv: ${parsed.fatal}`); process.exit(1); }
if (parsed.problems.length) {
  console.error('docs/default-questions.csv has problems, nothing was written:');
  parsed.problems.forEach((p) => console.error(`  ${p.row ? `Row ${p.row}: ` : ''}${p.message}`));
  process.exit(1);
}
const checked = validateQuiz(parsed.quiz);
if (!checked.ok) { console.error(checked.issues.map((i) => i.message).join('\n')); process.exit(1); }

const file = path.join(root, 'server/src/default-quiz.js');
fs.writeFileSync(file, `// GENERATED from docs/default-questions.csv by scripts/build-default-quiz.mjs. Do not edit by hand.
// The quiz ships inside the app, so the default questions never depend on a file, a database or a request.
export const DEFAULT_QUIZ = ${JSON.stringify(checked.quiz, null, 2)};
`);
console.log(`Wrote ${path.relative(root, file)}: "${checked.quiz.title}", ${checked.quiz.questions.length} questions.`);
