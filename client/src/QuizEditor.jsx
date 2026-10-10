import { useState } from 'react';
import { DEMO_QUIZ, QUIZ_LIMITS, validateQuiz } from '../../server/src/quiz-rules.js';

// Quizzes are kept in this browser (localStorage) until accounts and a database exist (PRD 1.0).
const STORE = 'gametribe:quizzes';
const TIME_CHOICES = [10, 15, 20, 30, 45, 60, 90];

function loadAll() {
  try { const list = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
}
function saveAll(list) {
  try { localStorage.setItem(STORE, JSON.stringify(list)); return true; } catch { return false; }
}
const uid = () => Math.random().toString(36).slice(2, 10);
const blankQuestion = () => ({ key: uid(), prompt: '', options: ['', ''], correctIndex: null, durationSeconds: QUIZ_LIMITS.defaultSeconds });
const blankQuiz = () => ({ id: uid(), title: '', questions: [blankQuestion()] });
const withKeys = (quiz) => ({ ...quiz, id: uid(), questions: quiz.questions.map((q) => ({ ...q, key: uid(), options: [...q.options] })) });
const letter = (i) => String.fromCharCode(65 + i);

export default function QuizEditor({ onBack, onHost, connected = true }) {
  const [quizzes, setQuizzes] = useState(loadAll);
  const [draft, setDraft] = useState(null);
  const [showIssues, setShowIssues] = useState(false);
  const [status, setStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  function persist(list, message) {
    setQuizzes(list);
    setStatus(saveAll(list) ? message : 'This browser would not save the quiz. You can still host it now.');
  }
  function upsert(quiz) {
    const stamped = { ...quiz, updatedAt: Date.now() };
    const exists = quizzes.some((q) => q.id === quiz.id);
    return exists ? quizzes.map((q) => (q.id === quiz.id ? stamped : q)) : [stamped, ...quizzes];
  }
  function save() { persist(upsert(draft), 'Saved.'); }
  function hostChecked(quiz) {
    const checked = validateQuiz(quiz);
    if (!checked.ok) return false;
    onHost(checked.quiz);
    return true;
  }
  function hostDraft() {
    setShowIssues(true);
    if (hostChecked(draft)) persist(upsert(draft), 'Saved.');
  }
  function duplicate(quiz) {
    const copy = { ...withKeys(quiz), title: `${quiz.title} (copy)` };
    persist([copy, ...quizzes], 'Copied. Edit the copy below.');
  }
  function remove(id) { persist(quizzes.filter((q) => q.id !== id), 'Deleted.'); setConfirmDelete(null); }

  // ----- draft helpers
  const setQuestions = (fn) => setDraft((d) => ({ ...d, questions: fn(d.questions) }));
  const patchQ = (i, patch) => setQuestions((qs) => qs.map((q, n) => (n === i ? { ...q, ...patch } : q)));
  const setOption = (i, oi, value) => setQuestions((qs) => qs.map((q, n) => (n === i ? { ...q, options: q.options.map((o, k) => (k === oi ? value : o)) } : q)));
  const addOption = (i) => setQuestions((qs) => qs.map((q, n) => (n === i && q.options.length < QUIZ_LIMITS.maxOptions ? { ...q, options: [...q.options, ''] } : q)));
  const removeOption = (i, oi) => setQuestions((qs) => qs.map((q, n) => {
    if (n !== i || q.options.length <= QUIZ_LIMITS.minOptions) return q;
    const correct = q.correctIndex === oi ? null : q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex;
    return { ...q, options: q.options.filter((_, k) => k !== oi), correctIndex: correct };
  }));
  const move = (i, by) => setQuestions((qs) => {
    const to = i + by;
    if (to < 0 || to >= qs.length) return qs;
    const next = [...qs]; [next[i], next[to]] = [next[to], next[i]]; return next;
  });
  const duplicateQ = (i) => setQuestions((qs) => [...qs.slice(0, i + 1), { ...qs[i], key: uid(), options: [...qs[i].options] }, ...qs.slice(i + 1)]);
  const deleteQ = (i) => setQuestions((qs) => (qs.length > 1 ? qs.filter((_, n) => n !== i) : qs));

  // ----- list view
  if (!draft) {
    return <section className="panel editor">
      <button className="back-link" onClick={onBack}>← Back</button>
      <div className="eyebrow">QUIZ BUILDER</div>
      <h2>Your quizzes</h2>
      <p>Quizzes are saved in this browser for now. A game always uses a copy taken when you start it, so editing later never changes a live game.</p>
      <div className="quiz-list">
        <article className="quiz-card">
          <div><strong>{DEMO_QUIZ.title}</strong><span>{DEMO_QUIZ.questions.length} questions · sample</span></div>
          <div className="quiz-actions">
            <button className="button primary" disabled={!connected} onClick={() => hostChecked(DEMO_QUIZ)}>Host</button>
            <button className="button" onClick={() => duplicate(DEMO_QUIZ)}>Copy to edit</button>
          </div>
        </article>
        {quizzes.map((quiz) => {
          const ok = validateQuiz(quiz).ok;
          return <article className="quiz-card" key={quiz.id}>
            <div><strong>{quiz.title || 'Untitled quiz'}</strong><span>{quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}{ok ? '' : ' · needs fixes before hosting'}</span></div>
            <div className="quiz-actions">
              <button className="button primary" disabled={!connected || !ok} onClick={() => hostChecked(quiz)}>Host</button>
              <button className="button" onClick={() => { setDraft(quiz); setShowIssues(false); setStatus(''); }}>Edit</button>
              <button className="button" onClick={() => duplicate(quiz)}>Duplicate</button>
              {confirmDelete === quiz.id
                ? <><button className="button primary" onClick={() => remove(quiz.id)}>Delete for good</button><button className="button" onClick={() => setConfirmDelete(null)}>Keep</button></>
                : <button className="button" onClick={() => setConfirmDelete(quiz.id)}>Delete</button>}
            </div>
          </article>;
        })}
      </div>
      {!quizzes.length && <p className="hint">No saved quizzes yet. Start one, or copy the sample to see how it is set up.</p>}
      {status && <p className="hint" role="status">{status}</p>}
      <button className="button primary" onClick={() => { setDraft(blankQuiz()); setShowIssues(false); setStatus(''); }}>New quiz</button>
    </section>;
  }

  // ----- edit view
  const checked = validateQuiz(draft);
  const issuesFor = (i) => (showIssues ? checked.issues.filter((x) => x.question === i) : []);
  const generalIssues = showIssues ? checked.issues.filter((x) => x.question === null) : [];
  return <section className="panel editor">
    <button className="back-link" onClick={() => setDraft(null)}>← Your quizzes</button>
    <div className="eyebrow">QUIZ BUILDER</div>
    <h2>{draft.title.trim() || 'New quiz'}</h2>
    <label className="field">Quiz title
      <input type="text" maxLength={QUIZ_LIMITS.maxTitle} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Friday Bible trivia" />
    </label>
    {generalIssues.length > 0 && <ul className="issue-list" role="alert">{generalIssues.map((x) => <li key={x.message}>{x.message}</li>)}</ul>}

    {draft.questions.map((q, i) => {
      const issues = issuesFor(i);
      return <fieldset className={`q-card${issues.length ? ' has-issue' : ''}`} key={q.key}>
        <legend>Question {i + 1} of {draft.questions.length}</legend>
        <label className="field">Question
          <textarea rows={2} maxLength={QUIZ_LIMITS.maxPrompt} value={q.prompt} onChange={(e) => patchQ(i, { prompt: e.target.value })} placeholder="What do you want to ask?" />
        </label>
        <div className="options-block" role="group" aria-label={`Answers for question ${i + 1}`}>
          <p className="options-help">Add 2 to 4 answers and tick the correct one.</p>
          {q.options.map((option, oi) => <div className="option-row" key={oi}>
            <input type="radio" name={`correct-${q.key}`} checked={q.correctIndex === oi} onChange={() => patchQ(i, { correctIndex: oi })} aria-label={`Answer ${letter(oi)} is correct`} />
            <span className="option-letter" aria-hidden="true">{letter(oi)}</span>
            <input type="text" maxLength={QUIZ_LIMITS.maxOption} value={option} onChange={(e) => setOption(i, oi, e.target.value)} placeholder={`Answer ${letter(oi)}`} aria-label={`Answer ${letter(oi)} text`} />
            {q.options.length > QUIZ_LIMITS.minOptions && <button className="mini" onClick={() => removeOption(i, oi)} aria-label={`Remove answer ${letter(oi)}`}>Remove</button>}
          </div>)}
          {q.options.length < QUIZ_LIMITS.maxOptions && <button className="mini" onClick={() => addOption(i)}>Add answer</button>}
        </div>
        <div className="q-tools">
          <label className="field inline">Time limit
            <select value={q.durationSeconds} onChange={(e) => patchQ(i, { durationSeconds: Number(e.target.value) })}>
              {[...new Set([...TIME_CHOICES, q.durationSeconds])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{s} seconds</option>)}
            </select>
          </label>
          <div className="q-buttons">
            <button className="mini" disabled={i === 0} onClick={() => move(i, -1)}>Move up</button>
            <button className="mini" disabled={i === draft.questions.length - 1} onClick={() => move(i, 1)}>Move down</button>
            <button className="mini" disabled={draft.questions.length >= QUIZ_LIMITS.maxQuestions} onClick={() => duplicateQ(i)}>Duplicate</button>
            <button className="mini" disabled={draft.questions.length === 1} onClick={() => deleteQ(i)}>Delete</button>
          </div>
        </div>
        {issues.length > 0 && <ul className="issue-list" role="alert">{issues.map((x) => <li key={x.message}>{x.message}</li>)}</ul>}
      </fieldset>;
    })}

    <button className="button" disabled={draft.questions.length >= QUIZ_LIMITS.maxQuestions} onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}>Add question</button>

    <div className="editor-footer">
      <button className="button secondary" onClick={save}>Save quiz</button>
      <button className="button primary" disabled={!connected} onClick={hostDraft}>Host this quiz</button>
    </div>
    {showIssues && !checked.ok && <p className="hint" role="alert">Fix the {checked.issues.length} item{checked.issues.length === 1 ? '' : 's'} marked above, then host.</p>}
    {status && <p className="hint" role="status">{status}</p>}
  </section>;
}
