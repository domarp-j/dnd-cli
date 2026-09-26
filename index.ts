#!/usr/bin/env bun
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { ALL_STATUS_EFFECTS } from "./statusEffects";

// --- Types ---

type CreatureType = "pc" | "enemy" | "neutral";

interface Creature {
  name: string;
  type: CreatureType;
  hpMax: number | null;
  dmg: number;
  ac: number | null;
  initiative: number | null;
  statusEffects: string[];
  reactionUsed?: boolean;
  resourceUsage?: Record<string, number>;
}

interface ActivityEntry {
  timestamp: string;
  message: string;
}

interface GameStateData {
  version: 1;
  savedAt: string;
  creatures: Creature[];
  inCombat: boolean;
  currentRound: number;
  currentTurnIndex: number;
  activityLog?: ActivityEntry[];
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
let pendingRenamePrompt: { defaultName: string } | null = null;
let pendingQuitConfirmation = false;
let pendingCharTypePrompt: { names: string[] } | null = null;
let hasAddedCreature = false;
let currentSessionName: string | null = null;
const activityLog: ActivityEntry[] = [];

interface Snapshot {
  creatures: Creature[];
  inCombat: boolean;
  currentRound: number;
  currentTurnIndex: number;
  activityLog: ActivityEntry[];
  hasAddedCreature: boolean;
  currentSessionName: string | null;
}

interface HistoryEntry {
  commandInput: string;
  snapshot: Snapshot;
  timestamp: string;
}

const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];

function captureSnapshot(): Snapshot {
  return {
    creatures: creatures.map((c) => ({
      ...c,
      statusEffects: [...c.statusEffects],
      resourceUsage: c.resourceUsage ? { ...c.resourceUsage } : {},
    })),
    inCombat,
    currentRound,
    currentTurnIndex,
    activityLog: activityLog.map((e) => ({ ...e })),
    hasAddedCreature,
    currentSessionName,
  };
}

function restoreSnapshot(snapshot: Snapshot): void {
  creatures.length = 0;
  creatures.push(
    ...snapshot.creatures.map((c) => ({
      ...c,
      statusEffects: [...c.statusEffects],
      resourceUsage: c.resourceUsage ? { ...c.resourceUsage } : {},
    }))
  );
  inCombat = snapshot.inCombat;
  currentRound = snapshot.currentRound;
  currentTurnIndex = snapshot.currentTurnIndex;
  activityLog.length = 0;
  activityLog.push(...snapshot.activityLog.map((e) => ({ ...e })));
  hasAddedCreature = snapshot.hasAddedCreature;
  currentSessionName = snapshot.currentSessionName;
}

export function normalizeCommandTokens(parts: string[]): string[] {
  if (parts.length === 0) return parts;
  const first = parts[0]!.toLowerCase();
  const second = parts[1]?.toLowerCase();

  // 1. save ...
  if (first === "save" || first === "savegame") {
    if (second === "list" || second === "ls") {
      return ["saves", ...parts.slice(2)];
    }
    if (second === "load") {
      return ["load", "save", ...parts.slice(2)];
    }
    return parts;
  }

  // 2. game ...
  if (first === "game") {
    if (second === "new") {
      return ["new", "game", ...parts.slice(2)];
    }
    if (second === "load") {
      return ["load", "save", ...parts.slice(2)];
    }
    if (second === "save") {
      return ["save", ...parts.slice(2)];
    }
    if (second === "rename") {
      return ["rename", "save", ...parts.slice(2)];
    }
    if (second === "delete" || second === "del" || second === "rm" || second === "remove") {
      return ["delete", "save", ...parts.slice(2)];
    }
    if (second === "list" || second === "ls") {
      return ["saves", ...parts.slice(2)];
    }
    return parts;
  }

  // 3. char / creature ...
  if (first === "char" || first === "creature") {
    if (second === "add") {
      const third = parts[2]?.toLowerCase();
      if (third === "pc" || third === "p" || third === "enemy" || third === "e" || third === "neutral" || third === "n") {
        return ["add", parts[2]!, ...parts.slice(3)];
      }
      return ["add", "char", ...parts.slice(2)];
    }
    if (second === "remove" || second === "rm" || second === "del" || second === "delete") {
      const third = parts[2]?.toLowerCase();
      if (
        third === "pcs" || third === "pc" || third === "p" ||
        third === "enemies" || third === "enemy" || third === "e" ||
        third === "neutrals" || third === "neutral" || third === "n"
      ) {
        return ["remove", parts[2]!, ...parts.slice(3)];
      }
      return ["remove", "char", ...parts.slice(2)];
    }
    if (second === "rename") {
      return ["char", "rename", ...parts.slice(2)];
    }
    return parts;
  }

  // 4. pc / enemy / neutral ...
  if (first === "pc" || first === "pcs" || first === "enemy" || first === "enemies" || first === "neutral" || first === "neutrals") {
    const normType = first.startsWith("pc") ? "pc" : first.startsWith("en") ? "enemy" : "neutral";
    if (second === "add") {
      return ["add", normType, ...parts.slice(2)];
    }
    if (second === "remove" || second === "rm" || second === "del" || second === "delete") {
      return ["remove", normType, ...parts.slice(2)];
    }
    return parts;
  }

  // 5. type ...
  if (first === "type") {
    if (second === "set" || second === "change") {
      return ["set", "type", ...parts.slice(2)];
    }
    return ["set", "type", ...parts.slice(1)];
  }

  // 6. hp ...
  if (first === "hp") {
    if (second === "set") {
      return ["set", "hp", ...parts.slice(2)];
    }
    if (second === "clear" || second === "remove" || second === "rm" || second === "del" || second === "delete") {
      return ["clear", "hp", ...parts.slice(2)];
    }
    if (parts.length >= 2 && !isNaN(parseInt(parts[1]!, 10))) {
      return ["set", "hp", ...parts.slice(1)];
    }
    return parts;
  }

  // 7. ac ...
  if (first === "ac") {
    if (second === "set") {
      return ["set", "ac", ...parts.slice(2)];
    }
    if (second === "clear" || second === "remove" || second === "rm" || second === "del" || second === "delete") {
      return ["clear", "ac", ...parts.slice(2)];
    }
    if (parts.length >= 2 && !isNaN(parseInt(parts[1]!, 10))) {
      return ["set", "ac", ...parts.slice(1)];
    }
    return parts;
  }

  // 8. init / initiative ...
  if (first === "init" || first === "initiative") {
    if (second === "set") {
      return ["set", "init", ...parts.slice(2)];
    }
    if (second === "clear" || second === "remove" || second === "rm" || second === "del" || second === "delete") {
      return ["clear", "init", ...parts.slice(2)];
    }
    if (parts.length >= 2 && !isNaN(parseInt(parts[1]!, 10))) {
      return ["set", "init", ...parts.slice(1)];
    }
    return parts;
  }

  // 9. dmg / damage ...
  if (first === "dmg" || first === "damage") {
    if (second === "add" || second === "hurt") {
      return ["add", "dmg", ...parts.slice(2)];
    }
    if (second === "remove" || second === "rm" || second === "heal") {
      return ["remove", "dmg", ...parts.slice(2)];
    }
    if (second === "clear") {
      return ["clear", "dmg", ...parts.slice(2)];
    }
    if (second === "kill" || second === "max") {
      return ["add", "dmg", "max", ...parts.slice(2)];
    }
    if (parts.length >= 2 && (!isNaN(parseInt(parts[1]!, 10)) || parts[1]!.toLowerCase() === "max")) {
      return ["add", "dmg", ...parts.slice(1)];
    }
    return parts;
  }

  // 10. eff / cond / stat / status / effect / condition ...
  if (["eff", "effect", "effects", "cond", "condition", "stat", "status", "stats"].includes(first)) {
    if (second === "add") {
      return ["add", "eff", ...parts.slice(2)];
    }
    if (second === "remove" || second === "rm" || second === "del" || second === "delete") {
      return ["remove", "eff", ...parts.slice(2)];
    }
    return parts;
  }

  // 11. res / resource ...
  if (first === "res" || first === "resource") {
    if (second === "add" || second === "use") {
      return ["add", "res", ...parts.slice(2)];
    }
    if (second === "remove" || second === "rm" || second === "del" || second === "delete") {
      return ["remove", "res", ...parts.slice(2)];
    }
    if (second === "clear") {
      return ["clear", "res", ...parts.slice(2)];
    }
    return parts;
  }

  // 12. rxn / reaction ...
  if (first === "rxn" || first === "reaction") {
    if (second === "set" || second === "add" || second === "use") {
      return ["add", "rxn", ...parts.slice(2)];
    }
    if (second === "remove" || second === "rm" || second === "clear" || second === "del" || second === "reset") {
      return ["remove", "rxn", ...parts.slice(2)];
    }
    return parts;
  }

  // 13. turn ...
  if (first === "turn") {
    if (second === "next" || second === "n") {
      return ["next", ...parts.slice(2)];
    }
    if (second === "prev" || second === "p" || second === "previous" || second === "back") {
      return ["prev", ...parts.slice(2)];
    }
    return parts;
  }

  // 14. activity ...
  if (first === "activity") {
    if (!second || second === "show" || second === "list" || second === "log") {
      return ["show", "activity", ...parts.slice(2)];
    }
    return parts;
  }

  // 15. kill alias
  if (first === "kill") {
    return ["add", "dmg", "max", ...parts.slice(1)];
  }

  return parts;
}

function isUndoExemptCommand(input: string): boolean {
  const parts = normalizeCommandTokens(tokenize(input.trim()));
  const cmd = parts[0]?.toLowerCase();
  const exemptCmds = [
    "undo", "u",
    "redo", "r",
    "test",
    "new",
    "load", "loadgame",
    "save", "savegame",
    "rename",
    "delete", "del",
    "saves",
    "help", "h",
    "quit", "q", "exit",
    "show"
  ];
  return exemptCmds.includes(cmd ?? "");
}

function executeWithUndoTracking<T>(action: () => T, commandInput: string): T {
  if (isUndoExemptCommand(commandInput)) {
    const res = action();
    checkDeathStates();
    return res;
  }

  const pre = captureSnapshot();
  const res = action();
  checkDeathStates();
  const post = captureSnapshot();

  if (JSON.stringify(pre) !== JSON.stringify(post)) {
    undoStack.push({
      commandInput,
      snapshot: pre,
      timestamp: new Date().toISOString(),
    });
    redoStack.length = 0; // Clear redo history on new action
  }

  return res;
}

export function checkDeathStates(): void {
  for (const c of creatures) {
    if (c.hpMax !== null && c.dmg >= c.hpMax) {
      const hasDead = c.statusEffects.some(e => e.toLowerCase() === "dead");
      if (!hasDead) {
        c.statusEffects.push("Dead");
      }
    } else if (c.hpMax !== null && c.dmg < c.hpMax) {
      c.statusEffects = c.statusEffects.filter(e => e.toLowerCase() !== "dead");
    }
  }
}

export function executeUndo(): boolean {
  if (undoStack.length === 0) {
    return false;
  }
  const entry = undoStack.pop()!;
  const current = captureSnapshot();
  redoStack.push({
    commandInput: entry.commandInput,
    snapshot: current,
    timestamp: new Date().toISOString(),
  });
  restoreSnapshot(entry.snapshot);

  if (hasAddedCreature && currentSessionName) {
    saveState(currentSessionName);
  }
  return true;
}

export function executeRedo(): boolean {
  if (redoStack.length === 0) {
    return false;
  }
  const entry = redoStack.pop()!;
  const current = captureSnapshot();
  undoStack.push({
    commandInput: entry.commandInput,
    snapshot: current,
    timestamp: new Date().toISOString(),
  });
  restoreSnapshot(entry.snapshot);

  if (hasAddedCreature && currentSessionName) {
    saveState(currentSessionName);
  }
  return true;
}

export function getHistoryStacks() {
  return {
    undoLength: undoStack.length,
    redoLength: redoStack.length,
    undoStack: [...undoStack],
    redoStack: [...redoStack],
  };
}

export function getPendingCharTypePrompt() {
  return pendingCharTypePrompt;
}

function logActivity(message: string): void {
  activityLog.push({ timestamp: new Date().toISOString(), message });
}

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
    activityLog: [...activityLog],
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
      const mapped = data.creatures.map((c: any) => {
        const statusEffects = c.statusEffects ?? c.conditions ?? [];
        const resourceUsage = c.resourceUsage ?? {};
        return {
          name: c.name,
          type: c.type,
          hpMax: c.hpMax,
          dmg: c.dmg,
          ac: c.ac,
          initiative: c.initiative,
          statusEffects,
          reactionUsed: c.reactionUsed ?? false,
          resourceUsage,
        };
      });
      creatures.push(...mapped);
    }
    inCombat = Boolean(data.inCombat);
    currentRound = typeof data.currentRound === "number" ? data.currentRound : 1;
    currentTurnIndex = typeof data.currentTurnIndex === "number" ? data.currentTurnIndex : 0;
    pendingConfirmation = null;
    hasAddedCreature = creatures.length > 0;
    activityLog.length = 0;
    if (Array.isArray(data.activityLog)) {
      activityLog.push(...data.activityLog);
    }
    if (cleanName !== "current") {
      currentSessionName = cleanName;
    }

    undoStack.length = 0;
    redoStack.length = 0;

    checkDeathStates();
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

export function getLatestSave(): { name: string; count: number; savedAt: string; filepath: string } | null {
  const saves = listSaves();
  if (saves.length === 0) return null;

  saves.sort((a, b) => {
    const timeA = a.savedAt !== "Unknown" ? new Date(a.savedAt).getTime() : 0;
    const timeB = b.savedAt !== "Unknown" ? new Date(b.savedAt).getTime() : 0;
    if (timeA !== timeB && !isNaN(timeA) && !isNaN(timeB)) {
      return timeB - timeA;
    }
    try {
      const mtimeA = fs.statSync(a.filepath).mtimeMs;
      const mtimeB = fs.statSync(b.filepath).mtimeMs;
      return mtimeB - mtimeA;
    } catch {
      return 0;
    }
  });

  return saves[0] ?? null;
}

export interface StartupOptions {
  fresh?: boolean;
  saveName?: string;
}

export function initializeSession(options: StartupOptions = {}): {
  loaded: boolean;
  sessionName: string | null;
  error?: string;
} {
  if (options.fresh) {
    resetState();
    return { loaded: false, sessionName: null };
  }

  if (options.saveName) {
    const res = loadState(options.saveName);
    if (res.ok) {
      return { loaded: true, sessionName: res.name };
    } else {
      resetState();
      return { loaded: false, sessionName: null, error: res.error };
    }
  }

  const latest = getLatestSave();
  if (latest) {
    const res = loadState(latest.name);
    if (res.ok) {
      return { loaded: true, sessionName: res.name };
    } else {
      resetState();
      return { loaded: false, sessionName: null, error: res.error };
    }
  }

  resetState();
  return { loaded: false, sessionName: null };
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

export function renameSession(newName: string): { ok: true; oldName: string | null; newName: string } | { ok: false; error: string } {
  if (!newName || !newName.trim()) {
    return { ok: false, error: "Please specify a new session name." };
  }

  const cleanNewName = newName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  const oldName = currentSessionName;

  ensureSavesDir();

  if (oldName && oldName !== "Unsaved") {
    const oldPath = path.resolve(SAVES_DIR, `${oldName}.json`);
    const newPath = path.resolve(SAVES_DIR, `${cleanNewName}.json`);

    if (fs.existsSync(oldPath) && oldPath !== newPath) {
      try {
        fs.renameSync(oldPath, newPath);
      } catch {
        // ignore error if file missing or rename fails
      }
    }
  }

  currentSessionName = cleanNewName;
  saveState(cleanNewName);
  return { ok: true, oldName, newName: cleanNewName };
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
  checkDeathStates();
  const sorted = getSortedCreatures();
  const allDead = sorted.every(c => c.statusEffects.some(e => e.toLowerCase() === "dead"));
  if (allDead) return;

  for (let i = 0; i < count; i++) {
    let loops = 0;
    do {
      currentTurnIndex++;
      if (currentTurnIndex >= sorted.length) {
        currentTurnIndex = 0;
        currentRound++;
      }
      loops++;
      if (loops > sorted.length) break;
    } while (sorted[currentTurnIndex]?.statusEffects.some(e => e.toLowerCase() === "dead"));

    const active = sorted[currentTurnIndex];
    if (active) {
      active.reactionUsed = false;
    }
  }
}

function prevTurn(count = 1): void {
  if (!inCombat || creatures.length === 0) return;
  checkDeathStates();
  const sorted = getSortedCreatures();
  const allDead = sorted.every(c => c.statusEffects.some(e => e.toLowerCase() === "dead"));
  if (allDead) return;

  for (let i = 0; i < count; i++) {
    let loops = 0;
    do {
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
      loops++;
      if (loops > sorted.length) break;
    } while (sorted[currentTurnIndex]?.statusEffects.some(e => e.toLowerCase() === "dead"));

    const active = sorted[currentTurnIndex];
    if (active) {
      active.reactionUsed = false;
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

export function parseCreatureType(str: string): CreatureType | null {
  const s = str.toLowerCase();
  if (s === "pcs" || s === "pc" || s === "p" || s === "player") return "pc";
  if (s === "enemies" || s === "enemy" || s === "e") return "enemy";
  if (s === "neutrals" || s === "neutral" || s === "n") return "neutral";
  return null;
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
  checkDeathStates();
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
  const padding = Math.max(2, 100 - leftVisLen - rightVisLen);

  console.log(`${titleLeft}${" ".repeat(padding)}${sessionRight}`);
  console.log(`${DIM}${"─".repeat(100)}${RESET}`);

  if (creatures.length === 0) {
    console.log(`${DIM}  No creatures yet. Use "char add pc n1 n2" to begin.${RESET}`);
  } else {
    // Header
    const hdr = inCombat
      ? `  ${pad("Name", 22)}${pad("Type", 10)}${pad("HP Max", 8)}${pad("Dmg", 6)}${pad("AC", 6)}${pad("Init", 6)}${pad("Rxn", 6)}${pad("Resource Usage", 18)}${"Status Effects"}`
      : `  ${pad("Name", 22)}${pad("Type", 10)}${pad("HP Max", 8)}${pad("Dmg", 6)}${pad("AC", 6)}${pad("Init", 6)}${pad("Resource Usage", 18)}${"Status Effects"}`;
    console.log(`${BOLD}${CYAN}${hdr}${RESET}`);
    console.log(`${DIM}  ${"─".repeat(inCombat ? 100 : 94)}${RESET}`);

    sorted.forEach((c, idx) => {
      const isTurn = inCombat && idx === currentTurnIndex;
      const isDead = c.statusEffects.some(e => e.toLowerCase() === "dead");
      const displayName = isDead ? `💀 ${c.name}` : c.name;

      const color = typeColor(c.type);
      const name = pad(displayName, 22);
      const type = pad(typeLabel(c.type), 10);
      const hpMax = pad(fmt(c.hpMax), 8);
      const dmg = pad(c.dmg > 0 ? String(c.dmg) : "—", 6);
      const ac = pad(fmt(c.ac), 6);
      const init = pad(fmt(c.initiative), 6);
      const rxn = inCombat ? pad(c.reactionUsed ? "✓" : "—", 6) : "";

      const resourceStrings = Object.entries(c.resourceUsage ?? {})
        .filter(([_, val]) => val !== 0)
        .map(([rname, val]) => `${rname}=${val}`);

      const prefixWidthBeforeRes = inCombat ? 66 : 60;
      const prefixWidth = prefixWidthBeforeRes + 18;
      const statusWidth = Math.max(15, 100 - prefixWidth);

      const resLines = wrapStatusEffects(resourceStrings, 16);
      const effectLines = wrapStatusEffects(c.statusEffects, statusWidth);
      const maxLines = Math.max(resLines.length, effectLines.length);

      for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
        const resLine = resLines[lineIdx] ?? "";
        const effectLine = effectLines[lineIdx] ?? "";
        const resPart = pad(resLine, 18);

        if (lineIdx === 0) {
          const rowContent = `${name}${type}${hpMax}${dmg}${ac}${init}${rxn}${resPart}${effectLine}`;
          if (isDead) {
            if (isTurn) {
              const prefix = `${BOLD}${MAGENTA}▶ ${RESET}`;
              console.log(`${prefix}${RED}${DIM}${rowContent}${RESET}`);
            } else {
              console.log(`  ${RED}${DIM}${rowContent}${RESET}`);
            }
          } else {
            if (isTurn) {
              const prefix = `${BOLD}${MAGENTA}▶ ${RESET}`;
              console.log(`${prefix}${BOLD}${CYAN}${name}${RESET}${color}${type}${RESET}${BOLD}${CYAN}${hpMax}${dmg}${ac}${init}${rxn}${resPart}${effectLine}${RESET}`);
            } else {
              console.log(`  ${BOLD}${name}${RESET}${color}${type}${RESET}${hpMax}${dmg}${ac}${init}${rxn}${resPart}${effectLine}`);
            }
          }
        } else {
          const indentBeforeRes = " ".repeat(prefixWidthBeforeRes - 2);
          const subRowContent = `${indentBeforeRes}${resPart}${effectLine}`;
          if (isDead) {
            console.log(`  ${RED}${DIM}${subRowContent}${RESET}`);
          } else {
            if (isTurn) {
              console.log(`  ${BOLD}${CYAN}${subRowContent}${RESET}`);
            } else {
              console.log(`  ${subRowContent}`);
            }
          }
        }
      }
    });
  }

  console.log(`${DIM}${"─".repeat(100)}${RESET}`);
  console.log(`${DIM}  help (h) · quit (q) · <field|entity> <command> <value> <target>...${RESET}\n`);
}

// --- Helpers ---

export function wrapStatusEffects(effects: string[], width: number): string[] {
  if (effects.length === 0) return [""];
  const lines: string[] = [];
  let currentLine = "";

  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i]!;
    const nextWord = currentLine === "" ? effect : ", " + effect;
    if (currentLine.length + nextWord.length <= width) {
      currentLine += nextWord;
    } else {
      if (currentLine !== "") {
        lines.push(currentLine);
      }
      currentLine = effect;
    }
  }
  if (currentLine !== "") {
    lines.push(currentLine);
  }
  return lines;
}

export function tokenize(input: string): string[] {
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
  return {
    ok: false,
    error: `Ambiguous match "${identifier}" — matches: ${names}.`,
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

export const OLD_DISALLOWED_COMMANDS = new Set([
  "add",
  "set",
  "remove",
  "rm",
  "clear",
  "delete",
  "del",
  "load",
  "loadgame",
  "new",
  "rename",
  "saves",
  "list",
  "hurt",
  "heal",
  "use",
  "change",
  "show",
  "next",
  "prev",
  "n",
  "p",
  "start",
  "end",
]);

function handleCommandInternal(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return true; // empty input, just re-render
  }

  const rawParts = tokenize(trimmed);
  if (rawParts.length === 0) {
    return true;
  }
  const rawFirst = rawParts[0]!.toLowerCase();

  if (OLD_DISALLOWED_COMMANDS.has(rawFirst)) {
    renderTable();
    console.log(`${RED}Unknown command: "${trimmed}". Type "help" for commands.${RESET}\n`);
    return true;
  }

  let parts = normalizeCommandTokens(rawParts);
  let cmd = parts[0]?.toLowerCase();

  if (!cmd) {
    return true; // empty input, just re-render
  }

  if (cmd === "undo" || cmd === "u") {
    let count = 1;
    if (parts[1]) {
      const parsed = parseInt(parts[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        count = parsed;
      }
    }

    let undoneCount = 0;
    const undoneActions: string[] = [];
    for (let i = 0; i < count; i++) {
      const lastUndoEntry = undoStack[undoStack.length - 1];
      if (executeUndo()) {
        undoneCount++;
        if (lastUndoEntry) {
          undoneActions.push(lastUndoEntry.commandInput);
        }
      } else {
        break;
      }
    }

    renderTable();
    if (undoneCount > 0) {
      if (undoneCount === 1) {
        console.log(`${GREEN}✓ Undid command: "${undoneActions[0]}"${RESET}\n`);
      } else {
        console.log(`${GREEN}✓ Undid ${undoneCount} commands: ${undoneActions.map(a => `"${a}"`).join(", ")}${RESET}\n`);
      }
    } else {
      console.log(`${YELLOW}Nothing to undo.${RESET}\n`);
    }
    return true;
  }

  if (cmd === "redo" || cmd === "r") {
    let count = 1;
    if (parts[1]) {
      const parsed = parseInt(parts[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        count = parsed;
      }
    }

    let redoneCount = 0;
    const redoneActions: string[] = [];
    for (let i = 0; i < count; i++) {
      const lastRedoEntry = redoStack[redoStack.length - 1];
      if (executeRedo()) {
        redoneCount++;
        if (lastRedoEntry) {
          redoneActions.push(lastRedoEntry.commandInput);
        }
      } else {
        break;
      }
    }

    renderTable();
    if (redoneCount > 0) {
      if (redoneCount === 1) {
        console.log(`${GREEN}✓ Redid command: "${redoneActions[0]}"${RESET}\n`);
      } else {
        console.log(`${GREEN}✓ Redid ${redoneCount} commands: ${redoneActions.map(a => `"${a}"`).join(", ")}${RESET}\n`);
      }
    } else {
      console.log(`${YELLOW}Nothing to redo.${RESET}\n`);
    }
    return true;
  }

  if (cmd === "quit" || cmd === "exit" || cmd === "q") {
    pendingQuitConfirmation = true;
    renderTable();
    return true;
  }

  if (cmd === "help" || cmd === "h") {
    renderTable();
    console.log(`${BOLD}Available commands:${RESET}\n`);

    const filter = parts.length > 1 ? parts.slice(1).join(" ").toLowerCase() : null;

    interface HelpCategory {
      title: string;
      lines: { command: string; desc: string }[];
    }

    const HELP_DATA: HelpCategory[] = [
      {
        title: "Creature Management",
        lines: [
          { command: "char add [pc | enemy | neutral] <name>...", desc: "Add creature(s) by type or prompt" },
          { command: "(pc | enemy | neutral) add <name>...", desc: "Add creature(s) of specified type" },
          { command: "char remove <target>...", desc: "Remove specific creature(s) by name" },
          { command: "(pc | enemy | neutral) remove", desc: "Bulk remove creatures by type" },
          { command: "char rename <target> <new_name>", desc: "Rename an existing character" },
          { command: "type set (pc | enemy | neutral) <target>...", desc: "Change character type" },
        ]
      },
      {
        title: "Combat & Turn Control",
        lines: [
          { command: "(combat | c) [start]", desc: "Start combat mode (resorts by initiative)" },
          { command: "(combat | c) end", desc: "End combat mode (clears init & dmg)" },
          { command: "turn (next | prev) [<count>]", desc: "Advance or rewind 1 or <count> turns" },
          { command: "rxn set <target>...", desc: "Mark creature reaction as used" },
          { command: "rxn remove <target>...", desc: "Restore creature reaction" },
        ]
      },
      {
        title: "Stats & Status Effects",
        lines: [
          { command: "hp set <value> <target>...", desc: "Set HP max (supports multiple targets or pairs)" },
          { command: "hp clear (all | <target>...)", desc: "Clear HP max for target(s) or all" },
          { command: "ac set <value> <target>...", desc: "Set AC (supports multiple targets or pairs)" },
          { command: "ac clear (all | <target>...)", desc: "Clear AC for target(s) or all" },
          { command: "init set <value> <target>...", desc: "Set initiative (supports multiple targets or pairs)" },
          { command: "init clear (all | <target>...)", desc: "Clear initiative for target(s) or all" },
          { command: "dmg add (<value> | max) <target>...", desc: "Add damage or set to max HP (kill) for target(s)" },
          { command: "kill <target>...", desc: "Instantly set dmg to max HP (Dead) for target(s)" },
          { command: "dmg remove <value> <target>...", desc: "Heal/subtract damage from target(s)" },
          { command: "dmg clear (all | <target>...)", desc: "Clear damage for target(s) or all" },
          { command: "eff add <effect> <target>...", desc: "Add status effect to target(s)" },
          { command: "eff remove <effect> <target>...", desc: "Remove status effect from target(s)" },
          { command: "res (add | use) <resource> <target>...", desc: "Add/increment resource usage for target(s)" },
          { command: "res remove <resource> <target>...", desc: "Remove/decrement resource usage from target(s)" },
          { command: "res clear (all | <target>...)", desc: "Clear resource usage for target(s) or all" },
        ]
      },
      {
        title: "Game State & Storage",
        lines: [
          { command: "save list", desc: "List all saved game files with paths" },
          { command: "save delete [<name>...]", desc: "Delete save file(s) (or list options)" },
          { command: "save load [<name>]", desc: "Load saved game state (or list options)" },
          { command: "save rename [<new_name>]", desc: "Rename current game session" },
          { command: "save [<name>]", desc: "Save game session snapshot (or prompt)" },
          { command: "game new", desc: "Start a fresh new game session" },
          { command: "game list", desc: "List all saved game files" },
          { command: "game load [<name>]", desc: "Load saved game session snapshot" },
          { command: "game save [<name>]", desc: "Save game session snapshot" },
          { command: "game rename [<new_name>]", desc: "Rename current game session" },
          { command: "game delete [<name>...]", desc: "Delete saved game file(s)" },
        ]
      },
      {
        title: "Utilities",
        lines: [
          { command: "activity show", desc: "Show all actions logged in this session" },
          { command: "(help | h) [<filter>]", desc: "Show this help menu (supports optional filter)" },
          { command: "(undo | u) [<count>]", desc: "Revert the last 1 or <count> mutating actions" },
          { command: "(redo | r) [<count>]", desc: "Re-apply the last 1 or <count> undone actions" },
          { command: "test [simple]", desc: "Load test data encounter" },
          { command: "(quit | q | exit)", desc: "Exit the application" },
        ]
      }
    ];

    HELP_DATA.forEach(cat => {
      console.log(`  ${BOLD}${MAGENTA}${cat.title}:${RESET}`);
      cat.lines.forEach(line => {
        const isMatch = filter ? (line.command.toLowerCase().includes(filter) || line.desc.toLowerCase().includes(filter)) : false;
        if (isMatch) {
          console.log(`${BOLD}${YELLOW}    ${pad(line.command, 44)} ${line.desc}${RESET}`);
        } else {
          console.log(`    ${CYAN}${pad(line.command, 44)}${RESET} ${line.desc}`);
        }
      });
      console.log();
    });

    return true;
  }

  if (cmd === "new") {
    if (parts[1]?.toLowerCase() !== "game") {
      renderTable();
      console.log(`${RED}Too ambiguous — perhaps you meant: ${BOLD}new game${RESET}\n`);
      return true;
    }
    resetState();
    renderTable();
    console.log(`${GREEN}✓ Started a fresh new game.${RESET}\n`);
    return true;
  }

  if (cmd === "rename") {
    const subCmd = parts[1]?.toLowerCase();
    const isSave = subCmd === "save" || subCmd === "session" || subCmd === "game";

    if (!isSave) {
      renderTable();
      console.log(`${RED}Too ambiguous — perhaps you meant: ${BOLD}rename save [<new_name>]${RESET}\n`);
      return true;
    }

    const newName = parts[2];

    if (!newName) {
      const presetName = generateRandomSaveName();
      pendingRenamePrompt = { defaultName: presetName };
      renderTable();
      console.log(`${DIM}Save Directory: ${path.resolve(SAVES_DIR)}${RESET}`);
      console.log(`${BOLD}Renaming game session:${RESET}`);
      console.log(`Default session name: ${CYAN}${presetName}${RESET}\n`);
      return true;
    }

    const res = renameSession(newName);
    renderTable();
    if (res.ok) {
      const filepath = path.resolve(SAVES_DIR, `${res.newName}.json`);
      console.log(`${GREEN}✓ Renamed game session to "${res.newName}" at "${filepath}".${RESET}\n`);
    } else {
      console.log(`${RED}${res.error}${RESET}\n`);
    }
    return true;
  }

  if (cmd === "char" || cmd === "creature") {
    const subCmd = parts[1]?.toLowerCase();
    if (subCmd === "rename") {
      const args = parts.slice(2);
      if (args.length !== 2) {
        renderTable();
        console.log(`${RED}Usage: char rename <target> <new_name>${RESET}\n`);
        return true;
      }

      const arg1 = args[0]!;
      const arg2 = args[1]!;

      const res1 = findCreaturesForIdentifier(arg1);
      const res2 = findCreaturesForIdentifier(arg2);

      let targetCreature: Creature;
      let newName: string;

      if (res1.ok && !res2.ok) {
        targetCreature = res1.creatures[0]!;
        newName = arg2;
      } else if (!res1.ok && res2.ok) {
        targetCreature = res2.creatures[0]!;
        newName = arg1;
      } else if (res1.ok && res2.ok) {
        if (res1.creatures[0] === res2.creatures[0]) {
          renderTable();
          console.log(`${YELLOW}Creature is already named "${res1.creatures[0]!.name}".${RESET}\n`);
          return true;
        }
        renderTable();
        console.log(`${RED}A creature named "${res2.creatures[0]!.name}" already exists.${RESET}\n`);
        return true;
      } else {
        renderTable();
        if (res1.error.startsWith("Ambiguous")) {
          console.log(`${RED}${res1.error}${RESET}\n`);
        } else if (res2.error.startsWith("Ambiguous")) {
          console.log(`${RED}${res2.error}${RESET}\n`);
        } else {
          console.log(`${RED}${res1.error}${RESET}\n`);
        }
        return true;
      }

      const trimmedNewName = newName.trim();
      if (!trimmedNewName) {
        renderTable();
        console.log(`${RED}New name cannot be empty.${RESET}\n`);
        return true;
      }

      const duplicate = creatures.find(
        (c) => c !== targetCreature && c.name.toLowerCase() === trimmedNewName.toLowerCase()
      );
      if (duplicate) {
        renderTable();
        console.log(`${RED}A creature named "${duplicate.name}" already exists.${RESET}\n`);
        return true;
      }

      const oldName = targetCreature.name;
      targetCreature.name = trimmedNewName;

      renderTable();
      console.log(`${GREEN}✓ Renamed creature "${oldName}" to "${targetCreature.name}".${RESET}\n`);
      logActivity(`Renamed creature "${oldName}" to "${targetCreature.name}"`);
      return true;
    }
  }

  if (cmd === "save" || cmd === "savegame") {
    const subCmd = parts[1]?.toLowerCase();
    if (subCmd === "rename") {
      const newName = parts[2];
      if (!newName) {
        const presetName = generateRandomSaveName();
        pendingRenamePrompt = { defaultName: presetName };
        renderTable();
        console.log(`${DIM}Save Directory: ${path.resolve(SAVES_DIR)}${RESET}`);
        console.log(`${BOLD}Renaming game session:${RESET}`);
        console.log(`Default session name: ${CYAN}${presetName}${RESET}\n`);
        return true;
      }
      const res = renameSession(newName);
      renderTable();
      if (res.ok) {
        const filepath = path.resolve(SAVES_DIR, `${res.newName}.json`);
        console.log(`${GREEN}✓ Renamed game session to "${res.newName}" at "${filepath}".${RESET}\n`);
      } else {
        console.log(`${RED}${res.error}${RESET}\n`);
      }
      return true;
    }

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
        console.log(`${DIM}Save Directory: ${path.resolve(SAVES_DIR)}${RESET}`);
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
        console.log(`${GREEN}✓ Deleted saved game(s) from "${path.resolve(SAVES_DIR)}": ${deleted.join(", ")}.${RESET}`);
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
      console.log(`${DIM}Save Directory: ${path.resolve(SAVES_DIR)}${RESET}`);
      console.log(`${BOLD}Saving game session:${RESET}`);
      console.log(`Default session name: ${CYAN}${presetName}${RESET}\n`);
      return true;
    }

    const res = saveState(saveName);
    renderTable();
    const filepath = path.resolve(SAVES_DIR, `${res.name}.json`);
    if (res.isNew) {
      console.log(`${GREEN}✓ Created new save state "${res.name}" at "${filepath}".${RESET}\n`);
    } else {
      console.log(`${GREEN}✓ Saved game state to "${res.name}" at "${filepath}".${RESET}\n`);
    }
    return true;
  }

  if (cmd === "delete" || cmd === "del") {
    const subCmd = parts[1]?.toLowerCase() ?? "";
    const isSave = subCmd === "save" || subCmd === "savegame" || subCmd === "saves";

    if (!isSave) {
      renderTable();
      console.log(`${RED}Too ambiguous — perhaps you meant: ${BOLD}delete save [<name>...]${RESET}\n`);
      return true;
    }

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
      console.log(`${DIM}Save Directory: ${path.resolve(SAVES_DIR)}${RESET}`);
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
      console.log(`${GREEN}✓ Deleted saved game(s) from "${path.resolve(SAVES_DIR)}": ${deleted.join(", ")}.${RESET}`);
    }
    if (errors.length > 0) {
      console.log(`${RED}${errors.join(" ")}${RESET}`);
    }
    console.log();
    return true;
  }

  if (cmd === "load" || cmd === "loadgame") {
    const subCmd = parts[1]?.toLowerCase();
    const isSave = subCmd === "save" || subCmd === "savegame" || subCmd === "saves";

    if (!isSave && !subCmd) {
      renderTable();
      console.log(`${RED}Too ambiguous — perhaps you meant: ${BOLD}load save [<name>]${RESET}\n`);
      return true;
    }

    // Allow both "load save <name>" and "load <name>" (direct named load)
    const saveName = isSave ? parts[2] : parts[1];

    if (!saveName) {
      const savesList = listSaves();
      if (savesList.length === 0) {
        renderTable();
        console.log(`${YELLOW}No saved games found to load.${RESET}\n`);
        return true;
      }

      pendingSaveSelection = { saves: savesList };
      renderTable();
      console.log(`${DIM}Save Directory: ${path.resolve(SAVES_DIR)}${RESET}`);
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
      const filepath = path.resolve(SAVES_DIR, `${result.name}.json`);
      console.log(`${GREEN}✓ Loaded game state from "${result.name}" at "${filepath}" (${creatures.length} creatures).${RESET}\n`);
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

  if (cmd === "combat" || cmd === "c" || (cmd === "start" && (parts[1]?.toLowerCase() === "combat" || parts[1]?.toLowerCase() === "c"))) {
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

    if (inCombat) {
      renderTable();
      console.log(`${RED}Combat has already started.${RESET}\n`);
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
    checkDeathStates();
    const sorted = getSortedCreatures();
    
    const allDead = sorted.every(c => c.statusEffects.some(e => e.toLowerCase() === "dead"));
    if (!allDead) {
      while (sorted[currentTurnIndex]?.statusEffects.some(e => e.toLowerCase() === "dead")) {
        currentTurnIndex++;
        if (currentTurnIndex >= sorted.length) {
          currentTurnIndex = 0;
          currentRound++;
        }
      }
    }

    const active = sorted[currentTurnIndex];
    if (active) {
      active.reactionUsed = false;
    }
    renderTable();
    console.log(`${GREEN}⚔ Combat started! Round 1 — ${BOLD}${active ? active.name : ""}'s turn${RESET}\n`);
    logActivity(`⚔ Combat started (Round 1 — ${active ? active.name : ""}'s turn)`);
    return true;
  }

  if (cmd === "end" && (parts[1]?.toLowerCase() === "combat" || parts[1]?.toLowerCase() === "c")) {
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
      console.log(`${RED}Not in combat mode. Type "combat" or "c" to start combat.${RESET}\n`);
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
    logActivity(`► Round ${currentRound} — Turn: ${active ? active.name : ""}${stepMsg}`);
    return true;
  }

  if (cmd === "prev" || cmd === "p") {
    if (!inCombat) {
      renderTable();
      console.log(`${RED}Not in combat mode. Type "combat" or "c" to start combat.${RESET}\n`);
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
    logActivity(`◄ Round ${currentRound} — Turn: ${active ? active.name : ""}${stepMsg}`);
    return true;
  }

  if (cmd === "add") {
    let rawSub = parts[1]?.toLowerCase() ?? "";
    if (rawSub === "p" || rawSub === "pcs") rawSub = "pc";
    if (rawSub === "e" || rawSub === "enemies") rawSub = "enemy";
    if (rawSub === "n" || rawSub === "neutrals") rawSub = "neutral";
    if (rawSub === "rxn" || rawSub === "reaction") rawSub = "rxn";
    if (rawSub === "res") rawSub = "res";
    if (rawSub === "stat" || rawSub === "status" || rawSub === "stats") rawSub = "eff";
    const subCmd = rawSub;
    const addOptions = ["pc", "char", "enemy", "neutral", "dmg", "cond", "condition", "eff", "effect", "effects", "rxn", "res", "stat", "status", "stats"];
    const matched = matchPrefix(subCmd, addOptions);

    // --- rxn set <target>... ---
    if (matched === "rxn") {
      const targets = parts.slice(2);
      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: rxn set <target>...${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      for (const creature of result.creatures) {
        creature.reactionUsed = true;
      }

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Reaction marked as used for ${names}.${RESET}\n`);
      logActivity(`Reaction marked as used for ${names}`);
      return true;
    }

    // --- res (add | use) <resource> <target>... ---
    if (matched === "res") {
      const resNameInput = parts[2];
      const targets = parts.slice(3);

      if (!resNameInput || targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: res (add | use) <resource> <target>...${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      for (const creature of result.creatures) {
        if (!creature.resourceUsage) {
          creature.resourceUsage = {};
        }

        const keys = Object.keys(creature.resourceUsage);
        const lowerInput = resNameInput.toLowerCase();
        const exactKey = keys.find(k => k.toLowerCase() === lowerInput);
        let targetKey = exactKey;

        if (!targetKey) {
          const matchingKeys = keys.filter(k => k.toLowerCase().startsWith(lowerInput));
          if (matchingKeys.length > 0) {
            targetKey = matchingKeys[0]!;
          }
        }

        if (targetKey) {
          creature.resourceUsage[targetKey] = (creature.resourceUsage[targetKey] ?? 0) + 1;
        } else {
          creature.resourceUsage[resNameInput] = 1;
        }
      }

      renderTable();
      const updates = result.creatures.map(c => {
        const keys = Object.keys(c.resourceUsage ?? {});
        const lowerInput = resNameInput.toLowerCase();
        const targetKey = keys.find(k => k.toLowerCase() === lowerInput) || keys.find(k => k.toLowerCase().startsWith(lowerInput)) || resNameInput;
        return `${c.name}: ${targetKey}=${c.resourceUsage![targetKey]}`;
      }).join(", ");

      console.log(`${GREEN}✓ ${updates}${RESET}\n`);
      logActivity(`Incremented resource "${resNameInput}" for ${result.creatures.map(c => c.name).join(", ")}`);
      return true;
    }

    // --- eff add <effect> <target>... ---
    if (matched === "cond" || matched === "condition" || matched === "eff" || matched === "effect" || matched === "effects" || matched === "stat" || matched === "status" || matched === "stats") {
      const cond = parts[2];
      const targets = parts.slice(3);

      if (!cond || targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: eff add <effect> <target>...${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      for (const creature of result.creatures) {
        if (!creature.statusEffects.includes(cond)) {
          creature.statusEffects.push(cond);
        }
      }

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ ${names}: +effect "${cond}"${RESET}\n`);
      logActivity(`Added status effect "${cond}" to ${names}`);
      return true;
    }

    // --- dmg add (<value> | max) <target>... ---
    if (matched === "dmg") {
      const rawVal = parts[2];
      const targets = parts.slice(3);

      if (!rawVal || targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: dmg add (<value> | max) <target>... or kill <target>...${RESET}\n`);
        return true;
      }

      const isMax = rawVal.toLowerCase() === "max" || rawVal.toLowerCase() === "m";
      let val = 0;
      if (!isMax) {
        val = parseInt(rawVal, 10);
        if (isNaN(val)) {
          renderTable();
          console.log(`${RED}"${rawVal}" is not a valid number.${RESET}\n`);
          return true;
        }
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      if (isMax) {
        for (const creature of result.creatures) {
          if (creature.hpMax === null) {
            creature.hpMax = 0;
          }
          creature.dmg = creature.hpMax;
          if (!creature.statusEffects.some(e => e.toLowerCase() === "dead")) {
            creature.statusEffects.push("Dead");
          }
        }

        renderTable();
        const names = result.creatures.map((c) => c.name).join(", ");
        console.log(`${GREEN}✓ ${names}: killed (dmg set to max HP)${RESET}\n`);
        logActivity(`Killed ${names} (dmg set to max HP)`);
        return true;
      }

      for (const creature of result.creatures) {
        creature.dmg += val;
      }

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ ${names}: dmg +${val}${RESET}\n`);
      logActivity(`Dealt ${val} damage to ${names}`);
      return true;
    }

    // --- char add [pc | enemy | neutral] <name>... ---
    const targets = parts.slice(2);

    if (targets.length === 0) {
      renderTable();
      console.log(`${RED}Usage: char add [pc | enemy | neutral] <name>...${RESET}\n`);
      return true;
    }

    if (matched === "char") {
      pendingCharTypePrompt = { names: targets };
      renderTable();
      return true;
    }

    let type: CreatureType;
    switch (matched) {
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

    const isFirstPcInBlankSession = type === "pc" && !currentSessionName;

    withTurnPreservation(() => {
      for (const name of targets) {
        creatures.push({ name, type, hpMax: null, dmg: 0, ac: null, initiative: null, statusEffects: [], resourceUsage: {} });
      }
    });
    hasAddedCreature = true;

    let createdSaveMsg: string | null = null;
    if (isFirstPcInBlankSession) {
      const generatedName = generateRandomSaveName();
      currentSessionName = generatedName;
      const res = saveState(generatedName);
      const filepath = path.resolve(SAVES_DIR, `${res.name}.json`);
      if (res.isNew) {
        createdSaveMsg = `✓ Created new save state "${res.name}" at "${filepath}".`;
      }
    }

    renderTable();
    console.log(`${GREEN}+ Added ${typeLabel(type)}: ${targets.join(", ")}${RESET}`);
    if (createdSaveMsg) {
      console.log(`${GREEN}${createdSaveMsg}${RESET}`);
    }
    console.log();
    logActivity(`Added ${typeLabel(type)}: ${targets.join(", ")}`);
    return true;
  }

  if (cmd === "clear") {
    const subCmd = parts[1]?.toLowerCase() ?? "";
    const isInit = matchPrefix(subCmd, ["init", "initiative"]) !== null;
    const isDmg = matchPrefix(subCmd, ["dmg", "damage"]) !== null;
    const isHp = matchPrefix(subCmd, ["hp"]) !== null;
    const isAc = matchPrefix(subCmd, ["ac"]) !== null;
    const isResource = matchPrefix(subCmd, ["res"]) !== null;

    if (isResource) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear resource usage (e.g., "clear res all" or "clear res Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.resourceUsage = {};
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared all resource usages for all creatures.${RESET}\n`);
        logActivity("Cleared all resource usages for all creatures");
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
          c.resourceUsage = {};
        }
      });

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Cleared all resource usages for ${names}.${RESET}\n`);
      logActivity(`Cleared all resource usages for ${names}`);
      return true;
    }

    if (isInit) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear initiative (e.g., "clear init all" or "clear init Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.initiative = null;
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared initiative for all creatures.${RESET}\n`);
        logActivity("Cleared initiative for all creatures");
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
      logActivity(`Cleared initiative for ${names}`);
      return true;
    }

    if (isDmg) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear damage (e.g., "clear dmg all" or "clear dmg Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.dmg = 0;
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared damage for all creatures.${RESET}\n`);
        logActivity("Cleared damage for all creatures");
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
      logActivity(`Cleared damage for ${names}`);
      return true;
    }

    if (isHp) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear HP max (e.g., "clear hp all" or "clear hp Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.hpMax = null;
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared HP max for all creatures.${RESET}\n`);
        logActivity("Cleared HP max for all creatures");
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
          c.hpMax = null;
        }
      });

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Cleared HP max for ${names}.${RESET}\n`);
      logActivity(`Cleared HP max for ${names}`);
      return true;
    }

    if (isAc) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear AC (e.g., "clear ac all" or "clear ac Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.ac = null;
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared AC for all creatures.${RESET}\n`);
        logActivity("Cleared AC for all creatures");
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
          c.ac = null;
        }
      });

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Cleared AC for ${names}.${RESET}\n`);
      logActivity(`Cleared AC for ${names}`);
      return true;
    }

    renderTable();
    console.log(`${RED}Usage: (hp | ac | init | dmg | res) clear (all | <target>...)${RESET}\n`);
    return true;
  }

  if (cmd === "set") {
    const fieldInput = parts[1]?.toLowerCase() ?? "";
    if (fieldInput === "rxn" || fieldInput === "reaction") {
      const targets = parts.slice(2);
      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: rxn set <target>...${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      for (const creature of result.creatures) {
        creature.reactionUsed = true;
      }

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Reaction marked as used for ${names}.${RESET}\n`);
      logActivity(`Reaction marked as used for ${names}`);
      return true;
    }

    if (fieldInput === "type") {
      const args = parts.slice(2);
      if (args.length === 0) {
        renderTable();
        console.log(`${RED}Usage: type set <pc|enemy|neutral> <target>...${RESET}\n`);
        return true;
      }

      type TypeUpdateItem = { type: CreatureType; rawTarget: string };
      const parsedItems: TypeUpdateItem[] = [];

      const firstType = parseCreatureType(args[0]!);

      // Check if alternating pairs: even length, every even index is a valid type
      let isPairs = args.length >= 2 && args.length % 2 === 0;
      if (isPairs) {
        for (let i = 0; i < args.length; i += 2) {
          if (!parseCreatureType(args[i]!)) {
            isPairs = false;
            break;
          }
        }
      }

      if (isPairs) {
        for (let i = 0; i < args.length; i += 2) {
          parsedItems.push({
            type: parseCreatureType(args[i]!)!,
            rawTarget: args[i + 1]!,
          });
        }
      } else if (firstType) {
        const targets = args.slice(1);
        if (targets.length === 0) {
          renderTable();
          console.log(`${RED}Usage: type set <pc|enemy|neutral> <target>...${RESET}\n`);
          return true;
        }
        for (const t of targets) {
          parsedItems.push({ type: firstType, rawTarget: t });
        }
      } else {
        renderTable();
        console.log(`${RED}Invalid creature type. Please specify pc, enemy, or neutral (e.g. "type set pc Ajax").${RESET}\n`);
        return true;
      }

      const updates: { creatures: Creature[]; type: CreatureType; rawTarget: string }[] = [];
      for (const item of parsedItems) {
        const result = findCreatures([item.rawTarget]);
        if (!result.ok) {
          renderTable();
          console.log(`${RED}${result.error}${RESET}\n`);
          return true;
        }
        updates.push({ creatures: result.creatures, type: item.type, rawTarget: item.rawTarget });
      }

      const summaryItems: string[] = [];
      let becamePcInBlankSession = false;

      withTurnPreservation(() => {
        for (const update of updates) {
          for (const c of update.creatures) {
            c.type = update.type;
            if (update.type === "pc" && !currentSessionName) {
              becamePcInBlankSession = true;
            }
          }
          const names = update.creatures.map((c) => c.name).join(", ");
          summaryItems.push(`${names} → ${typeLabel(update.type)}`);
        }
      });

      let createdSaveMsg: string | null = null;
      if (becamePcInBlankSession) {
        const generatedName = generateRandomSaveName();
        currentSessionName = generatedName;
        const res = saveState(generatedName);
        const filepath = path.resolve(SAVES_DIR, `${res.name}.json`);
        if (res.isNew) {
          createdSaveMsg = `✓ Created new save state "${res.name}" at "${filepath}".`;
        }
      }

      renderTable();
      console.log(`${GREEN}✓ Set type: ${summaryItems.join("; ")}${RESET}`);
      if (createdSaveMsg) {
        console.log(`${GREEN}${createdSaveMsg}${RESET}`);
      }
      console.log();
      logActivity(`Set type: ${summaryItems.join("; ")}`);
      return true;
    }

    const setOptions = ["hp", "ac", "init"];
    const field = matchPrefix(fieldInput, setOptions);

    const args = parts.slice(2);

    if (!field || args.length < 2) {
      renderTable();
      const msg = fieldInput && !field
        ? `Unknown field "${fieldInput}". Use hp, ac, init, or type.`
        : `Usage: (hp | ac | init) set <value> <target>... (e.g. "hp set 40 Ajax")`;
      console.log(`${RED}${msg}${RESET}\n`);
      return true;
    }

    const isNullVal = (str: string) => {
      const lower = str.toLowerCase();
      return lower === "null" || lower === "none" || lower === "clear" || lower === "-" || lower === "—";
    };

    const parseVal = (str: string): number | null | undefined => {
      if (isNullVal(str)) return null;
      const n = parseInt(str, 10);
      return isNaN(n) ? undefined : n;
    };

    const updates: { creatures: Creature[]; val: number | null; rawTarget: string; rawVal: string }[] = [];

    // Check if alternating pairs: even length >= 4, every even index has a valid number/null value,
    // and every odd index is NOT a number/null value.
    let isPairs = args.length >= 4 && args.length % 2 === 0;
    if (isPairs) {
      for (let i = 0; i < args.length; i += 2) {
        if (parseVal(args[i]!) === undefined || parseVal(args[i + 1]!) !== undefined) {
          isPairs = false;
          break;
        }
      }
    }

    if (isPairs) {
      for (let i = 0; i < args.length; i += 2) {
        const rawVal = args[i]!;
        const rawTarget = args[i + 1]!;
        const val = parseVal(rawVal)!;

        const result = findCreatures([rawTarget]);
        if (!result.ok) {
          renderTable();
          console.log(`${RED}${result.error}${RESET}\n`);
          return true;
        }

        updates.push({ creatures: result.creatures, val, rawTarget, rawVal });
      }
    } else {
      const rawVal = args[0]!;
      const val = parseVal(rawVal);
      if (val === undefined) {
        renderTable();
        console.log(`${RED}"${rawVal}" is not a valid number. Usage: (hp | ac | init) set <value> <target>...${RESET}\n`);
        return true;
      }

      const targetArgs = args.slice(1);
      const result = findCreatures(targetArgs);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      updates.push({ creatures: result.creatures, val, rawTarget: targetArgs.join(" "), rawVal });
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
    console.log(`${GREEN}✓ Set ${field}: ${summaryItems.join("; ")}${RESET}\n`);
    logActivity(`Set ${field}: ${summaryItems.join("; ")}`);
    return true;
  }

  if (cmd === "remove" || cmd === "rm") {
    const subCmd = parts[1]?.toLowerCase() ?? "";
    const isCond = matchPrefix(subCmd, ["condition", "cond", "eff", "effect", "effects", "stat", "status", "stats"]) !== null;
    const isInit = matchPrefix(subCmd, ["initiative", "init"]) !== null;
    const isDmg = matchPrefix(subCmd, ["dmg", "damage"]) !== null;
    const isHp = matchPrefix(subCmd, ["hp"]) !== null;
    const isAc = matchPrefix(subCmd, ["ac"]) !== null;
    const isRxn = matchPrefix(subCmd, ["reaction", "rxn"]) !== null;
    const isResource = matchPrefix(subCmd, ["res"]) !== null;

    if (isResource) {
      const resNameInput = parts[2];
      const targets = parts.slice(3);

      if (!resNameInput || targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: res remove <resource> <target>...${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      let matchedAny = false;
      const updates: string[] = [];

      for (const creature of result.creatures) {
        if (!creature.resourceUsage) continue;
        const resUsage = creature.resourceUsage;
        const keys = Object.keys(resUsage);
        const lowerInput = resNameInput.toLowerCase();
        const targetKey = keys.find(k => k.toLowerCase() === lowerInput) || keys.find(k => k.toLowerCase().startsWith(lowerInput));

        if (targetKey) {
          const currentVal = resUsage[targetKey];
          if (currentVal !== undefined) {
            const newVal = currentVal - 1;
            if (newVal <= 0) {
              delete resUsage[targetKey];
              updates.push(`${creature.name}: removed "${targetKey}"`);
            } else {
              resUsage[targetKey] = newVal;
              updates.push(`${creature.name}: "${targetKey}" decremented to ${newVal}`);
            }
            matchedAny = true;
          }
        }
      }

      renderTable();
      if (matchedAny) {
        console.log(`${GREEN}✓ ${updates.join(", ")}${RESET}\n`);
        logActivity(`Removed/decremented resource "${resNameInput}" for ${result.creatures.map(c => c.name).join(", ")}`);
      } else {
        console.log(`${YELLOW}No resource matching "${resNameInput}" found on ${result.creatures.map(c => c.name).join(", ")}.${RESET}\n`);
      }
      return true;
    }

    if (isRxn) {
      const targets = parts.slice(2);
      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets to restore reaction (e.g., "remove rxn Ajax").${RESET}\n`);
        return true;
      }

      const result = findCreatures(targets);
      if (!result.ok) {
        renderTable();
        console.log(`${RED}${result.error}${RESET}\n`);
        return true;
      }

      for (const creature of result.creatures) {
        creature.reactionUsed = false;
      }

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Reaction restored for ${names}.${RESET}\n`);
      logActivity(`Reaction restored for ${names}`);
      return true;
    }

    if (isInit) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear initiative (e.g., "remove init all" or "remove init Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all") {
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
      const rawVal = parts[2];
      const val = rawVal ? parseInt(rawVal, 10) : NaN;

      if (!isNaN(val)) {
        const targets = parts.slice(3);
        if (targets.length === 0) {
          renderTable();
          console.log(`${RED}Please specify targets to heal (e.g., "remove dmg 10 Ajax").${RESET}\n`);
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
            c.dmg = Math.max(0, c.dmg - val);
          }
        });

        renderTable();
        const names = result.creatures.map((c) => c.name).join(", ");
        console.log(`${GREEN}✓ ${names}: dmg -${val}${RESET}\n`);
        logActivity(`Healed ${val} damage from ${names}`);
        return true;
      } else {
        const targets = parts.slice(2);

        if (targets.length === 0) {
          renderTable();
          console.log(`${RED}Please specify a value, targets, or "all" to remove/clear damage (e.g., "remove dmg 10 Ajax" or "remove dmg Ajax").${RESET}\n`);
          return true;
        }

        if (targets[0] === "all") {
          withTurnPreservation(() => {
            for (const c of creatures) {
              c.dmg = 0;
            }
          });
          renderTable();
          console.log(`${GREEN}✓ Cleared damage for all creatures.${RESET}\n`);
          logActivity("Cleared damage for all creatures");
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
        logActivity(`Cleared damage for ${names}`);
        return true;
      }
    }

    if (isHp) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear HP max (e.g., "remove hp all" or "remove hp Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.hpMax = null;
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared HP max for all creatures.${RESET}\n`);
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
          c.hpMax = null;
        }
      });

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Cleared HP max for ${names}.${RESET}\n`);
      return true;
    }

    if (isAc) {
      const targets = parts.slice(2);

      if (targets.length === 0) {
        renderTable();
        console.log(`${RED}Please specify targets or "all" to clear AC (e.g., "remove ac all" or "remove ac Ajax").${RESET}\n`);
        return true;
      }

      if (targets[0] === "all") {
        withTurnPreservation(() => {
          for (const c of creatures) {
            c.ac = null;
          }
        });
        renderTable();
        console.log(`${GREEN}✓ Cleared AC for all creatures.${RESET}\n`);
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
          c.ac = null;
        }
      });

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      console.log(`${GREEN}✓ Cleared AC for ${names}.${RESET}\n`);
      return true;
    }

    if (isCond) {
      const condPattern = parts[2];
      const targets = parts.slice(3);

      if (!condPattern || targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: eff remove <effect> <target>...${RESET}\n`);
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
        const prevLen = creature.statusEffects.length;
        creature.statusEffects = creature.statusEffects.filter((c) => !c.toLowerCase().includes(lowerCond));
        if (creature.statusEffects.length < prevLen) {
          matchedAny = true;
        }
      }

      renderTable();
      const names = result.creatures.map((c) => c.name).join(", ");
      if (matchedAny) {
        console.log(`${GREEN}✓ Removed status effect matching "${condPattern}" from ${names}${RESET}\n`);
        logActivity(`Removed status effect "${condPattern}" from ${names}`);
      } else {
        console.log(`${YELLOW}No status effect matching "${condPattern}" found on ${names}.${RESET}\n`);
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
      // Bulk remove if no targets specified, or targets[0] === "all"
      if (targetArgs.length === 0 || targetArgs[0] === "all") {
        let removedCount = 0;
        withTurnPreservation(() => {
          for (let i = creatures.length - 1; i >= 0; i--) {
            const c = creatures[i];
            if (c && c.type === category) {
              creatures.splice(i, 1);
              removedCount++;
            }
          }
        });
        renderTable();
        const label = category === "pc" ? "PCs" : category === "enemy" ? "enemies" : "neutral creatures";
        if (removedCount > 0) {
          console.log(`${YELLOW}- Removed all ${label} (${removedCount} creatures).${RESET}\n`);
          logActivity(`Removed all ${label} (${removedCount} creatures)`);
        } else {
          console.log(`${YELLOW}No ${label} found to remove.${RESET}\n`);
        }
        return true;
      }
    }

    if (targetArgs.length === 0) {
      renderTable();
      console.log(`${RED}Usage: char remove <target>... or (pc | enemy | neutral) remove${RESET}\n`);
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
    logActivity(`Removed: ${names}`);
    return true;
  }

  if (cmd === "test") {
    const isSimple = parts[1]?.toLowerCase() === "simple" || parts[1]?.toLowerCase() === "s";

    // Clear current state first (preserves session name / log)
    creatures.length = 0;
    inCombat = false;
    currentRound = 1;
    currentTurnIndex = 0;

    if (isSimple) {
      // Add creatures via real commands — no stats, just names + types
      handleCommand("char add pc \"ajax grimstone\" \"kaelor stormstride\" \"lyra moonwhisper\" \"thorgan ironbreaker\" \"elaria shadowstep\" \"seraphina sunfire\" \"valerius frostweaver\"");
      handleCommand("char add enemy \"goblin warrior 1\" \"goblin warrior 2\" \"goblin archer\" \"goblin shaman\" \"bugbear chieftain\" \"hobgoblin captain\" \"skeleton archer\" \"dark cultist\" \"young red dragon\"");
      handleCommand("char add neutral \"captured merchant\" \"village elder\" \"tavern keeper\" \"mysterious traveler\"");
    } else {
      // PCs
      handleCommand("char add pc ajax \"kaelor stormstride\" \"lyra moonwhisper\" \"thorgan ironbreaker\" \"elaria shadowstep\" \"seraphina sunfire\" \"valerius frostweaver\"");
      handleCommand("hp set 45 ajax 38 \"kaelor stormstride\" 32 \"lyra moonwhisper\" 58 \"thorgan ironbreaker\" 30 \"elaria shadowstep\" 40 \"seraphina sunfire\" 28 \"valerius frostweaver\"");
      handleCommand("ac set 18 ajax 15 \"kaelor stormstride\" 12 \"lyra moonwhisper\" 16 \"thorgan ironbreaker\" 14 \"elaria shadowstep\" 17 \"seraphina sunfire\" 13 \"valerius frostweaver\"");
      handleCommand("init set 14 ajax 18 \"kaelor stormstride\" 9 \"lyra moonwhisper\" 12 \"thorgan ironbreaker\" 20 \"elaria shadowstep\" 10 \"seraphina sunfire\" 15 \"valerius frostweaver\"");
      handleCommand("dmg add 12 \"kaelor stormstride\"");
      handleCommand("dmg add 15 \"thorgan ironbreaker\"");
      handleCommand("dmg add 4 \"elaria shadowstep\"");
      handleCommand("dmg add 8 \"valerius frostweaver\"");
      handleCommand("eff add Concentrating \"lyra moonwhisper\"");
      handleCommand("eff add Raging \"thorgan ironbreaker\"");
      handleCommand("eff add Invisible \"valerius frostweaver\"");

      // Enemies
      handleCommand("char add enemy \"goblin warrior 1\" \"goblin warrior 2\" \"goblin archer\" \"goblin shaman\" \"bugbear chieftain\" \"hobgoblin captain\" \"skeleton archer\" \"dark cultist\" \"young red dragon\"");
      handleCommand("hp set 12 \"goblin warrior 1\" 12 \"goblin warrior 2\" 10 \"goblin archer\" 18 \"goblin shaman\" 42 \"bugbear chieftain\" 39 \"hobgoblin captain\" 13 \"skeleton archer\" 22 \"dark cultist\" 178 \"young red dragon\"");
      handleCommand("ac set 13 \"goblin warrior 1\" 13 \"goblin warrior 2\" 12 \"goblin archer\" 12 \"goblin shaman\" 15 \"bugbear chieftain\" 17 \"hobgoblin captain\" 11 \"skeleton archer\" 12 \"dark cultist\" 18 \"young red dragon\"");
      handleCommand("init set 11 \"goblin warrior 1\" 8 \"goblin warrior 2\" 16 \"goblin archer\" 13 \"goblin shaman\" 7 \"bugbear chieftain\" 14 \"hobgoblin captain\" 15 \"skeleton archer\" 11 \"dark cultist\" 10 \"young red dragon\"");
      handleCommand("dmg add 5 \"goblin warrior 1\"");
      handleCommand("dmg add 12 \"goblin warrior 2\"");
      handleCommand("dmg add 10 \"goblin archer\"");
      handleCommand("dmg add 6 \"goblin shaman\"");
      handleCommand("dmg add 14 \"bugbear chieftain\"");
      handleCommand("dmg add 11 \"dark cultist\"");
      handleCommand("dmg add 35 \"young red dragon\"");
      handleCommand("eff add Dead \"goblin warrior 2\"");
      handleCommand("eff add Poisoned \"goblin shaman\"");
      handleCommand("eff add Frightened \"dark cultist\"");

      // Neutrals
      handleCommand("char add neutral \"captured merchant\" \"village elder\" \"tavern keeper\" \"mysterious traveler\"");
      handleCommand("hp set 8 \"captured merchant\" 6 \"village elder\" 12 \"tavern keeper\" 25 \"mysterious traveler\"");
      handleCommand("ac set 10 \"captured merchant\" 10 \"village elder\" 11 \"tavern keeper\" 14 \"mysterious traveler\"");
      handleCommand("init set 16 \"mysterious traveler\"");
      handleCommand("dmg add 3 \"captured merchant\"");
      handleCommand("eff add Restrained \"captured merchant\"");
    }

    renderTable();
    console.log(`${GREEN}✓ Loaded test data${isSimple ? " (simple)" : ""} (${creatures.length} creatures)${RESET}\n`);
    return true;
  }


  if (cmd === "show" && parts[1]?.toLowerCase() === "activity") {
    renderTable();
    if (activityLog.length === 0) {
      console.log(`${YELLOW}No activity recorded yet for this session.${RESET}\n`);
      return true;
    }
    console.log(`${BOLD}${CYAN}Activity log for "${currentSessionName ?? "Unsaved"}":${RESET}\n`);
    for (const entry of activityLog) {
      const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      console.log(`  ${DIM}[${timeStr}]${RESET}  ${entry.message}`);
    }
    console.log();
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
  pendingRenamePrompt = null;
  pendingQuitConfirmation = false;
  pendingCharTypePrompt = null;
  hasAddedCreature = false;
  currentSessionName = null;
  activityLog.length = 0;
  undoStack.length = 0;
  redoStack.length = 0;
}

export function getActivityLog(): ActivityEntry[] {
  return [...activityLog];
}

export function getCombatState() {
  return {
    inCombat,
    currentRound,
    currentTurnIndex,
    pendingConfirmation,
    pendingQuitConfirmation,
    pendingRenamePrompt,
    currentSessionName,
    activeCreature: creatures.length > 0 ? getSortedCreatures()[currentTurnIndex] ?? null : null,
  };
}

export function processQuitConfirmation(answer: string): boolean {
  if (!pendingQuitConfirmation) return false;

  pendingQuitConfirmation = false;
  const choice = answer.trim().toLowerCase();
  if (choice === "y" || choice === "yes") {
    console.log("Farewell, adventurer!");
    return true;
  } else {
    renderTable();
    console.log(`${DIM}Quit cancelled.${RESET}\n`);
    return false;
  }
}

export function processConfirmation(answer: string): boolean {
  return executeWithUndoTracking(() => {
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
        if (currentSessionName) saveState(currentSessionName);
        else saveState("current");
        renderTable();
        console.log(`${YELLOW}⚔ Combat ended. Initiative and damage cleared for all creatures.${RESET}\n`);
        logActivity("⚔ Combat ended — initiative and damage cleared");
        return true;
      } else {
        renderTable();
        console.log(`${DIM}Combat end cancelled.${RESET}\n`);
        return false;
      }
    }
    return false;
  }, `confirm end combat: ${answer}`);
}

export function processSaveNamePrompt(answer: string): boolean {
  return executeWithUndoTracking(() => {
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
    const filepath = path.resolve(SAVES_DIR, `${res.name}.json`);
    if (res.isNew) {
      console.log(`${GREEN}✓ Created new save state "${res.name}" at "${filepath}".${RESET}\n`);
    } else {
      console.log(`${GREEN}✓ Saved game state to "${res.name}" at "${filepath}".${RESET}\n`);
    }
    return true;
  }, `save game as: ${answer}`);
}

export function processRenamePrompt(answer: string): boolean {
  return executeWithUndoTracking(() => {
    if (!pendingRenamePrompt) return false;

    const defaultName = pendingRenamePrompt.defaultName;
    pendingRenamePrompt = null;

    const trimmed = answer.trim();
    if (trimmed.toLowerCase() === "c" || trimmed.toLowerCase() === "cancel") {
      renderTable();
      console.log(`${DIM}Rename cancelled.${RESET}\n`);
      return false;
    }

    const chosenName = trimmed || defaultName;
    const res = renameSession(chosenName);
    renderTable();
    if (res.ok) {
      const filepath = path.resolve(SAVES_DIR, `${res.newName}.json`);
      console.log(`${GREEN}✓ Renamed game session to "${res.newName}" at "${filepath}".${RESET}\n`);
      return true;
    } else {
      console.log(`${RED}${res.error}${RESET}\n`);
      return false;
    }
  }, `rename session to: ${answer}`);
}

export function processCharTypePrompt(answer: string): boolean {
  if (!pendingCharTypePrompt) return false;
  const ans = answer.trim().toLowerCase();
  let type: CreatureType | null = null;
  if (ans === "pc" || ans === "p") type = "pc";
  else if (ans === "enemy" || ans === "e") type = "enemy";
  else if (ans === "neutral" || ans === "n") type = "neutral";

  if (!type) {
    renderTable();
    console.log(`${RED}Invalid type "${answer}". Please choose pc, enemy, or neutral.${RESET}\n`);
    return false;
  }

  const names = pendingCharTypePrompt.names;
  pendingCharTypePrompt = null; // Clear prompt

  return executeWithUndoTracking(() => {
    const isFirstPcInBlankSession = type === "pc" && !currentSessionName;

    withTurnPreservation(() => {
      for (const name of names) {
        creatures.push({ name, type: type!, hpMax: null, dmg: 0, ac: null, initiative: null, statusEffects: [], resourceUsage: {} });
      }
    });
    hasAddedCreature = true;

    let createdSaveMsg: string | null = null;
    if (isFirstPcInBlankSession) {
      const generatedName = generateRandomSaveName();
      currentSessionName = generatedName;
      const res = saveState(generatedName);
      const filepath = path.resolve(SAVES_DIR, `${res.name}.json`);
      if (res.isNew) {
        createdSaveMsg = `✓ Created new save state "${res.name}" at "${filepath}".`;
      }
    }

    renderTable();
    console.log(`${GREEN}+ Added ${typeLabel(type!)}: ${names.join(", ")}${RESET}`);
    if (createdSaveMsg) {
      console.log(`${GREEN}${createdSaveMsg}${RESET}`);
    }
    console.log();
    logActivity(`Added ${typeLabel(type!)}: ${names.join(", ")}`);
    return true;
  }, `add ${type} ${names.map(n => n.includes(" ") ? `"${n}"` : n).join(" ")}`);
}

export function processSaveSelection(answer: string): boolean {
  return executeWithUndoTracking(() => {
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
      const filepath = path.resolve(SAVES_DIR, `${result.name}.json`);
      console.log(`${GREEN}✓ Loaded game state from "${result.name}" at "${filepath}" (${creatures.length} creatures).${RESET}\n`);
      return true;
    } else {
      console.log(`${RED}${result.error}${RESET}\n`);
      return false;
    }
  }, `load save: ${answer}`);
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

  if (tokens.length === 1 && tokens[0]!.toLowerCase() === "all") {
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
    console.log(`${GREEN}✓ Deleted saved game(s) from "${path.resolve(SAVES_DIR)}": ${deleted.join(", ")}.${RESET}`);
  }
  if (errors.length > 0) {
    console.log(`${RED}${errors.join(" ")}${RESET}`);
  }
  console.log();
  return true;
}

// Wrap handleCommand to ensure auto-saving on every mutating command
export function handleCommand(input: string): boolean {
  return executeWithUndoTracking(() => {
    const rawParts = tokenize(input.trim());
    const parts = normalizeCommandTokens(rawParts);
    const cmd = parts[0]?.toLowerCase();
    const res = handleCommandInternal(input);

    const nonMutatingCmds = ["help", "saves", "delete", "del", "quit", "exit", "q", "rename", "undo", "u", "redo", "r", "show", "save", "load", "loadgame", "new"];
    if (cmd && !nonMutatingCmds.includes(cmd) && hasAddedCreature && currentSessionName) {
      saveState(currentSessionName);
    }
    return res;
  }, input);
}

export const ALL_COMMAND_TEMPLATES: string[] = [
  // Primary syntax: <field|entity> <command> ...
  "save list", "save delete", "save load", "save rename", "save",
  "game new", "game load", "game save", "game list", "game delete",
  "char add", "char add pc", "char add enemy", "char add neutral", "char remove", "char rename",
  "pc add", "pc remove",
  "enemy add", "enemy remove",
  "neutral add", "neutral remove",
  "hp set", "hp clear",
  "ac set", "ac clear",
  "init set", "init clear",
  "dmg add", "dmg add max", "dmg remove", "dmg clear", "dmg hurt", "dmg heal", "dmg kill", "kill",
  "eff add", "eff remove",
  "cond add", "cond remove",
  "stat add", "stat remove",
  "status add", "status remove",
  "res add", "res use", "res remove", "res clear",
  "rxn set", "rxn remove",
  "type set", "type set pc", "type set enemy", "type set neutral",
  "turn next", "turn prev",
  "activity show",
  "combat", "combat start", "combat end", "c", "c start", "c end",
  "undo", "u", "redo", "r",
  "help", "h", "quit", "exit", "q",
  "test", "test simple",
];

export function highlightMatch(
  text: string,
  query: string,
  matchColor = `${BOLD}${YELLOW}`,
  baseColor = `${CYAN}`
): string {
  if (!query) return `${baseColor}${text}${RESET}`;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return `${baseColor}${text}${RESET}`;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return `${baseColor}${before}${RESET}${matchColor}${match}${RESET}${baseColor}${after}${RESET}`;
}

export function completer(line: string): [string[], string] {
  const lineTrimmed = line.trimStart();
  const endsWithSpace = line.endsWith(" ");
  
  const rawParts = lineTrimmed.split(/\s+/);
  const partsCount = rawParts.length;
  const lastPart = endsWithSpace ? "" : rawParts[partsCount - 1] || "";
  const baseParts = endsWithSpace ? rawParts : rawParts.slice(0, -1);
  if (baseParts.length > 0 && baseParts[baseParts.length - 1] === "") {
    baseParts.pop();
  }
  const cmd = baseParts[0]?.toLowerCase() || "";
  const subCmd = baseParts[1]?.toLowerCase() || "";
  
  if (OLD_DISALLOWED_COMMANDS.has(cmd)) {
    return [[], line];
  }
  
  let completions: string[] = [];
  
  if (lineTrimmed === "" || (rawParts.length === 1 && !endsWithSpace)) {
    completions = ALL_COMMAND_TEMPLATES;
  } else if (cmd === "char") {
    if (baseParts.length === 1) {
      completions = ["char add", "char remove", "char rename"];
    } else if (subCmd === "add") {
      if (baseParts.length === 2) {
        completions = ["char add pc", "char add enemy", "char add neutral"];
      }
    } else if (subCmd === "rename") {
      completions = creatures.map(c => {
        const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
        return `char rename ${formatted}`;
      });
    } else if (subCmd === "remove") {
      if (baseParts.length === 2) {
        const typeSubs = ["pcs", "enemies", "neutrals"];
        const creatureSubs = creatures.map(c => c.name.includes(" ") ? `"${c.name}"` : c.name);
        completions = [...typeSubs, ...creatureSubs].map(s => `char remove ${s}`);
      } else {
        completions = creatures.map(c => {
          const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
          return `${baseParts.join(" ")} ${formatted}`;
        });
      }
    }
  } else if (cmd === "pc" || cmd === "enemy" || cmd === "neutral") {
    if (baseParts.length === 1) {
      completions = [`${cmd} add`, `${cmd} remove`];
    } else if (subCmd === "remove") {
      completions = creatures.map(c => {
        const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
        return `${baseParts.join(" ")} ${formatted}`;
      });
    }
  } else if (cmd === "hp" || cmd === "ac" || cmd === "init") {
    if (baseParts.length === 1) {
      completions = [`${cmd} set`, `${cmd} clear`];
    } else if (subCmd === "clear") {
      completions = ["all", ...creatures.map(c => c.name.includes(" ") ? `"${c.name}"` : c.name)].map(target => {
        return `${cmd} clear ${target}`;
      });
    } else if (subCmd === "set") {
      if (baseParts.length >= 3) {
        completions = creatures.map(c => {
          const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
          return `${baseParts.join(" ")} ${formatted}`;
        });
      }
    }
  } else if (cmd === "dmg") {
    if (baseParts.length === 1) {
      completions = ["dmg add", "dmg add max", "dmg remove", "dmg clear", "dmg hurt", "dmg heal", "dmg kill"];
    } else if (subCmd === "clear") {
      completions = ["all", ...creatures.map(c => c.name.includes(" ") ? `"${c.name}"` : c.name)].map(target => {
        return `dmg clear ${target}`;
      });
    } else if (subCmd === "kill" || subCmd === "max") {
      completions = creatures.map(c => {
        const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
        return `${baseParts.join(" ")} ${formatted}`;
      });
    } else if (subCmd === "add") {
      if (baseParts.length === 2) {
        completions = ["dmg add max", ...creatures.map(c => `dmg add ${c.name.includes(" ") ? `"${c.name}"` : c.name}`)];
      } else {
        completions = creatures.map(c => {
          const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
          return `${baseParts.join(" ")} ${formatted}`;
        });
      }
    } else if (subCmd === "remove" || subCmd === "hurt" || subCmd === "heal") {
      if (baseParts.length >= 3) {
        completions = creatures.map(c => {
          const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
          return `${baseParts.join(" ")} ${formatted}`;
        });
      }
    }
  } else if (cmd === "kill") {
    completions = creatures.map(c => {
      const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
      return `${baseParts.join(" ")} ${formatted}`;
    });
  } else if (cmd === "eff" || cmd === "cond" || cmd === "stat" || cmd === "status") {
    if (baseParts.length === 1) {
      completions = [`${cmd} add`, `${cmd} remove`];
    } else if (subCmd === "add" || subCmd === "remove") {
      if (baseParts.length === 2) {
        completions = ALL_STATUS_EFFECTS.map(eff => {
          const formatted = eff.includes(" ") ? `"${eff}"` : eff;
          return `${cmd} ${subCmd} ${formatted}`;
        });
      } else {
        completions = creatures.map(c => {
          const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
          return `${baseParts.join(" ")} ${formatted}`;
        });
      }
    }
  } else if (cmd === "res") {
    if (baseParts.length === 1) {
      completions = ["res add", "res use", "res remove", "res clear"];
    } else if (subCmd === "clear") {
      completions = ["all", ...creatures.map(c => c.name.includes(" ") ? `"${c.name}"` : c.name)].map(target => {
        return `res clear ${target}`;
      });
    } else if (subCmd === "add" || subCmd === "use" || subCmd === "remove") {
      if (baseParts.length === 2) {
        const existingResources = new Set<string>();
        for (const c of creatures) {
          if (c.resourceUsage) {
            for (const r of Object.keys(c.resourceUsage)) {
              existingResources.add(r);
            }
          }
        }
        completions = Array.from(existingResources).map(r => {
          const formatted = r.includes(" ") ? `"${r}"` : r;
          return `${baseParts.join(" ")} ${formatted}`;
        });
      } else {
        completions = creatures.map(c => {
          const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
          return `${baseParts.join(" ")} ${formatted}`;
        });
      }
    }
  } else if (cmd === "rxn") {
    if (baseParts.length === 1) {
      completions = ["rxn set", "rxn remove"];
    } else if (subCmd === "set" || subCmd === "remove") {
      completions = creatures.map(c => {
        const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
        return `${baseParts.join(" ")} ${formatted}`;
      });
    }
  } else if (cmd === "type") {
    if (baseParts.length === 1) {
      completions = ["type set"];
    } else if (subCmd === "set") {
      if (baseParts.length === 2) {
        completions = ["type set pc", "type set enemy", "type set neutral"];
      } else {
        completions = creatures.map(c => {
          const formatted = c.name.includes(" ") ? `"${c.name}"` : c.name;
          return `${baseParts.join(" ")} ${formatted}`;
        });
      }
    }
  } else if (cmd === "turn") {
    if (baseParts.length === 1) {
      completions = ["turn next", "turn prev"];
    }
  } else if (cmd === "activity") {
    if (baseParts.length === 1) {
      completions = ["activity show"];
    }
  } else if (cmd === "save") {
    if (baseParts.length === 1) {
      completions = ["save list", "save delete", "save load", "save rename"];
    } else if ((subCmd === "delete" || subCmd === "load") && baseParts.length === 2) {
      if (fs.existsSync(SAVES_DIR)) {
        const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith(".json"));
        completions = files.map(f => {
          const name = f.replace(/\.json$/, "");
          const formatted = name.includes(" ") ? `"${name}"` : name;
          return `${cmd} ${subCmd} ${formatted}`;
        });
      }
    }
  } else if (cmd === "game") {
    if (baseParts.length === 1) {
      completions = ["game new", "game load", "game save", "game list", "game delete"];
    }
  } else if (cmd === "combat" || cmd === "c") {
    if (baseParts.length === 1) {
      completions = [`${cmd} start`, `${cmd} end`];
    }
  }

  const fullTyped = baseParts.length > 0 ? baseParts.join(" ") + " " : "";
  const searchPrefix = (fullTyped + lastPart).toLowerCase().trim();
  const search = searchPrefix.length > 0 ? searchPrefix : lineTrimmed.toLowerCase();
  
  let hits = Array.from(new Set(completions)).filter(c => c.toLowerCase().includes(search));
  if (hits.length === 0 && search.length > 0) {
    hits = ALL_COMMAND_TEMPLATES.filter(c => c.toLowerCase().includes(search));
  }

  // Sort: prefix matches first, followed by substring matches, then alphabetical
  hits.sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    const aStarts = aLower.startsWith(search);
    const bStarts = bLower.startsWith(search);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return a.localeCompare(b);
  });
  
  return [hits, line];
}

// --- REPL ---

if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
${BOLD}${MAGENTA}⚔  dnd-cli — D&D Combat State Tracker${RESET}

${BOLD}Usage:${RESET}
  dnd [<options>] [<session_name>]

${BOLD}Options:${RESET}
  -n, --new, --fresh     Start a fresh, unsaved game session
  -h, --help             Show this help message

${BOLD}Arguments:${RESET}
  <session_name>         Name of a saved session to load (loads last session by default)
`);
    process.exit(0);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  });

  const isFresh = args.includes("--new") || args.includes("-n") || args.includes("--fresh");
  const specificSave = args.find((arg) => !arg.startsWith("-"));

  const startup = initializeSession({
    fresh: isFresh,
    saveName: specificSave,
  });

  renderTable();

  if (startup.loaded && startup.sessionName) {
    if (specificSave) {
      console.log(`${GREEN}✓ Loaded session: "${startup.sessionName}" (${creatures.length} creature${creatures.length === 1 ? "" : "s"})${RESET}\n`);
    } else {
      console.log(`${GREEN}✓ Loaded last session: "${startup.sessionName}" (${creatures.length} creature${creatures.length === 1 ? "" : "s"})${RESET}\n`);
    }
  } else if (startup.error) {
    console.log(`${YELLOW}⚠ Could not load session: ${startup.error}. Started fresh new game.${RESET}\n`);
  }

  function isAtMainPrompt(): boolean {
    return (
      !pendingConfirmation &&
      !pendingQuitConfirmation &&
      !pendingSaveSelection &&
      !pendingSaveDeleteSelection &&
      !pendingSaveNamePrompt &&
      !pendingRenamePrompt &&
      !pendingCharTypePrompt
    );
  }

  let typeaheadActive = false;
  let typeaheadMatches: string[] = [];
  let typeaheadIndex = 0;
  let typeaheadSavedQuery = "";
  let typeaheadRenderedLines = 0;

  function clearTypeaheadMenu(): void {
    if (typeaheadRenderedLines > 0) {
      process.stdout.write("\x1b7");
      process.stdout.write("\n\x1b[J");
      process.stdout.write("\x1b8");
      typeaheadRenderedLines = 0;
    }
  }

  function renderTypeaheadMenu(): void {
    clearTypeaheadMenu();

    const total = typeaheadMatches.length;
    if (total === 0) return;

    const MAX_VISIBLE = 8;
    let startIdx = 0;
    if (total > MAX_VISIBLE) {
      startIdx = Math.max(0, Math.min(typeaheadIndex - Math.floor(MAX_VISIBLE / 2), total - MAX_VISIBLE));
    }
    const visibleSlice = typeaheadMatches.slice(startIdx, startIdx + MAX_VISIBLE);

    let output = "\x1b7\n\x1b[J";
    let count = 1;

    const header = total > MAX_VISIBLE
      ? `${DIM}  Typeahead matches (${startIdx + 1}-${startIdx + visibleSlice.length} of ${total}) [↑/↓ to select, Enter to choose, Esc to cancel]:${RESET}\n`
      : `${DIM}  Typeahead matches (${total} found) [↑/↓ to select, Enter to choose, Esc to cancel]:${RESET}\n`;
    output += header;

    if (startIdx > 0) {
      output += `${DIM}  ▲ (${startIdx} more above)${RESET}\n`;
      count++;
    }

    visibleSlice.forEach((item, sliceIdx) => {
      const actualIdx = startIdx + sliceIdx;
      const isSelected = actualIdx === typeaheadIndex;
      const pointer = isSelected ? `${BOLD}${GREEN}▶ ${RESET}` : "  ";
      const baseColor = isSelected ? `${BOLD}${CYAN}` : `${CYAN}`;
      const highlighted = highlightMatch(item, typeaheadSavedQuery.trim(), `${BOLD}${YELLOW}`, baseColor);
      output += `${pointer}${highlighted}\n`;
      count++;
    });

    if (startIdx + visibleSlice.length < total) {
      output += `${DIM}  ▼ (${total - startIdx - visibleSlice.length} more below)${RESET}\n`;
      count++;
    }

    output += "\x1b8";
    process.stdout.write(output);
    typeaheadRenderedLines = count;
  }

  if (process.stdin.isTTY && typeof (rl as any)._ttyWrite === "function") {
    const origTtyWrite = (rl as any)._ttyWrite.bind(rl);

    (rl as any)._ttyWrite = (s: string, key: any) => {
      if (!isAtMainPrompt()) {
        origTtyWrite(s, key);
        return;
      }

      if (key && key.name === "tab") {
        if (!typeaheadActive) {
          const currentInput = (((rl as any).line || "") as string);
          const [matches] = completer(currentInput);
          if (matches && matches.length > 0) {
            typeaheadActive = true;
            typeaheadMatches = matches;
            typeaheadIndex = 0;
            typeaheadSavedQuery = currentInput;
            renderTypeaheadMenu();
            return;
          }
        } else {
          typeaheadIndex = (typeaheadIndex + 1) % typeaheadMatches.length;
          renderTypeaheadMenu();
          return;
        }
      }

      if (typeaheadActive) {
        if (key && key.name === "down") {
          typeaheadIndex = (typeaheadIndex + 1) % typeaheadMatches.length;
          renderTypeaheadMenu();
          return;
        }

        if (key && key.name === "up") {
          typeaheadIndex = (typeaheadIndex - 1 + typeaheadMatches.length) % typeaheadMatches.length;
          renderTypeaheadMenu();
          return;
        }

        if (key && (key.name === "return" || key.name === "enter")) {
          const selected = typeaheadMatches[typeaheadIndex];
          clearTypeaheadMenu();
          typeaheadActive = false;

          const noArgCmds = [
            "combat", "c", "combat start", "combat end", "c start", "c end",
            "next", "n", "prev", "p",
            "undo", "u", "redo", "r",
            "new game", "saves", "help", "h", "quit", "exit", "q",
            "test", "test simple", "show activity"
          ];
          const needsSpace = !noArgCmds.includes(selected.trim());
          (rl as any).line = selected + (needsSpace ? " " : "");
          (rl as any).cursor = (rl as any).line.length;
          (rl as any)._refreshLine();
          return;
        }

        if (key && (key.name === "escape" || (key.ctrl && key.name === "c"))) {
          clearTypeaheadMenu();
          typeaheadActive = false;
          (rl as any).line = typeaheadSavedQuery;
          (rl as any).cursor = (rl as any).line.length;
          (rl as any)._refreshLine();
          return;
        }

        clearTypeaheadMenu();
        typeaheadActive = false;
      }

      origTtyWrite(s, key);
    };
  }

  function prompt() {
    const promptStr = pendingConfirmation
      ? `${YELLOW}End combat and clear init & dmg for all creatures? (y/n) > ${RESET}`
      : pendingQuitConfirmation
      ? `${YELLOW}Are you sure you want to quit? (y/n) > ${RESET}`
      : pendingSaveSelection
      ? `${CYAN}Select save to load (1-${pendingSaveSelection.saves.length}) or 'c' to cancel > ${RESET}`
      : pendingSaveDeleteSelection
      ? `${RED}Select save(s) to DELETE (e.g. 1 3 or 1,2 or 'all') or 'c' to cancel > ${RESET}`
      : pendingSaveNamePrompt
      ? `${CYAN}Enter session name [Press Enter for "${pendingSaveNamePrompt.defaultName}"] > ${RESET}`
      : pendingRenamePrompt
      ? `${CYAN}Enter new session name [Press Enter for "${pendingRenamePrompt.defaultName}"] > ${RESET}`
      : pendingCharTypePrompt
      ? `${CYAN}What kind of character is this? (pc / enemy / neutral) > ${RESET}`
      : `${MAGENTA}> ${RESET}`;

    rl.question(promptStr, (answer) => {
      clearTypeaheadMenu();
      typeaheadActive = false;
      if (pendingQuitConfirmation) {
        const confirmedQuit = processQuitConfirmation(answer);
        if (confirmedQuit) {
          rl.close();
        } else {
          prompt();
        }
        return;
      }

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

      if (pendingRenamePrompt) {
        processRenamePrompt(answer);
        prompt();
        return;
      }

      if (pendingCharTypePrompt) {
        processCharTypePrompt(answer);
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

      const shouldContinue = handleCommand(answer);
      if (shouldContinue) {
        prompt();
      } else {
        rl.close();
      }
    });
  }

  prompt();
}

