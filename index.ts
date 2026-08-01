import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";

// --- Types ---

type CreatureType = "pc" | "enemy" | "neutral";

interface Creature {
  name: string;
  type: CreatureType;
  hpMax: number | null;
  dmg: number;
  ac: number | null;
  initiative: number | null;
  conditions: string[];
}

interface GameStateData {
  version: 1;
  savedAt: string;
  creatures: Creature[];
  inCombat: boolean;
  currentRound: number;
  currentTurnIndex: number;
}

// --- State ---

const creatures: Creature[] = [];
let inCombat = false;
let currentRound = 1;
let currentTurnIndex = 0;
let pendingConfirmation: { type: "end_combat" } | null = null;
let pendingSaveSelection: {
  saves: { name: string; count: number; savedAt: string; filepath: string }[];
} | null = null;
let pendingSaveDeleteSelection: {
  saves: { name: string; count: number; savedAt: string; filepath: string }[];
} | null = null;
let pendingSaveNamePrompt: { defaultName: string } | null = null;
let hasAddedCreature = false;
let currentSessionName: string | null = null;

// --- Persistence Helpers ---

const SAVES_DIR = path.join(process.cwd(), "saves");

function generateRandomSaveName(): string {
  const adjectives = [
    "amber", "bold", "crimson", "dark", "epic", "fierce", "glorious", "hidden",
    "iron", "jade", "knight", "lunar", "mystic", "noble", "obsidian", "phantom",
    "radiant", "shadow", "thunder", "valiant", "wild"
  ];
  const nouns = [
    "ambush", "battle", "cavern", "delve", "dungeon", "encounter", "fortress",
    "grotto", "haven", "keep", "lair", "outpost", "quest", "ruins", "sanctuary",
    "spire", "temple", "vault", "wilderness", "zone"
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]!;
  const noun = nouns[Math.floor(Math.random() * nouns.length)]!;
  const num = Math.floor(Math.random() * 90) + 10;
  return `${adj}_${noun}_${num}`;
}

function ensureSavesDir(): void {
  if (!fs.existsSync(SAVES_DIR)) {
    fs.mkdirSync(SAVES_DIR, { recursive: true });
  }
}

export function saveState(saveName: string = "current"): { name: string; isNew: boolean } {
  ensureSavesDir();
  const cleanName = saveName.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "current";
  const filename = `${cleanName}.json`;
  const filepath = path.join(SAVES_DIR, filename);
  const isNew = !fs.existsSync(filepath);

  const data: GameStateData = {
    version: 1,
    savedAt: new Date().toISOString(),
    creatures,
    inCombat,
    currentRound,
    currentTurnIndex,
  };

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  if (cleanName !== "current") {
    currentSessionName = cleanName;
  }
  return { name: cleanName, isNew };
}

export function loadState(saveName: string = "current"): { ok: true; name: string } | { ok: false; error: string } {
  ensureSavesDir();
  const cleanName = saveName.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "current";
  const filename = `${cleanName}.json`;
  const filepath = path.join(SAVES_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return { ok: false, error: `Save file "${cleanName}" not found.` };
  }

  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    const data = JSON.parse(raw) as GameStateData;

    creatures.length = 0;
    if (Array.isArray(data.creatures)) {
      creatures.push(...data.creatures);
    }
    inCombat = Boolean(data.inCombat);
    currentRound = typeof data.currentRound === "number" ? data.currentRound : 1;
    currentTurnIndex = typeof data.currentTurnIndex === "number" ? data.currentTurnIndex : 0;
    pendingConfirmation = null;
    hasAddedCreature = creatures.length > 0;
    if (cleanName !== "current") {
      currentSessionName = cleanName;
    }

    return { ok: true, name: cleanName };
  } catch {
    return { ok: false, error: `Failed to parse save file "${cleanName}".` };
  }
}

export function listSaves(): { name: string; count: number; savedAt: string; filepath: string }[] {
  ensureSavesDir();
  const files = fs.readdirSync(SAVES_DIR).filter((f) => f.endsWith(".json"));
  const results: { name: string; count: number; savedAt: string; filepath: string }[] = [];

  for (const f of files) {
    const filepath = path.resolve(SAVES_DIR, f);
    try {
      const raw = fs.readFileSync(filepath, "utf-8");
      const data = JSON.parse(raw) as GameStateData;
      results.push({
        name: f.replace(/\.json$/, ""),
        count: Array.isArray(data.creatures) ? data.creatures.length : 0,
        savedAt: data.savedAt ?? "Unknown",
        filepath,
      });
    } catch {
      // skip unparseable
    }
  }

  return results;
}

export function deleteSave(saveName: string): { ok: true; name: string; filepath: string } | { ok: false; error: string } {
  ensureSavesDir();
  if (!saveName || !saveName.trim()) {
    return { ok: false, error: "Please specify the save name to delete." };
  }
  const cleanName = saveName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${cleanName}.json`;
  const filepath = path.resolve(SAVES_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return { ok: false, error: `Save file "${cleanName}" not found.` };
  }

  try {
    fs.unlinkSync(filepath);
    return { ok: true, name: cleanName, filepath };
  } catch {
    return { ok: false, error: `Failed to delete save file "${cleanName}".` };
  }
}

// --- Sorting & Helpers ---

function compareCreaturesCombat(a: Creature, b: Creature): number {
  const initA = a.initiative;
  const initB = b.initiative;
  if (initA !== null && initB !== null) {
    if (initA !== initB) return initB - initA; // Descending initiative
  } else if (initA !== null) {
    return -1; // Initiative present comes before null
  } else if (initB !== null) {
    return 1;
  }
  return a.name.localeCompare(b.name);
}

function getSortedCreatures(): Creature[] {
  if (inCombat) {
    return [...creatures].sort(compareCreaturesCombat);
  }
  return [...creatures].sort((a, b) => a.name.localeCompare(b.name));
}

function withTurnPreservation(fn: () => void): void {
  if (inCombat && creatures.length > 0) {
    const sortedBefore = getSortedCreatures();
    const activeBefore = sortedBefore[currentTurnIndex];
    fn();
    const sortedAfter = getSortedCreatures();
    if (activeBefore) {
      const newIndex = sortedAfter.indexOf(activeBefore);
      if (newIndex !== -1) {
        currentTurnIndex = newIndex;
      } else {
        currentTurnIndex = Math.max(0, Math.min(currentTurnIndex, sortedAfter.length - 1));
      }
    }
  } else {
    fn();
  }
}

function nextTurn(count = 1): void {
  if (!inCombat || creatures.length === 0) return;
  const sorted = getSortedCreatures();
  for (let i = 0; i < count; i++) {
    currentTurnIndex++;
    if (currentTurnIndex >= sorted.length) {
      currentTurnIndex = 0;
      currentRound++;
    }
  }
}

function prevTurn(count = 1): void {
  if (!inCombat || creatures.length === 0) return;
  const sorted = getSortedCreatures();
  for (let i = 0; i < count; i++) {
    currentTurnIndex--;
    if (currentTurnIndex < 0) {
      if (currentRound > 1) {
        currentRound--;
        currentTurnIndex = sorted.length - 1;
      } else {
        currentTurnIndex = 0;
        break;
      }
    }
  }
}

// --- Rendering ---

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

function typeColor(type: CreatureType): string {
  switch (type) {
    case "pc":
      return GREEN;
    case "enemy":
      return RED;
    case "neutral":
      return YELLOW;
  }
}

function typeLabel(type: CreatureType): string {
  switch (type) {
    case "pc":
      return "PC";
    case "enemy":
      return "Enemy";
    case "neutral":
      return "Neutral";
  }
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function fmt(val: number | null): string {
  return val === null ? "—" : String(val);
}

function visibleLength(str: string): number {
  return str.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function renderTable(): void {
  console.clear();

  const sorted = getSortedCreatures();

  if (inCombat && sorted.length > 0) {
    if (currentTurnIndex >= sorted.length) {
      currentTurnIndex = Math.max(0, sorted.length - 1);
    }
    if (currentTurnIndex < 0) {
      currentTurnIndex = 0;
    }
  }

  const activeName = (inCombat && sorted.length > 0) ? (sorted[currentTurnIndex]?.name ?? "None") : "";
  const titleLeft = (inCombat && sorted.length > 0)
    ? `${BOLD}${MAGENTA}⚔  D&D Game State Tracker ${RESET} ${BOLD}${YELLOW}[ COMBAT — Round ${currentRound} | Turn: ${activeName} ]${RESET}`
    : `${BOLD}${MAGENTA}⚔  D&D Game State Tracker${RESET}`;

  const sessionLabel = currentSessionName ? `[ Game: ${currentSessionName} ]` : `[ Game: Unsaved ]`;
  const sessionRight = `${BOLD}${CYAN}${sessionLabel}${RESET}`;

  const leftVisLen = visibleLength(titleLeft);
  const rightVisLen = visibleLength(sessionRight);
  const padding = Math.max(2, 80 - leftVisLen - rightVisLen);

  console.log(`${titleLeft}${" ".repeat(padding)}${sessionRight}`);
  console.log(`${DIM}${"─".repeat(80)}${RESET}`);

  if (creatures.length === 0) {
    console.log(`${DIM}  No creatures yet. Use "add pc n1 n2" to begin.${RESET}`);
  } else {
    // Header
    const hdr = `    ${pad("Name", 22)}${pad("Type", 10)}${pad("HP Max", 8)}${pad("Dmg", 6)}${pad("AC", 6)}${pad("Init", 6)}${"Conditions"}`;
    console.log(`${BOLD}${CYAN}${hdr}${RESET}`);
    console.log(`${DIM}  ${"─".repeat(76)}${RESET}`);

    sorted.forEach((c, idx) => {
      const isTurn = inCombat && idx === currentTurnIndex;
      const color = typeColor(c.type);
      const name = pad(c.name, 22);
      const type = pad(typeLabel(c.type), 10);
      const hpMax = pad(fmt(c.hpMax), 8);
      const dmg = pad(c.dmg > 0 ? String(c.dmg) : "—", 6);
      const ac = pad(fmt(c.ac), 6);
      const init = pad(fmt(c.initiative), 6);
      const cond = c.conditions.length > 0 ? c.conditions.join(", ") : "";

      if (isTurn) {
        const prefix = `${BOLD}${MAGENTA}▶ ${RESET}`;
        console.log(`${prefix}${BOLD}${CYAN}${name}${RESET}${color}${type}${RESET}${BOLD}${CYAN}${hpMax}${dmg}${ac}${init}${cond}${RESET}`);
      } else {
        console.log(`  ${BOLD}${name}${RESET}${color}${type}${RESET}${hpMax}${dmg}${ac}${init}${cond}`);
      }
    });
  }

  console.log(`${DIM}${"─".repeat(80)}${RESET}`);
  if (inCombat) {
    console.log(`${DIM}  next (n [count]) · prev (p [count]) · add dmg <val> n1 · set hp <val> n1 · combat end${RESET}\n`);
  } else {
    console.log(`${DIM}  combat · add pc n1 n2 · set hp <val> n1 n2 · add dmg <val> n1 n2 · help · quit${RESET}\n`);
  }
}

// --- Helpers ---

function tokenize(input: string): string[] {
  const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]!);
  }
  return tokens;
}

function matchPrefix(input: string, options: string[]): string | null {
  const lower = input.toLowerCase();
  const exact = options.find((o) => o === lower);
  if (exact) return exact;
  const matches = options.filter((o) => o.startsWith(lower));
  return matches.length === 1 ? matches[0]! : null;
}

type FindManyResult =
  | { ok: true; creatures: Creature[] }
  | { ok: false; error: string };

function findCreaturesForIdentifier(identifier: string): FindManyResult {
  const isWildcard = identifier.includes("*");

  if (isWildcard) {
    const escaped = identifier
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    const pattern = new RegExp(escaped, "i");
    const matches = creatures.filter((c) => pattern.test(c.name));

    if (matches.length === 0) {
      return { ok: false, error: `No creature matching "${identifier}".` };
    }
    return { ok: true, creatures: matches };
  }

  const lower = identifier.toLowerCase();
  const exactMatch = creatures.find((c) => c.name.toLowerCase() === lower);
  if (exactMatch) {
    return { ok: true, creatures: [exactMatch] };
  }

  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");
  const matches = creatures.filter((c) => pattern.test(c.name));

  if (matches.length === 1) {
    return { ok: true, creatures: [matches[0]!] };
  }
  if (matches.length === 0) {
    return { ok: false, error: `No creature matching "${identifier}".` };
  }
  const names = matches.map((c) => c.name).join(", ");
  const suggestedWildcard = identifier.endsWith("*") ? identifier : `${identifier}*`;
  return {
    ok: false,
    error: `Ambiguous match "${identifier}" — matches: ${names}. Perhaps you meant ${suggestedWildcard}?`,
  };
}

function findCreatures(identifiers: string[]): FindManyResult {
  const found: Creature[] = [];

  for (const id of identifiers) {
    const result = findCreaturesForIdentifier(id);
    if (!result.ok) {
      return result;
    }
    for (const c of result.creatures) {
      if (!found.includes(c)) {
        found.push(c);
      }
    }
  }

  if (found.length === 0) {
    return { ok: false, error: "No targets specified." };
  }
  return { ok: true, creatures: found };
}

// --- Commands ---

function handleCommand(input: string): boolean {
  const parts = tokenize(input.trim());
  const cmd = parts[0]?.toLowerCase();

  if (!cmd) {
    return true; // empty input, just re-render
  }

  if (cmd === "quit" || cmd === "exit" || cmd === "q") {
    console.log("Farewell, adventurer!");
    return false;
  }

  if (cmd === "help" || cmd === "h") {
    renderTable();
    console.log(`${BOLD}Available commands:${RESET}\n`);

    console.log(`  ${BOLD}${MAGENTA}Combat & Turn Control:${RESET}`);
    console.log(`    ${CYAN}${pad("combat [start]", 25)}${RESET} Start combat mode (resorts by initiative)`);
    console.log(`    ${CYAN}${pad("combat end", 25)}${RESET} End combat mode (clears init & dmg)`);
    console.log(`    ${CYAN}${pad("next / n [count]", 25)}${RESET} Advance 1 or [count] turns`);
    console.log(`    ${CYAN}${pad("prev / p [count]", 25)}${RESET} Go back 1 or [count] turns\n`);

    console.log(`  ${BOLD}${MAGENTA}Creature Management:${RESET}`);
    console.log(`    ${CYAN}${pad("add enemy / e n1 n2", 25)}${RESET} Add enemies (shorthand e)`);
    console.log(`    ${CYAN}${pad("add neutral / n n1 n2", 25)}${RESET} Add neutral creatures (shorthand n)`);
    console.log(`    ${CYAN}${pad("add pc / p n1 n2", 25)}${RESET} Add PCs (shorthand p)`);
    console.log(`    ${CYAN}${pad("remove char n1 n2", 25)}${RESET} Remove specific creatures`);
    console.log(`    ${CYAN}${pad("remove pcs / e / n", 25)}${RESET} Remove all pcs / enemies / neutrals\n`);

    console.log(`  ${BOLD}${MAGENTA}Stats & Conditions:${RESET}`);
    console.log(`    ${CYAN}${pad("add cond <str> n1 n2", 25)}${RESET} Add condition to targets`);
    console.log(`    ${CYAN}${pad("add dmg <val> n1 n2", 25)}${RESET} Add damage to targets`);
    console.log(`    ${CYAN}${pad("clear dmg [n1 / all]", 25)}${RESET} Clear damage for targets (or all)`);
    console.log(`    ${CYAN}${pad("clear init [n1 / all]", 25)}${RESET} Clear initiative for targets (or all)`);
    console.log(`    ${CYAN}${pad("remove cond <str> n1", 25)}${RESET} Remove condition from targets`);
    console.log(`    ${CYAN}${pad("set ac <val> n1 n2", 25)}${RESET} Set AC for targets`);
    console.log(`    ${CYAN}${pad("set ac bulk n1 v1...", 25)}${RESET} Bulk set AC pairs`);
    console.log(`    ${CYAN}${pad("set hp <val> n1 n2", 25)}${RESET} Set HP max for targets`);
    console.log(`    ${CYAN}${pad("set init <val> n1 n2", 25)}${RESET} Set initiative for targets`);
    console.log(`    ${CYAN}${pad("set init bulk n1 v1...", 25)}${RESET} Bulk set initiative pairs\n`);

    console.log(`  ${BOLD}${MAGENTA}Game State & Storage:${RESET}`);
    console.log(`    ${CYAN}${pad("delete save [name]", 25)}${RESET} Delete a saved game file (or list options)`);
    console.log(`    ${CYAN}${pad("load [name]", 25)}${RESET} Load saved game state (or list options)`);
    console.log(`    ${CYAN}${pad("new", 25)}${RESET} Start a fresh new game session`);
    console.log(`    ${CYAN}${pad("save [name]", 25)}${RESET} Save current game state snapshot`);
    console.log(`    ${CYAN}${pad("saves", 25)}${RESET} List all saved game files with paths\n`);

    console.log(`  ${BOLD}${MAGENTA}Utilities:${RESET}`);
    console.log(`    ${CYAN}${pad("help / h", 25)}${RESET} Show this categorized help menu`);
    console.log(`    ${CYAN}${pad("quit / q", 25)}${RESET} Exit the application`);
    console.log(`    ${CYAN}${pad("test [simple]", 25)}${RESET} Load test data encounter\n`);
    return true;
  }

  if (cmd === "new") {
    resetState();
    renderTable();
    console.log(`${GREEN}✓ Started a fresh new game.${RESET}\n`);
    return true;
  }

  if (cmd === "save" || cmd === "savegame") {
    const subCmd = parts[1]?.toLowerCase();
    if (subCmd === "delete" || subCmd === "rm" || subCmd === "remove" || subCmd === "del") {
      const saveNames = parts.slice(2);
      if (saveNames.length === 0) {
        const savesList = listSaves();
        if (savesList.length === 0) {
          renderTable();
          console.log(`${YELLOW}No saved games found to delete.${RESET}\n`);
          return true;
        }

        pendingSaveDeleteSelection = { saves: savesList };
        renderTable();
        console.log(`${BOLD}Available saved games to delete:${RESET}`);
        savesList.forEach((s, idx) => {
          const timeStr = s.savedAt !== "Unknown" ? new Date(s.savedAt).toLocaleString() : s.savedAt;
          console.log(`  ${CYAN}${idx + 1})${RESET} ${pad(s.name, 15)} ${s.count} creatures · ${DIM}${timeStr}${RESET}`);
        });
        console.log();
        return true;
      }

      const deleted: string[] = [];
      const errors: string[] = [];
      for (const sName of saveNames) {
        const res = deleteSave(sName);
        if (res.ok) deleted.push(res.name);
        else errors.push(res.error);
      }

      renderTable();
      if (deleted.length > 0) {
        console.log(`${GREEN}✓ Deleted saved game(s): ${deleted.join(", ")}.${RESET}`);
      }
      if (errors.length > 0) {
        console.log(`${RED}${errors.join(" ")}${RESET}`);
      }
      console.log();
      return true;
    }

    const saveName = parts[1];
    if (!saveName) {
      const presetName = generateRandomSaveName();
      pendingSaveNamePrompt = { defaultName: presetName };
      renderTable();
      console.log(`${BOLD}Saving game session:${RESET}`);
      console.log(`Default session name: ${CYAN}${presetName}${RESET}\n`);
      return true;
    }

    const res = saveState(saveName);
    renderTable();
    if (res.isNew) {
      console.log(`${GREEN}✓ Created new save state "${res.name}".${RESET}\n`);
    }
    return true;
  }

  if (cmd === "delete" || cmd === "del") {
    const subCmd = parts[1]?.toLowerCase() ?? "";
    const isSave = subCmd === "save" || subCmd === "savegame" || subCmd === "saves";
    const saveNames = isSave ? parts.slice(2) : parts.slice(1);

    if (saveNames.length === 0) {
      const savesList = listSaves();
      if (savesList.length === 0) {
        renderTable();
        console.log(`${YELLOW}No saved games found to delete.${RESET}\n`);
        return true;
      }

      pendingSaveDeleteSelection = { saves: savesList };
      renderTable();
      console.log(`${BOLD}Available saved games to delete:${RESET}`);
      savesList.forEach((s, idx) => {
        const timeStr = s.savedAt !== "Unknown" ? new Date(s.savedAt).toLocaleString() : s.savedAt;
        console.log(`  ${CYAN}${idx + 1})${RESET} ${pad(s.name, 15)} ${s.count} creatures · ${DIM}${timeStr}${RESET}`);
      });
      console.log();
      return true;
    }

    const deleted: string[] = [];
    const errors: string[] = [];
    for (const sName of saveNames) {
      const res = deleteSave(sName);
      if (res.ok) deleted.push(res.name);
      else errors.push(res.error);
    }

    renderTable();
    if (deleted.length > 0) {
      console.log(`${GREEN}✓ Deleted saved game(s): ${deleted.join(", ")}.${RESET}`);
    }
    if (errors.length > 0) {
      console.log(`${RED}${errors.join(" ")}${RESET}`);
    }
    console.log();
    return true;
  }

  if (cmd === "load" || cmd === "loadgame") {
    const saveName = parts[1];

    if (!saveName) {
      const savesList = listSaves();
      if (savesList.length === 0) {
        renderTable();
        console.log(`${YELLOW}No saved games found to load.${RESET}\n`);
        return true;
      }

      pendingSaveSelection = { saves: savesList };
      renderTable();
      console.log(`${BOLD}Available saved games to load:${RESET}`);
      savesList.forEach((s, idx) => {
        const timeStr = s.savedAt !== "Unknown" ? new Date(s.savedAt).toLocaleString() : s.savedAt;
        console.log(`  ${CYAN}${idx + 1})${RESET} ${pad(s.name, 15)} ${s.count} creatures · ${DIM}${timeStr}${RESET}`);
      });
      console.log();
      return true;
    }

    const result = loadState(saveName);
    renderTable();
    if (result.ok) {
      console.log(`${GREEN}✓ Loaded game state from "${result.name}" (${creatures.length} creatures).${RESET}\n`);
    } else {
      console.log(`${RED}${result.error}${RESET}\n`);
    }
    return true;
  }

  if (cmd === "saves" || (cmd === "list" && parts[1]?.toLowerCase() === "saves")) {
    const savesList = listSaves();
    renderTable();
    console.log(`${DIM}Save Directory: ${path.resolve(SAVES_DIR)}${RESET}`);
    if (savesList.length === 0) {
      console.log(`${YELLOW}No saved games found.${RESET}\n`);
    } else {
      console.log(`${BOLD}Saved games:${RESET}`);
      for (const s of savesList) {
        const timeStr = s.savedAt !== "Unknown" ? new Date(s.savedAt).toLocaleString() : s.savedAt;
        console.log(`  ${CYAN}${pad(s.name, 15)}${RESET} ${s.count} creatures · ${DIM}${timeStr}${RESET}`);
        console.log(`  ${DIM}└─ Path: ${s.filepath}${RESET}`);
      }
      console.log();
    }
    return true;
  }

  if (cmd === "combat" || (cmd === "start" && parts[1]?.toLowerCase() === "combat")) {
    const sub = parts[1]?.toLowerCase();
    if (sub === "end" || sub === "stop" || sub === "exit") {
      if (!inCombat) {
        renderTable();
        console.log(`${RED}Not currently in combat mode.${RESET}\n`);
        return true;
      }
      pendingConfirmation = { type: "end_combat" };
      renderTable();
      return true;
    }

    if (creatures.length === 0) {
      renderTable();
      console.log(`${RED}No creatures in tracker. Add creatures before starting combat.${RESET}\n`);
      return true;
    }

    inCombat = true;
    currentRound = 1;
    currentTurnIndex = 0;
    renderTable();
    const sorted = getSortedCreatures();
    const active = sorted[currentTurnIndex];
    console.log(`${GREEN}⚔ Combat started! Round 1 — ${BOLD}${active ? active.name : ""}'s turn${RESET}\n`);
    return true;
  }

  if (cmd === "end" && parts[1]?.toLowerCase() === "combat") {
    if (!inCombat) {
      renderTable();
      console.log(`${RED}Not currently in combat mode.${RESET}\n`);
      return true;
    }
    pendingConfirmation = { type: "end_combat" };
    renderTable();
    return true;
  }

  if (cmd === "next" || cmd === "n") {
    if (!inCombat) {
      renderTable();
      console.log(`${RED}Not in combat mode. Type "combat" to start combat.${RESET}\n`);
      return true;
    }
    let count = 1;
    if (parts[1]) {
      const parsed = parseInt(parts[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        count = parsed;
      }
    }
    nextTurn(count);
    renderTable();
    const sorted = getSortedCreatures();
    const active = sorted[currentTurnIndex];
    const stepMsg = count > 1 ? ` (+${count} turns)` : "";
    console.log(`${GREEN}► Round ${currentRound} — Turn: ${BOLD}${active ? active.name : ""}${RESET}${DIM}${stepMsg}${RESET}\n`);
    return true;
  }

  if (cmd === "prev" || cmd === "p") {
    if (!inCombat) {
      renderTable();
      console.log(`${RED}Not in combat mode. Type "combat" to start combat.${RESET}\n`);
      return true;
    }
    let count = 1;
    if (parts[1]) {
      const parsed = parseInt(parts[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        count = parsed;
      }
    }
    prevTurn(count);
    renderTable();
    const sorted = getSortedCreatures();
    const active = sorted[currentTurnIndex];
    const stepMsg = count > 1 ? ` (-${count} turns)` : "";
    console.log(`${YELLOW}◄ Round ${currentRound} — Turn: ${BOLD}${active ? active.name : ""}${RESET}${DIM}${stepMsg}${RESET}\n`);
    return true;
  }

  if (cmd === "add") {
    let rawSub = parts[1]?.toLowerCase() ?? "";
    if (rawSub === "p" || rawSub === "pcs") rawSub = "pc";
    if (rawSub === "e" || rawSub === "enemies") rawSub = "enemy";
    if (rawSub === "n" || rawSub === "neutrals") rawSub = "neutral";
    const subCmd = rawSub;
    const addOptions = ["pc", "char", "enemy", "neutral", "dmg", "cond", "condition"];
    const matched = matchPrefix(subCmd, addOptions);

    // --- add cond <str> n1 n2 ---
    if (matched === "cond" || matched === "condition") {
      const cond = parts[2];
      const targets = parts.slice(3);

      if (!cond || targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: add cond <str> n1 n2${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      for (const creature of result.creatures) {
        if (!creature.conditions.includes(cond)) {
          creature.conditions.push(cond);
        }
      }

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ ${names}: +condition "${cond}"${RESET}\n`);
      return true;
    }

    // --- add dmg <val> n1 n2 ---
    if (matched === "dmg") {
      const rawVal = parts[2];
      const targets = parts.slice(3);

      if (!rawVal || targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: add dmg <value> n1 n2${RESET}\n`);
        return true;
      }

      const val = parseInt(rawVal, 10);
      if (isNaN(val)) {
        renderTable();
        console.log(`${RED}"${rawVal}" is not a valid number.${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      for (const creature of result.creatures) {
        creature.dmg += val;
      }

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ ${names}: dmg +${val}${RESET}\n`);
      return true;
    }

    // --- add char/enemy/neutral n1 n2 ---
    const targets = parts.slice(2);

    if (targets.length === 0) {
      renderTable();
      console.log(`${RED}Usage: add <pc|enemy|neutral> n1 n2${RESET}\n`);
      return true;
    }

    let type: CreatureType;
    switch (matched) {
      case "char":
      case "pc":
        type = "pc";
        break;
      case "enemy":
        type = "enemy";
        break;
      case "neutral":
        type = "neutral";
        break;
      default:
        renderTable();
        console.log(`${RED}Unknown subcommand "${subCmd}". Use char, enemy, neutral, or dmg.${RESET}\n`);
        return true;
    }

    withTurnPreservation(() => {
      for (const name of targets) {
        creatures.push({ name, type, hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] });
      }
    });
    hasAddedCreature = true;
    renderTable();
    console.log(`${GREEN}+ Added ${typeLabel(type)}: ${targets.join(", ")}${RESET}\n`);
    return true;
  }

  if (cmd === "clear") {
    const subCmd = parts[1]?.toLowerCase() ?? "";
    const isInit = matchPrefix(subCmd, ["init", "initiative"]) !== null;
    const isDmg = matchPrefix(subCmd, ["dmg", "damage"]) !== null;

    if (isInit) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear initiative (e.g., "clear init all" or "clear init Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all" || targets[0] === "*") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.initiative = null;
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared initiative for all creatures.${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      withTurnPreservation(() => {
        for (const c of result.creatures) {
          c.initiative = null;
        }
      });

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Cleared initiative for ${names}.${RESET}\n`);
      return true;
    }

    if (isDmg) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear damage (e.g., "clear dmg all" or "clear dmg Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all" || targets[0] === "*") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.dmg = 0;
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared damage for all creatures.${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      withTurnPreservation(() => {
        for (const c of result.creatures) {
          c.dmg = 0;
        }
      });

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Cleared damage for ${names}.${RESET}\n`);
      return true;
    }

    renderTable();
    console.log(`${RED}Usage: clear <init|dmg> <all | target1 target2 ...> (e.g., "clear init all" or "clear dmg Ajax")${RESET}\n`);
    return true;
  }

  if (cmd === "set") {
    const fieldInput = parts[1]?.toLowerCase() ?? "";
    const setOptions = ["hp", "ac", "init"];
    const field = matchPrefix(fieldInput, setOptions);

    if (parts[2]?.toLowerCase() === "bulk") {
      const bulkArgs = parts.slice(3);
      if (!field || bulkArgs.length === 0 || bulkArgs.length % 2 !== 0) {
        renderTable();
        const msg = !field
          ? `Unknown field "${fieldInput}". Use hp, ac, or init.`
          : `Usage: set ${fieldInput} bulk <target1> <val1> <target2> <val2> ...`;
        console.log(`${RED}${msg}${RESET}\n`);
        return true;
      }

      const updates: { creatures: Creature[]; val: number | null; rawTarget: string; rawVal: string }[] = [];
      for (let i = 0; i < bulkArgs.length; i += 2) {
        const rawTarget = bulkArgs[i]!;
        const rawVal = bulkArgs[i + 1]!;
        const lowerVal = rawVal.toLowerCase();
        const isNullVal = lowerVal === "null" || lowerVal === "none" || lowerVal === "clear" || lowerVal === "-" || lowerVal === "—";
        const val = isNullVal ? null : parseInt(rawVal, 10);
        if (!isNullVal && isNaN(val as number)) {
          renderTable();
          console.log(`${RED}"${rawVal}" is not a valid number for target "${rawTarget}".${RESET}\n`);
          return true;
        }

        const result = findCreatures([rawTarget]);
        if (!result.ok) {
          renderTable();
          console.log(`${RED}${result.error}${RESET}\n`);
          return true;
        }

        updates.push({ creatures: result.creatures, val, rawTarget, rawVal });
      }

      const summaryItems: string[] = [];
      withTurnPreservation(() => {
        for (const update of updates) {
          for (const c of update.creatures) {
            if (field === "hp") c.hpMax = update.val;
            else if (field === "ac") c.ac = update.val;
            else if (field === "init") c.initiative = update.val;
          }
          const names = update.creatures.map((c) => c.name).join(", ");
          summaryItems.push(`${names} → ${update.val === null ? "cleared" : update.val}`);
        }
      });

      renderTable();
      console.log(`${GREEN}✓ Bulk set ${field}: ${summaryItems.join("; ")}${RESET}\n`);
      return true;
    }

    const rawVal = parts[2];
    const targets = parts.slice(3);

    if (!field || rawVal === undefined || targets.length === 0) {
      renderTable();
      const msg = fieldInput && !field
        ? `Unknown field "${fieldInput}". Use hp, ac, or init.`
        : "Usage: set <hp|ac|init> <value> n1 n2";
      console.log(`${RED}${msg}${RESET}\n`);
      return true;
    }

    const lowerVal = rawVal.toLowerCase();
    const isNullVal = lowerVal === "null" || lowerVal === "none" || lowerVal === "clear" || lowerVal === "-" || lowerVal === "—";
    const val = isNullVal ? null : parseInt(rawVal, 10);
    if (!isNullVal && isNaN(val as number)) {
      renderTable();
      console.log(`${RED}"${rawVal}" is not a valid number.${RESET}\n`);
      return true;
    }

    const result = findCreatures(targets);
    if (!result.ok) {
      renderTable();
      console.log(`${RED}${result.error}${RESET}\n`);
      return true;
    }

    withTurnPreservation(() => {
      for (const creature of result.creatures) {
        switch (field) {
          case "hp":
            creature.hpMax = val;
            break;
          case "ac":
            creature.ac = val;
            break;
          case "init":
          case "initiative":
            creature.initiative = val;
            break;
        }
      }
    });

    renderTable();
    const names = result.creatures.map((c) => c.name).join(", ");
    console.log(`${GREEN}✓ ${names}: ${field} → ${val === null ? "cleared" : val}${RESET}\n`);
    return true;
  }

  if (cmd === "remove" || cmd === "rm") {
    const subCmd = parts[1]?.toLowerCase() ?? "";
    const isCond = matchPrefix(subCmd, ["condition", "cond"]) !== null;
    const isInit = matchPrefix(subCmd, ["initiative", "init"]) !== null;

    if (isInit) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear initiative (e.g., "remove init all" or "remove init Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all" || targets[0] === "*") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.initiative = null;
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared initiative for all creatures.${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      withTurnPreservation(() => {
        for (const c of result.creatures) {
          c.initiative = null;
        }
      });

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Cleared initiative for ${names}.${RESET}\n`);
      return true;
    }

    if (isCond) {
      const condPattern = parts[2];
      const targets = parts.slice(3);

      if (!condPattern || targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: remove cond <str> n1 n2${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      const lowerCond = condPattern.toLowerCase();
      let matchedAny = false;
      for (const creature of result.creatures) {
        const prevLen = creature.conditions.length;
        creature.conditions = creature.conditions.filter((c) => !c.toLowerCase().includes(lowerCond));
        if (creature.conditions.length < prevLen) {
          matchedAny = true;
        }
      }

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      if (matchedAny) {
        console.log(`${GREEN}✓ Removed condition matching "${condPattern}" from ${names}${RESET}\n`);
      } else {
        console.log(`${YELLOW}No condition matching "${condPattern}" found on ${names}.${RESET}\n`);
      }
      return true;
    }

    // --- Bulk & Specific Removal by Creature Type ---
    const normalizeType = (str: string): string => {
      const s = str.toLowerCase();
      if (s === "enemies" || s === "enemy" || s === "e") return "enemy";
      if (s === "pcs" || s === "pc" || s === "p") return "pc";
      if (s === "neutrals" || s === "neutral" || s === "n") return "neutral";
      if (s === "creature" || s === "creatures" || s === "char" || s === "c") return "char";
      return s;
    };

    const typeOptions = ["pc", "enemy", "neutral", "char"];
    const normSub = normalizeType(subCmd);
    const matchedType = matchPrefix(normSub, typeOptions);
    const secondArg = parts[2] ? normalizeType(parts[2]) : "";
    const matchedAllType = subCmd === "all" ? matchPrefix(secondArg, ["pc", "enemy", "neutral"]) : null;

    let category: CreatureType | "char" | null = null;
    let targetArgs: string[] = [];

    if (subCmd === "all" && matchedAllType) {
      category = matchedAllType as CreatureType;
      targetArgs = parts.slice(3);
    } else if (matchedType) {
      category = matchedType as CreatureType | "char";
      targetArgs = parts.slice(2);
    } else {
      targetArgs = parts.slice(1);
    }

    if (category && category !== "char") {
      // Bulk remove if no targets specified, or targets[0] === "all" / "*"
      if (targetArgs.length === 0 || targetArgs[0] === "all" || targetArgs[0] === "*") {
        let removedCount = 0;
        withTurnPreservation(() => {
          for (let i = creatures.length - 1; i >= 0; i--) {
            if (creatures[i].type === category) {
              creatures.splice(i, 1);
              removedCount++;
            }
          }
        });
        renderTable();
        const label = category === "pc" ? "PCs" : category === "enemy" ? "enemies" : "neutral creatures";
        if (removedCount > 0) {
          console.log(`${YELLOW}- Removed all ${label} (${removedCount} creatures).${RESET}\n`);
        } else {
          console.log(`${YELLOW}No ${label} found to remove.${RESET}\n`);
        }
        return true;
      }
    }

    if (targetArgs.length === 0) {
      renderTable();
      console.log(`${RED}Usage: remove <pc|enemy|neutral|char> [target1 target2 ...] (e.g. "remove enemy" or "remove pc Ajax")${RESET}\n`);
      return true;
    }

    const result = findCreatures(targetArgs);
    if (!result.ok) {
      renderTable();
      console.log(`${RED}${result.error}${RESET}\n`);
      return true;
    }

    withTurnPreservation(() => {
      for (const creature of result.creatures) {
        const idx = creatures.indexOf(creature);
        if (idx !== -1) {
          creatures.splice(idx, 1);
        }
      }
    });
    renderTable();
    const names = result.creatures.map((c) => c.name).join(", ");
    console.log(`${YELLOW}- Removed: ${names}${RESET}\n`);
    return true;
  }

  if (cmd === "test") {
    const isSimple = parts[1]?.toLowerCase() === "simple" || parts[1]?.toLowerCase() === "s";
    creatures.length = 0;
    if (isSimple) {
      creatures.push(
        { name: "ajax grimstone", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "kaelor stormstride", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "lyra moonwhisper", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "thorgan ironbreaker", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "elaria shadowstep", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "seraphina sunfire", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "valerius frostweaver", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "goblin warrior 1", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "goblin warrior 2", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "goblin archer", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "goblin shaman", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "bugbear chieftain", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "hobgoblin captain", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "skeleton archer", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "dark cultist", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "young red dragon", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "captured merchant", type: "neutral", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "village elder", type: "neutral", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "tavern keeper", type: "neutral", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "mysterious traveler", type: "neutral", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
      );
    } else {
      creatures.push(
        { name: "ajax", type: "pc", hpMax: 45, dmg: 0, ac: 18, initiative: 14, conditions: [] },
        { name: "kaelor stormstride", type: "pc", hpMax: 38, dmg: 12, ac: 15, initiative: 18, conditions: [] },
        { name: "lyra moonwhisper", type: "pc", hpMax: 32, dmg: 0, ac: 12, initiative: 9, conditions: ["Concentrating"] },
        { name: "thorgan ironbreaker", type: "pc", hpMax: 58, dmg: 15, ac: 16, initiative: 12, conditions: ["Raging"] },
        { name: "elaria shadowstep", type: "pc", hpMax: 30, dmg: 4, ac: 14, initiative: 20, conditions: [] },
        { name: "seraphina sunfire", type: "pc", hpMax: 40, dmg: 0, ac: 17, initiative: 10, conditions: [] },
        { name: "valerius frostweaver", type: "pc", hpMax: 28, dmg: 8, ac: 13, initiative: 15, conditions: ["Invisible"] },
        { name: "goblin warrior 1", type: "enemy", hpMax: 12, dmg: 5, ac: 13, initiative: 11, conditions: [] },
        { name: "goblin warrior 2", type: "enemy", hpMax: 12, dmg: 12, ac: 13, initiative: 8, conditions: ["Dead"] },
        { name: "goblin archer", type: "enemy", hpMax: 10, dmg: 10, ac: 12, initiative: 16, conditions: [] },
        { name: "goblin shaman", type: "enemy", hpMax: 18, dmg: 6, ac: 12, initiative: 13, conditions: ["Poisoned"] },
        { name: "bugbear chieftain", type: "enemy", hpMax: 42, dmg: 14, ac: 15, initiative: 7, conditions: [] },
        { name: "hobgoblin captain", type: "enemy", hpMax: 39, dmg: 0, ac: 17, initiative: 14, conditions: [] },
        { name: "skeleton archer", type: "enemy", hpMax: 13, dmg: 0, ac: 11, initiative: 15, conditions: [] },
        { name: "dark cultist", type: "enemy", hpMax: 22, dmg: 11, ac: 12, initiative: 11, conditions: ["Frightened"] },
        { name: "young red dragon", type: "enemy", hpMax: 178, dmg: 35, ac: 18, initiative: 10, conditions: [] },
        { name: "captured merchant", type: "neutral", hpMax: 8, dmg: 3, ac: 10, initiative: null, conditions: ["Restrained"] },
        { name: "village elder", type: "neutral", hpMax: 6, dmg: 0, ac: 10, initiative: null, conditions: [] },
        { name: "tavern keeper", type: "neutral", hpMax: 12, dmg: 0, ac: 11, initiative: null, conditions: [] },
        { name: "mysterious traveler", type: "neutral", hpMax: 25, dmg: 0, ac: 14, initiative: 16, conditions: [] },
      );
    }
    hasAddedCreature = true;
    renderTable();
    console.log(`${GREEN}✓ Loaded test data${isSimple ? " (simple)" : ""} (${creatures.length} creatures)${RESET}\n`);
    return true;
  }

  renderTable();
  console.log(`${RED}Unknown command: "${input.trim()}". Type "help" for commands.${RESET}\n`);
  return true;
}

// --- Test Helpers & Exports ---

export { creatures, getSortedCreatures };

export function resetState(): void {
  creatures.length = 0;
  inCombat = false;
  currentRound = 1;
  currentTurnIndex = 0;
  pendingConfirmation = null;
  pendingSaveSelection = null;
  pendingSaveDeleteSelection = null;
  pendingSaveNamePrompt = null;
  hasAddedCreature = false;
  currentSessionName = null;
}

export function getCombatState() {
  return {
    inCombat,
    currentRound,
    currentTurnIndex,
    pendingConfirmation,
    activeCreature: creatures.length > 0 ? getSortedCreatures()[currentTurnIndex] ?? null : null,
  };
}

export function processConfirmation(answer: string): boolean {
  if (pendingConfirmation?.type === "end_combat") {
    pendingConfirmation = null;
    const choice = answer.trim().toLowerCase();
    if (choice === "y" || choice === "yes") {
      inCombat = false;
      currentRound = 1;
      currentTurnIndex = 0;
      for (const c of creatures) {
        c.initiative = null;
        c.dmg = 0;
      }
      saveState("current");
      renderTable();
      console.log(`${YELLOW}⚔ Combat ended. Initiative and damage cleared for all creatures.${RESET}\n`);
      return true;
    } else {
      renderTable();
      console.log(`${DIM}Combat end cancelled.${RESET}\n`);
      return false;
    }
  }
  return false;
}

export function processSaveNamePrompt(answer: string): boolean {
  if (!pendingSaveNamePrompt) return false;

  const defaultName = pendingSaveNamePrompt.defaultName;
  pendingSaveNamePrompt = null;

  const trimmed = answer.trim();
  if (trimmed.toLowerCase() === "c" || trimmed.toLowerCase() === "cancel") {
    renderTable();
    console.log(`${DIM}Save cancelled.${RESET}\n`);
    return false;
  }

  const chosenName = trimmed || defaultName;
  const res = saveState(chosenName);
  renderTable();
  if (res.isNew) {
    console.log(`${GREEN}✓ Created new save state "${res.name}".${RESET}\n`);
  }
  return true;
}

export function processSaveSelection(answer: string): boolean {
  if (!pendingSaveSelection) return false;

  const saves = pendingSaveSelection.saves;
  pendingSaveSelection = null;

  const choice = answer.trim();
  if (choice.toLowerCase() === "c" || choice.toLowerCase() === "cancel") {
    renderTable();
    console.log(`${DIM}Load cancelled.${RESET}\n`);
    return false;
  }

  const index = parseInt(choice, 10) - 1;
  let targetSave: string | null = null;

  if (!isNaN(index) && index >= 0 && index < saves.length) {
    targetSave = saves[index]!.name;
  } else {
    const matched = saves.find((s) => s.name.toLowerCase() === choice.toLowerCase());
    if (matched) {
      targetSave = matched.name;
    }
  }

  if (!targetSave) {
    renderTable();
    console.log(`${RED}Invalid selection "${choice}". Load cancelled.${RESET}\n`);
    return false;
  }

  const result = loadState(targetSave);
  renderTable();
  if (result.ok) {
    console.log(`${GREEN}✓ Loaded game state from "${result.name}" (${creatures.length} creatures).${RESET}\n`);
    return true;
  } else {
    console.log(`${RED}${result.error}${RESET}\n`);
    return false;
  }
}

export function processSaveDeleteSelection(answer: string): boolean {
  if (!pendingSaveDeleteSelection) return false;

  const saves = pendingSaveDeleteSelection.saves;
  pendingSaveDeleteSelection = null;

  const choiceStr = answer.trim();
  if (choiceStr.toLowerCase() === "c" || choiceStr.toLowerCase() === "cancel") {
    renderTable();
    console.log(`${DIM}Delete save cancelled.${RESET}\n`);
    return false;
  }

  const tokens = choiceStr.split(/[\s,]+/).filter(Boolean);
  let targetNames: string[] = [];

  if (tokens.length === 1 && (tokens[0]!.toLowerCase() === "all" || tokens[0]! === "*")) {
    targetNames = saves.map((s) => s.name);
  } else {
    for (const token of tokens) {
      const idx = parseInt(token, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < saves.length) {
        targetNames.push(saves[idx]!.name);
      } else {
        const matched = saves.find((s) => s.name.toLowerCase() === token.toLowerCase());
        if (matched) {
          targetNames.push(matched.name);
        } else {
          targetNames.push(token);
        }
      }
    }
  }

  targetNames = Array.from(new Set(targetNames));

  if (targetNames.length === 0) {
    renderTable();
    console.log(`${RED}Invalid selection "${choiceStr}". Delete save cancelled.${RESET}\n`);
    return false;
  }

  const deleted: string[] = [];
  const errors: string[] = [];

  for (const tName of targetNames) {
    const result = deleteSave(tName);
    if (result.ok) {
      deleted.push(result.name);
    } else {
      errors.push(result.error);
    }
  }

  renderTable();
  if (deleted.length > 0) {
    console.log(`${GREEN}✓ Deleted saved game(s): ${deleted.join(", ")}.${RESET}`);
  }
  if (errors.length > 0) {
    console.log(`${RED}${errors.join(" ")}${RESET}`);
  }
  console.log();
  return true;
}

// Wrap handleCommand to ensure auto-saving on every mutating command
const originalHandleCommand = handleCommand;
function handleCommandWithAutoSave(input: string): boolean {
  const parts = tokenize(input.trim());
  const cmd = parts[0]?.toLowerCase();
  const res = originalHandleCommand(input);

  const nonMutatingCmds = ["help", "saves", "delete", "del", "quit", "exit", "q"];
  if (cmd && !nonMutatingCmds.includes(cmd) && hasAddedCreature) {
    saveState("current");
  }
  return res;
}

export { handleCommandWithAutoSave as handleCommand };

// --- REPL ---

if (import.meta.main) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  resetState();
  renderTable();

  function prompt() {
    const promptStr = pendingConfirmation
      ? `${YELLOW}End combat and clear init & dmg for all creatures? (y/n) > ${RESET}`
      : pendingSaveSelection
      ? `${CYAN}Select save to load (1-${pendingSaveSelection.saves.length}) or 'c' to cancel > ${RESET}`
      : pendingSaveDeleteSelection
      ? `${RED}Select save(s) to DELETE (e.g. 1 3 or 1,2 or 'all') or 'c' to cancel > ${RESET}`
      : pendingSaveNamePrompt
      ? `${CYAN}Enter session name [Press Enter for "${pendingSaveNamePrompt.defaultName}"] > ${RESET}`
      : `${MAGENTA}> ${RESET}`;

    rl.question(promptStr, (answer) => {
      if (pendingConfirmation) {
        processConfirmation(answer);
        prompt();
        return;
      }

      if (pendingSaveNamePrompt) {
        processSaveNamePrompt(answer);
        prompt();
        return;
      }

      if (pendingSaveSelection) {
        processSaveSelection(answer);
        prompt();
        return;
      }

      if (pendingSaveDeleteSelection) {
        processSaveDeleteSelection(answer);
        prompt();
        return;
      }

      const shouldContinue = handleCommandWithAutoSave(answer);
      if (shouldContinue) {
        prompt();
      } else {
        rl.close();
      }
    });
  }

  prompt();
}

