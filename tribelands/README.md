# Tribelands

A turn-based strategy game about castaway tribes on a volcanic island chain,
the Ember Isles. It is built on the bones of *The Battle of Polytopia* (explore,
grow camps, learn skills, conquer), with the rest made its own. One HTML file,
runs offline, saves on the device, and is tuned for a phone held in one hand.

## The tribes

| Tribe | Washes up knowing | Trait |
| --- | --- | --- |
| Tala | Foraging, coconut coast | *Coconut crackers*: coconuts cost 1 🐚 instead of 2 |
| Moku | Spearfishing, lagoons | *Lagoon born*: units wade through shallow water as if it were land |
| Vaka | Climbing, black basalt | *Cliff runners*: cliffs never stop their units |
| Nalu | Tracking, deep jungle | *Jungle ghosts*: jungle never stops them, and they defend +50% in it |

## Playing

- **Last tribe standing wins.** Take every rival camp. Lose your last camp and
  your tribe is voted off the islands.
- **Shells 🐚** arrive every day from your camps. Tap the counter for a breakdown.
- **Grow camps** by working the land in your borders: crack coconuts, hunt boar,
  spear fish, plant taro gardens, quarry obsidian, weave bamboo huts. A full camp
  levels up (Shelter, Camp, Village, Town, Haven) and you pick a reward:
  Toolmaker or Scout canoe, Palisade or Supply cache, Newcomers or Claim the
  cove, then a Tiki Titan or a Hammock grove.
- **Recruit castaways** from stranded SOS shacks to found new camps.
- **The skill web.** Twenty-one skills unlock by survival day (Day 1, Day 10,
  Day 30), and later skills need *two* earlier ones: Boar Taming needs Sprinting
  and Trailblazing; Gliding needs Weaving and Climbing. Picking a skill lights
  up what it needs and what it leads to.
- **Units:** Scrapper, Runner, Slinger, Shieldbearer, Healer (heals everyone
  around), Schemer (sways an adjacent rival to your side), Obsidian Blade,
  Glider (flies over sea, cliffs and enemy lines), Coconut Catapult, Boar Rider
  and Tiki Titan, plus Rafts and War Canoes from raft docks.
- **Island buildings:** signal fires on cliffs (see far, earn from passing
  traders), trading posts (earn from the gardens, quarries, huts and docks beside
  them), machete trails (half-cost moves).
- **Landmarks:** Lighthouse, Stone Totems, Floating Market, Sacred Spring and
  Fire Throne. One of each in the islands; take the camp and you take the landmark.
- **Hidden immunity idols** 🗿 turn up in shipwrecks and challenges. When a
  rival would take one of your camps, an idol is played for you: the capture
  fails and the raider is voted off the island. Rivals hold them too.
- **Reward and immunity challenges.** Every so often a flag goes up somewhere
  fair to every tribe. The first unit to reach it wins shells or an idol.
- **Alliances.** Pay a rival for 8 turns of truce; a losing tribe may offer one.
- **The island stirs:** supply drops, rainy seasons, tropical storms, boar
  stampedes, castaways washing ashore, full moons and eruptions of the volcano
  at the heart of the map.

## Made for the phone

- Big text and big buttons; every action says what it does, what it costs, and
  why it can't be pressed.
- The selection glows, pulses, and has a bouncing marker over it. The panel is
  edged in the colour of what you picked and labelled *Selected unit / tile / camp*.
- Units that can still act wear a green ring. **▶ Next** hops to each in turn;
  **End turn** nudges you when everyone is done.
- Undo, Next and End turn float just above the panel, in thumb reach. The map
  glides out from under the panel when you select something near the bottom.
- A light vibration on taps, moves and hits (switch it off in Settings).
- Autosave after every action; **Undo** names what it will undo.

The version number (Menu → Settings, and on the title screen) matches the pull
request that last changed the game.

## Files

| | |
| --- | --- |
| `src/core.js` | Rules, map generation, the computer tribes, saving. No DOM. |
| `src/ui.js` | Drawing the islands, touch input, selection and the camera. |
| `src/panels.js` | The HUD, floating buttons, bottom panel and every sheet. |
| `src/style.css`, `src/body.html` | The page around the map. |
| `build.py` | Stitches `src/` into the self-contained `index.html`. |
| `make-icons.py` | Draws the home-screen icons. |
| `test/core.test.js` | `node test/core.test.js [games]`. Plays whole computer-only games, checks the rules hold every turn, and reports which landmarks, units, idols and challenges got used. |
| `test/ui_test.py` | `python3 test/ui_test.py`. Drives the built game in Chromium at phone size, and fails on any console error. |

After editing anything in `src/`, run `python3 build.py`.
