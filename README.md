# Dutch en ligne

Jeu de cartes **Dutch** multijoueur en temps réel (3 à 6 joueurs), dans le navigateur.

## Lancer en local

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000, créer une partie et partager le code (ou le lien d'invitation).

## Règles implémentées

- 54 cartes (52 + 2 Jokers). Chaque joueur a 4 cartes face cachée et regarde ses 2 cartes du bas au début.
- À son tour : piocher (uniquement dans la pioche), puis échanger avec une de ses cartes ou défausser.
- Pouvoirs (carte défaussée directement depuis la pioche) :
  - **7** : regarder une de ses cartes
  - **10** : regarder la carte d'un autre joueur
  - **Valet** : échanger deux cartes du jeu au choix, sans les regarder
  - **Roi noir** : échanger deux cartes du jeu au choix et regarder celle qu'on récupère (si une de ses cartes fait partie de l'échange)
- **Défausse rapide** (à tout moment, même valeur que la défausse) :
  - sa propre carte : réussite = la carte part ; erreur = 2 cartes de pénalité
  - la carte d'un autre : réussite = il reçoit une carte de remplacement + 1 pénalité ; erreur = 1 pénalité pour soi
- Valeurs : Joker −1, Roi rouge 0, As 1, 2–10, Valet 11, Dame 12, Roi noir 13.
- **Dutch !** s'annonce en début de tour ; les autres jouent un dernier tour. Si l'annonceur n'a pas le plus petit score (égalité = réussite), ses points sont doublés.
- La partie s'arrête quand un joueur atteint 200 points ; le plus petit total gagne.

## Structure

- `game.js` : moteur de règles (le serveur fait autorité, les cartes cachées ne sont jamais envoyées aux clients)
- `server.js` : serveur Express + Socket.IO (salons, reconnexion)
- `public/` : interface (HTML/CSS/JS)
