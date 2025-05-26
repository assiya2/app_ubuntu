// ✅ Fichier : server.js avec gestion des conflits audio

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const record = require('node-record-lpcm16');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

const players = new Map();
const entraineurs = new Map();
const matches = new Map();
let micRecorder = null;
let micStream = null;
let streamTargetNames = []; // 🔐 Noms des joueurs ciblés par le flux audio

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function getPublicMatchData(match) {
  return {
    id: match.id,
    name: match.name,
    entraineurs: match.entraineurs.map(e => ({
      id: e.id,
      name: e.name,
      avatar: e.avatar
    })),
    joueursCount: match.joueurs.length,
    createdAt: match.createdAt
  };
}

function broadcastMatchUpdate(match) {
  const matchData = getPublicMatchData(match);
  io.emit('match-update', matchData);
  updateMatchesList();
}

function updateMatchesList() {
  const publicMatches = Array.from(matches.values()).map(getPublicMatchData);
  io.emit('matches-list', publicMatches);
}

function updateEntraineursList() {
  io.emit('entraineurs-list', Array.from(entraineurs.values()));
}

function stopCurrentStream() {
  if (micStream) {
    micStream.destroy();
    micStream = null;
  }
  if (micRecorder) {
    micRecorder.stop();
    micRecorder = null;
  }
  streamTargetNames = [];
}

io.on('connection', (socket) => {
  console.log(`Nouvelle connexion: ${socket.id}`);

  socket.emit('initial-data', {
    matches: Array.from(matches.values()).map(getPublicMatchData),
    entraineurs: Array.from(entraineurs.values())
  });

  socket.on('register-entraineur', (data) => {
    const entraineur = {
      id: socket.id,
      name: data.name,
      avatar: data.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name)}&background=007bff&color=fff`,
      currentMatch: null,
      status: 'online'
    };
    entraineurs.set(socket.id, entraineur);
    updateEntraineursList();
  });

  socket.on('create-match', (data) => {
    const matchId = generateId();
    const entraineur = entraineurs.get(socket.id);
    if (!entraineur) return;

    const match = {
      id: matchId,
      name: data.name,
      entraineurs: [entraineur],
      joueurs: [],
      createdAt: new Date()
    };

    matches.set(matchId, match);
    entraineur.currentMatch = matchId;
    entraineurs.set(socket.id, entraineur);

    socket.join(matchId);
    broadcastMatchUpdate(match);
    updateMatchesList();
    updateEntraineursList();
    socket.emit('match-created', matchId);
  });

  socket.on('join-match', (matchId) => {
    if (matches.has(matchId)) {
      const match = matches.get(matchId);
      const entraineur = entraineurs.get(socket.id);
      if (!entraineur) return;

      if (!match.entraineurs.some(e => e.id === socket.id)) {
        match.entraineurs.push(entraineur);
        entraineur.currentMatch = matchId;
        entraineurs.set(socket.id, entraineur);
        socket.join(matchId);
      }

      broadcastMatchUpdate(match);
      updateMatchesList();
      updateEntraineursList();

      socket.emit('match-update', getPublicMatchData(match));
      socket.emit('joueurs-update', match.joueurs);
    }
  });

  socket.on('register-player', (playerData) => {
    if (!playerData?.nom) return;
    const player = {
      id: socket.id,
      name: playerData.nom,
      avatar: playerData.avatar || 'https://via.placeholder.com/50',
      status: 'online',
      socketId: socket.id
    };
    players.set(socket.id, player);
    io.emit('players-list', Array.from(players.values()));
  });

  socket.on('sync-joueurs', (data) => {
    if (matches.has(data.matchId)) {
      const match = matches.get(data.matchId);
      match.joueurs = data.joueurs;
      io.to(data.matchId).emit('joueurs-update', data.joueurs);
    }
  });

  socket.on('start-stream-to', (targetPlayerNames) => {
    const targets = Array.isArray(targetPlayerNames) ? targetPlayerNames : [targetPlayerNames];
    const conflit = targets.some(name => streamTargetNames.includes(name));

    if (micRecorder || conflit) {
      socket.emit('audio-rejected', {
        reason: 'Un autre enregistrement est déjà en cours pour ce joueur.'
      });
      return;
    }

    stopCurrentStream();
    streamTargetNames = targets;

    const targetSockets = targets
      .map(name => Array.from(players.values()).find(p => p.name === name))
      .filter(Boolean)
      .map(player => io.sockets.sockets.get(player.socketId))
      .filter(Boolean);

    if (targetSockets.length > 0) {
      startAudioStream(targetSockets);
    }
  });

  socket.on('stop-audio-stream', () => {
    stopCurrentStream();
    io.emit('audio-end');
  });

  socket.on('disconnect', () => {
    if (entraineurs.has(socket.id)) {
      const entraineur = entraineurs.get(socket.id);
      entraineur.status = 'offline';

      if (entraineur.currentMatch && matches.has(entraineur.currentMatch)) {
        const match = matches.get(entraineur.currentMatch);
        match.entraineurs = match.entraineurs.filter(e => e.id !== socket.id);
        if (match.entraineurs.length === 0) {
          matches.delete(entraineur.currentMatch);
        } else {
          broadcastMatchUpdate(match);
        }
      }

      setTimeout(() => {
        if (entraineurs.get(socket.id)?.status === 'offline') {
          entraineurs.delete(socket.id);
          updateEntraineursList();
        }
      }, 5000);
    }

    if (players.has(socket.id)) {
      players.delete(socket.id);
      io.emit('players-list', Array.from(players.values()));
    }
  });

  function startAudioStream(sockets) {
    micRecorder = record.record({
      sampleRate: 16000,
      channels: 1,
      threshold: 0,
      silence: '2.0',
      recorder: 'sox'
    });

    micStream = micRecorder.stream();
    micStream.on('data', (chunk) => {
      if (Buffer.isBuffer(chunk)) {
        sockets.forEach(s => s.emit('audio-chunk', chunk));
      }
    });
  }
});

server.listen(4000, '0.0.0.0', () => {
  console.log('Serveur démarré sur http://localhost:4000');
});