/**
 * STL By Night: Casefiles
 * Evidence objects (polaroids, scraps, books) built on core Tiles, plus a left-edge initiative tracker.
 * System agnostic: only core documents (Tile, Combat, Combatant) are used.
 */

const MOD = "stl-foundry";
const SOCKET = `module.${MOD}`;
const UPLOAD_DIR = "stl-evidence";
const PAD = 14; // transparent margin around each painted image, room for the drop shadow

const TYPES = {
  polaroid: { label: "Polaroid", size: [420, 500] },
  lined: { label: "Lined scrap", size: [460, 360] },
  plain: { label: "Plain scrap", size: [440, 340] },
  book: { label: "Book", size: [380, 500] }
};

const FONT = {
  hand: "'Caveat', 'Segoe Print', cursive",
  type: "'Special Elite', 'Courier New', monospace",
  serif: "'IM Fell English', Georgia, serif"
};
const NOTE_INK = "#1f2d5c";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const getEvidence = tile => tile?.getFlag?.(MOD, "evidence") ?? tile?.flags?.[MOD]?.evidence;
const FilePickerImpl = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

/* -------------------------------------------- */
/*  Painting                                    */
/* -------------------------------------------- */

/** Small seeded PRNG so torn edges and stains stay the same when a card is re-painted. */
function rng(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

let fontsReady;
function loadFonts() {
  fontsReady ??= Promise.all(
    ["700 34px Caveat", "500 28px Caveat", "22px 'Special Elite'", "40px 'IM Fell English'", "italic 22px 'IM Fell English'"]
      .map(f => document.fonts.load(f).catch(() => null))
  );
  return fontsReady;
}

/** Writes wrapped text, honouring line breaks. Returns the next baseline. */
function wrap(ctx, text, x, y, maxW, lh, maxY, align = "left") {
  ctx.textAlign = align;
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) {
        if (y > maxY) return y;
        ctx.fillText(line, x, y);
        y += lh;
        line = word;
      } else line = test;
    }
    if (y > maxY) return y;
    ctx.fillText(line, x, y);
    y += lh;
  }
  return y;
}

/** Paper with ragged edges, a drop shadow, grain and aged edges. Leaves the paper shape clipped. */
function paper(ctx, w, h, color, r, jag) {
  const pts = [];
  const edge = (x0, y0, x1, y1, amp) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 9));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const nx = -(y1 - y0), ny = x1 - x0, len = Math.hypot(nx, ny);
      const off = (r() - 0.5) * amp;
      pts.push([x0 + (x1 - x0) * t + (nx / len) * off, y0 + (y1 - y0) * t + (ny / len) * off]);
    }
  };
  edge(0, 0, w, 0, jag * 2);
  edge(w, 0, w, h, jag);
  edge(w, h, 0, h, jag);
  edge(0, h, 0, 0, jag);
  const path = new Path2D();
  pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
  ctx.clip(path);

  for (let i = 0; i < (w * h) / 60; i++) {
    ctx.fillStyle = `rgba(60,40,20,${r() * 0.05})`;
    ctx.fillRect(r() * w, r() * h, 1.5, 1.5);
  }
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, "rgba(90,60,20,0)");
  g.addColorStop(1, "rgba(90,60,20,0.28)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function coffeeRing(ctx, x, y, rad) {
  ctx.save();
  ctx.strokeStyle = "rgba(110,70,30,0.16)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0.3, Math.PI * 1.85);
  ctx.stroke();
  ctx.restore();
}

/** Body text for a side, then the players' notes in a different ink on the back. */
function writeBody(ctx, ev, side, { x, y, maxW, maxY, font, lh, ink }) {
  ctx.font = font;
  ctx.fillStyle = ink;
  y = wrap(ctx, side === "front" ? ev.front : ev.back, x, y, maxW, lh, maxY);
  if (side === "back" && ev.notes?.trim()) {
    ctx.font = `500 ${Math.round(lh * 0.95)}px ${FONT.hand}`;
    ctx.fillStyle = NOTE_INK;
    wrap(ctx, ev.notes, x, y + lh * 0.4, maxW, lh, maxY);
  }
}

function drawCover(ctx, img, x, y, w, h, filter) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  ctx.save();
  ctx.filter = filter;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}

const PAINTERS = {
  async polaroid(ctx, ev, side, w, h, r) {
    paper(ctx, w, h, side === "front" ? "#f2efe6" : "#e4dfd1", r, 0.6);
    if (side === "front") {
      const s = w - 48;
      ctx.fillStyle = "#111";
      ctx.fillRect(24, 24, s, s);
      const img = await loadImage(ev.image);
      if (img) drawCover(ctx, img, 24, 24, s, s, "sepia(0.3) saturate(0.75) contrast(1.1) brightness(0.9)");
      const v = ctx.createRadialGradient(24 + s / 2, 24 + s / 2, s * 0.3, 24 + s / 2, 24 + s / 2, s * 0.75);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = v;
      ctx.fillRect(24, 24, s, s);
      ctx.font = `700 40px ${FONT.hand}`;
      ctx.fillStyle = "#1d1b19";
      wrap(ctx, ev.title, w / 2, s + 24 + 58, w - 40, 40, h - 10, "center");
    } else {
      ctx.font = `700 30px ${FONT.hand}`;
      ctx.fillStyle = "#3a3530";
      wrap(ctx, ev.title, 30, 48, w - 60, 32, 60);
      writeBody(ctx, ev, side, { x: 30, y: 96, maxW: w - 60, maxY: h - 20, font: `500 28px ${FONT.hand}`, lh: 30, ink: "#26221e" });
    }
  },

  async lined(ctx, ev, side, w, h, r) {
    paper(ctx, w, h, "#f4f1e4", r, 3);
    ctx.strokeStyle = "rgba(70,110,170,0.35)";
    ctx.lineWidth = 1;
    for (let y = 90; y < h - 8; y += 30) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(190,60,60,0.45)";
    ctx.beginPath(); ctx.moveTo(50, 0); ctx.lineTo(50, h); ctx.stroke();
    if (side === "front") {
      ctx.font = `700 34px ${FONT.hand}`;
      ctx.fillStyle = "#1c1a24";
      wrap(ctx, ev.title, 62, 56, w - 80, 34, 60);
    }
    writeBody(ctx, ev, side, { x: 62, y: 86, maxW: w - 80, maxY: h - 12, font: `500 28px ${FONT.hand}`, lh: 30, ink: "#1c1a24" });
  },

  async plain(ctx, ev, side, w, h, r) {
    paper(ctx, w, h, "#e9dfc6", r, 2.5);
    coffeeRing(ctx, w * (0.55 + r() * 0.35), h * (0.55 + r() * 0.35), 34 + r() * 18);
    let y = 52;
    if (side === "front" && ev.title) {
      ctx.font = `24px ${FONT.type}`;
      ctx.fillStyle = "#2a2622";
      y = wrap(ctx, ev.title.toUpperCase(), 30, y, w - 60, 28, 90) + 10;
    }
    writeBody(ctx, ev, side, { x: 30, y, maxW: w - 60, maxY: h - 16, font: `20px ${FONT.type}`, lh: 27, ink: "#2a2622" });
  },

  async book(ctx, ev, side, w, h, r) {
    if (side === "back") {
      paper(ctx, w, h, "#efe6cf", r, 0.4);
      const gutter = ctx.createLinearGradient(0, 0, 40, 0);
      gutter.addColorStop(0, "rgba(60,40,20,0.4)");
      gutter.addColorStop(1, "rgba(60,40,20,0)");
      ctx.fillStyle = gutter;
      ctx.fillRect(0, 0, 40, h);
      ctx.font = `italic 20px ${FONT.serif}`;
      ctx.fillStyle = "#5a4a38";
      wrap(ctx, ev.title, w / 2, 40, w - 80, 22, 50, "center");
      writeBody(ctx, ev, side, { x: 44, y: 84, maxW: w - 80, maxY: h - 24, font: `21px ${FONT.serif}`, lh: 28, ink: "#2b2218" });
      return;
    }
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    const leather = ctx.createLinearGradient(0, 0, w, h);
    leather.addColorStop(0, "#3d2820");
    leather.addColorStop(1, "#1f130d");
    ctx.fillStyle = leather;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, [4, 10, 10, 4]);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, 26, h);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(255,230,200,${r() * 0.06})`;
      ctx.beginPath();
      const x = r() * w, y = r() * h;
      ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 20); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(196,160,90,0.7)";
    ctx.lineWidth = 2;
    ctx.strokeRect(44, 24, w - 68, h - 48);
    let y = h * 0.42;
    const img = await loadImage(ev.image);
    if (img) {
      drawCover(ctx, img, 74, 60, w - 128, 180, "sepia(0.6) contrast(1.1) brightness(0.85)");
      ctx.strokeRect(74, 60, w - 128, 180);
      y = 300;
    }
    ctx.font = `40px ${FONT.serif}`;
    ctx.fillStyle = "#c9a45c";
    y = wrap(ctx, ev.title, w / 2 + 10, y, w - 110, 44, h - 90, "center");
    ctx.font = `italic 22px ${FONT.serif}`;
    wrap(ctx, ev.front, w / 2 + 10, y + 8, w - 110, 26, h - 40, "center");
  }
};

async function paint(ev, side) {
  const [w, h] = TYPES[ev.type].size;
  const c = document.createElement("canvas");
  c.width = w + PAD * 2;
  c.height = h + PAD * 2;
  const ctx = c.getContext("2d");
  ctx.translate(PAD, PAD);
  ctx.textBaseline = "alphabetic";
  await PAINTERS[ev.type](ctx, ev, side, w, h, rng(ev.id + side));
  return c;
}

async function upload(canvasEl, name) {
  const FP = FilePickerImpl();
  const blob = await new Promise(res => canvasEl.toBlob(res, "image/webp", 0.9));
  const file = new File([blob], `${name}.webp`, { type: "image/webp" });
  try { await FP.createDirectory("data", UPLOAD_DIR); } catch {} // already exists
  const res = await FP.upload("data", UPLOAD_DIR, file, {}, { notify: false });
  return res?.path ?? `${UPLOAD_DIR}/${file.name}`;
}

/** Paints both sides and uploads them. Each paint gets a new file name so clients don't show a cached image. */
async function paintSides(ev, sides = ["front", "back"]) {
  await loadFonts();
  const stamp = Date.now().toString(36);
  const out = {};
  for (const side of sides) out[`${side}Src`] = await upload(await paint(ev, side), `${ev.id}-${side}-${stamp}`);
  return out;
}

/* -------------------------------------------- */
/*  Evidence actions                            */
/* -------------------------------------------- */

const Evidence = {
  async create(data) {
    const scene = canvas.scene;
    if (!scene) return ui.notifications.warn("Open a scene first.");
    const ev = { id: foundry.utils.randomID(), type: data.type, title: data.title, image: data.image,
      front: data.front, back: data.back, notes: "", flipped: false, links: [] };
    Object.assign(ev, await paintSides(ev));
    const [w, h] = TYPES[ev.type].size;
    const k = (canvas.dimensions.size / 100) * 0.5;
    const { x, y } = canvas.stage.pivot;
    const tiles = scene.tiles.contents;
    await scene.createEmbeddedDocuments("Tile", [{
      texture: { src: ev.frontSrc },
      width: Math.round((w + PAD * 2) * k),
      height: Math.round((h + PAD * 2) * k),
      x: Math.round(x - ((w + PAD * 2) * k) / 2),
      y: Math.round(y - ((h + PAD * 2) * k) / 2),
      rotation: Math.round((Math.random() - 0.5) * 12),
      sort: Math.max(0, ...tiles.map(t => t.sort ?? 0)) + 1,
      hidden: !!data.hidden,
      flags: { [MOD]: { evidence: ev } }
    }]);
  },

  async edit(tile, data) {
    const ev = { ...getEvidence(tile), ...data };
    Object.assign(ev, await paintSides(ev));
    await tile.update({ hidden: !!data.hidden, "texture.src": ev.flipped ? ev.backSrc : ev.frontSrc, [`flags.${MOD}.evidence`]: ev });
  },

  async flip(tile) {
    const ev = getEvidence(tile);
    const flipped = !ev.flipped;
    await tile.update({ "texture.src": flipped ? ev.backSrc : ev.frontSrc, [`flags.${MOD}.evidence.flipped`]: flipped });
  },

  async notes(tile, notes) {
    const ev = { ...getEvidence(tile), notes };
    const { backSrc } = await paintSides(ev, ["back"]);
    const update = { [`flags.${MOD}.evidence.notes`]: notes, [`flags.${MOD}.evidence.backSrc`]: backSrc };
    if (ev.flipped) update["texture.src"] = backSrc;
    await tile.update(update);
  },

  /** Players can't update tiles, so their requests go over the socket to the active GM. */
  request(action, tile, ...args) {
    if (game.user.isGM) return this[action](tile, ...args);
    if (!game.users.activeGM) return ui.notifications.warn("A GM needs to be online to change evidence.");
    game.socket.emit(SOCKET, { action, sceneId: tile.parent.id, tileId: tile.id, args });
  },

  onSocket({ action, sceneId, tileId, args }) {
    if (!game.users.activeGM?.isSelf || !["flip", "notes"].includes(action)) return;
    const tile = game.scenes.get(sceneId)?.tiles.get(tileId);
    if (getEvidence(tile)) Evidence[action](tile, ...(args ?? []));
  },

  /** Topmost visible evidence tile under a canvas point, respecting tile rotation. */
  at(point) {
    const hits = (canvas.scene?.tiles ?? []).filter(t => {
      if (!getEvidence(t) || (t.hidden && !game.user.isGM) || t.object?.visible === false) return false;
      const cx = t.x + t.width / 2, cy = t.y + t.height / 2;
      const a = -Math.toRadians(t.rotation ?? 0);
      const dx = point.x - cx, dy = point.y - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      return Math.abs(lx) <= Math.abs(t.width) / 2 && Math.abs(ly) <= Math.abs(t.height) / 2;
    });
    return hits.sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0) || (b.sort ?? 0) - (a.sort ?? 0))[0];
  }
};

/* -------------------------------------------- */
/*  Applications                                */
/* -------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

/** Create or edit an evidence object (GM). */
class EvidenceEditor extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["stl-casefile", "stl-editor"],
    window: { title: "New Evidence", icon: "fa-solid fa-magnifying-glass" },
    position: { width: 440, height: "auto" },
    form: { handler: EvidenceEditor.onSubmit, closeOnSubmit: true },
    actions: { pick: EvidenceEditor.onPick }
  };

  constructor(tile, options = {}) {
    super(options);
    this.tile = tile ?? null;
  }

  get title() {
    return this.tile ? `Edit Evidence: ${getEvidence(this.tile).title || "Untitled"}` : "New Evidence";
  }

  async _renderHTML() {
    const ev = getEvidence(this.tile) ?? {
      type: "polaroid",
      image: canvas.tokens?.controlled[0]?.actor?.img ?? canvas.tokens?.controlled[0]?.document.texture.src ?? ""
    };
    const types = Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === ev.type ? "selected" : ""}>${t.label}</option>`).join("");
    return `
      <div class="form-group"><label>Type</label><select name="type">${types}</select></div>
      <div class="form-group"><label>Title</label><input type="text" name="title" value="${esc(ev.title)}" placeholder="Caption, heading or book title"></div>
      <div class="form-group"><label>Image</label><div class="form-fields">
        <input type="text" name="image" value="${esc(ev.image)}" placeholder="Polaroid photo or book cover">
        <button type="button" data-action="pick" data-tooltip="Browse"><i class="fa-solid fa-file-image"></i></button>
      </div></div>
      <div class="form-group stacked"><label>Front</label><textarea name="front" rows="4">${esc(ev.front)}</textarea></div>
      <div class="form-group stacked"><label>Back</label><textarea name="back" rows="4">${esc(ev.back)}</textarea></div>
      <div class="form-group"><label>Hidden from players</label><input type="checkbox" name="hidden" ${this.tile?.hidden ? "checked" : ""}></div>
      <footer class="form-footer"><button type="submit"><i class="fa-solid fa-thumbtack"></i> ${this.tile ? "Update" : "Place on scene"}</button></footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static onPick(event, target) {
    const input = target.closest(".form-fields").querySelector("input");
    new (FilePickerImpl())({ type: "image", current: input.value, callback: path => (input.value = path) }).render(true);
  }

  static async onSubmit(event, form, formData) {
    const data = formData.object;
    data.hidden = !!data.hidden;
    ui.notifications.info("Developing evidence…");
    if (this.tile) await Evidence.edit(this.tile, data);
    else await Evidence.create(data);
  }
}

/** Close-up of one evidence object, with shared notes anyone can write. */
class EvidenceSheet extends ApplicationV2 {
  static instances = new Map();

  static DEFAULT_OPTIONS = {
    classes: ["stl-casefile", "stl-sheet"],
    window: { icon: "fa-solid fa-magnifying-glass", resizable: true },
    position: { width: 480, height: "auto" },
    actions: {
      flip: EvidenceSheet.onFlip,
      save: EvidenceSheet.onSave,
      edit: EvidenceSheet.onEdit,
      reveal: EvidenceSheet.onReveal
    }
  };

  static open(tile) {
    const app = this.instances.get(tile.uuid) ?? new this(tile);
    this.instances.set(tile.uuid, app);
    return app.render({ force: true });
  }

  constructor(tile, options = {}) {
    super({ id: `stl-evidence-${tile.id}`, ...options });
    this.tile = tile;
  }

  get title() {
    return getEvidence(this.tile)?.title || TYPES[getEvidence(this.tile)?.type]?.label || "Evidence";
  }

  async _renderHTML() {
    const ev = getEvidence(this.tile);
    const gm = game.user.isGM;
    const draft = this.element?.querySelector("textarea[name=notes]");
    // Keep unsaved typing when someone else's change re-renders the window
    const notes = draft && draft.value !== this._savedNotes ? draft.value : ev.notes;
    this._savedNotes = ev.notes;
    return `
      <figure class="stl-ev-image ${ev.flipped ? "flipped" : ""}"><img src="${esc(ev.flipped ? ev.backSrc : ev.frontSrc)}" alt=""></figure>
      ${ev.front ? `<section><h4>Front</h4><p>${esc(ev.front).replace(/\n/g, "<br>")}</p></section>` : ""}
      ${ev.back ? `<section><h4>Back</h4><p>${esc(ev.back).replace(/\n/g, "<br>")}</p></section>` : ""}
      <section><h4>Notes <small>(written on the back, everyone can edit)</small></h4>
        <textarea name="notes" rows="4" placeholder="Scribble something…">${esc(notes)}</textarea></section>
      <footer class="stl-ev-buttons">
        <button type="button" data-action="flip"><i class="fa-solid fa-rotate"></i> Flip</button>
        <button type="button" data-action="save"><i class="fa-solid fa-pen-nib"></i> Save notes</button>
        ${gm ? `<button type="button" data-action="edit"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
        <button type="button" data-action="reveal"><i class="fa-solid ${this.tile.hidden ? "fa-eye" : "fa-eye-slash"}"></i> ${this.tile.hidden ? "Reveal" : "Hide"}</button>` : ""}
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onClose(options) {
    EvidenceSheet.instances.delete(this.tile.uuid);
    super._onClose?.(options);
  }

  static onFlip() {
    Evidence.request("flip", this.tile);
  }

  static onSave() {
    const notes = this.element.querySelector("textarea[name=notes]").value;
    this._savedNotes = notes;
    Evidence.request("notes", this.tile, notes);
    ui.notifications.info("Notes saved.");
  }

  static onEdit() {
    new EvidenceEditor(this.tile).render({ force: true });
  }

  static onReveal() {
    this.tile.update({ hidden: !this.tile.hidden });
  }
}

/* -------------------------------------------- */
/*  Initiative tracker                          */
/* -------------------------------------------- */

/**
 * Reads the core combat tracker and stacks it on the left edge.
 * The current turn sits at the bottom, the next one above it, and so on up to whoever acts last.
 * At the top of a round that is simply ascending initiative.
 */
const Tracker = {
  el: null,

  draw() {
    if (!this.el) {
      this.el = document.createElement("aside");
      this.el.id = "stl-initiative";
      this.el.addEventListener("click", ev => this.onClick(ev));
      document.body.append(this.el);
    }
    const combat = game.combat;
    const turns = combat?.turns ?? [];
    if (!game.settings.get(MOD, "tracker") || !turns.length) {
      this.el.classList.remove("open");
      return;
    }
    this.el.style.left = `${game.settings.get(MOD, "trackerLeft")}px`;
    this.el.style.bottom = `${game.settings.get(MOD, "trackerBottom")}px`;

    const cur = combat.started ? (combat.turn ?? 0) : 0;
    const queue = [...turns.slice(cur), ...turns.slice(0, cur)].filter(c => c.visible).reverse();
    const current = combat.started ? combat.combatant : null;
    const entries = queue.map(c => {
      const cls = [c === current && "active", c.isDefeated && "defeated", c.hidden && "hidden", c.isOwner && "owned"].filter(Boolean).join(" ");
      const init = c.initiative ?? (c.isOwner ? `<a data-act="roll" data-tooltip="Roll initiative"><i class="fa-solid fa-dice-d10"></i></a>` : "–");
      return `<li class="${cls}" data-id="${c.id}" data-act="pan">
        <img src="${esc(c.token?.texture?.src ?? c.img)}" alt="">
        <span class="name">${esc(c.name)}</span>
        <span class="init">${typeof init === "number" ? Math.round(init * 100) / 100 : init}</span>
      </li>`;
    }).join("");

    const btn = (act, icon, tip) => `<a data-act="${act}" data-tooltip="${tip}"><i class="fa-solid ${icon}"></i></a>`;
    let controls = "";
    if (game.user.isGM) {
      if (turns.some(c => c.isNPC && c.initiative === null)) controls += btn("rollNPC", "fa-users", "Roll NPCs");
      controls += combat.started
        ? btn("prev", "fa-caret-up", "Previous turn") + btn("next", "fa-caret-down", "Next turn")
        : btn("begin", "fa-skull", "Begin encounter");
    } else if (current?.isOwner) controls += btn("next", "fa-check", "End my turn");

    this.el.innerHTML = `
      <ol>${entries}</ol>
      <div class="stl-init-footer"><span>${combat.started ? `Round ${combat.round}` : "Not started"}</span>${controls}</div>`;
    this.el.classList.add("open");
  },

  async onClick(event) {
    const target = event.target.closest("[data-act]");
    const combat = game.combat;
    if (!target || !combat) return;
    const c = combat.combatants.get(target.closest("li")?.dataset.id);
    switch (target.dataset.act) {
      case "roll": event.stopPropagation(); return combat.rollInitiative([c.id]);
      case "rollNPC": return combat.rollNPC();
      case "begin": return combat.startCombat();
      case "prev": return combat.previousTurn();
      case "next": return combat.nextTurn();
      case "pan": {
        const token = c?.token?.object;
        if (!token?.visible) return;
        if (token.isOwner) token.control({ releaseOthers: true });
        return canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
      }
    }
  }
};

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const redraw = () => Tracker.draw();
  game.settings.register(MOD, "tracker", { name: "Left-edge initiative tracker", hint: "Show the casefile initiative tracker on the left side of the screen.", scope: "client", config: true, type: Boolean, default: true, onChange: redraw });
  game.settings.register(MOD, "trackerLeft", { name: "Initiative tracker: left offset (px)", hint: "Distance from the left edge, to clear the scene controls.", scope: "client", config: true, type: Number, default: 80, onChange: redraw });
  game.settings.register(MOD, "trackerBottom", { name: "Initiative tracker: bottom offset (px)", hint: "Distance from the bottom edge, to clear the players list.", scope: "client", config: true, type: Number, default: 120, onChange: redraw });
  globalThis.STLCasefiles = { Evidence, EvidenceEditor, EvidenceSheet, Tracker, TYPES };
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, msg => Evidence.onSocket(msg));
  loadFonts();
  Tracker.draw();

  // Double-click evidence to open it (shift + double-click flips it). GMs on the Tiles layer keep the core behaviour.
  document.addEventListener("dblclick", event => {
    if (event.target?.id !== "board" || !canvas.ready || canvas.tiles?.active) return;
    const client = { x: event.clientX, y: event.clientY };
    const point = canvas.canvasCoordinatesFromClient?.(client) ?? canvas.stage.worldTransform.applyInverse(client);
    const tile = Evidence.at(point);
    if (!tile) return;
    if (event.shiftKey) Evidence.request("flip", tile);
    else EvidenceSheet.open(tile);
  });
});

const debouncedDraw = foundry.utils.debounce(() => Tracker.draw(), 50);
for (const hook of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant", "combatStart", "combatTurnChange", "canvasReady"]) {
  Hooks.on(hook, debouncedDraw);
}

Hooks.on("updateTile", tile => {
  if (getEvidence(tile)) EvidenceSheet.instances.get(tile.uuid)?.render();
});
Hooks.on("deleteTile", tile => EvidenceSheet.instances.get(tile.uuid)?.close());

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  const tool = {
    name: "stl-evidence",
    title: "New Evidence",
    icon: "fa-solid fa-magnifying-glass",
    button: true,
    order: 100,
    visible: true,
    onChange: () => new EvidenceEditor().render({ force: true })
  };
  if (Array.isArray(controls)) {
    for (const name of ["tiles", "token"]) controls.find(c => c.name === name)?.tools.push({ ...tool, onClick: tool.onChange });
  } else {
    for (const name of ["tiles", "tokens"]) if (controls[name]) controls[name].tools[tool.name] = tool;
  }
});

// Tile HUD buttons so the GM can flip or open evidence while working on the Tiles layer.
Hooks.on("renderTileHUD", (hud, html) => {
  const tile = hud.object?.document;
  if (!getEvidence(tile)) return;
  const root = html instanceof HTMLElement ? html : html[0];
  const col = root.querySelector(".col.right") ?? root;
  for (const [icon, tip, fn] of [["fa-rotate", "Flip evidence", () => Evidence.flip(tile)], ["fa-magnifying-glass", "Open evidence", () => EvidenceSheet.open(tile)]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "control-icon";
    b.dataset.tooltip = tip;
    b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); fn(); });
    col.append(b);
  }
});
