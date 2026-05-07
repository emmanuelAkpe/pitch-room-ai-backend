import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { transcribeAudio, generatePiaResponse, synthesizeSpeech } from '../services/aiService.js';

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

export async function handleAudioWebSocket(ws) {
  let user = null;
  let session = null;
  let audioMimeType = 'audio/webm';
  let audioVoice = 'onyx';

  ws.on('message', async (data, isBinary) => {
    try {
      if (!isBinary) {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth') {
          try {
            const payload = jwt.verify(msg.token, process.env.SECRET_KEY || 'dev-secret');
            user = await User.findById(payload.sub).select('-password');
            if (!user) throw new Error('User not found');
            send(ws, { type: 'auth_ok' });
          } catch (e) {
            send(ws, { type: 'error', message: 'Authentication failed' });
            ws.close();
          }
          return;
        }

        if (msg.type === 'start_session') {
          if (!user) return send(ws, { type: 'error', message: 'Not authenticated' });
          session = await Session.findOne({ _id: msg.session_id, user_id: user._id });
          if (!session) return send(ws, { type: 'error', message: 'Session not found' });
          if (msg.audio_mime_type) audioMimeType = msg.audio_mime_type;
          if (msg.voice) audioVoice = msg.voice;
          send(ws, { type: 'session_ready', session_id: session._id });
          return;
        }

        return;
      }

      // Binary = audio blob from user
      if (!session || !user) return send(ws, { type: 'error', message: 'Session not started' });

      send(ws, { type: 'status', status: 'processing' });

      const transcript = await transcribeAudio(data, audioMimeType);
      if (!transcript) {
        return send(ws, { type: 'status', status: 'listening' });
      }

      session.transcript.push({ speaker: 'user', text: transcript });
      send(ws, { type: 'transcript', speaker: 'user', text: transcript });
      send(ws, { type: 'status', status: 'thinking' });

      const { spokenText, scores } = await generatePiaResponse(
        transcript,
        session.conversation_history,
        session.mode,
        session.startup_name
      );

      session.conversation_history.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: spokenText }
      );

      if (scores) {
        Object.assign(session.scores, scores);
        send(ws, { type: 'scores', scores: session.scores });
      }

      session.transcript.push({ speaker: 'pia', text: spokenText });
      await session.save();

      send(ws, { type: 'transcript', speaker: 'pia', text: spokenText });
      send(ws, { type: 'status', status: 'speaking' });

      const audioBuffer = await synthesizeSpeech(spokenText, audioVoice);
      ws.send(audioBuffer);

      // status: listening is sent after audio finishes playing (frontend fires it)
    } catch (err) {
      console.error('WS handler error:', err.message);
      send(ws, { type: 'error', message: err.message });
      send(ws, { type: 'status', status: 'listening' });
    }
  });

  ws.on('close', () => console.log('WebSocket disconnected'));
  ws.on('error', (err) => console.error('WebSocket error:', err.message));
}
