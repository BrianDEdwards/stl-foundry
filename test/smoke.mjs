#!/usr/bin/env node
/**
 * Casefiles smoke test against a real Foundry server running in Docker.
 *   node test/smoke.mjs          boot Foundry, run the checks, save screenshots to test/shots/, stop Foundry
 *   node test/smoke.mjs --keep   leave Foundry running on http://localhost:30000 for poking at afterwards
 * Needs: Docker, Playwright + Chromium, the private image from .github/workflows/foundry-image.yml,
 * and GHCR_TOKEN (a GitHub token with read:packages) unless the image is already pulled.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SHOTS = path.join(ROOT, "test", "shots");
const IMAGE = process.env.FOUNDRY_IMAGE ?? "ghcr.io/briandedwards/foundry-casefiles:latest";
const URL = "http://localhost:30000";
const KEEP = process.argv.includes("--keep");
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Boot Foundry ---------- */

function docker() {
  try { sh("docker info"); return; } catch {}
  sh("(dockerd >/tmp/dockerd.log 2>&1 &)", { shell: "/bin/bash" });
  for (let i = 0; i < 30; i++) { try { sh("docker info"); return; } catch { execSync("sleep 1"); } }
  throw new Error("Docker daemon did not start (see /tmp/dockerd.log)");
}

function boot() {
  docker();
  try { sh(`docker image inspect ${IMAGE}`); } catch {
    if (!process.env.GHCR_TOKEN) throw new Error("Image not pulled and GHCR_TOKEN is not set");
    sh(`docker login ghcr.io -u BrianDEdwards --password-stdin`, { input: process.env.GHCR_TOKEN, stdio: ["pipe", "pipe", "pipe"] });
    console.log(`Pulling ${IMAGE}...`);
    sh(`docker pull ${IMAGE}`, { timeout: 600000 });
  }
  try { sh("docker rm -f casefiles"); } catch {}
  sh(`docker run -d --name casefiles -p 30000:30000 -v "${ROOT}:/data/Data/modules/stl-foundry:ro" ${IMAGE}`);
}

async function waitHttp() {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(URL)).status < 500) return; } catch {}
    await sleep(1000);
  }
  throw new Error(`Foundry did not answer:\n${sh("docker logs --tail 40 casefiles 2>&1")}`);
}

/** Walks through license/EULA/setup/join until the world's game is ready, enabling the module if needed. */
async function enterWorld(page) {
  for (let step = 0; step < 12; step++) {
    await page.waitForLoadState("domcontentloaded");
    const where = new globalThis.URL(page.url()).pathname;
    if (where.startsWith("/license")) {
      const key = page.locator("input[name=licenseKey]");
      if (await key.count()) {
        if (!process.env.FOUNDRY_LICENSE_KEY) throw new Error("Foundry asks for a license key; set FOUNDRY_LICENSE_KEY");
        await key.fill(process.env.FOUNDRY_LICENSE_KEY);
      }
      for (const box of await page.locator("input[type=checkbox]").all()) await box.check().catch(() => {});
      await page.locator("button#sign, button[name=sign], button[type=submit]").first().click();
      await page.waitForURL(u => !u.pathname.startsWith("/license") || step > 10, { timeout: 15000 }).catch(() => {});
    } else if (where.startsWith("/setup") || where.startsWith("/auth")) {
      await page.evaluate(() => fetch("/setup", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "launchWorld", world: "casefiles-test" }) }));
      await sleep(4000);
      await page.goto(`${URL}/join`);
    } else if (where.startsWith("/join")) {
      const user = page.locator("select[name=userid]");
      const gm = await user.locator("option", { hasText: "Gamemaster" }).first().getAttribute("value");
      await user.selectOption(gm);
      await page.locator("button[name=join]").click();
      await page.waitForURL(/\/game/, { timeout: 30000 });
    } else if (where.startsWith("/game")) {
      await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready !== undefined, null, { timeout: 60000 });
      const active = await page.evaluate(() => !!game.modules.get("stl-foundry")?.active);
      if (active) return;
      await page.evaluate(async () => {
        const cfg = game.settings.get("core", "moduleConfiguration") ?? {};
        await game.settings.set("core", "moduleConfiguration", { ...cfg, "stl-foundry": true });
      });
      await sleep(1500);
      await page.reload();
    } else {
      await page.goto(`${URL}/join`);
    }
  }
  throw new Error(`Could not get into the world (stuck at ${page.url()})`);
}

/* ---------- Checks ---------- */

const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`  ok    ${name}`); }
  catch (err) { results.push([false, name]); console.log(`  FAIL  ${name}\n        ${err.message.split("\n")[0]}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/** Screen position of a canvas point. */
const toScreen = (page, p) => page.evaluate(({ x, y }) => {
  const r = canvas.app.canvas?.getBoundingClientRect?.() ?? canvas.app.view.getBoundingClientRect();
  const s = canvas.clientCoordinatesFromCanvas?.({ x, y }) ?? canvas.stage.worldTransform.apply({ x, y });
  return canvas.clientCoordinatesFromCanvas ? { x: s.x, y: s.y } : { x: s.x + r.left, y: s.y + r.top };
}, p);

/** Centre of a tile in canvas coordinates, whether x/y is an anchor (v14) or the top-left corner. */
const tileCentre = (page, id) => page.evaluate(id => {
  const t = canvas.scene.tiles.get(id);
  const ax = typeof t.anchorX === "number" ? t.anchorX : 0, ay = typeof t.anchorY === "number" ? t.anchorY : 0;
  return { x: t.x + (0.5 - ax) * t.width, y: t.y + (0.5 - ay) * t.height, w: t.width, h: t.height };
}, id);
const flipped = (page, id) => page.evaluate(id => canvas.scene.tiles.get(id).flags["stl-foundry"].evidence.flipped, id);

async function run(page, errors) {
  await check("module loads without console errors", async () => {
    assert(await page.evaluate(() => !!globalThis.STLCasefiles), "STLCasefiles global missing");
    const own = errors.filter(e => /stl-foundry|casefiles/i.test(e));
    assert(!own.length, own.join(" | "));
  });

  await page.evaluate(async () => {
    for (const s of game.scenes.filter(s => s.name === "Smoke")) await s.delete();
    const scene = await Scene.create({ name: "Smoke", width: 3000, height: 2000, padding: 0, backgroundColor: "#2b2b2b", grid: { type: 0 } });
    await scene.activate();
    await scene.view();
  });
  await page.waitForFunction(() => canvas.ready && canvas.scene?.name === "Smoke", null, { timeout: 30000 });
  await sleep(1000);

  const ids = {};
  await check("every evidence type paints and places", async () => {
    const types = await page.evaluate(() => Object.keys(STLCasefiles.TYPES));
    for (const [i, type] of types.entries()) {
      const id = await page.evaluate(async ({ type, i }) => {
        const before = new Set(canvas.scene.tiles.map(t => t.id));
        await STLCasefiles.Evidence.create({ type, title: `Test ${type}`, front: "Front text", back: "Back text" });
        const tile = canvas.scene.tiles.find(t => !before.has(t.id));
        // Spread them out so each can be clicked on its own.
        const cx = 500 + (i % 3) * 900, cy = 550 + Math.floor(i / 3) * 900;
        const anchored = typeof tile.anchorX === "number";
        await tile.update(anchored ? { x: cx, y: cy } : { x: cx - tile.width / 2, y: cy - tile.height / 2 });
        return tile.id;
      }, { type, i });
      assert(id, `${type}: no tile created`);
      ids[type] = id;
    }
    await page.evaluate(() => canvas.animatePan({ x: 1400, y: 1000, scale: 0.45, duration: 0 }));
    await sleep(1500);
    await page.screenshot({ path: path.join(SHOTS, "1-placed.png") });
  });

  const first = Object.values(ids)[0];
  if (!first) return;

  await check("double-click on the tile centre flips it", async () => {
    const c = await tileCentre(page, first);
    const s = await toScreen(page, c);
    await page.mouse.dblclick(s.x, s.y);
    await sleep(900);
    assert(await flipped(page, first) === true, "not flipped after double-click");
  });

  await check("double-click near each corner (inside) flips; just outside does not", async () => {
    const id = ids.lined ?? first;
    await page.evaluate(id => canvas.scene.tiles.get(id).update({ rotation: 0 }), id);
    await sleep(300);
    const c = await tileCentre(page, id);
    for (const [fx, fy] of [[-0.4, -0.4], [0.4, 0.4]]) {
      const was = await flipped(page, id);
      const s = await toScreen(page, { x: c.x + fx * c.w, y: c.y + fy * c.h });
      await page.mouse.dblclick(s.x, s.y);
      await sleep(900);
      assert(await flipped(page, id) !== was, `no flip at (${fx}, ${fy}) of the tile`);
    }
    const was = await flipped(page, id);
    const s = await toScreen(page, { x: c.x + 0.6 * c.w, y: c.y });
    await page.mouse.dblclick(s.x, s.y);
    await sleep(900);
    assert(await flipped(page, id) === was, "flipped from a double-click outside the tile");
  });

  await check("two double-clicks in a row flip twice (no sticky clicks)", async () => {
    const id = ids.polaroid ?? first;
    const was = await flipped(page, id);
    const s = await toScreen(page, await tileCentre(page, id));
    for (let i = 0; i < 4; i++) { await page.mouse.click(s.x, s.y); await sleep(90); }
    await sleep(1500);
    assert(await flipped(page, id) === was, "expected two flips (back to the start), got one");
  });

  await check("flip animation folds the card and opens it back to full size", async () => {
    const id = ids.book ?? first;
    const full = await page.evaluate(id => canvas.scene.tiles.get(id).object.mesh.scale.x, id);
    const sample = page.evaluate(async ({ id }) => {
      const mesh = () => canvas.scene.tiles.get(id).object.mesh;
      let min = Infinity;
      const end = performance.now() + 900;
      while (performance.now() < end) { min = Math.min(min, Math.abs(mesh().scale.x)); await new Promise(requestAnimationFrame); }
      return min;
    }, { id });
    await page.evaluate(id => STLCasefiles.Evidence.flip(canvas.scene.tiles.get(id)), id);
    const min = await sample;
    await sleep(500);
    const after = await page.evaluate(id => canvas.scene.tiles.get(id).object.mesh.scale.x, id);
    assert(min < Math.abs(full) * 0.5, `card never folded (narrowest ${min.toFixed(3)} of ${full.toFixed(3)})`);
    assert(Math.abs(Math.abs(after) - Math.abs(full)) / Math.abs(full) < 0.05, `card stuck at ${after.toFixed(3)}, expected ${full.toFixed(3)}`);
  });

  await check("file away to the locker and place it again", async () => {
    const id = ids.email ?? first;
    const ok = await page.evaluate(async id => {
      const tile = canvas.scene.tiles.get(id);
      const evId = tile.flags["stl-foundry"].evidence.id;
      await STLCasefiles.Evidence.fileAway(tile);
      const filed = game.settings.get("stl-foundry", "locker");
      const entry = Object.values(filed).find(e => e.ev?.id === evId) ?? filed[evId];
      if (!entry || canvas.scene.tiles.get(id)) return false;
      await STLCasefiles.Evidence.place(entry.ev);
      return canvas.scene.tiles.some(t => t.flags["stl-foundry"]?.evidence?.id === evId);
    }, id);
    assert(ok, "not filed or not placed back");
  });

  await page.screenshot({ path: path.join(SHOTS, "2-after-flips.png") });

  await check("initiative tracker renders for a combat", async () => {
    await page.evaluate(async () => {
      const combat = await Combat.create({ scene: canvas.scene.id, active: true });
      await combat.createEmbeddedDocuments("Combatant", [{ name: "Alice", initiative: 12 }, { name: "Bob", initiative: 7 }]);
      await combat.startCombat();
    });
    await sleep(800);
    assert(await page.locator("#stl-initiative").count(), "#stl-initiative not in the page");
    await page.screenshot({ path: path.join(SHOTS, "3-tracker.png") });
  });
}

/* ---------- Main ---------- */

mkdirSync(SHOTS, { recursive: true });
boot();
await waitHttp();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push(e.message));
let code = 1;
try {
  await page.goto(URL);
  await enterWorld(page);
  await sleep(2000);
  await run(page, errors);
  code = results.every(([ok]) => ok) ? 0 : 1;
  console.log(`\n${results.filter(([ok]) => ok).length}/${results.length} passed. Screenshots in test/shots/`);
} catch (err) {
  console.error(err);
  await page.screenshot({ path: path.join(SHOTS, "error.png") }).catch(() => {});
} finally {
  await browser.close();
  if (!KEEP) sh("docker rm -f casefiles");
}
process.exit(code);
