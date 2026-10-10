// CSV import/export for quizzes. Pure functions (no Node imports) so the editor and the tests share them.
import { QUIZ_LIMITS } from './quiz-rules.js';

export const CSV_HEADER = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct', 'seconds'];

const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Splits CSV text into rows of cells. Handles quotes, "" escapes, commas/newlines inside quotes,
// CRLF, a UTF-8 BOM, and the semicolon/tab separators some spreadsheet locales use.
export function splitCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const delimiter = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function mapColumns(header) {
  const cols = { prompt: -1, options: [-1, -1, -1, -1], correct: -1, seconds: -1 };
  header.forEach((h, i) => {
    const n = norm(h);
    if (['question', 'prompt', 'questiontext', 'q'].includes(n)) cols.prompt = i;
    else if (['correct', 'correctanswer', 'answer', 'key', 'right', 'rightanswer'].includes(n)) cols.correct = i;
    else if (['seconds', 'time', 'timelimit', 'duration', 'durationseconds', 'timer', 'timeseconds'].includes(n)) cols.seconds = i;
    else {
      const m = n.match(/^(?:option|answer|choice)?([a-d1-4])$/);
      if (m) {
        const idx = 'abcd'.includes(m[1]) ? 'abcd'.indexOf(m[1]) : Number(m[1]) - 1;
        if (cols.options[idx] === -1) cols.options[idx] = i;
      }
    }
  });
  return cols;
}

// Returns { quiz, problems: [{ row, message }], imported, fatal? }.
// Row numbers match the spreadsheet (the header is row 1). Rows with a problem are still imported,
// with the correct answer left empty, so they can be fixed in the editor instead of being lost.
export function parseQuizCsv(text, { title = '' } = {}) {
  const L = QUIZ_LIMITS;
  const rows = splitCsv(text);
  if (!rows.length || rows.every((r) => r.every((c) => !String(c).trim()))) return { fatal: 'That file is empty.' };
  const cols = mapColumns(rows[0]);
  if (cols.prompt === -1) return { fatal: 'Could not find a "question" column. Download the template and use its first row as your header.' };
  if (cols.options.filter((i) => i !== -1).length < 2) return { fatal: 'Need at least two answer columns (option_a, option_b, ...). Download the template to see the layout.' };
  if (cols.correct === -1) return { fatal: 'Could not find a "correct" column. Put A, B, C or D (or the answer text) in it.' };

  const problems = [];
  const questions = [];
  let truncated = false;
  const cell = (rec, i) => (i >= 0 ? clean(rec[i]) : '');

  for (let r = 1; r < rows.length; r += 1) {
    const rec = rows[r];
    if (rec.every((c) => !String(c).trim())) continue;
    if (questions.length >= L.maxQuestions) { truncated = true; continue; }
    const row = r + 1;
    const note = (message) => problems.push({ row, message });

    const prompt = cell(rec, cols.prompt);
    if (!prompt) note('there is no question text.');

    // Blank answer cells are dropped; remember where each answer sat so "C" still means column C.
    const slots = cols.options.map((ci) => cell(rec, ci));
    const options = [];
    const slotToIndex = {};
    slots.forEach((t, k) => { if (t) { slotToIndex[k] = options.length; options.push(t); } });
    if (options.length < L.minOptions) note(`needs at least ${L.minOptions} answers.`);
    while (options.length < L.minOptions) options.push('');

    let correctIndex = null;
    const raw = cell(rec, cols.correct);
    if (!raw) note('no correct answer given.');
    else {
      const byText = options.findIndex((o) => o && o.toLowerCase() === raw.toLowerCase());
      const letter = raw.match(/^([a-d])$/i);
      const digit = raw.match(/^([1-4])$/);
      const slot = letter ? 'abcd'.indexOf(letter[1].toLowerCase()) : digit ? Number(digit[1]) - 1 : -1;
      if (byText !== -1) correctIndex = byText;
      else if (slot !== -1 && slotToIndex[slot] !== undefined) correctIndex = slotToIndex[slot];
      else if (slot !== -1) note(`the correct answer "${raw}" points to an empty option.`);
      else note(`the correct answer "${raw}" does not match any answer. Use A, B, C or D, or copy the answer text exactly.`);
    }

    let durationSeconds = L.defaultSeconds;
    const rawSeconds = cell(rec, cols.seconds);
    if (rawSeconds) {
      const n = Number(rawSeconds.replace(/s(ec(onds)?)?$/i, ''));
      if (Number.isInteger(n) && n >= L.minSeconds && n <= L.maxSeconds) durationSeconds = n;
      else note(`the time "${rawSeconds}" is not a whole number from ${L.minSeconds} to ${L.maxSeconds}, so ${L.defaultSeconds} seconds was used.`);
    }
    questions.push({ prompt, options, correctIndex, durationSeconds });
  }

  if (!questions.length) return { fatal: 'No questions were found under the header row.' };
  if (truncated) problems.push({ row: null, message: `Only the first ${L.maxQuestions} questions were imported (the limit per quiz).` });
  return { quiz: { title: clean(title).slice(0, L.maxTitle), questions }, problems, imported: questions.length };
}

// Spreadsheet formula protection: cells starting with these characters are prefixed so they stay text.
const protect = (v) => (/^[=+@\t\r]/.test(v) ? `'${v}` : v);
const cellOut = (v) => {
  const s = protect(String(v ?? ''));
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function quizToCsv(quiz) {
  const rows = [CSV_HEADER, ...quiz.questions.map((q) => [
    q.prompt, ...[0, 1, 2, 3].map((i) => q.options?.[i] ?? ''),
    Number.isInteger(q.correctIndex) ? 'ABCD'[q.correctIndex] : '', q.durationSeconds ?? QUIZ_LIMITS.defaultSeconds
  ])];
  return `${rows.map((r) => r.map(cellOut).join(',')).join('\r\n')}\r\n`;
}

export const TEMPLATE_CSV = quizToCsv({
  questions: [
    { prompt: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correctIndex: 1, durationSeconds: 15 },
    { prompt: 'Lagos is the capital city of Nigeria.', options: ['True', 'False'], correctIndex: 1, durationSeconds: 10 },
    { prompt: 'Who led Israel across the Jordan River, after Moses?', options: ['Joshua', 'Caleb', 'Aaron', 'Samuel'], correctIndex: 0, durationSeconds: 20 }
  ]
});
