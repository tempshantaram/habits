# Tribelands

A turn-based strategy game in the spirit of *The Battle of Polytopia*: a small
square world seen from above at an angle, low-poly and colourful, where four
tribes race to explore, grow and conquer. One HTML file, runs offline, saves on
the device.

## Playing

- **Domination.** Take every rival city. Lose your last city and your tribe falls.
- **Four tribes, each bending one rule.**

  | Tribe | Start | Trait |
  | --- | --- | --- |
  | Aurel | Organization, golden meadows | *Orchard keepers*: fruit costs 1 ★ instead of 2 |
  | Kiro | Climbing, peaks and ore | *Mountain born*: mountains never stop their units |
  | Thane | Hunting, pine forest | *Forest stalkers*: forests never stop them, and always give +50% defence |
  | Sandari | Riding and a Rider, savanna | *Horse lords*: Riders and Knights move one tile further |

- **Stars.** Cities pay stars every turn. Tap the ★ counter for a line-by-line breakdown.
- **Cities grow.** Gather, hunt, fish, farm, mine or build lumber huts and ports inside
  your borders. Fill the growth dots and the city levels up, and you pick a reward:
  workshop or explorer, walls or resources, population or wider borders, then a
  Giant or a park.
- **Twenty technologies in five branches.** Each tech lists exactly what it unlocks.
- **Roads.** A move from road to road costs half a step. Cities count as roads.
- **Markets.** They earn +1 ★ every turn for each farm, mine, lumber hut or port
  beside them (up to 4).
- **Wonders.** Five of them, one of each per world: Sky Observatory, Great Wall,
  Grand Bazaar, Tree of Life and Hall of Heroes. Whoever holds the city holds the
  wonder, so capturing it steals it.
- **Units.** Warrior, Rider, Archer, Defender, Swordsman, Catapult, Knight and Giant,
  plus three that break the usual rules:
  - the **Envoy** converts an adjacent enemy instead of fighting it;
  - the **Shaman** heals every friendly unit around it;
  - the **Eagle Rider** flies over water, mountains and enemy lines.

  Boats and Warships come from ports. Combat uses Polytopia's formula, and the
  attack label shows the damage you deal and the damage you take back (↩).
- **Diplomacy.** Pay a rival for an 8-turn truce; weaker tribes accept more readily.
  A tribe that is losing may ask *you* for peace, with a gift.
- **World events.** Every few turns something happens to every tribe alike:
  bountiful seasons, gold, fever, migrants who found new villages, returning herds,
  or a comet that lights up the unknown.
- **The Tribes screen** shows every rival's trait, strength and status, plus a
  chronicle of captures, wonders, truces and events.
- **Clear buttons.** Every action says what it does and what it costs. When it
  can't be pressed, it says why ("Need 2 more ★", "Research Hunting").
- **Undo** names what it will undo. It takes back moves, training, research and
  building, until something new is revealed or a fight happens.
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
| `test/core.test.js` | `node test/core.test.js [games]`. Plays whole computer-only games, checks the rules hold every turn, and reports which wonders, units and systems got used. |
| `test/ui_test.py` | `python3 test/ui_test.py`. Drives the built game in Chromium at phone size, and fails on any console error. |

After editing anything in `src/`, run `python3 build.py`.
