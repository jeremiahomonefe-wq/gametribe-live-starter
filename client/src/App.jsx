import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import QuizEditor from './QuizEditor.jsx';
import { JoinQr, joinUrl } from './JoinQr.jsx';
import { DEFAULT_QUIZ } from '../../server/src/default-quiz.js';

// Dev: the server runs on :4000. Production: the website and the game server share one address.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);
const SERVER_HOST = (() => { try { return new URL(SERVER_URL, 'http://localhost').hostname; } catch { return ''; } })();
const LOOKS_SERVERLESS = /\.(vercel|netlify)\.app$/.test(SERVER_HOST);

// The player page has its own address: /#join, or /#join=123456 to arrive with the PIN filled in.
function joinRoute() {
  const match = typeof location !== 'undefined' && location.hash.match(/^#join(?:=(\d{6}))?$/);
  return match ? { pin: match[1] || '' } : null;
}

function pinFromHash() {
  const match = typeof location !== 'undefined' && location.hash.match(/projector=(\d{6})/);
  return match ? match[1] : null;
}

export default function App({ sessionKey = 'gametribe:player-session', watchPin = null, onOpenProjector = null, onJoin = null, initialRole = 'home', routing = true } = {}) {
  const projectorPin = watchPin || pinFromHash();
  const hostKey = `${sessionKey}:host`;
  const socket = useMemo(() => io(SERVER_URL, { autoConnect: false }), []);
  const [role, setRole] = useState(() => (initialRole === 'home' && routing && joinRoute() ? 'join' : initialRole));
  const [connected, setConnected] = useState(false);
  const [serverInstance, setServerInstance] = useState('');
  const serverRef = useRef('');
  const serverChangeRef = useRef(null);
  const [everConnected, setEverConnected] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [showLinkNotice, setShowLinkNotice] = useState(false);
  const [error, setError] = useState('');
  const [game, setGame] = useState(null);
  const [host, setHost] = useState(null);
  const [player, setPlayer] = useState(null);
  const [pinInput, setPinInput] = useState(() => (routing ? joinRoute()?.pin || '' : ''));
  const [nickname, setNickname] = useState('');
  const [answerSent, setAnswerSent] = useState(false);
  const [answerAccepted, setAnswerAccepted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [result, setResult] = useState(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    socket.connect();
    socket.on('connect', () => {
      setConnected(true);
      setEverConnected(true);
      setLinkError('');
      setError('');
      if (projectorPin) {
        setRole('projector');
        socket.emit('projector:watch', { pin: projectorPin });
        return;
      }
      try {
        const savedHost = sessionStorage.getItem(hostKey);
        if (savedHost) {
          const h = JSON.parse(savedHost);
          if (h?.pin && h?.hostToken) { socket.emit('host:reconnect', { pin: h.pin, hostToken: h.hostToken }); return; }
        }
        const saved = sessionStorage.getItem(sessionKey);
        if (saved) {
          const session = JSON.parse(saved);
          if (session?.pin && session?.reconnectToken) {
            socket.emit('player:reconnect', { pin: session.pin, reconnectToken: session.reconnectToken });
          }
        }
      } catch {
        sessionStorage.removeItem(sessionKey);
      }
    });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      setLinkError(String(reason || 'disconnected'));
      if (reason === 'io server disconnect') socket.connect(); // the server closed us; the browser will not retry by itself
    });
    socket.on('server:ready', (info) => {
      const next = info?.instance || '';
      if (serverRef.current && next && serverRef.current !== next) serverChangeRef.current = { from: serverRef.current, to: next };
      serverRef.current = next;
      setServerInstance(next);
    });
    socket.on('connect_error', (err) => setLinkError(err?.message || 'could not connect'));
    socket.on('game:state', (state) => {
      setGame(state);
    });
    socket.on('host:reconnected', (back) => {
      setHost({ pin: back.pin, hostToken: back.hostToken });
      setGame(back.state);
      setRole('host');
      setError('');
    });
    socket.on('host:created', (created) => {
      sessionStorage.setItem(hostKey, JSON.stringify({ pin: created.pin, hostToken: created.hostToken }));
      setHost({ pin: created.pin, hostToken: created.hostToken });
      setGame(created.state);
      setRole('host');
    });
    const savePlayerSession = (joined) => {
      setPlayer(joined);
      sessionStorage.setItem(sessionKey, JSON.stringify({
        pin: joined.pin,
        playerId: joined.id,
        nickname: joined.nickname,
        reconnectToken: joined.reconnectToken
      }));
      setGame((current) => current ? { ...current, pin: joined.pin } : current);
      setRole('player');
      setError('');
    };
    socket.on('player:joined', savePlayerSession);
    socket.on('player:reconnected', savePlayerSession);
    socket.on('player:answer-accepted', () => setAnswerAccepted(true));
    socket.on('player:result', setResult);
    socket.on('app:error', (payload) => {
      // After a server restart the old game is gone. Say so and return to the start instead of showing a dead game.
      if (payload.code === 'game_not_found' || payload.event === 'player:reconnect' || payload.event === 'host:reconnect') {
        sessionStorage.removeItem(hostKey);
        sessionStorage.removeItem(sessionKey);
        setGame(null); setPlayer(null); setHost(null); setRole('home');
        const change = serverChangeRef.current;
        setError(`That game is no longer on the server. ${change ? `The server changed from ${change.from} to ${change.to}: it restarted, or you reached a different copy. ` : ''}Games live in one server's memory, so they end when it restarts. Start or join a new one.`);
        return;
      }
      if (payload.event === 'projector:watch') setGame(null);
      if (payload.event === 'player:join' && /PIN was not found/i.test(payload.message || '')) {
        setError(`${payload.message} If the host's screen shows this PIN, you and the host are on different game servers${serverRef.current ? ` (you are on server ${serverRef.current})` : ''}. Compare the "server" code next to "Connected" on both screens: they must match.`);
        return;
      }
      setError(payload.message || 'Something went wrong.');
    });
    return () => {
      socket.off();
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    if (connected) { setShowLinkNotice(false); return undefined; }
    const timer = setTimeout(() => setShowLinkNotice(true), 4000);
    return () => clearTimeout(timer);
  }, [connected]);

  // Keep the page and the address in step, so the browser's back button and shared links work.
  useEffect(() => {
    if (!routing) return undefined;
    const onHash = () => {
      const route = joinRoute();
      if (route?.pin) setPinInput(route.pin);
      setRole((current) => (route ? (current === 'home' ? 'join' : current) : (current === 'join' ? 'home' : current)));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [routing]);

  useEffect(() => {
    setAnswerSent(false);
    setAnswerAccepted(false);
    if (game?.phase === 'question') setResult(null);
    if (game?.phase === 'finished') setConfirmEnd(false);
  }, [game?.questionIndex, game?.phase]);

  useEffect(() => {
    if (game?.phase === 'locked') { setSecondsLeft(0); return; }
    if (!game?.question?.endsAt || game.phase !== 'question') {
      setSecondsLeft(null);
      return;
    }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((game.question.endsAt - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [game?.question?.endsAt, game?.phase]);

  function createGame(quiz) {
    setError('');
    socket.emit('host:create', quiz ? { quiz } : {});
  }
  function joinGame(event) {
    event.preventDefault();
    setError('');
    socket.emit('player:join', { pin: pinInput, nickname });
  }
  function hostAction(eventName) {
    if (!host) return;
    setError('');
    socket.emit(eventName, { pin: host.pin, hostToken: host.hostToken });
  }
  function submitAnswer(answerIndex) {
    if (!player || !game || answerSent || game.phase !== 'question') return;
    setAnswerSent(true);
    socket.emit('player:answer', { pin: game.pin || player.pin, answerIndex, questionIndex: game.question?.index });
  }
  function openProjector() {
    if (onOpenProjector) return onOpenProjector(game.pin);
    window.open(`${location.origin}${location.pathname}#projector=${game.pin}`, '_blank', 'noopener');
  }
  function goJoinPage() {
    if (onJoin) return onJoin();
    setRole('join');
    if (routing && !joinRoute()) location.hash = 'join';
  }
  function leaveJoinPage() {
    setRole('home');
    if (routing && joinRoute()) history.replaceState(null, '', location.pathname + location.search);
  }
  function resetToHome() {
    if (routing && joinRoute()) history.replaceState(null, '', location.pathname + location.search);
    sessionStorage.removeItem(sessionKey);
    sessionStorage.removeItem(hostKey);
    setRole('home'); setGame(null); setHost(null); setPlayer(null); setError(''); setAnswerSent(false); setAnswerAccepted(false); setResult(null); setConfirmEnd(false);
  }

  const question = game?.question;
  const topPlayers = game?.leaderboard?.slice(0, 10) || [];
  const inQuestion = game?.phase === 'question' || game?.phase === 'locked';
  const myRank = player && game ? game.leaderboard.findIndex((p) => p.id === player.id) + 1 : 0;
  const hasAnsweredCurrentQuestion = Boolean(player && game?.players?.some((p) => p.id === player.id && p.answered));

  return <>
    <div className="ticker">Abraka • Play • Connect • Repeat</div>
    <main className="app-shell">
    <header className={`topbar topbar-${role}`}>
      <button className="brand" onClick={resetToHome} aria-label="Game Tribe Live home"><Logo small /></button>
      <div className="connection"><span className={connected ? 'dot online' : 'dot'} />{connected ? 'Connected' : everConnected ? 'Connection lost. Reconnecting...' : showLinkNotice ? 'Cannot reach the server' : 'Connecting...'}{connected && serverInstance && <small className="server-id" title="Everyone in one game must show the same server code">server {serverInstance}</small>}</div>
    </header>

    {LOOKS_SERVERLESS && <div className="notice warn" role="alert">
      <div><strong>The game server address ({SERVER_HOST}) is on a serverless host.</strong> Vercel and Netlify cannot hold live games: connections drop, and players get "PIN not found" because each request can reach a different copy of the server. Run the game server on Render, Fly.io or Railway, set VITE_SERVER_URL to its https address, and redeploy.</div>
    </div>}

    {!connected && showLinkNotice && <div className="notice warn" role="status">
      <div><strong>{everConnected ? 'Connection lost.' : 'Cannot reach the game server.'}</strong> {linkHint({ everConnected })}</div>
      <div className="notice-actions">
        <button className="mini" onClick={() => socket.connect()}>Try again</button>
        {!everConnected && <a href={`${SERVER_URL}/health`} target="_blank" rel="noreferrer">Check the server</a>}
      </div>
      <small>Server: {SERVER_URL}{linkError ? ` · ${linkError}` : ''}</small>
    </div>}

    {error && <div className="notice error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

    {role === 'home' && <section className="hero">
      <div className="hero-main">
        <Logo hero />
        <div className="script">Live</div>
        <h1>Your next big play date is live.</h1>
        <p className="hero-copy">Host a quiz for your crew, class or festival crowd. Players join with a PIN on their phones. No account, no fuss.</p>
        <div className="home-actions">
          <button className="button primary" onClick={() => createGame(DEFAULT_QUIZ)}>Host the Game Tribe quiz</button>
          <button className="button secondary" onClick={() => setRole('editor')}>Build a quiz</button>
          <button className="button" onClick={goJoinPage}>Join a game</button>
        </div>
        <div className="feature-row"><div><b>1</b><span>Make a room</span></div><div><b>2</b><span>Share the PIN</span></div><div><b>3</b><span>Play together</span></div></div>
        <p className="prototype-note">The Game Tribe quiz has {DEFAULT_QUIZ.questions.length} ready questions: Bible, Nigeria, general knowledge, cartoons and games. Or build your own.</p>
      </div>
      <div className="hero-card" aria-hidden="true">
        <div className="card-label">Sample game PIN</div>
        <div className="card-pin">482 913</div>
        <p>Enter the PIN on your phone to join.</p>
        <div className="card-chips"><span>Ovie</span><span>Tega</span><span>Efe</span><span>Mide</span></div>
        <div className="card-bar"><span>Lobby is open</span><span>4 players</span></div>
      </div>
    </section>}

    {role === 'editor' && <QuizEditor connected={connected} onBack={() => setRole('home')} onHost={(quiz) => createGame(quiz)} />}

    {game?.hostConnected === false && role !== 'host' && role !== 'home' && <div className="notice info" role="status"><span>The host lost connection. The game keeps running and the host can rejoin.</span></div>}

    {role === 'join' && <section className="panel narrow">
      <button className="back-link" onClick={leaveJoinPage}>← Back</button>
      <div className="eyebrow">PLAYER JOIN</div><h2>Ready to play?</h2><p>Enter the game PIN shown on the big screen and choose a nickname.</p>
      <form onSubmit={joinGame} className="stack-form">
        <label>Game PIN<input autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))} placeholder="123456" /></label>
        <label>Your nickname<input minLength={2} maxLength={20} required value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Jerry" /></label>
        <button className="button primary full" disabled={!connected}>Join game</button>
      </form>
      <p className="small-muted">No account needed. Use a nickname that is easy to recognise.</p>
    </section>}

    {role === 'host' && game && <section className="game-layout">
      <div className="panel host-panel">
        <div className="eyebrow">HOST CONTROL</div><h2>{game.title}</h2>
        <div className="pin-card"><span>GAME PIN</span><strong>{game.pin}</strong><div className="pin-actions"><button className="text-button" onClick={() => navigator.clipboard?.writeText(game.pin)}>Copy PIN</button><button className="text-button" onClick={() => navigator.clipboard?.writeText(joinUrl(game.pin))}>Copy join link</button></div></div>
        <p className="small-muted">Players join by scanning the QR code, using the join link, or typing the PIN. Open the projector screen on the big display.</p>
        <div className="stat-row"><div className="stat"><strong>{game.players.length}</strong><span>Players joined</span></div><div className="stat"><strong>{game.totalQuestions}</strong><span>Questions</span></div>{inQuestion && <div className="stat"><strong>{game.answeredCount} / {game.players.length}</strong><span>Answered this question</span></div>}</div>
        {game.phase === 'lobby' && <button className="button primary full" disabled={!game.players.length} onClick={() => hostAction('host:start')}>Start quiz</button>}
        {game.phase === 'lobby' && !game.players.length && <p className="hint">Start unlocks when at least one player joins.</p>}
        {inQuestion && <button className="button primary full" onClick={() => hostAction('host:reveal')}>{game.phase === 'locked' ? 'Reveal answer (time is up)' : 'Close and reveal answer'}</button>}
        {game.phase === 'reveal' && <button className="button primary full" onClick={() => hostAction('host:next')}>{game.questionIndex + 1 >= game.totalQuestions ? 'Finish quiz' : 'Next question'}</button>}
        {game.phase === 'finished' && <div className="finished-banner">Quiz finished. Great game!</div>}
        <button className="button secondary full" onClick={openProjector}>Open projector screen</button>
        {game.phase !== 'finished' && !confirmEnd && <button className="text-button end-link" onClick={() => setConfirmEnd(true)}>End game</button>}
        {confirmEnd && <div className="end-confirm" role="alertdialog" aria-label="End the game"><p>End the game for everyone? Scores so far become the final results.</p><div><button className="button primary" onClick={() => { hostAction('host:end'); setConfirmEnd(false); }}>End game</button><button className="button" onClick={() => setConfirmEnd(false)}>Keep playing</button></div></div>}
        <h3 className="section-heading">Players <span>{game.players.length}</span></h3>
        <div className="player-list">{game.players.length ? game.players.map((p) => <div className="player-row" key={p.id}><span className="avatar">{p.nickname.slice(0, 1).toUpperCase()}</span><span>{p.nickname}</span>{p.connected === false && <span className="offline-tag">Offline</span>}{inQuestion && p.answered && <span className="answered-tag">Answered</span>}<span className="player-score">{p.score}</span></div>) : <p className="small-muted">Waiting for players to join...</p>}</div>
      </div>
      <div className="panel preview-panel"><div className="preview-top"><span className="live-label"><span className="dot online" /> LIVE PREVIEW</span><span className="pill">{game.phase.toUpperCase()}</span></div><GameScreen game={game} secondsLeft={secondsLeft} topPlayers={topPlayers} /><p className="small-muted center">This view updates in realtime. The projector screen is read-only.</p></div>
    </section>}

    {role === 'projector' && !game && <section className="panel narrow center"><h2>Looking for the game...</h2><p>Waiting for PIN {projectorPin}. If this takes long, check the PIN on the host screen.</p></section>}
    {role === 'projector' && game && <section className="projector-screen">
      <div className="projector-head"><Logo small /><div className="pin-pill">Join with PIN <b>{game.pin}</b></div></div>
      <GameScreen game={game} secondsLeft={secondsLeft} topPlayers={topPlayers} large />
      <p className="projector-footer">GAMES • BANTERS • HANGOUT • CONNECT</p>
    </section>}

    {role === 'player' && game && <section className="player-game">
      <div className="player-game-top"><Logo small /><span className="player-pin">PIN {game.pin || player.pin}</span></div>
      {!['question', 'locked', 'reveal', 'finished'].includes(game.phase) && <div className="panel waiting-card"><div className="waiting-icon">✓</div><div className="eyebrow">YOU'RE IN</div><h2>You're in the game, {player.nickname}!</h2><p>Keep your eyes on the big screen. The host will start shortly.</p><div className="waiting-count">{game.players.length} players joined</div></div>}
      {inQuestion && question && <div className="player-question"><div className="question-meta"><span>QUESTION {question.index + 1} / {question.total}</span><span className="timer">{secondsLeft ?? '—'}s</span></div><div className="player-question-card"><h2>{question.prompt}</h2></div><div className="answer-grid">{question.options.map((option, index) => <button key={option} className={`answer-button answer-${index}`} disabled={answerSent || hasAnsweredCurrentQuestion || secondsLeft === 0} onClick={() => submitAnswer(index)}><span className="answer-letter">{String.fromCharCode(65 + index)}</span>{option}</button>)}</div>{(answerSent || hasAnsweredCurrentQuestion) && <div className="answer-status">{answerAccepted ? 'Answer received!' : hasAnsweredCurrentQuestion ? 'Your answer is already recorded.' : 'Submitting answer...'}</div>}{game.phase === 'locked' && !answerSent && !hasAnsweredCurrentQuestion && <div className="answer-status">Time is up. Waiting for the reveal.</div>}</div>}
      {game.phase === 'reveal' && <ResultCard result={result} nickname={player.nickname} score={game.leaderboard.find((p) => p.id === player.id)?.score ?? 0} />}
      {game.phase === 'finished' && <div className="panel waiting-card"><div className="eyebrow">GAME COMPLETE</div><h2>Thanks for playing, {player.nickname}!</h2><p>{myRank ? `You finished #${myRank} of ${game.leaderboard.length}. Your final score` : 'Your final score'}</p><div className="final-score">{game.leaderboard.find((p) => p.id === player.id)?.score ?? 0}</div><p>Play, connect and repeat.</p></div>}
    </section>}

    <footer className="footer"><span>Game Tribe Live</span><span>Play, connect and repeat.</span></footer>
    </main>
  </>;
}

function GameScreen({ game, secondsLeft, topPlayers, large = false }) {
  if (game.phase === 'lobby') return <div className={`game-screen lobby-screen ${large ? 'large' : ''}`}><div className="eyebrow">JOIN THE GAME</div><div className="lobby-join"><div className="big-pin">{game.pin}</div><JoinQr pin={game.pin} large={large} /></div><h2>Scan in. Tune in. Play.</h2><p>Scan the code, or enter the PIN on your phone and choose a nickname.</p><div className="lobby-players"><span className="dot online" /> {game.players.length} player{game.players.length === 1 ? '' : 's'} joined</div><div className="lobby-chips">{game.players.slice(0, 12).map((p) => <span key={p.id}>{p.nickname}</span>)}</div></div>;
  if ((game.phase === 'question' || game.phase === 'locked') && game.question) return <div className={`game-screen question-screen ${large ? 'large' : ''}`}><div className="question-meta"><span>QUESTION {game.question.index + 1} / {game.question.total}</span><span className="timer">{secondsLeft ?? '—'}s</span></div><h2>{game.question.prompt}</h2><div className="projector-options">{game.question.options.map((option, i) => <div className={`projector-option option-${i}`} key={option}><span>{String.fromCharCode(65 + i)}</span>{option}</div>)}</div><p className="answer-count">{game.phase === 'locked' ? 'Time is up. ' : ''}{game.answeredCount} of {game.players.length} answered</p></div>;
  if (game.phase === 'reveal' && game.question) return <div className={`game-screen reveal-screen ${large ? 'large' : ''}`}><div className="eyebrow">THAT'S THE ANSWER</div><h2>{game.question.options[game.question.correctIndex]}</h2><p>Well played to everyone who got it right.</p><Leaderboard players={topPlayers} /></div>;
  return <div className={`game-screen reveal-screen ${large ? 'large' : ''}`}><div className="eyebrow">FINAL LEADERBOARD</div><h2>{winnerLine(topPlayers)}</h2><Leaderboard players={topPlayers} /></div>;
}

function Leaderboard({ players }) {
  return <div className="leaderboard">{players.length ? players.slice(0, 5).map((p, index) => <div className="leader-row" key={p.id}><span className="rank">{index + 1}</span><span className="leader-name">{p.nickname}</span><strong>{p.score.toLocaleString()}</strong></div>) : <p className="small-muted">Scores will appear here.</p>}</div>;
}

function Logo({ small = false, hero = false }) {
  return <span className={`logo${small ? ' small' : ''}${hero ? ' hero-logo' : ''}`} role="img" aria-label="Game Tribe"><span className="logo-game">GAME</span><span className="logo-tribe">TRIBE</span></span>;
}

function winnerLine(players) {
  const best = players[0]?.score ?? 0;
  if (!best) return 'Game over';
  const winners = players.filter((p) => p.score === best);
  return winners.length === 1 ? `${winners[0].nickname} wins!` : `Tie at the top: ${winners.map((p) => p.nickname).join(', ')}`;
}

function ResultCard({ result, nickname, score }) {
  const tone = !result ? 'none' : !result.answered ? 'none' : result.correct ? 'right' : 'wrong';
  const copy = {
    right: ['✓', 'CORRECT', `Nice one, ${nickname}!`, `+${result?.points ?? 0} points`],
    wrong: ['✕', 'NOT THIS TIME', `Good try, ${nickname}.`, 'Check the big screen for the answer.'],
    none: ['–', result ? 'NO ANSWER' : 'ANSWER REVEALED', result ? `You did not answer, ${nickname}.` : `Nice playing, ${nickname}!`, 'Look at the big screen for the answer and leaderboard.']
  }[tone];
  return <div className={`panel waiting-card result-card ${tone}`}><div className="result-badge" aria-hidden="true">{copy[0]}</div><div className="eyebrow">{copy[1]}</div><h2>{copy[2]}</h2><p>{copy[3]}</p><div className="waiting-count">Your score: {score}</div></div>;
}

// Plain-language help for the two situations people hit: never connected, and dropped after connecting.
function linkHint({ everConnected }) {
  if (!everConnected) {
    if (typeof location !== 'undefined' && /\.vercel\.app$/.test(location.hostname) && SERVER_URL === location.origin) {
      return 'This website is on Vercel, which cannot run the game server. Set VITE_SERVER_URL to your game server address and redeploy.';
    }
    if (typeof location !== 'undefined' && location.protocol === 'https:' && SERVER_URL.startsWith('http:')) {
      return 'Browsers block an https website from reaching an http server. Use an https server address.';
    }
    return 'The server may be asleep, offline, or not allowing this website. Open the server check: it should show {"ok":true}. If it does, add this website address to CLIENT_ORIGIN on the server.';
  }
  return 'The app keeps retrying and will rejoin your game automatically. On a free host that went to sleep, the game may have ended.';
}
