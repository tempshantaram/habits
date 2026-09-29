# Tribelands

A turn-based strategy game in the spirit of *The Battle of Polytopia*: a small
square world seen from above at an angle, low-poly and colourful, where four
tribes race to explore, grow and conquer. One HTML file, runs offline, saves on
the device.

## Playing

- **Domination.** Take every rival city. Lose your last city and your tribe falls.
- **Four tribes, four starts.** Each has its own colour, look, landscape and first
  technology: **Aurel** (Organization, golden meadows full of fruit), **Kiro**
  (Climbing, mountains and ore), **Thane** (Hunting, deep pine forest) and
  **Sandari** (Riding, open savanna; starts with a Rider).
- **Stars.** Every city pays stars each turn. Spend them on technology, on working
  the land, and on units.
- **Cities grow.** Gather fruit, hunt, fish, farm, mine or build lumber huts and
  ports inside your borders. Fill a city's growth dots and it levels up, and you
  choose a reward: workshop or explorer, walls or resources, population or wider
  borders, then a Giant or a park.
- **Villages.** Walk a unit onto one; on your next turn it can capture it as a new
  city.
- **Tech tree.** Fifteen technologies in five branches. Costs rise with every city
  you own.
- **Units.** Warrior, Rider, Archer, Defender, Swordsman, Catapult, Knight and
  Giant, plus Boats and Warships. Walk a unit into your port and it becomes a boat.
  Combat uses Polytopia's rules: damage from attack against defence, both scaled by
  remaining health. Survivors strike back. Cities, walls, forests and mountains
  help the defender. Three kills make a veteran.
- **Fog.** The map starts hidden. Ruins hold stars, technology, allies or maps.
- **Undo** takes back moves, training, research and work, until something new is
  revealed or a fight happens.
- **Autosave.** Close it mid-game and *Continue* picks up where you left off.
- Three map sizes, one to three computer rivals, easy, normal or hard.

The version number (Menu → Settings, and on the title screen) matches the pull
request that last changed the game.

## Files

| | |
| --- | --- |
| `src/core.js` | Rules, map generation, the computer tribes, saving. No DOM. |
| `src/ui.js` | Drawing the map, touch and mouse input, the panels and sheets. |
| `src/style.css`, `src/body.html` | The page around the map. |
| `build.py` | Stitches `src/` into the self-contained `index.html`. |
| `make-icons.py` | Draws the home-screen icons. |
| `test/core.test.js` | `node test/core.test.js [games]`. Plays whole computer-only games and checks the rules hold every turn. |
| `test/ui_test.py` | `python3 test/ui_test.py`. Drives the built game in Chromium at phone size, and fails on any console error. |

After editing anything in `src/`, run `python3 build.py`.
