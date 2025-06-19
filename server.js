const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const record = require('node-record-lpcm16');
const path = require('path');
const fs = require('fs');

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
app.use(express.json());

// Créer les dossiers nécessaires
const recordingsDir = path.join(__dirname, 'recordings');
const communicationsDir = path.join(__dirname, 'recordings', 'communications');
const dataDir = path.join(__dirname, 'data');

[recordingsDir, communicationsDir, dataDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Fichiers de sauvegarde
const matchesFile = path.join(dataDir, 'matches.json');
const coachesFile = path.join(dataDir, 'coaches.json');

// Structure de données
const matches = new Map();
const players = new Map();
const coaches = new Map();
const activeRecordings = new Map();
const activeCommunications = new Map();
const activeStreams = new Map();

let globalMicRecorder = null;
let globalMicStream = null;

// === FONCTIONS DE SAUVEGARDE ===
function sauvegarderMatches() {
  try {
    const matchesData = {};
    matches.forEach((match, matchId) => {
      matchesData[matchId] = {
        ...match,
        coaches: Array.from(match.coaches.entries()),
        players: Array.from(match.players.entries()),
        createdAt: match.createdAt.toISOString(),
        lastUpdated: new Date().toISOString()
      };
    });
    fs.writeFileSync(matchesFile, JSON.stringify(matchesData, null, 2));
    console.log('Matches sauvegardés');
  } catch (error) {
    console.error('Erreur sauvegarde matches:', error);
  }
}

function chargerMatches() {
  try {
    if (fs.existsSync(matchesFile)) {
      const data = JSON.parse(fs.readFileSync(matchesFile, 'utf8'));
      Object.entries(data).forEach(([matchId, matchData]) => {
        const match = {
          ...matchData,
          coaches: new Map(matchData.coaches || []),
          players: new Map(matchData.players || []),
          createdAt: new Date(matchData.createdAt),
          lastUpdated: new Date(matchData.lastUpdated || matchData.createdAt)
        };
        matches.set(matchId, match);
      });
      console.log(` ${Object.keys(data).length} matches chargés`);
    }
  } catch (error) {
    console.error('Erreur chargement matches:', error);
  }
}

function sauvegarderEntraineurs() {
  try {
    const coachesData = Array.from(coaches.entries()).map(([socketId, coach]) => ({
      ...coach,
      lastActive: new Date().toISOString()
    }));
    fs.writeFileSync(coachesFile, JSON.stringify(coachesData, null, 2));
    console.log('Entraîneurs sauvegardés');
  } catch (error) {
    console.error('Erreur sauvegarde entraîneurs:', error);
  }
}

function chargerEntraineurs() {
  try {
    if (fs.existsSync(coachesFile)) {
      const data = JSON.parse(fs.readFileSync(coachesFile, 'utf8'));
      console.log(`${data.length} profils d'entraîneurs chargés`);
      return data;
    }
    return [];
  } catch (error) {
    console.error('Erreur chargement entraîneurs:', error);
    return [];
  }
}

// === ROUTES AUDIO ===
app.get('/audio/communications/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(communicationsDir, filename);
  
  if (fs.existsSync(filepath)) {
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filepath);
  } else {
    res.status(404).send('Fichier audio non trouvé');
  }
});

app.get('/download/communications/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(communicationsDir, filename);
  
  if (fs.existsSync(filepath)) {
    res.download(filepath, filename);
  } else {
    res.status(404).send('Fichier audio non trouvé');
  }
});

app.delete('/communications/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(communicationsDir, filename);
  
  if (fs.existsSync(filepath)) {
    fs.unlink(filepath, (err) => {
      if (err) {
        res.status(500).json({ error: 'Erreur lors de la suppression' });
      } else {
        res.json({ success: true, message: 'Fichier supprimé avec succès' });
      }
    });
  } else {
    res.status(404).json({ error: 'Fichier non trouvé' });
  }
});

// === ROUTES API SAUVEGARDE ===
app.get('/api/matches', (req, res) => {
  const matchesData = {};
  matches.forEach((match, matchId) => {
    matchesData[matchId] = {
      matchId,
      terrain: match.terrain,
      coachesCount: match.coaches.size,
      playersCount: match.playersOnField.length,
      createdAt: match.createdAt,
      lastUpdated: match.lastUpdated || match.createdAt
    };
  });
  res.json(matchesData);
});

app.get('/api/matches/:matchId', (req, res) => {
  const match = matches.get(req.params.matchId);
  if (!match) {
    return res.status(404).json({ error: 'Match non trouvé' });
  }
  
  res.json({
    matchId: req.params.matchId,
    terrain: match.terrain,
    coaches: Array.from(match.coaches.values()),
    playersOnField: match.playersOnField,
    recordings: match.recordings,
    communications: match.communications,
    createdAt: match.createdAt,
    lastUpdated: match.lastUpdated || match.createdAt
  });
});

app.post('/api/matches/:matchId/save', (req, res) => {
  const match = matches.get(req.params.matchId);
  if (!match) {
    return res.status(404).json({ error: 'Match non trouvé' });
  }
  
  match.lastUpdated = new Date();
  sauvegarderMatches();
  
  res.json({ 
    success: true, 
    message: 'Match sauvegardé',
    lastUpdated: match.lastUpdated
  });
});

app.delete('/api/matches/:matchId', (req, res) => {
  if (matches.has(req.params.matchId)) {
    matches.delete(req.params.matchId);
    sauvegarderMatches();
    res.json({ success: true, message: 'Match supprimé' });
  } else {
    res.status(404).json({ error: 'Match non trouvé' });
  }
});

app.get('/api/coaches/profiles', (req, res) => {
  const profiles = chargerEntraineurs();
  res.json(profiles);
});

app.post('/api/coaches/profile', (req, res) => {
  const { name, role, preferences } = req.body;
  
  if (!name || !role) {
    return res.status(400).json({ error: 'Nom et rôle requis' });
  }
  
  const profiles = chargerEntraineurs();
  const existingIndex = profiles.findIndex(p => p.name === name);
  
  const profile = {
    name,
    role,
    preferences: preferences || {},
    createdAt: existingIndex >= 0 ? profiles[existingIndex].createdAt : new Date().toISOString(),
    lastActive: new Date().toISOString()
  };
  
  if (existingIndex >= 0) {
    profiles[existingIndex] = profile;
  } else {
    profiles.push(profile);
  }
  
  fs.writeFileSync(coachesFile, JSON.stringify(profiles, null, 2));
  res.json({ success: true, profile });
});

// === FONCTIONS UTILITAIRES ===
function getTargetSockets(targetNames) {
  const targetSockets = [];
  for (const [socketId, player] of players.entries()) {
    if (targetNames.includes(player.name)) {
      targetSockets.push(socketId);
    }
  }
  return targetSockets;
}

function startAudioStreamToPlayers(coachSocketId, targetSockets) {
  console.log(' Démarrage du streaming audio...');
  
  if (globalMicRecorder || globalMicStream) {
    console.warn(' Streaming déjà actif, arrêt en cours...');
    stopCurrentStream();
  }

  try {
    globalMicRecorder = record.record({
      sampleRate: 16000,
      channels: 1,
      audioType: 'wav',
      silence: '2.0',
      recorder: 'sox'
    });

    globalMicStream = globalMicRecorder.stream();
    
    activeStreams.set(coachSocketId, {
      recorder: globalMicRecorder,
      stream: globalMicStream,
      targets: targetSockets,
      startTime: new Date()
    });

    globalMicStream.on('data', (audioData) => {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('audio-stream', audioData);
      });
    });

    globalMicStream.on('error', (error) => {
      console.error('Erreur stream audio:', error);
    });

    console.log(` Streaming audio démarré vers ${targetSockets.length} joueur(s)`);
    return true;
  } catch (error) {
    console.error(' Erreur lors du démarrage du streaming:', error);
    return false;
  }
}

function stopCurrentStream() {
  console.log('Arrêt du stream global...');
  
  if (globalMicStream) {
    try {
      globalMicStream.removeAllListeners();
      globalMicStream.unpipe();
      globalMicStream.destroy();
      console.log(' globalMicStream arrêté');
    } catch (error) {
      console.error('Erreur arrêt globalMicStream:', error);
    }
    globalMicStream = null;
  }
  
  if (globalMicRecorder) {
    try {
      globalMicRecorder.stop();
      console.log(' globalMicRecorder arrêté');
    } catch (error) {
      console.error('Erreur arrêt globalMicRecorder:', error);
    }
    globalMicRecorder = null;
  }
  
  activeStreams.clear();
  console.log('activeStreams nettoyé');
}

function stopCommunicationRecording(socketId) {
  console.log(` Arrêt de l'enregistrement de communication pour ${socketId}`);
  
  const communication = activeCommunications.get(socketId);
  if (!communication) {
    console.log('Aucun enregistrement de communication trouvé');
    return null;
  }

  try {
    communication.stream.removeAllListeners();
    communication.stream.unpipe();
    communication.writeStream.end();
    communication.recorder.stop();

    const duration = new Date() - communication.startTime;
    const communicationInfo = {
      filename: communication.filename,
      filepath: communication.filepath,
      duration: Math.floor(duration / 1000),
      startTime: communication.startTime,
      endTime: new Date(),
      coachName: communication.coachName,
      matchId: communication.matchId,
      targets: communication.targets,
      type: 'communication'
    };

    const match = matches.get(communication.matchId);
    if (match) {
      match.communications.push(communicationInfo);
      
      const coachData = match.coaches.get(socketId);
      if (coachData) {
        coachData.isCommunicating = false;
      }

      sauvegarderMatches();

      io.to(communication.matchId).emit('communication-saved', communicationInfo);
      io.to(communication.matchId).emit('coaches-list', Array.from(match.coaches.values()));
    }

    activeCommunications.delete(socketId);
    console.log(`Communication sauvegardée: ${communicationInfo.filename}`);
    return communicationInfo;

  } catch (error) {
    console.error('Erreur lors de l\'arrêt de l\'enregistrement de communication:', error);
    activeCommunications.delete(socketId);
    return null;
  }
}

// === SOCKET.IO ===
io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] ✅ Nouvelle connexion: ${socket.id}`);

  // Enregistrement d'un joueur
  socket.on('register-player', (playerData) => {
    if (!playerData?.nom) {
      console.warn(' Client sans données valides ignoré.');
      return;
    }

    const playerName = playerData.nom;
    const avatar = playerData.avatar || 'https://via.placeholder.com/50';

    Array.from(players.entries()).forEach(([id, player]) => {
      if (player.name === playerName) {
        players.delete(id);
        console.log(` Remplacement de l'ancienne connexion pour ${playerName}`);
      }
    });

    players.set(socket.id, {
      id: socket.id,
      name: playerName,
      position: playerData.position || '',
      avatar: avatar,
      status: 'online',
      socketId: socket.id
    });

    console.log(`Joueur enregistré : ${playerName}`);
    io.emit('players-list', Array.from(players.values()));
  });

  // Entraîneur rejoint un match
  socket.on('join-match', (data) => {
    const { matchId, coachName, role } = data;
    
    if (!matchId || !coachName) {
      socket.emit('error', 'ID du match et nom de l\'entraîneur requis');
      return;
    }

    if (!matches.has(matchId)) {
      matches.set(matchId, {
        coaches: new Map(),
        players: new Map(),
        terrain: 'foot',
        playersOnField: [],
        recordings: [],
        communications: [],
        createdAt: new Date()
      });
      console.log(`Nouveau match créé: ${matchId}`);
    }

    const match = matches.get(matchId);
    
    socket.join(matchId);
    match.coaches.set(socket.id, {
      id: socket.id,
      name: coachName,
      role: role || 'Assistant',
      socketId: socket.id,
      joinedAt: new Date(),
      isActive: true,
      isRecording: false,
      isCommunicating: false
    });

    coaches.set(socket.id, {
      name: coachName,
      role: role || 'Assistant',
      matchId: matchId,
      socketId: socket.id
    });

    console.log(`Entraîneur ${coachName} (${role}) a rejoint le match ${matchId}`);

    sauvegarderMatches();
    sauvegarderEntraineurs();

    socket.emit('match-joined', {
      matchId: matchId,
      terrain: match.terrain,
      playersOnField: match.playersOnField,
      role: role,
      recordings: match.recordings,
      communications: match.communications
    });

    io.to(matchId).emit('coaches-list', Array.from(match.coaches.values()));
    io.to(matchId).emit('players-on-field-updated', match.playersOnField);
  });

  // Audio streaming vers des joueurs spécifiques avec enregistrement
  socket.on('start-stream-to', (targetPlayerNames) => {
    console.log(`Demande de démarrage de stream de ${socket.id}`);
    
    const coach = coaches.get(socket.id);
    if (!coach) {
      console.error('Entraîneur non trouvé pour le streaming');
      socket.emit('stream-error', 'Entraîneur non trouvé');
      return;
    }

    const match = matches.get(coach.matchId);
    if (!match) {
      console.error('Match non trouvé');
      socket.emit('stream-error', 'Match non trouvé');
      return;
    }

    const targets = Array.isArray(targetPlayerNames) ? targetPlayerNames : [targetPlayerNames];
    const targetSockets = getTargetSockets(targets);

    if (targetSockets.length === 0) {
      console.error('Aucune cible valide trouvée');
      socket.emit('stream-error', 'Aucun joueur trouvé');
      return;
    }

    // Arrêter le streaming précédent
    stopCurrentStream();

    // Démarrer l'enregistrement automatique de la communication
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const commFilename = `${coach.matchId}_${coach.name}_comm_${targets.join('-')}_${timestamp}.wav`;
    const commFilepath = path.join(communicationsDir, commFilename);

    try {
      const commRecorder = record.record({
        sampleRate: 16000,
        channels: 1,
        audioType: 'wav',
        silence: '2.0',
        recorder: 'sox'
      });

      const commStream = commRecorder.stream();
      const commWriteStream = fs.createWriteStream(commFilepath);
      commStream.pipe(commWriteStream);

      activeCommunications.set(socket.id, {
        recorder: commRecorder,
        stream: commStream,
        writeStream: commWriteStream,
        filename: commFilename,
        filepath: commFilepath,
        startTime: new Date(),
        coachName: coach.name,
        matchId: coach.matchId,
        targets: targets,
        type: 'communication'
      });

      const coachData = match.coaches.get(socket.id);
      coachData.isCommunicating = true;

      console.log(` Communication enregistrée: ${coach.name} -> ${targets.join(', ')}`);

    } catch (error) {
      console.error('Erreur lors du démarrage de l\'enregistrement de communication:', error);
    }

    // Démarrer le streaming audio vers les joueurs
    const streamStarted = startAudioStreamToPlayers(socket.id, targetSockets);
    
    if (streamStarted) {
      console.log(` ${coach.name} streaming audio vers ${targets.join(', ')}`);

      socket.to(coach.matchId).emit('coach-streaming', {
        coachName: coach.name,
        targets: targets,
        role: coach.role,
        timestamp: new Date()
      });

      socket.emit('stream-started', {
        success: true,
        targets: targets,
        message: `Communication démarrée vers ${targets.join(', ')}`
      });

      io.to(coach.matchId).emit('coaches-list', Array.from(match.coaches.values()));
    } else {
      socket.emit('stream-error', 'Erreur lors du démarrage de la communication');
    }
  });

  // Arrêter le streaming audio - VERSION CORRIGÉE
  socket.on('stop-stream', () => {
    console.log(` Demande d'arrêt de stream reçue de ${socket.id}`);
    
    const coach = coaches.get(socket.id);
    if (!coach) {
      console.error('Entraîneur non trouvé pour l\'arrêt');
      socket.emit('stream-error', 'Entraîneur non trouvé');
      return;
    }

    console.log(` ${coach.name} demande l'arrêt du streaming audio`);
    
    // 1. ARRÊTER L'ENREGISTREMENT DE COMMUNICATION EN PREMIER
    const communicationInfo = stopCommunicationRecording(socket.id);
    console.log('Enregistrement de communication arrêté:', communicationInfo ? 'Oui' : 'Non');
    
    // 2. ARRÊTER LE STREAMING GLOBAL
    stopCurrentStream();
    console.log('Streaming global arrêté');
    
    // 3. METTRE À JOUR L'ÉTAT DU COACH
    const match = matches.get(coach.matchId);
    if (match) {
      const coachData = match.coaches.get(socket.id);
      if (coachData) {
        coachData.isCommunicating = false;
        console.log(`État du coach ${coach.name} mis à jour: isCommunicating = false`);
      }
      
      // Notifier tous les entraîneurs de la mise à jour
      io.to(coach.matchId).emit('coaches-list', Array.from(match.coaches.values()));
    }

    // 4. NOTIFIER LES AUTRES ENTRAÎNEURS
    socket.to(coach.matchId).emit('coach-stream-stopped', {
      coachName: coach.name,
      timestamp: new Date()
    });

    // 5. CONFIRMER L'ARRÊT AU CLIENT
    socket.emit('stream-stopped', {
      success: true,
      message: 'Communication arrêtée avec succès',
      communication: communicationInfo,
      timestamp: new Date()
    });

    console.log(`Stream arrêté avec succès pour ${coach.name}`);

    if (communicationInfo) {
      console.log(`Communication sauvegardée: ${communicationInfo.filename} (${communicationInfo.duration}s)`);
    }
  });

  // Changer le type de terrain
  socket.on('change-terrain', (terrainType) => {
    const coach = coaches.get(socket.id);
    if (!coach) return;

    const match = matches.get(coach.matchId);
    if (!match) return;

    match.terrain = terrainType;
    match.playersOnField = [];
    match.lastUpdated = new Date();

    sauvegarderMatches();

    io.to(coach.matchId).emit('terrain-changed', {
      terrain: terrainType,
      playersOnField: []
    });

    console.log(`Terrain changé en ${terrainType} pour le match ${coach.matchId}`);
  });

  // Ajouter un joueur sur le terrain
  socket.on('add-player-to-field', (playerData) => {
    const coach = coaches.get(socket.id);
    if (!coach) return;

    const match = matches.get(coach.matchId);
    if (!match) return;

    const playerOnField = {
      ...playerData,
      id: playerData.id || Date.now(),
      x: playerData.x || 100,
      y: playerData.y || 100,
      addedBy: coach.name,
      addedAt: new Date()
    };

    const existingIndex = match.playersOnField.findIndex(p => p.id === playerOnField.id);
    if (existingIndex >= 0) {
      match.playersOnField[existingIndex] = playerOnField;
    } else {
      match.playersOnField.push(playerOnField);
    }

    match.lastUpdated = new Date();
    sauvegarderMatches();

    io.to(coach.matchId).emit('players-on-field-updated', match.playersOnField);
    console.log(`Joueur ${playerOnField.name} ajouté au terrain par ${coach.name}`);
  });

  // Mettre à jour la position d'un joueur
  socket.on('update-player-position', (data) => {
    const coach = coaches.get(socket.id);
    if (!coach) return;

    const match = matches.get(coach.matchId);
    if (!match) return;

    const player = match.playersOnField.find(p => p.id === data.playerId);
    if (player) {
      player.x = data.x;
      player.y = data.y;
      player.lastUpdatedBy = coach.name;
      player.lastUpdatedAt = new Date();

      match.lastUpdated = new Date();

      socket.to(coach.matchId).emit('player-position-updated', {
        playerId: data.playerId,
        x: data.x,
        y: data.y,
        updatedBy: coach.name
      });

      if (Math.random() < 0.1) {
        sauvegarderMatches();
      }
    }
  });

  // Supprimer un joueur du terrain
  socket.on('remove-player-from-field', (playerId) => {
    const coach = coaches.get(socket.id);
    if (!coach) return;

    const match = matches.get(coach.matchId);
    if (!match) return;

    match.playersOnField = match.playersOnField.filter(p => p.id !== playerId);
    match.lastUpdated = new Date();
    sauvegarderMatches();

    io.to(coach.matchId).emit('players-on-field-updated', match.playersOnField);
    console.log(` Joueur ${playerId} retiré du terrain par ${coach.name}`);
  });

  // Gestion de la déconnexion
  socket.on('disconnect', () => {
    console.log(`[${new Date().toISOString()}]  Déconnexion: ${socket.id}`);

    // Nettoyer les enregistrements actifs
    if (activeRecordings.has(socket.id)) {
      const recording = activeRecordings.get(socket.id);
      try {
        recording.stream.unpipe();
        recording.writeStream.end();
        recording.recorder.stop();
        activeRecordings.delete(socket.id);
      } catch (error) {
        console.error('Erreur lors du nettoyage de l\'enregistrement:', error);
      }
    }

    // Nettoyer les communications actives
    if (activeCommunications.has(socket.id)) {
      stopCommunicationRecording(socket.id);
      stopCurrentStream();
    }

    // Retirer le joueur
    if (players.has(socket.id)) {
      const player = players.get(socket.id);
      players.delete(socket.id);
      io.emit('players-list', Array.from(players.values()));
      console.log(`Joueur ${player.name} déconnecté`);
    }

    // Retirer l'entraîneur
    if (coaches.has(socket.id)) {
      const coach = coaches.get(socket.id);
      const match = matches.get(coach.matchId);
      
      if (match) {
        match.coaches.delete(socket.id);
        match.lastUpdated = new Date();
        io.to(coach.matchId).emit('coaches-list', Array.from(match.coaches.values()));
        
        if (match.coaches.size === 0) {
          console.log(`Match ${coach.matchId} devient inactif (aucun entraîneur connecté)`);
        }
        
        sauvegarderMatches();
      }
      
      coaches.delete(socket.id);
      sauvegarderEntraineurs();
      console.log(`Entraîneur ${coach.name} déconnecté du match ${coach.matchId}`);
    }
  });
});

// Sauvegarde automatique périodique
setInterval(() => {
  sauvegarderMatches();
  sauvegarderEntraineurs();
}, 30000);

// Charger les données au démarrage
chargerMatches();

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(` Serveur démarré sur le port ${PORT}`);
  console.log(` Dossier des enregistrements: ${recordingsDir}`);
  console.log(`Dossier des communications: ${communicationsDir}`);
  console.log(`Dossier des données: ${dataDir}`);
});
