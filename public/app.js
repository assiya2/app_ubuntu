const socket = io();
const playerList = document.getElementById('player-list');
const terrain = document.getElementById('terrain');
const sportSelect = document.getElementById('sport-select');

let currentPlayers = [];

// Met à jour le style du terrain
sportSelect.addEventListener('change', () => {
  terrain.className = sportSelect.value;
});

// Affiche les joueurs
socket.on('clients', (clients) => {
  playerList.innerHTML = '';
  clients.forEach((c) => {
    const li = document.createElement('li');
    li.textContent = c.name;
    li.classList.add('drag');
    li.draggable = true;
    li.dataset.id = c.id;

    const btn = document.createElement('button');
    btn.textContent = '🎤';
    btn.onclick = () => socket.emit('start-stream-to', c.id);

    li.appendChild(btn);
    playerList.appendChild(li);
  });
});

// Gère le drag & drop
terrain.addEventListener('dragover', e => e.preventDefault());

terrain.addEventListener('drop', e => {
  e.preventDefault();
  const id = e.dataTransfer.getData("text");
  const playerEl = document.querySelector(`[data-id="${id}"]`);
  e.target.appendChild(playerEl);
});

playerList.addEventListener('dragstart', e => {
  if (e.target.dataset.id) {
    e.dataTransfer.setData("text", e.target.dataset.id);
  }
});