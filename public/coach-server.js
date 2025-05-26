const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Stockage des données
const sessions = new Map();

io.on('connection', (socket) => {
  console.log(`Nouvelle connexion entraîneur: ${socket.id}`);

  // Rejoindre une session
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        coaches: new Map(),
        broadcasts: new Set()
      });
    }
    console.log(`Entraîneur a rejoint la session: ${sessionId}`);
  });

  // Enregistrement d'un entraîneur
  socket.on('register-coach', (coachData) => {
    const session = sessions.get(coachData.sessionId);
    if (session) {
      session.coaches.set(coachData.id, {
        ...coachData,
        socketId: socket.id,
        status: 'online'
      });
      updateCoachesList(coachData.sessionId);
    }
  });

  // Gestion des messages entre entraîneurs
  socket.on('coach-message', (message) => {
    const session = findSessionByCoach(message.to);
    if (session) {
      const targetCoach = session.coaches.get(message.to);
      if (targetCoach) {
        io.to(targetCoach.socketId).emit('coach-message', {
          from: message.from,
          text: message.text
        });
      }
    }
  });

  // Diffusion audio
  socket.on('start-broadcast', ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.broadcasts.add(socket.id);
      io.to(sessionId).emit('stream-started');
    }
  });

  socket.on('stop-broadcast', () => {
    const session = findSessionBySocket(socket.id);
    if (session) {
      session.broadcasts.delete(socket.id);
      io.to(session.id).emit('stream-stopped');
    }
  });

  // Gestion déconnexion
  socket.on('disconnect', () => {
    const session = findSessionBySocket(socket.id);
    if (session) {
      for (let [coachId, coach] of session.coaches) {
        if (coach.socketId === socket.id) {
          coach.status = 'offline';
          break;
        }
      }
      updateCoachesList(session.id);
    }
  });

  // Fonctions utilitaires
  function updateCoachesList(sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      io.to(sessionId).emit('coaches-updated', 
        Array.from(session.coaches.values()));
    }
  }

  function findSessionByCoach(coachId) {
    for (let [sessionId, session] of sessions) {
      if (session.coaches.has(coachId)) {
        return session;
      }
    }
    return null;
  }

  function findSessionBySocket(socketId) {
    for (let [sessionId, session] of sessions) {
      for (let coach of session.coaches.values()) {
        if (coach.socketId === socketId) {
          return { ...session, id: sessionId };
        }
      }
    }
    return null;
  }
});

// Serveur les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4001;
server.listen(PORT, () => {
  console.log(`Serveur entraîneur sur le port ${PORT}`);
});