import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createGameEngine } from './game-engine.js';
import { createHub } from './hub.js';

const PORT = Number(process.env.PORT || 4000);
// One or more website addresses allowed to connect, comma separated (e.g. your Vercel production and preview URLs).
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean);
// Every running copy of the server gets a short code. Everyone in one game must be on the same copy,
// so the code is shown in the app and in /health to make a mismatch easy to spot.
const INSTANCE_ID = randomUUID().slice(0, 6);
const startedAt = Date.now();
const engine = createGameEngine();
const app = express();
app.use(cors({ origin: CLIENT_ORIGINS }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'gametribe-live-server', instance: INSTANCE_ID, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), games: engine.sessionCount() }));

// One deploy: when the website has been built (npm run build), this server also serves it,
// so players and the game share a single address and no cross-origin settings are needed.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const indexFile = path.join(distDir, 'index.html');
if (fs.existsSync(indexFile)) {
  app.use(express.static(distDir, { setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(indexFile) : next()));
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGINS, methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 20000
});

const hub = createHub({
  engine,
  instanceId: INSTANCE_ID,
  broadcast: (room, event, data) => io.to(room).emit(event, data),
  sendTo: (socketId, event, data) => io.to(socketId).emit(event, data)
});

io.on('connection', (socket) => {
  socket.emit('server:ready', { connected: true, instance: INSTANCE_ID });
  for (const event of hub.events) socket.on(event, (payload) => hub.handle(socket, event, payload));
  socket.on('disconnect', () => hub.onDisconnect(socket));
});

httpServer.listen(PORT, () => console.log(`Game Tribe Live server listening on http://localhost:${PORT}${fs.existsSync(indexFile) ? ' (serving the website too)' : ''}`));
