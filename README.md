# DUNGEON ⚔️🕯️
### A Multiplayer Social Deduction Game of Shadows & Deception

> *"Beneath the ancient stones, trust is the sharpest dagger."*

**DUNGEON** is an atmospheric, real-time multiplayer browser-based social deduction game inspired by Mafia and Werewolf, drenched in dark fantasy and medieval dungeon aesthetics. Designed for **5 to 20 players** guided by an omniscient **Moderator**, players scheme, investigate, perform mystical trials, and cast votes to either cleanse the dungeon of evil or let the shadows claim every living soul.

---

<!-- SCREENSHOT PLACEHOLDER -->
```
+-------------------------------------------------------------------------+
|                                DUNGEON                                  |
|                    A Game of Shadows & Deception                        |
|                                                                         |
|         [ ROOM CODE: GY7K ]              [ SOULS GATHERED: 7 / 20 ]     |
|                                                                         |
|               ( * * * RUNIC PORTAL PULSING WITH EMBERS * * * )          |
|                                                                         |
|        [ Moderated by: Alden ]              [ Begin the Ritual ]        |
+-------------------------------------------------------------------------+
```
*(Screenshot: Swirling runic portal in the gathering lobby with ambient floating embers and gold parchment typography)*

---

## ✨ Features

- **Gothic Visual Immersion**: Rich dark theme with flickering torchlight vignetting, procedural HTML5 Canvas ember particles, wax-sealed envelopes, and ornate parchment cards powered by *Cinzel* and *Cormorant Garamond* typography.
- **Dedicated Moderator Tome**: The room creator acts as the omniscient dungeon master—monitoring living states, night actions, active shields, trial results, and votes in real time with advance, pause, and kick controls.
- **Interactive Role Reveal**: Players tap to break realistic animated wax seals on ancient parchment envelopes to discover their secret destiny.
- **12 Laws of the Dungeon**: Built-in rules carousel detailing every core mechanic, special role power, and trial rule before nightfall.
- **Active Trial Mini-Game System**:
  - **Rune Memory**: Memorize and reconstruct sequences of ancient Nordic runes.
  - **Lockpick Rhythm**: Match the auditory and visual rhythmic cadence of dungeon tumblers.
  - **Word Scramble**: Unscramble cryptic dark fantasy anagrams under pressure.
- **Tactical Night Phases**:
  - **Mafia Assassination**: Cult members collaborate on targets and must conquer a Trial to execute their victim. If failed, dark retribution claims a random Mafia member (*Mafia Suicide Rule*).
  - **Doctor's Sanctuary**: The Doctor solves a trial to protect a player. Saving themselves triggers a public dawn announcement (*The Darkness Sees All*).
  - **Detective Clues & Butterfly Curse**: The Detective receives nocturnal revelations and can share clues with allies—cursing the recipient with silence (*Butterfly Effect*), revoking their vote during the next tribunal.
  - **Citizen Shield Trials**: Mortal citizens can brave optional trials to forge a secret mystical Shield that silently absorbs a lethal Mafia strike.
  - **Mafia Succession & Recruitment**: When a Mafia falls, surviving members can wager a turn to attempt to recruit an unsuspecting citizen into their ranks.
- **The Tribunal (Day Voting)**: Democratic elimination voting with tie detection, live vote tallies, role revelation upon execution, and strict enforcement of silenced status.
- **Tri-Channel Real-Time Chat**:
  - ☀️ **Day Chat**: Public discourse for all living dungeon dwellers.
  - 🗡️ **Mafia Night Chat**: Private encrypted communications for the conspirators under cover of darkness.
  - 👻 **Ghost Chat**: The ethereal plane where departed souls observe and converse without disturbing the living.
- **Synthesized Web Audio**: Atmospheric drone, torch crackles, seal snaps, rhythmic clicks, and suspenseful bells without external sound file dependencies.
- **Responsive Architecture**: Play smoothly across desktop monitors, tablets, and mobile screens.

---

## 🚀 Quick Start

Run the application with one command:

```bash
npm install && npm start
```

Open your browser and navigate to:
```
http://localhost:3000
```

---

## 📜 How to Play

1. **Summon the Portal (Moderator)**:
   - Click **"Create a Dungeon"**, enter your name, and receive a 4-letter Room Code.
   - Share the code or invite link with **5 to 20 players**.
2. **Enter the Dungeon (Players)**:
   - Enter your name and the 4-letter Room Code on the entry screen.
3. **The Ritual Begins**:
   - Once at least 5 souls join, the Moderator clicks **"Begin the Ritual"**.
   - Players open their sealed envelopes to view their secret role and review the **12 Laws of the Dungeon**.
4. **The Phases**:
   - **Night Phase**: Special roles and brave citizens perform their actions and trials while the dungeon sleeps.
   - **Dawn Phase**: The sun rises, revealing nocturnal casualties, miraculous survivals, or divine doctor interventions.
   - **The Tribunal (Voting)**: If a death occurred (or initiated by the town), living players deliberate in chat and cast their ballots to banish a suspected conspirator.
5. **Victory**:
   - **Citizens Win**: When every last Mafia conspirator is eliminated.
   - **Mafia Wins**: When living Mafia equal or outnumber living Citizens.

---

## 🎭 Roles Explained

| Role | Team | Description |
| :--- | :--- | :--- |
| **Moderator** | Neutral | The dungeon architect. Does not take a player seat. Observes all secret actions, ledger entries, and controls the flow of the ritual. |
| **Doctor** | Citizens | Protects one soul each night by completing a medicinal trial. If the Doctor protects themselves, a dawn announcement exposes the act. |
| **Detective** | Citizens | Receives an investigative clue each night. May choose to share the clue with a compatriot, silencing them (*Butterfly Effect*) for the next vote. |
| **Mafia** | Mafia | Conspire together to eliminate a townsperson each night. Must succeed in their trial; failing results in accidental suicide of a random member. May recruit when down a member. |
| **Citizen** | Citizens | Possess no innate supernatural powers, but carry the decisive vote at the Tribunal. May undertake optional night trials to earn a secret protective Shield. |

---

## 🛠️ Tech Stack

- **Runtime & Server**: [Node.js](https://nodejs.org/) & [Express 4](https://expressjs.com/)
- **Real-Time Networking**: [Socket.io 4](https://socket.io/)
- **Frontend**: Vanilla JavaScript (ES6+), Modern Semantic HTML5, CSS3 Custom Properties & Animations
- **Graphics & Visuals**: HTML5 2D Canvas (runic portal, particle physics, ambient embers)
- **Audio Engine**: Native Browser Web Audio API (real-time procedural audio synthesis)
- **Testing Framework**: [Jest 29](https://jestjs.io/)
- **ID Generation**: [UUID](https://github.com/uuidjs/uuid)

---

## 🏗️ Architecture Overview

```
Dungeon/
├── server/
│   ├── index.js          # Express app, HTTP server, and Socket.io event router
│   ├── gameManager.js    # Core game state machine, role allocation, night resolution & voting
│   └── trials.js         # Procedural trial generator & server-side answer validator
├── public/
│   ├── index.html        # Single-page application screen flow & structure
│   ├── css/
│   │   └── style.css     # Dark gothic UI, atmospheric animations, responsive layouts
│   └── js/
│       ├── app.js        # Main client controller & Socket.io event handling
│       ├── audio.js      # Web Audio procedural sound synthesizer
│       ├── portal.js     # Canvas-based swirling runic portal & ember particle system
│       └── trials.js     # Client-side UI renderers for Rune, Rhythm, and Scramble trials
├── tests/
│   └── game.test.js      # Comprehensive Jest test suite for all rules & edge cases
├── PLAYTEST.md           # Step-by-step 6-player and 12-player QA playtest checklist
├── package.json          # Project dependencies and script declarations
└── README.md             # Project documentation and guide
```

### Role Distribution Algorithm

The role pool scales dynamically based on the number of non-moderator players:

```javascript
const mafiaCount = Math.max(1, Math.floor(playerCount / 6));
const doctorCount = 1;
const detectiveCount = 1;
const citizenCount = playerCount - mafiaCount - 2;
```

- **5 players**: 1 Doctor, 1 Detective, 1 Mafia, 2 Citizens
- **6 players**: 1 Doctor, 1 Detective, 1 Mafia, 3 Citizens
- **12 players**: 1 Doctor, 1 Detective, 2 Mafia, 8 Citizens
- **18 players**: 1 Doctor, 1 Detective, 3 Mafia, 13 Citizens

---

## 🧪 Testing

The game logic is verified with an extensive, automated Jest suite covering role allocations, night resolution priority order, win conditions, voting edge cases, trial validation, chat sanitization, and input validation:

```bash
npm test
```

To run tests in watch mode:
```bash
npx jest --watch
```

---

## ⚙️ Environment Variables

You can configure the server using environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | The network port the HTTP & WebSocket server binds to. |
| `NODE_ENV` | `development` | Environment mode (`development` or `production`). |

Example:
```bash
PORT=8080 npm start
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
