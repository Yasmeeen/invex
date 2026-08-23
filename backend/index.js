import express from 'express';
import bootstrap from './src/bootstrap.js';
import dotenv from 'dotenv';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { setSocketServer } from './src/realtime/socket.js';

dotenv.config();
const app = express();

// Setup app
bootstrap(app, express);

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    credentials: true,
  },
});

io.on('connection', (socket) => {
  const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
  if (userId) {
    socket.join(`user:${String(userId)}`);
  }
  socket.on('join', (payload) => {
    const uid = payload?.userId;
    if (uid) {
      socket.join(`user:${String(uid)}`);
    }
  });
});

setSocketServer(io);

export default app;

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
}
