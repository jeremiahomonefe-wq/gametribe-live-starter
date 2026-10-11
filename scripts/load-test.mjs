// Simulates a crowd against a running game server and reports what players would actually experience.
//   npm run load-test -- --players 500 --url http://localhost:4000
// Options: --players N (200)  --url (http://localhost:4000)  --join-seconds S (10, how long the crowd takes to join)
//          --answer-seconds S (6, players answer at random within this window)
// Run it against a COPY of the server you will use at the event, from a different machine if you can:
// on one shared machine the test itself uses CPU and makes the server look slower than it is.
import { io } from 'socket.io-client';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const N = Number(arg('players', 200));
const URL = arg('url', 'http://localhost:4000');
const JOIN_MS = Number(arg('join-seconds', 10)) * 1000;
const ANSWER_MS = Number(arg('answer-seconds', 6)) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const pct = (list, p) => (list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor((p / 100) * list.length))] : NaN);
const fmt = (ms) => (Number.isFinite(ms) ? `${Math.round(ms)} ms` : 'n/a');
const stats = (name, list) => console.log(`  ${name.padEnd(34)} median ${fmt(pct(list, 50))} | 95th ${fmt(pct(list, 95))} | slowest ${fmt(Math.max(...list))}  (${list.length} samples)`);

const sock = (auto = true) => io(URL, { transports: ['websocket'], reconnection: false, forceNew: true, autoConnect: auto });
const waitFor = (s, ev, ms = 10000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`timed out waiting for ${ev}`)), ms); s.once(ev, (d) => { clearTimeout(t); res(d); }); });

const host = sock();
await waitFor(host, 'connect');
host.emit('host:create', {});
const created = await waitFor(host, 'host:created');
const auth = { pin: created.pin, hostToken: created.hostToken };
console.log(`Game ${created.pin} on ${URL}. Simulating ${N} players (joining over ${JOIN_MS / 1000}s, answering within ${ANSWER_MS / 1000}s)...`);

const m = { join: [], propagate: [], ack: [], result: [], connectErrors: 0, disconnects: 0, appErrors: {}, bytes: 0, stateMsgs: 0, joined: 0, answered: 0, results: 0 };
let tStart = 0;
let tReveal = 0;
const players = Array.from({ length: N }, (_, i) => {
  const s = sock(false); // connects later, spread over the join window
  const p = { s, i, answeredQ: -1, tJoin: 0, gotResult: false };
  s.on('connect_error', () => { m.connectErrors += 1; });
  s.on('disconnect', () => { m.disconnects += 1; });
  s.on('app:error', (e) => { m.appErrors[e.message] = (m.appErrors[e.message] || 0) + 1; });
  s.on('connect', () => {
    s.io.engine.on('data', (d) => { m.bytes += typeof d === 'string' ? d.length : d.byteLength; });
    p.tJoin = now();
    s.emit('player:join', { pin: created.pin, nickname: `Player ${i}` });
  });
  s.on('player:joined', () => { m.join.push(now() - p.tJoin); m.joined += 1; });
  s.on('game:state', (st) => {
    m.stateMsgs += 1;
    if (st.phase === 'question' && tStart && p.answeredQ !== st.questionIndex) {
      p.answeredQ = st.questionIndex;
      m.propagate.push(now() - tStart);
      setTimeout(() => {
        const t = now();
        s.once('player:answer-accepted', () => { m.ack.push(now() - t); m.answered += 1; });
        s.emit('player:answer', { pin: created.pin, answerIndex: Math.floor(Math.random() * 4), questionIndex: st.questionIndex });
      }, Math.random() * ANSWER_MS);
    }
  });
  s.on('player:result', () => { if (p.gotResult || !tReveal) return; p.gotResult = true; m.results += 1; m.result.push(now() - tReveal); });
  return p;
});

// the crowd arrives over JOIN_MS
players.forEach((p, i) => setTimeout(() => p.s.connect(), (i / N) * JOIN_MS));
const joinDeadline = now() + JOIN_MS + 20000;
while (m.joined + m.connectErrors < N && now() < joinDeadline) await sleep(200);
console.log(`Joined: ${m.joined} of ${N}${m.connectErrors ? ` (${m.connectErrors} connection errors)` : ''}`);

// question 1
let hostState = null;
host.on('game:state', (st) => { hostState = st; if (st.phase === 'reveal' && !tReveal) tReveal = now(); });
tStart = now();
host.emit('host:start', auth);
await waitFor(host, 'game:state', 15000).catch(() => {});
const limit = (hostState?.question?.durationSeconds ?? 15) * 1000;
const revealDeadline = now() + limit + 15000;
while (m.results < m.joined && now() < revealDeadline) await sleep(250);

host.emit('host:end', auth);
await sleep(500);
console.log('\nResults for one question with everyone answering:');
stats('time to join', m.join);
stats('question reaches each player', m.propagate);
stats('answer is acknowledged', m.ack);
stats('result card arrives after reveal', m.result);
console.log(`  answers accepted: ${m.answered} of ${m.joined} | results delivered: ${m.results} of ${m.joined}`);
console.log(`  dropped connections: ${m.disconnects} | connection errors: ${m.connectErrors}`);
const errs = Object.entries(m.appErrors);
if (errs.length) console.log('  errors seen:', errs.map(([k, v]) => `${v} x "${k}"`).join('; '));
console.log(`  data received by all players: ${(m.bytes / 1e6).toFixed(0)} MB (${(m.bytes / Math.max(m.joined, 1) / 1e6).toFixed(1)} MB per player) in ${m.stateMsgs} state messages`);
players.forEach((p) => p.s.close()); host.close();
process.exit(0);
