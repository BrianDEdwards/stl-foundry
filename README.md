# STL By Night: Casefiles

A small Foundry VTT (v13/v14) module for the *St Louis By Night* Hunter: the Vigil chronicle. It works with any game system.

## Install

In Foundry: **Add-on Modules → Install Module**, paste this into **Manifest URL**, then enable it in your world:

```
https://github.com/BrianDEdwards/stl-foundry/releases/latest/download/module.json
```

## Evidence

- **Create:** as GM, click the magnifying glass in the Token or Tile scene controls. Pick a type (polaroid, lined scrap, plain scrap, book, email printout, text messages), add a title, an image, and front/back text. It lands in the middle of your view, slightly askew. If a token is selected, its portrait is pre-filled as the photo.
- **Emails:** the title is the subject. Each message in the chain gets its own From/To/Cc/Date/body block (**Add reply** for more); the printout shows the newest first with older ones quoted below.
- **Text messages:** the title is the contact. One row per message with a **Me/Them** toggle for the sender, plus optional time rows; rows can be moved or deleted. The back is the phone case with a sticky note.
- **Polaroids** take an optional date stamp; **books** take an author/subtitle. The editor only shows the fields each type uses. Evidence made before v0.5.0 converts itself when edited.
- **Flip:** anyone double-clicks a piece of evidence to flip it, on any layer.
- **Open:** shift + double-click opens a close-up window with Flip, Full image (the uncropped photo or cover) and a shared Notes box. Notes are written onto the back of the object in blue ink, so everyone sees them when it's flipped.
- **GM extras:** the window has Edit and Hide/Reveal. The tile HUD (right-click on the Tiles layer) has Flip and Open buttons. Double-click no longer opens the core tile settings for evidence; use Edit instead.
- **Evidence Locker:** the box button next to New Evidence. *File away* (in the close-up window or the tile HUD) takes a piece off the table and stores it with its text, images and players' notes. In the locker, the pin places it back on whatever scene you're viewing, hidden until you reveal it; the flame destroys it for good. Tick *Straight to the locker* when creating evidence to prep it ahead of time.
- Evidence is a normal Tile, so move, scale, rotate, lock and delete it as usual. Images are painted in the browser and saved to `Data/stl-evidence/`.
- Player flips and notes are applied by the GM's client, so a GM must be logged in.

## Initiative tracker

A strip on the left edge that mirrors the core combat tracker. The current turn sits at the bottom, the next one above it, and so on up the screen. At the start of a round that reads as ascending initiative. Click a combatant to pan to them. The GM gets previous/next turn, begin and roll-NPC buttons; a player whose turn it is gets End Turn. Its position and on/off switch are in **Configure Settings → Casefiles** (per player).

## Releasing

Bump `version` in `module.json` and push to the default branch. The workflow builds `module.zip` and publishes a GitHub release, and Foundry picks up the update.

## Testing

`node test/smoke.mjs` boots a real Foundry server in Docker, creates a scene, places every evidence type, double-clicks them (centre, corners, just outside, repeated), checks the flip animation, the locker and the tracker, and saves screenshots to `test/shots/`. Add `--keep` to leave Foundry running on port 30000.

It uses a **private** image built by the *Foundry test image* workflow (Actions tab → Run workflow, paste a timed Node.js download link from foundryvtt.com). That workflow needs the repo secret `FOUNDRY_LICENSE_KEY`; the test needs `GHCR_TOKEN`, a GitHub token with only `read:packages`. Re-run the workflow to move to a new Foundry version. Don't run tests while hosting a game: the license allows one server in use at a time.
