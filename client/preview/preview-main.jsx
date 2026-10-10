import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import '../src/styles.css';
import './preview.css';
import { hub } from './mock-socket.js';

// Each screen needs its own saved-session key, because they all share this one browser tab.
const KEYS = { host: 'gametribe:preview-host', phone: 'gametribe:preview-phone', screen: 'gametribe:preview-screen' };
const onJoinPage = () => location.hash === '#join';

function Preview() {
  const [pin, setPin] = useState(null);
  const [note, setNote] = useState('');
  const [run, setRun] = useState(0);
  const [playerRun, setPlayerRun] = useState(0);
  const [hostRun, setHostRun] = useState(0);
  const [page, setPage] = useState(onJoinPage() ? 'join' : 'host');
  const [playerMounted, setPlayerMounted] = useState(onJoinPage()); // the player page only exists once someone opens it
  const screenRef = useRef(null);
  useEffect(() => hub.subscribe(setPin), []);
  useEffect(() => {
    const sync = () => { const p = onJoinPage() ? 'join' : 'host'; setPage(p); if (p === 'join') setPlayerMounted(true); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const goJoin = () => { location.hash = 'join'; };
  const goHost = () => { history.pushState(null, '', location.pathname + location.search); window.dispatchEvent(new HashChangeEvent('hashchange')); };

  function addBots() { const r = hub.addBots(3); setNote(r.ok ? '3 bot players joined.' : r.error); }
  function startOver() {
    hub.reset();
    Object.values(KEYS).forEach((k) => { sessionStorage.removeItem(k); sessionStorage.removeItem(`${k}:host`); });
    setNote(''); setPlayerMounted(false); setRun((n) => n + 1); setPlayerRun((n) => n + 1); setHostRun((n) => n + 1);
    goHost();
  }
  function refreshHost() { setNote('Host refreshed. The host screen reconnects and keeps control of the same game.'); setHostRun((n) => n + 1); }
  function refreshPlayer() { setNote('Player page reloaded. If you had joined, it reconnects as the same player.'); setPlayerRun((n) => n + 1); }
  function showScreen() { screenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setNote('In the real app this opens the projector screen in a new tab. Here it is the pane below.'); }

  return (
    <div className="preview-shell">
      <div className="preview-bar">
        {page === 'join'
          ? <p><strong>Player page</strong> (its own address, <code>#join</code>). {pin ? `Game PIN ${pin}.` : 'Host a game first, then come back with its PIN.'}</p>
          : <p><strong>Live preview.</strong> The server runs inside this page, so nothing is saved and no one else can join.</p>}
        <div className="preview-actions">
          {page === 'join' ? <>
            <button className="button secondary" onClick={goHost}>Back to host</button>
            <button className="button" onClick={refreshPlayer}>Reload this page</button>
          </> : <>
            <button className="button secondary" onClick={addBots}>Add 3 bot players</button>
            <button className="button" onClick={refreshHost}>Refresh host</button>
            {pin && <button className="button" onClick={goJoin}>Join a game</button>}
          </>}
          <button className="button" onClick={startOver}>Start over</button>
        </div>
        {(note || (page === 'host' && pin)) && <p className="preview-note">{note || `Game PIN ${pin}. Use Join a game to open the player page.`}</p>}
      </div>

      <div className="preview-grid" key={run} hidden={page === 'join'}>
        <section className="pane" aria-label="Host screen">
          <h2 className="pane-label">Host</h2>
          <div className="pane-body" key={hostRun}><App routing={false} sessionKey={KEYS.host} onOpenProjector={showScreen} onJoin={goJoin} /></div>
        </section>
        <section className="pane" aria-label="Projector screen" ref={screenRef}>
          <h2 className="pane-label">Projector screen (read-only)</h2>
          <div className="pane-body">
            {pin ? <App key={pin} routing={false} sessionKey={KEYS.screen} watchPin={pin} /> : <p className="pane-empty">Host a game to see the projector screen.</p>}
          </div>
        </section>
      </div>

      {playerMounted && <div className="player-page" aria-label="Player page" hidden={page !== 'join'} key={playerRun}>
        <App routing={false} sessionKey={KEYS.phone} initialRole="join" />
      </div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Preview />);
