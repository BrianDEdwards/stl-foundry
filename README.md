# STL By Night: Casefiles

A small Foundry VTT (v13/v14) module for the *St Louis By Night* Hunter: the Vigil chronicle. It works with any game system.

## Install

In Foundry: **Add-on Modules → Install Module**, paste this into **Manifest URL**, then enable it in your world:

```
https://github.com/BrianDEdwards/stl-foundry/releases/latest/download/module.json
```

## Evidence

- **Create:** as GM, click the magnifying glass in the Token or Tile scene controls. Pick a type (polaroid, lined scrap, plain scrap, book, email printout, text messages), add a title, an image, and front/back text. It lands in the middle of your view, slightly askew. If a token is selected, its portrait is pre-filled as the photo.
- **Emails:** start the Front text with `From:`, `To:` and `Date:` lines; the title is the subject.
- **Text messages:** one message per line in Front, starting with `>` for messages the phone's owner sent; the title is the contact. The back is the phone case with a sticky note.
- **Flip:** anyone double-clicks a piece of evidence to flip it, on any layer.
- **Open:** shift + double-click opens a close-up window with Flip and a shared Notes box. Notes are written onto the back of the object in blue ink, so everyone sees them when it's flipped.
- **GM extras:** the window has Edit and Hide/Reveal. The tile HUD (right-click on the Tiles layer) has Flip and Open buttons. Double-click no longer opens the core tile settings for evidence; use Edit instead.
- **Evidence Locker:** the box button next to New Evidence. *File away* (in the close-up window or the tile HUD) takes a piece off the table and stores it with its text, images and players' notes. In the locker, the pin places it back on whatever scene you're viewing, hidden until you reveal it; the flame destroys it for good. Tick *Straight to the locker* when creating evidence to prep it ahead of time.
- Evidence is a normal Tile, so move, scale, rotate, lock and delete it as usual. Images are painted in the browser and saved to `Data/stl-evidence/`.
- Player flips and notes are applied by the GM's client, so a GM must be logged in.

## Initiative tracker

A strip on the left edge that mirrors the core combat tracker. The current turn sits at the bottom, the next one above it, and so on up the screen. At the start of a round that reads as ascending initiative. Click a combatant to pan to them. The GM gets previous/next turn, begin and roll-NPC buttons; a player whose turn it is gets End Turn. Its position and on/off switch are in **Configure Settings → Casefiles** (per player).

## Releasing

Bump `version` in `module.json` and push to the default branch. The workflow builds `module.zip` and publishes a GitHub release, and Foundry picks up the update.
