import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuizCsv, quizToCsv, splitCsv, TEMPLATE_CSV } from '../src/quiz-csv.js';
import { validateQuiz, DEMO_QUIZ } from '../src/quiz-rules.js';

const HEAD = 'question,option_a,option_b,option_c,option_d,correct,seconds\n';

test('the template parses cleanly into a quiz the server accepts', () => {
  const r = parseQuizCsv(TEMPLATE_CSV, { title: 'Template' });
  assert.equal(r.problems.length, 0);
  assert.equal(r.imported, 3);
  assert.equal(r.quiz.questions[1].options.length, 2, 'blank option cells are dropped');
  assert.equal(validateQuiz(r.quiz).ok, true);
});

test('quotes, commas, newlines inside cells, and doubled quotes', () => {
  const rows = splitCsv('a,"b, with comma","line1\nline2","say ""hi"""\r\nx,y,z,w\r\n');
  assert.deepEqual(rows[0], ['a', 'b, with comma', 'line1\nline2', 'say "hi"']);
  assert.deepEqual(rows[1], ['x', 'y', 'z', 'w']);
});

test('handles a BOM, CRLF line endings and semicolon separators (common in Excel)', () => {
  const csv = '\uFEFFquestion;option_a;option_b;correct\r\nWhat is 2+2?;3;4;B\r\n';
  const r = parseQuizCsv(csv);
  assert.equal(r.problems.length, 0);
  assert.deepEqual(r.quiz.questions[0].options, ['3', '4']);
  assert.equal(r.quiz.questions[0].correctIndex, 1);
});

test('the correct answer can be a letter, a number, or the answer text; text wins over a letter', () => {
  const r = parseQuizCsv(`${HEAD}Q1,Red,Blue,,,b,\nQ2,Red,Blue,,,2,\nQ3,Red,Blue,,,blue,\nQ4,4,5,6,,5,\n`);
  assert.deepEqual(r.quiz.questions.map((q) => q.correctIndex), [1, 1, 1, 1]);
  assert.equal(r.problems.length, 0);
});

test('a letter still means its own column when an earlier answer is blank', () => {
  const r = parseQuizCsv(`${HEAD}Pick,Alpha,,Gamma,,C,\n`);
  assert.deepEqual(r.quiz.questions[0].options, ['Alpha', 'Gamma']);
  assert.equal(r.quiz.questions[0].correctIndex, 1);
});

test('problem rows are kept for fixing, with spreadsheet row numbers', () => {
  const r = parseQuizCsv(`${HEAD}Good,A1,B1,,,A,10\nBad correct,A2,B2,,,Z,10\nNo answers,Only,,,,A,10\nBad time,A4,B4,,,A,soon\n`);
  assert.equal(r.imported, 4);
  assert.equal(r.quiz.questions[1].correctIndex, null);
  assert.deepEqual([...new Set(r.problems.map((p) => p.row))], [3, 4, 5], 'row 2 is fine; rows 3 to 5 are flagged');
  assert.ok(r.problems.some((p) => p.row === 3 && /does not match/.test(p.message)));
  assert.ok(r.problems.some((p) => p.row === 4 && /at least 2 answers/.test(p.message)));
  assert.ok(r.problems.some((p) => p.row === 5 && /time/.test(p.message)));
  assert.equal(r.quiz.questions[3].durationSeconds, 15);
  assert.equal(validateQuiz(r.quiz).ok, false, 'the editor will block hosting until these are fixed');
});

test('blank rows are skipped and header names are flexible', () => {
  const r = parseQuizCsv('Question Text,Choice A,Choice B,Correct Answer,Time Limit\nWhat?,Yes,No,A,30\n,,,,\n');
  assert.equal(r.imported, 1);
  assert.equal(r.quiz.questions[0].durationSeconds, 30);
});

test('clear errors when the layout is wrong', () => {
  assert.match(parseQuizCsv('').fatal, /empty/i);
  assert.match(parseQuizCsv('foo,bar\n1,2\n').fatal, /question/i);
  assert.match(parseQuizCsv('question,option_a\nQ,A\n').fatal, /two answer columns/i);
  assert.match(parseQuizCsv('question,option_a,option_b\nQ,A,B\n').fatal, /correct/i);
  assert.match(parseQuizCsv(HEAD).fatal, /No questions/i);
});

test('stops at the 50-question limit and says so', () => {
  const body = Array.from({ length: 60 }, (_, i) => `Q${i},a,b,,,A,`).join('\n');
  const r = parseQuizCsv(`${HEAD}${body}\n`);
  assert.equal(r.imported, 50);
  assert.ok(r.problems.some((p) => /first 50/.test(p.message)));
});

test('export then import gives the same quiz back, and formula-looking cells stay text', () => {
  const out = quizToCsv(DEMO_QUIZ);
  const back = parseQuizCsv(out, { title: DEMO_QUIZ.title });
  assert.deepEqual(back.quiz.questions, DEMO_QUIZ.questions);
  const risky = quizToCsv({ questions: [{ prompt: '=HYPERLINK("x")', options: ['a', 'b'], correctIndex: 0, durationSeconds: 10 }] });
  assert.match(risky, /^'=HYPERLINK|\r\n"?'=HYPERLINK/m);
});
