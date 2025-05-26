function dessinerTerrainFoot(ctx, joueurs = []) {
  ctx.fillStyle = "#6ab150"; // vert gazon
  ctx.fillRect(0, 0, 800, 500);

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;

  // lignes extérieures
  ctx.strokeRect(0, 0, 800, 500);

  // ligne du milieu
  ctx.beginPath();
  ctx.moveTo(400, 0);
  ctx.lineTo(400, 500);
  ctx.stroke();

  // cercle central
  ctx.beginPath();
  ctx.arc(400, 250, 50, 0, 2 * Math.PI);
  ctx.stroke();

  // surface de réparation gauche
  ctx.strokeRect(0, 150, 120, 200);

  // surface de réparation droite
  ctx.strokeRect(680, 150, 120, 200);

  // Affichage des joueurs
  joueurs.forEach(joueur => {
    dessinerJoueur(ctx, joueur);
  });
}

function dessinerTerrainBasket(ctx, joueurs = []) {
  ctx.fillStyle = "#fdd835"; // orange parquet
  ctx.fillRect(0, 0, 800, 500);

  ctx.strokeStyle = "#333";
  ctx.lineWidth = 2;

  // lignes extérieures
  ctx.strokeRect(0, 0, 800, 500);

  // ligne du milieu
  ctx.beginPath();
  ctx.moveTo(400, 0);
  ctx.lineTo(400, 500);
  ctx.stroke();

  // cercle central
  ctx.beginPath();
  ctx.arc(400, 250, 60, 0, 2 * Math.PI);
  ctx.stroke();

  // raquette gauche
  ctx.strokeRect(0, 175, 100, 150);

  // raquette droite
  ctx.strokeRect(700, 175, 100, 150);

  // Affichage des joueurs
  joueurs.forEach(joueur => {
    dessinerJoueur(ctx, joueur);
  });
}

function dessinerJoueur(ctx, joueur) {
  ctx.fillStyle = "#007bff";
  ctx.beginPath();
  ctx.arc(joueur.x, joueur.y, 18, 0, 2 * Math.PI);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = "12px Arial";
  ctx.fillText(joueur.nom, joueur.x - 20, joueur.y - 25);
}