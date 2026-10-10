import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createGameEngine } from './game-engine.js';
import { createHub } from './hub.js';

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'gametribe-live-server' }));

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
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 20000
});

const hub = createHub({
  engine: createGameEngine(),
  broadcast: (room, event, data) => io.to(room).emit(event, data),
  sendTo: (socketId, event, data) => io.to(socketId).emit(event, data)
});

io.on('connection', (socket) => {
  socket.emit('server:ready', { connected: true });
  for (const event of hub.events) socket.on(event, (payload) => hub.handle(socket, event, payload));
  socket.on('disconnect', () => hub.onDisconnect(socket));
});

httpServer.listen(PORT, () => console.log(`Game Tribe Live server listening on http://localhost:${PORT}${fs.existsSync(indexFile) ? ' (serving the website too)' : ''}`));
