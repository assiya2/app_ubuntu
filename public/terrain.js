


new Vue({
  el: '#app',
  data: {
    // État de connexion
    socket: null,
    isConnectedToMatch: false,
    isPlayer: false,

    // Interface utilisateur
    activeTab: 'coaches',
    notification: null,
    
    // Données entraîneur
    coachName: '',
    coachRole: 'Assistant',
    matchId: '',
    
    // Listes de données
    joueursUniques: [],
    coachesConnected: [],
    selectedPlayers: [],
    
    // État du terrain
    terrainChoisi: 'foot',
    playersOnField: [],
    canvasWidth: 800,
    canvasHeight: 500,
    
    // Drag & Drop
    isDragging: false,
    draggedPlayer: null,
    dragOffset: { x: 0, y: 0 },
    dragMode: false,
    currentCursor: 'crosshair',
    dragUpdateTimeout: null,
    
    // Gestion des cartes joueurs
    carteVisible: false,
    joueurSelectionne: null,
    showModificationForm: false,
    formModification: {
      name: '',
      x: 0,
      y: 0,
      avatar: ''
    },
    
    // Audio et streaming
    streamingEnCours: false,
    isCommunicationRecording: false,
    communicationDuration: 0,
    communicationTargets: [],
    communicationTimer: null,
    streamingCoaches: new Map(),
    
    // Audio côté joueur
    isReceivingAudio: false,
    audioContext: null,
    audioSource: null,
    currentCoachMessage: '',
    
    // Enregistrements
    communications: [],
    currentlyPlaying: null,
    currentAudio: null,
    
    // Sauvegarde
    matchesSauvegardes: []
  },
  
  mounted() {
    this.initSocket();
    this.initCanvas();
    this.chargerMatchesSauvegardes();
  },
  
  beforeDestroy() {
    this.arreterTimerCommunication();
    if (this.currentAudio) {
      this.currentAudio.pause();
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  },
  
  methods: {
    // === INITIALISATION ===
    initSocket() {
      this.socket = io({
        transports: ['websocket', 'polling']
      });

      // Gestion de la connexion
      this.socket.on('connect', () => {
        console.log('Connecté au serveur');
      });

      this.socket.on('disconnect', () => {
        console.log(' Déconnexé du serveur');
        this.isConnectedToMatch = false;
      });

      // === GESTION DES JOUEURS ===
      this.socket.on('players-list', (players) => {
        console.log('Mise à jour de la liste des joueurs:', players);
        this.joueursUniques = players.map(player => ({
          ...player,
          status: player.status || 'online'
        }));
      });

      // === GESTION DES ENTRAÎNEURS ===
      this.socket.on('coaches-list', (coaches) => {
        console.log('Mise à jour de la liste des entraîneurs:', coaches);
        this.coachesConnected = coaches;
      });

      this.socket.on('match-joined', (data) => {
        console.log('Match rejoint:', data);
        this.isConnectedToMatch = true;
        this.terrainChoisi = data.terrain;
        this.playersOnField = data.playersOnField || [];
        this.communications = data.communications || [];
        this.dessinerTerrain();
        this.afficherNotification('Match rejoint avec succès', 'success');
      });

      // === GESTION DU TERRAIN ===
      this.socket.on('terrain-changed', (data) => {
        this.terrainChoisi = data.terrain;
        this.playersOnField = data.playersOnField || [];
        this.dessinerTerrain();
        this.afficherNotification(`Terrain changé en ${data.terrain}`, 'info');
      });

      this.socket.on('players-on-field-updated', (players) => {
        this.playersOnField = players;
        this.dessinerTerrain();
      });

      this.socket.on('player-position-updated', (data) => {
        const player = this.playersOnField.find(p => p.id === data.playerId);
        if (player) {
          player.x = data.x;
          player.y = data.y;
          this.dessinerTerrain();
        }
      });

      // === GESTION AUDIO STREAMING ===
      this.socket.on('stream-started', (data) => {
        console.log('Stream démarré:', data);
        this.streamingEnCours = true;
        this.isCommunicationRecording = true;
        this.communicationTargets = data.targets;
        this.communicationDuration = 0;
        this.demarrerTimerCommunication();
        this.afficherNotification(data.message, 'success');
      });

      this.socket.on('audio-stream', (audioData) => {
        console.log('Données audio reçues:', audioData.length, 'bytes');
        this.handleAudioData(audioData);
      });

      this.socket.on('stream-stopped', (data) => {
        console.log('Confirmation d\'arrêt reçue du serveur:', data);
        this.streamingEnCours = false;
        this.isCommunicationRecording = false;
        this.communicationTargets = [];
        this.communicationDuration = 0;
        this.arreterTimerCommunication();
        
        // Arrêter la réception audio
        this.stopAudioReception();
        
        if (data.communication) {
          const exists = this.communications.find(c => c.filename === data.communication.filename);
          if (!exists) {
            this.communications.push(data.communication);
          }
        }
        
        this.afficherNotification(data.message || 'Communication arrêtée', 'success');
      });

      this.socket.on('stream-error', (error) => {
        console.error('Erreur de stream:', error);
        this.streamingEnCours = false;
        this.isCommunicationRecording = false;
        this.arreterTimerCommunication();
        this.stopAudioReception();
        this.afficherNotification(`Erreur: ${error}`, 'error');
      });

      // Notifications de streaming d'autres entraîneurs
      this.socket.on('coach-streaming', (data) => {
        this.streamingCoaches.set(data.coachName, data);
        this.afficherNotification(`${data.coachName} communique avec ${data.targets.join(', ')}`, 'info');
      });

      this.socket.on('coach-stream-stopped', (data) => {
        this.streamingCoaches.delete(data.coachName);
      });

      // === GESTION DES COMMUNICATIONS SAUVEGARDÉES ===
      this.socket.on('communication-saved', (communication) => {
        console.log(' Communication sauvegardée:', communication);
        const exists = this.communications.find(c => c.filename === communication.filename);
        if (!exists) {
          this.communications.push(communication);
        }
      });

      // === GESTION DES ERREURS ===
      this.socket.on('error', (error) => {
        console.error('Erreur socket:', error);
        this.afficherNotification(`Erreur: ${error}`, 'error');
      });
    },

    initCanvas() {
      this.$nextTick(() => {
        this.dessinerTerrain();
      });
    },

    // === FONCTIONS DE DRAG & DROP ===
    getPlayerAt(x, y) {
      const radius = 20; // Rayon de détection
      return this.playersOnField.find(player => {
        const dx = x - player.x;
        const dy = y - player.y;
        return Math.sqrt(dx * dx + dy * dy) <= radius;
      });
    },

    toggleDragMode() {
      this.dragMode = !this.dragMode;
      this.currentCursor = this.dragMode ? 'grab' : 'crosshair';
      this.afficherNotification(
        this.dragMode ? 'Mode déplacement activé' : 'Mode déplacement désactivé',
        'info'
      );
    },

    handleMouseDown(e) {
      const canvas = this.$refs.canvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      if (this.dragMode) {
        const clickedPlayer = this.getPlayerAt(x, y);
        if (clickedPlayer) {
          this.isDragging = true;
          this.draggedPlayer = clickedPlayer;
          this.dragOffset = {
            x: x - clickedPlayer.x,
            y: y - clickedPlayer.y
          };
          this.currentCursor = 'grabbing';
          e.preventDefault();
          return;
        }
      }

      // Autres interactions avec le canvas...
    },

    handleMouseMove(e) {
      const canvas = this.$refs.canvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // Gérer le drag and drop des joueurs
      if (this.isDragging && this.draggedPlayer) {
        this.draggedPlayer.x = x - this.dragOffset.x;
        this.draggedPlayer.y = y - this.dragOffset.y;
        
        // Limiter aux bords du canvas
        this.draggedPlayer.x = Math.max(20, Math.min(this.canvasWidth - 20, this.draggedPlayer.x));
        this.draggedPlayer.y = Math.max(20, Math.min(this.canvasHeight - 20, this.draggedPlayer.y));
        
        this.dessinerTerrain();
        
        // Envoyer la mise à jour au serveur avec un délai
        if (!this.dragUpdateTimeout) {
          this.dragUpdateTimeout = setTimeout(() => {
            this.socket.emit('update-player-position', {
              playerId: this.draggedPlayer.id,
              x: this.draggedPlayer.x,
              y: this.draggedPlayer.y
            });
            this.dragUpdateTimeout = null;
          }, 100);
        }
        return;
      }

      // Changer le curseur si on survole un joueur en mode drag
      if (this.dragMode && !this.isDragging) {
        const player = this.getPlayerAt(x, y);
        this.currentCursor = player ? 'grab' : 'crosshair';
      }
    },

    handleMouseUp() {
      if (this.isDragging && this.draggedPlayer) {
        // Envoyer la position finale au serveur
        this.socket.emit('update-player-position', {
          playerId: this.draggedPlayer.id,
          x: this.draggedPlayer.x,
          y: this.draggedPlayer.y
        });
        
        // Réinitialiser l'état
        this.isDragging = false;
        this.draggedPlayer = null;
        this.currentCursor = this.dragMode ? 'grab' : 'crosshair';
        
        // Annuler tout timeout en attente
        if (this.dragUpdateTimeout) {
          clearTimeout(this.dragUpdateTimeout);
          this.dragUpdateTimeout = null;
        }
      }
    },

    // === DESSIN DU TERRAIN ===
    dessinerTerrain() {
      this.$nextTick(() => {
        const canvas = this.$refs.canvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (this.terrainChoisi === 'foot') {
          this.dessinerTerrainFoot(ctx, canvas.width, canvas.height);
        } else {
          this.dessinerTerrainBasket(ctx, canvas.width, canvas.height);
        }

        this.dessinerJoueurs(ctx);
      });
    },

    dessinerTerrainFoot(ctx, width, height) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(0, 0, width, height);

      // Lignes du terrain
      ctx.beginPath();
      ctx.rect(20, 20, width - 40, height - 40);
      ctx.moveTo(width / 2, 20);
      ctx.lineTo(width / 2, height - 20);
      ctx.stroke();

      // Cercle central
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 60, 0, 2 * Math.PI);
      ctx.stroke();

      // Surfaces de réparation
      ctx.strokeRect(20, height / 2 - 80, 80, 160);
      ctx.strokeRect(width - 100, height / 2 - 80, 80, 160);
    },

    dessinerTerrainBasket(ctx, width, height) {
      ctx.fillStyle = '#FF9800';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;

      // Lignes du terrain
      ctx.beginPath();
      ctx.rect(20, 20, width - 40, height - 40);
      ctx.moveTo(width / 2, 20);
      ctx.lineTo(width / 2, height - 20);
      ctx.stroke();

      // Cercles
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 60, 0, 2 * Math.PI);
      ctx.stroke();

      // Paniers
      ctx.fillStyle = '#fff';
      ctx.fillRect(15, height / 2 - 30, 15, 60);
      ctx.fillRect(width - 30, height / 2 - 30, 15, 60);
    },

    dessinerJoueurs(ctx) {
      this.playersOnField.forEach((player, index) => {
        // Dessiner le joueur
        ctx.fillStyle = '#2196F3';
        ctx.beginPath();
        ctx.arc(player.x, player.y, 15, 0, 2 * Math.PI);
        ctx.fill();

        // Texte
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, player.x, player.y + 4);
        
        // Indicateur de sélection
        if (this.draggedPlayer && this.draggedPlayer.id === player.id) {
          ctx.beginPath();
          ctx.arc(player.x, player.y, 18, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        
        // Indicateur de drag (mode activé)
        if (this.dragMode) {
          ctx.beginPath();
          ctx.arc(player.x, player.y, 18, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    },

    // === GESTION DES JOUEURS ===
    ajouterJoueur(joueur) {
      if (!this.playersOnField.some(j => j.id === joueur.id)) {
        const positionInit = this.terrainChoisi === 'foot' 
          ? { x: 500, y: 300 } 
          : { x: 400, y: 300 };
        
        const nouveauJoueur = { 
          ...joueur,
          ...positionInit,
          avatar: joueur.avatar || 'https://via.placeholder.com/50'
        };
        
        this.playersOnField.push(nouveauJoueur);
        this.joueurSelectionne = nouveauJoueur;
        this.carteVisible = false;
        this.socket.emit('add-player-to-field', nouveauJoueur);
        this.dessinerTerrain();
      }
    },

    supprimerJoueur(joueur) {
      this.playersOnField = this.playersOnField.filter(j => j.id !== joueur.id);
      this.selectedPlayers = this.selectedPlayers.filter(j => j.id !== joueur.id);
      this.joueurSelectionne = null;
      this.carteVisible = false;
      this.showModificationForm = false;
      this.socket.emit('remove-player-from-field', joueur.id);
      this.dessinerTerrain();
    },

    afficherCarteJoueur(joueur) {
      const joueurSurTerrain = this.playersOnField.find(j => j.id === joueur.id);
      
      if (joueurSurTerrain) {
        this.joueurSelectionne = joueurSurTerrain;
      } else {
        this.joueurSelectionne = {
          ...joueur,
          x: this.terrainChoisi === 'foot' ? 500 : 400,
          y: 300,
          avatar: joueur.avatar || 'https://via.placeholder.com/50'
        };
      }
      
      this.carteVisible = true;
      this.showModificationForm = false;
    },

    afficherFormulaireModification() {
      if (this.joueurSelectionne) {
        this.formModification = {
          name: this.joueurSelectionne.name,
          x: Math.round(this.joueurSelectionne.x),
          y: Math.round(this.joueurSelectionne.y),
          avatar: this.joueurSelectionne.avatar || 'https://via.placeholder.com/50'
        };
        this.showModificationForm = true;
        this.carteVisible = false;
      }
    },

    validerModification() {
      if (this.joueurSelectionne) {
        this.joueurSelectionne.name = this.formModification.name;
        this.joueurSelectionne.x = this.formModification.x;
        this.joueurSelectionne.y = this.formModification.y;
        this.joueurSelectionne.avatar = this.formModification.avatar;
        
        this.showModificationForm = false;
        this.socket.emit('update-player-position', {
          playerId: this.joueurSelectionne.id,
          x: this.joueurSelectionne.x,
          y: this.joueurSelectionne.y
        });
        this.dessinerTerrain();
      }
    },

    annulerModification() {
      this.showModificationForm = false;
    },

    fermerCartes() {
      this.carteVisible = false;
      this.showModificationForm = false;
    },

    // === GESTION DU TERRAIN ===
    effacerTerrain() {
      this.playersOnField.forEach(player => {
        this.socket.emit('remove-player-from-field', player.id);
      });
      this.playersOnField = [];
      this.dessinerTerrain();
    },

    changerTerrain() {
      this.socket.emit('change-terrain', this.terrainChoisi);
    },

    // === GESTION AUDIO ===
    async handleAudioData(audioData) {
      try {
        if (!this.audioContext) {
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
          console.log(' Contexte audio initialisé');
        }

        if (!this.isReceivingAudio) {
          this.isReceivingAudio = true;
          this.currentCoachMessage = 'Communication en cours...';
          console.log('Début de réception audio');
        }

        const arrayBuffer = new Uint8Array(audioData).buffer;
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        source.start();
        
        console.log('Audio joué avec succès');
        
      } catch (error) {
        console.error('Erreur lors de la lecture audio:', error);
      }
    },

    stopAudioReception() {
      console.log('Arrêt de la réception audio');
      this.isReceivingAudio = false;
      this.currentCoachMessage = '';
      
      if (this.audioSource) {
        try {
          this.audioSource.stop();
          this.audioSource.disconnect();
        } catch (error) {
          console.warn('Erreur lors de l\'arrêt de la source audio:', error);
        }
        this.audioSource = null;
      }
    },

    demarrerAudioMulti() {
      if (!this.selectedPlayers.length) {
        this.afficherNotification('Sélectionnez au moins un joueur', 'error');
        return;
      }

      console.log('Démarrage communication vers:', this.selectedPlayers.map(p => p.name));
      
      const targetNames = this.selectedPlayers.map(player => player.name);
      this.socket.emit('start-stream-to', targetNames);
    },

    arreterAudioPourTous() {
      console.log('Tentative d\'arrêt de la communication');
      
      if (!this.streamingEnCours && !this.isCommunicationRecording) {
        console.log('Aucune communication en cours');
        this.afficherNotification('Aucune communication en cours', 'error');
        return;
      }
      
      this.streamingEnCours = false;
      this.isCommunicationRecording = false;
      this.communicationTargets = [];
      this.communicationDuration = 0;
      this.arreterTimerCommunication();
      this.stopAudioReception();
      
      this.socket.emit('stop-stream');
      
      this.afficherNotification('Arrêt de la communication en cours...', 'info');
    },

    // === TIMERS ===
    demarrerTimerCommunication() {
      this.communicationTimer = setInterval(() => {
        this.communicationDuration++;
      }, 1000);
    },

    arreterTimerCommunication() {
      if (this.communicationTimer) {
        clearInterval(this.communicationTimer);
        this.communicationTimer = null;
      }
    },

    // === SAUVEGARDE ===
    async sauvegarderMatch() {
      try {
        const response = await fetch(`/api/matches/${this.matchId}/save`, {
          method: 'POST'
        });
        
        if (response.ok) {
          this.afficherNotification('Match sauvegardé avec succès', 'success');
        } else {
          throw new Error('Erreur de sauvegarde');
        }
      } catch (error) {
        console.error('Erreur sauvegarde match:', error);
        this.afficherNotification('Erreur lors de la sauvegarde', 'error');
      }
    },

    async sauvegarderProfilEntraineur() {
      try {
        const response = await fetch('/api/coaches/profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: this.coachName,
            role: this.coachRole,
            preferences: {}
          })
        });
        
        if (response.ok) {
          this.afficherNotification('Profil entraîneur sauvegardé', 'success');
        } else {
          throw new Error('Erreur de sauvegarde');
        }
      } catch (error) {
        console.error('Erreur sauvegarde profil:', error);
        this.afficherNotification('Erreur lors de la sauvegarde du profil', 'error');
      }
    },

    async chargerMatchesSauvegardes() {
      try {
        const response = await fetch('/api/matches');
        if (response.ok) {
          const matches = await response.json();
          this.matchesSauvegardes = Object.values(matches);
        }
      } catch (error) {
        console.error('Erreur chargement matches:', error);
      }
    },

    rejoindreMatchSauvegarde(matchId) {
      this.matchId = matchId;
      this.rejoindreMatch();
    },

    async supprimerMatch(matchId) {
      if (!confirm(`Êtes-vous sûr de vouloir supprimer le match ${matchId} ?`)) {
        return;
      }

      try {
        const response = await fetch(`/api/matches/${matchId}`, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          this.matchesSauvegardes = this.matchesSauvegardes.filter(m => m.matchId !== matchId);
          this.afficherNotification('Match supprimé', 'success');
        } else {
          throw new Error('Erreur de suppression');
        }
      } catch (error) {
        console.error('Erreur suppression match:', error);
        this.afficherNotification('Erreur lors de la suppression', 'error');
      }
    },

// === GESTION AUDIO ===
    lireAudio(communication) {
      if (this.currentlyPlaying === communication.filename) {
        this.arreterAudio();
        return;
      }

      this.arreterAudio();
      
      const audioUrl = `/audio/communications/${communication.filename}`;
      this.currentAudio = new Audio(audioUrl);
      this.currentlyPlaying = communication.filename;

      this.currentAudio.onended = () => {
        this.currentlyPlaying = null;
      };

      this.currentAudio.onerror = () => {
        this.afficherNotification('Erreur lors de la lecture audio', 'error');
        this.currentlyPlaying = null;
      };

      this.currentAudio.play().catch(error => {
        console.error('Erreur lecture audio:', error);
        this.afficherNotification('Impossible de lire l\'audio', 'error');
        this.currentlyPlaying = null;
      });
    },

    arreterAudio() {
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio = null;
      }
      this.currentlyPlaying = null;
    },

    telechargerAudio(communication) {
      const link = document.createElement('a');
      link.href = `/download/communications/${communication.filename}`;
      link.download = communication.filename;
      link.click();
    },

    async supprimerCommunication(communication) {
      if (!confirm('Êtes-vous sûr de vouloir supprimer cette communication ?')) {
        return;
      }

      try {
        const response = await fetch(`/communications/${communication.filename}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          this.communications = this.communications.filter(c => c.filename !== communication.filename);
          this.afficherNotification('Communication supprimée', 'success');
        } else {
          throw new Error('Erreur lors de la suppression');
        }
      } catch (error) {
        console.error('Erreur suppression:', error);
        this.afficherNotification('Erreur lors de la suppression', 'error');
      }
    },
    // === UTILITAIRES ===
    afficherNotification(message, type = 'info') {
      this.notification = { message, type };
      setTimeout(() => {
        this.notification = null;
      }, 3000);
    },

    formatDuration(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    formatDate(dateString) {
      return new Date(dateString).toLocaleString('fr-FR');
    },

    rejoindreMatch() {
      if (!this.coachName || !this.matchId) {
        this.afficherNotification('Nom et ID du match requis', 'error');
        return;
      }

      console.log('Tentative de connexion au match:', this.matchId);
      this.socket.emit('join-match', {
        matchId: this.matchId,
        coachName: this.coachName,
        role: this.coachRole



      });
    }
  }
});
