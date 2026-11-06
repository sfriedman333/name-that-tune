require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 3847;
const AUDD_API_TOKEN = process.env.AUDD_API_TOKEN || '';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 15e6,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  if (rooms.has(code)) return makeCode();
  return code;
}

function normalizeTitle(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(feat\.?|ft\.?|featuring|with|vs\.?|x)\b.*$/i, ' ')
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titlesMatch(guess, answer) {
  const g = normalizeTitle(guess);
  const a = normalizeTitle(answer);
  if (!g || !a) return false;
  if (g === a) return true;
  // Allow guess that contains the full answer or answer that contains guess (min length)
  if (g.length >= 4 && a.includes(g)) return true;
  if (a.length >= 4 && g.includes(a)) return true;
  // Token overlap: at least 80% of answer tokens present in guess
  const aTokens = a.split(' ').filter(Boolean);
  const gSet = new Set(g.split(' ').filter(Boolean));
  if (aTokens.length === 0) return false;
  const hits = aTokens.filter((t) => gSet.has(t)).length;
  return hits / aTokens.length >= 0.8;
}

function publicPlayers(room) {
  return Object.values(room.players).map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    isHost: p.id === room.hostId,
  }));
}

function roomPublicState(room) {
  return {
    code: room.code,
    phase: room.phase, // lobby | listening | ready | guessing | revealed
    players: publicPlayers(room),
    round: room.round,
    track: room.phase === 'guessing' || room.phase === 'revealed' || room.phase === 'ready'
      ? room.revealedTrack
        ? room.track
        : room.phase === 'guessing' || room.phase === 'ready'
          ? { title: '???', artist: '???' }
          : room.track
      : null,
    // During guessing we hide the answer from clients except when revealed
    identified: !!room.track && (room.phase === 'guessing' || room.phase === 'ready' || room.phase === 'revealed'),
    winner: room.winner,
    lastCorrectGuess: room.lastCorrectGuess,
    hasAudd: !!AUDD_API_TOKEN,
    hostId: room.hostId,
  };
}

// For guessing phase, send a safe state that does NOT include the real title
function clientState(room, forSocketId) {
  const base = {
    code: room.code,
    phase: room.phase,
    players: publicPlayers(room),
    round: room.round,
    hasAudd: !!AUDD_API_TOKEN,
    hostId: room.hostId,
    youAreHost: forSocketId === room.hostId,
    winner: room.winner,
    lastCorrectGuess: room.lastCorrectGuess,
  };

  if (room.phase === 'lobby') {
    return { ...base, track: null, prompt: 'Waiting in lobby — host starts a round.' };
  }
  if (room.phase === 'listening') {
    return { ...base, track: null, prompt: 'Listening for the song…' };
  }
  if (room.phase === 'ready') {
    return {
      ...base,
      track: { hidden: true },
      prompt: 'Identified — GO!',
    };
  }
  if (room.phase === 'guessing') {
    return {
      ...base,
      track: { hidden: true },
      prompt: 'Name that tune!',
    };
  }
  if (room.phase === 'revealed') {
    return {
      ...base,
      track: room.track,
      prompt: room.winner
        ? `${room.winner.name} won!`
        : 'Round over',
    };
  }
  return base;
}

function emitRoom(room) {
  for (const pid of Object.keys(room.players)) {
    const sock = io.sockets.sockets.get(pid);
    if (sock) sock.emit('room:state', clientState(room, pid));
  }
}

function getRoomBySocket(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, audd: !!AUDD_API_TOKEN });
});

app.post('/api/identify', upload.single('audio'), async (req, res) => {
  if (!AUDD_API_TOKEN) {
    return res.status(400).json({
      error: 'no_audd_token',
      message: 'AUDD_API_TOKEN not set. Use Demo or Manual reveal instead.',
    });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'no_audio' });
  }
  try {
    const form = new FormData();
    form.append('api_token', AUDD_API_TOKEN);
    form.append('return', 'apple_music,spotify');
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || 'clip.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });

    const resp = await fetch('https://api.audd.io/', {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });
    const data = await resp.json();
    if (data.status === 'success' && data.result) {
      return res.json({
        ok: true,
        title: data.result.title,
        artist: data.result.artist,
        album: data.result.album || null,
        raw: data.result,
      });
    }
    return res.json({
      ok: false,
      error: 'not_found',
      message: data.error || 'Could not identify the track. Try again or use Manual reveal.',
    });
  } catch (err) {
    console.error('AudD error', err);
    return res.status(500).json({ error: 'audd_failed', message: String(err.message || err) });
  }
});

io.on('connection', (socket) => {
  socket.emit('hello', { hasAudd: !!AUDD_API_TOKEN });

  socket.on('room:create', ({ name }, cb) => {
    try {
      const displayName = String(name || 'Host').trim().slice(0, 24) || 'Host';
      const code = makeCode();
      const room = {
        code,
        hostId: socket.id,
        players: {},
        phase: 'lobby',
        round: 0,
        track: null, // { title, artist, album? }
        winner: null,
        lastCorrectGuess: null,
        guessingOpen: false,
        createdAt: Date.now(),
      };
      room.players[socket.id] = {
        id: socket.id,
        name: displayName,
        score: 0,
      };
      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerName = displayName;
      if (typeof cb === 'function') cb({ ok: true, code, state: clientState(room, socket.id) });
      emitRoom(room);
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: String(e.message || e) });
    }
  });

  socket.on('room:join', ({ code, name }, cb) => {
    try {
      const roomCode = String(code || '').trim().toUpperCase();
      const displayName = String(name || 'Player').trim().slice(0, 24) || 'Player';
      const room = rooms.get(roomCode);
      if (!room) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Room not found. Check the code.' });
        return;
      }
      // Leave previous room if any
      if (socket.data.roomCode && socket.data.roomCode !== roomCode) {
        leaveRoom(socket);
      }
      room.players[socket.id] = {
        id: socket.id,
        name: displayName,
        score: room.players[socket.id]?.score || 0,
      };
      socket.join(roomCode);
      socket.data.roomCode = roomCode;
      socket.data.playerName = displayName;
      if (typeof cb === 'function') cb({ ok: true, code: roomCode, state: clientState(room, socket.id) });
      emitRoom(room);
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: String(e.message || e) });
    }
  });

  socket.on('round:demo', ({ title, artist }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb && cb({ ok: false, error: 'Not in a room' });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Only host can start' });
    const t = String(title || '').trim();
    if (!t) return cb && cb({ ok: false, error: 'Enter a song title' });
    startIdentifiedRound(room, {
      title: t,
      artist: String(artist || '').trim() || 'Unknown',
      source: 'demo',
    });
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('round:manual', ({ title, artist }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb && cb({ ok: false, error: 'Not in a room' });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Only host can reveal' });
    const t = String(title || '').trim();
    if (!t) return cb && cb({ ok: false, error: 'Enter a song title' });
    startIdentifiedRound(room, {
      title: t,
      artist: String(artist || '').trim() || 'Unknown',
      source: 'manual',
    });
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('round:listening', (cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb && cb({ ok: false, error: 'Not in a room' });
    // Anyone can trigger listen, but typically host
    room.phase = 'listening';
    room.track = null;
    room.winner = null;
    room.lastCorrectGuess = null;
    room.guessingOpen = false;
    emitRoom(room);
    if (typeof cb === 'function') cb({ ok: true, hasAudd: !!AUDD_API_TOKEN });
  });

  socket.on('round:identified', ({ title, artist, album }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb && cb({ ok: false, error: 'Not in a room' });
    const t = String(title || '').trim();
    if (!t) return cb && cb({ ok: false, error: 'No title from ID' });
    startIdentifiedRound(room, {
      title: t,
      artist: String(artist || '').trim() || 'Unknown',
      album: album || null,
      source: 'audd',
    });
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('round:listen-failed', ({ message }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return;
    room.phase = 'lobby';
    emitRoom(room);
    io.to(room.code).emit('toast', {
      type: 'error',
      message: message || 'Could not identify. Try Demo or Manual.',
    });
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('guess:submit', ({ guess }, cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb && cb({ ok: false, error: 'Not in a room' });
    if (room.phase !== 'guessing' && room.phase !== 'ready') {
      return cb && cb({ ok: false, error: 'Guessing is not open' });
    }
    if (!room.guessingOpen || !room.track) {
      return cb && cb({ ok: false, error: 'Guessing is not open yet' });
    }
    const player = room.players[socket.id];
    if (!player) return cb && cb({ ok: false, error: 'Not a player' });
    const g = String(guess || '').trim();
    if (!g) return cb && cb({ ok: false, error: 'Empty guess' });

    if (titlesMatch(g, room.track.title)) {
      room.guessingOpen = false;
      room.phase = 'revealed';
      player.score += 1;
      room.winner = { id: player.id, name: player.name };
      room.lastCorrectGuess = g;
      emitRoom(room);
      io.to(room.code).emit('round:won', {
        winner: room.winner,
        track: room.track,
        guess: g,
      });
      if (typeof cb === 'function') cb({ ok: true, correct: true });
    } else {
      if (typeof cb === 'function') cb({ ok: true, correct: false, message: 'Nope — try again!' });
    }
  });

  socket.on('round:next', (cb) => {
    const room = getRoomBySocket(socket);
    if (!room) return cb && cb({ ok: false, error: 'Not in a room' });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Only host' });
    room.phase = 'lobby';
    room.track = null;
    room.winner = null;
    room.lastCorrectGuess = null;
    room.guessingOpen = false;
    emitRoom(room);
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
  });
});

function startIdentifiedRound(room, track) {
  room.round += 1;
  room.track = track;
  room.winner = null;
  room.lastCorrectGuess = null;
  room.phase = 'ready';
  room.guessingOpen = false;
  emitRoom(room);

  // Brief "GO!" beat, then open guessing
  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    if (room.phase !== 'ready') return;
    room.phase = 'guessing';
    room.guessingOpen = true;
    emitRoom(room);
    io.to(room.code).emit('round:go', { round: room.round });
  }, 1200);
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  delete room.players[socket.id];
  if (Object.keys(room.players).length === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = Object.keys(room.players)[0];
  }
  emitRoom(room);
}

// Cleanup stale rooms (>6 hours)
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff && Object.keys(room.players).length === 0) {
      rooms.delete(code);
    }
  }
}, 30 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Name That Tune listening on http://0.0.0.0:${PORT}`);
  console.log(`AudD: ${AUDD_API_TOKEN ? 'configured' : 'NOT set — demo/manual mode only'}`);
});
