import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { connectDB } from './src/config/database.js';
import authRouter from './src/routes/auth.js';
import sessionsRouter from './src/routes/sessions.js';
import { handleAudioWebSocket } from './src/websocket/audioHandler.js';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/audio' });

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/auth', authRouter);
app.use('/sessions', sessionsRouter);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

wss.on('connection', handleAudioWebSocket);

const PORT = process.env.PORT || 8000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`▶  Backend running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to connect to MongoDB:', err.message);
  process.exit(1);
});
