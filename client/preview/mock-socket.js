// In-browser stand-in for socket.io-client + the Node server (preview build only).
// It runs the real game-engine.js AND the real hub.js, so the preview behaves like the server.
import { createGameEngine, DEMO_QUIZ } from '../../server/src/game-engine.js';
import { createHub } from '../../server/src/hub.js';

const BOT_NAMES = ['Ovie', 'Tega', 'Efe', 'Mide', 'Kemi', 'Dami', 'Oghene', 'Ejiro'];
const watchers = new Set();
let seq = 0;
let core, engine, rooms, byId, lastPin, lastQuiz;

function build() {
  engine = createGameEngine();
  rooms = new Map();
  byId = new Map();
  lastPin = null;
  lastQuiz = null;
  core = createHub({
    engine,
    broadcast: (room, ev, data) => rooms.get(room)?.forEach((s) => s._deliver(ev, data)),
    sendTo: (id, ev, data) => byId.get(id)?._deliver(ev, data),
    setTimer: (fn, ms) => setTimeout(fn, ms)
  });
}
build();

class MockSocket {
  constructor() {
    this.id = `sock-${++seq}`;
    this.handlers = new Map();
    this.connected = false;
    byId.set(this.id, this);
    // What the server-side hub sees: emit() goes to this client, join() adds it to a room.
    this.server = {
      id: this.id,
      join: (room) => { if (!rooms.has(room)) rooms.set(room, new Set()); rooms.get(room).add(this); },
      emit: (ev, data) => {
        if (ev === 'host:created') { lastPin = data.pin; watchers.forEach((fn) => fn(lastPin)); }
        this._deliver(ev, data);
      }
    };
  }
  on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, new Set()); this.handlers.get(ev).add(fn); return this; }
  off(ev, fn) {
    if (!ev) this.handlers.clear();
    else if (!fn) this.handlers.delete(ev);
    else this.handlers.get(ev)?.delete(fn);
    return this;
  }
  connect() {
    if (this.connected) return this;
    this.connected = true;
    setTimeout(() => { if (!this.connected) return; this._deliver('connect'); this._deliver('server:ready', { connected: true, instance: 'preview' }); }, 60);
    return this;
  }
  disconnect() {
    if (!this.connected) return this;
    this.connected = false;
    core.onDisconnect(this.server);
    rooms.forEach((set) => set.delete(this));
    byId.delete(this.id);
    this._deliver('disconnect');
    return this;
  }
  emit(ev, payload) {
    if (ev === 'host:create') lastQuiz = payload?.quiz || null; // lets the preview bots know the right answers
    setTimeout(() => this.connected && core.handle(this.server, ev, payload), 25);
    return this;
  }
  _deliver(ev, ...args) { this.handlers.get(ev)?.forEach((fn) => fn(...args)); }
}

export const io = () => new MockSocket();

export const hub = {
  subscribe(fn) { watchers.add(fn); fn(lastPin); return () => watchers.delete(fn); },
  addBots(count = 3) {
    const state = lastPin && engine.getPublicState(lastPin);
    if (!state) return { ok: false, error: 'Host a game first, then add bots.' };
    if (state.phase !== 'lobby') return { ok: false, error: 'Bots can only join while the game is in the lobby.' };
    const taken = new Set(state.players.map((p) => p.nickname));
    const pin = lastPin;
    BOT_NAMES.filter((n) => !taken.has(n)).slice(0, count).forEach((name) => {
      const bot = new MockSocket();
      bot.connected = true;
      const answered = new Set();
      bot.on('game:state', (s) => {
        if (s.phase !== 'question' || answered.has(s.questionIndex)) return;
        answered.add(s.questionIndex);
        const q = (lastQuiz || DEMO_QUIZ).questions[s.questionIndex] || { correctIndex: 0, options: ['a', 'b'] };
        const pick = Math.random() < 0.65 ? q.correctIndex : Math.floor(Math.random() * q.options.length);
        setTimeout(() => bot.emit('player:answer', { pin, answerIndex: pick, questionIndex: s.questionIndex }), 1500 + Math.random() * 6000);
      });
      bot.emit('player:join', { pin, nickname: name });
    });
    return { ok: true };
  },
  reset() { build(); watchers.forEach((fn) => fn(null)); }
};
