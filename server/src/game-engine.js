import { randomInt, randomUUID } from 'node:crypto';

import { DEMO_QUIZ, validateQuiz } from './quiz-rules.js';

export { DEMO_QUIZ };

const normalizeNickname = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
const NICKNAME_PATTERN = /^[\p{L}\p{N} _.'-]+$/u;

export function createGameEngine({ now = () => Date.now() } = {}) {
  const sessions = new Map();

  function createPin() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const pin = String(randomInt(100000, 1000000));
      if (!sessions.has(pin)) return pin;
    }
    throw new Error('Could not allocate a game PIN. Try again.');
  }

  function getSession(pin) {
    return sessions.get(String(pin));
  }

  function publicState(session) {
    const question = session.currentQuestionIndex >= 0
      ? session.quiz.questions[session.currentQuestionIndex]
      : null;
    const questionState = (session.phase === 'question' || session.phase === 'locked') && question
      ? {
          prompt: question.prompt,
          options: [...question.options],
          index: session.currentQuestionIndex,
          total: session.quiz.questions.length,
          endsAt: session.questionEndsAt
        }
      : session.phase === 'reveal' && question
        ? {
            prompt: question.prompt,
            options: [...question.options],
            correctIndex: question.correctIndex,
            index: session.currentQuestionIndex,
            total: session.quiz.questions.length
          }
        : null;

    return {
      pin: session.pin,
      title: session.quiz.title,
      phase: session.phase,
      hostConnected: session.hostConnected,
      players: [...session.players.values()].map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, connected: p.connected, answered: p.answers.has(session.currentQuestionIndex) })),
      question: questionState,
      leaderboard: [...session.players.values()]
        .map(({ id, nickname, score }) => ({ id, nickname, score }))
        .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname)),
      questionEndsAt: session.questionEndsAt,
      questionIndex: session.currentQuestionIndex,
      answeredCount: [...session.players.values()].filter((p) => p.answers.has(session.currentQuestionIndex)).length,
      totalQuestions: session.quiz.questions.length
    };
  }

  function createSession({ quiz } = {}) {
    let snapshot = structuredClone(DEMO_QUIZ);
    if (quiz !== undefined && quiz !== null) {
      const checked = validateQuiz(quiz);
      if (!checked.ok) throw new Error(checked.error);
      snapshot = checked.quiz; // a snapshot: later edits to a saved quiz never change a live game
    }
    const pin = createPin();
    const hostToken = randomUUID();
    const session = {
      pin,
      hostToken,
      quiz: snapshot,
      hostConnected: true,
      hostSocketId: null,
      phase: 'lobby',
      players: new Map(),
      currentQuestionIndex: -1,
      questionEndsAt: null,
      startedAt: null
    };
    sessions.set(pin, session);
    return { pin, hostToken, state: publicState(session) };
  }

  function joinSession({ pin, nickname, socketId }) {
    const session = getSession(pin);
    const cleanNickname = normalizeNickname(nickname);
    if (!session) return { ok: false, error: 'That PIN was not found. Check it and try again.' };
    if (session.phase !== 'lobby') return { ok: false, error: 'This game has already started.' };
    if (cleanNickname.length < 2) return { ok: false, error: 'Nickname must be at least 2 characters.' };
    if (!NICKNAME_PATTERN.test(cleanNickname)) return { ok: false, error: "Nicknames can use letters, numbers, spaces and - _ . ' only." };
    if ([...session.players.values()].some((p) => p.nickname.toLowerCase() === cleanNickname.toLowerCase())) {
      return { ok: false, error: 'That nickname is already in use in this game.' };
    }
    const player = { id: randomUUID(), reconnectToken: randomUUID(), socketId, nickname: cleanNickname, score: 0, answers: new Map(), connected: true };
    session.players.set(player.id, player);
    return { ok: true, player: { id: player.id, nickname: player.nickname, reconnectToken: player.reconnectToken }, state: publicState(session) };
  }

  function reconnectPlayer({ pin, reconnectToken, socketId }) {
    const session = getSession(pin);
    if (!session) return { ok: false, error: 'Game not found. It may have ended or the server may have restarted.' };
    if (typeof reconnectToken !== 'string' || reconnectToken.length < 20) {
      return { ok: false, error: 'Reconnect session is invalid. Join the game again.' };
    }
    const player = [...session.players.values()].find((candidate) => candidate.reconnectToken === reconnectToken);
    if (!player) return { ok: false, error: 'Player session not found. Join the game again.' };
    player.socketId = socketId;
    player.connected = true;
    return {
      ok: true,
      player: { id: player.id, nickname: player.nickname, reconnectToken: player.reconnectToken },
      state: publicState(session)
    };
  }

  function startGame({ pin, hostToken }) {
    const session = getSession(pin);
    if (!session || session.hostToken !== hostToken) return { ok: false, error: 'Host authorization failed.' };
    if (session.phase !== 'lobby') return { ok: false, error: 'The game is not in the lobby.' };
    if (session.players.size < 1) return { ok: false, error: 'At least one player must join first.' };
    session.currentQuestionIndex = 0;
    session.phase = 'question';
    session.startedAt = now();
    session.questionEndsAt = now() + session.quiz.questions[0].durationSeconds * 1000;
    return { ok: true, state: publicState(session) };
  }

  function submitAnswer({ pin, playerId, socketId, answerIndex, questionIndex }) {
    const session = getSession(pin);
    if (!session) return { ok: false, error: 'Game not found.' };
    const player = session.players.get(playerId);
    if (!player || player.socketId !== socketId) return { ok: false, error: 'Player authorization failed.' };
    if (session.phase === 'locked') return { ok: false, error: 'Time is up.' };
    if (session.phase !== 'question') return { ok: false, error: 'Answers are not being accepted right now.' };
    if (questionIndex !== undefined && questionIndex !== session.currentQuestionIndex) return { ok: false, error: 'That question has already closed.' };
    const question = session.quiz.questions[session.currentQuestionIndex];
    if (now() >= session.questionEndsAt) return { ok: false, error: 'Time is up.' };
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.options.length) {
      return { ok: false, error: 'Choose one of the available answers.' };
    }
    if (player.answers.has(session.currentQuestionIndex)) return { ok: false, error: 'Your answer has already been submitted.' };

    const answeredAt = now();
    const correct = answerIndex === question.correctIndex;
    const durationMs = question.durationSeconds * 1000;
    const elapsedMs = Math.max(0, answeredAt - (session.questionEndsAt - durationMs));
    const timeRatio = Math.max(0, Math.min(1, 1 - elapsedMs / durationMs));
    const points = correct ? Math.round(500 + 500 * timeRatio) : 0;
    player.score += points;
    player.answers.set(session.currentQuestionIndex, { answerIndex, correct, points, answeredAt });
    return { ok: true, accepted: true, state: publicState(session) };
  }

  function revealAnswer({ pin, hostToken }) {
    const session = getSession(pin);
    if (!session || session.hostToken !== hostToken) return { ok: false, error: 'Host authorization failed.' };
    if (session.phase !== 'question' && session.phase !== 'locked') return { ok: false, error: 'There is no active question to reveal.' };
    session.phase = 'reveal';
    session.questionEndsAt = null;
    return { ok: true, state: publicState(session) };
  }

  function nextQuestion({ pin, hostToken }) {
    const session = getSession(pin);
    if (!session || session.hostToken !== hostToken) return { ok: false, error: 'Host authorization failed.' };
    if (session.phase !== 'reveal') return { ok: false, error: 'Reveal the current answer before continuing.' };
    const nextIndex = session.currentQuestionIndex + 1;
    if (nextIndex >= session.quiz.questions.length) {
      session.phase = 'finished';
      session.questionEndsAt = null;
      return { ok: true, state: publicState(session) };
    }
    session.currentQuestionIndex = nextIndex;
    session.phase = 'question';
    session.questionEndsAt = now() + session.quiz.questions[nextIndex].durationSeconds * 1000;
    return { ok: true, state: publicState(session) };
  }

  // Called by the transport layer when a question deadline passes. Safe to call late or twice.
  function lockExpired({ pin, questionIndex }) {
    const session = getSession(pin);
    if (!session || session.phase !== 'question' || session.currentQuestionIndex !== questionIndex) return { ok: false };
    if (now() < session.questionEndsAt) return { ok: false };
    session.phase = 'locked';
    return { ok: true, state: publicState(session) };
  }

  // Called by the transport layer a moment after a question locks, so results never wait on the host.
  function revealLocked({ pin, questionIndex }) {
    const session = getSession(pin);
    if (!session || session.phase !== 'locked' || session.currentQuestionIndex !== questionIndex) return { ok: false };
    session.phase = 'reveal';
    session.questionEndsAt = null;
    return { ok: true, state: publicState(session) };
  }

  function endGame({ pin, hostToken }) {
    const session = getSession(pin);
    if (!session || session.hostToken !== hostToken) return { ok: false, error: 'Host authorization failed.' };
    if (session.phase === 'finished') return { ok: false, error: 'The game has already ended.' };
    session.phase = 'finished';
    session.questionEndsAt = null;
    return { ok: true, state: publicState(session) };
  }

  // Private to the player: never part of the public state.
  function getPlayerResult(pin, playerId) {
    const session = getSession(pin);
    const player = session?.players.get(playerId);
    if (!player || session.currentQuestionIndex < 0) return null;
    const answer = player.answers.get(session.currentQuestionIndex);
    return { questionIndex: session.currentQuestionIndex, answered: Boolean(answer), correct: answer?.correct ?? false, points: answer?.points ?? 0 };
  }

  function getPlayerSockets(pin) {
    const session = getSession(pin);
    return session ? [...session.players.values()].map((p) => ({ id: p.id, socketId: p.socketId })) : [];
  }

  // Host recovery: the host token proves identity; the socket id marks which connection is current.
  function attachHost({ pin, hostToken, socketId }) {
    const session = getSession(pin);
    if (!session || typeof hostToken !== 'string' || session.hostToken !== hostToken) return { ok: false, error: 'Host session not found. The game may have ended or the server restarted.' };
    session.hostSocketId = socketId;
    session.hostConnected = true;
    return { ok: true, state: publicState(session) };
  }
  // Ignores a stale socket: an old connection closing after the host came back changes nothing.
  function detachHost({ pin, socketId }) {
    const session = getSession(pin);
    if (!session || session.hostSocketId !== socketId) return null;
    session.hostSocketId = null;
    session.hostConnected = false;
    return publicState(session);
  }

  function getPublicState(pin) {
    const session = getSession(pin);
    return session ? publicState(session) : null;
  }

  function removePlayer({ pin, playerId, socketId }) {
    const session = getSession(pin);
    if (!session) return null;
    const player = session.players.get(playerId);
    if (!player || player.socketId !== socketId) return publicState(session);
    player.connected = false;
    player.socketId = null;
    return publicState(session);
  }

  function hasSession(pin) { return sessions.has(String(pin)); }

  return { createSession, joinSession, reconnectPlayer, startGame, submitAnswer, revealAnswer, nextQuestion, attachHost, detachHost, lockExpired, revealLocked, endGame, getPlayerResult, getPlayerSockets, getPublicState, removePlayer, hasSession };
}
