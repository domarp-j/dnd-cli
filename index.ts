import * as readline from "readline";

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

// --- State ---

const creatures: Creature[] = [];
let inCombat = false;
let currentRound = 1;
let currentTurnIndex = 0;
let pendingConfirmation: { type: "end_combat" } | null = null;

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
    const active = sorted[currentTurnIndex];
    const turnName = active ? active.name : "None";
    console.log(
      `${BOLD}${MAGENTA}⚔  D&D Game State Tracker ${RESET} ${BOLD}${YELLOW}[ COMBAT MODE — Round ${currentRound} | Turn: ${turnName} ]${RESET}`
    );
  } else {
    console.log(`${BOLD}${MAGENTA}⚔  D&D Game State Tracker${RESET}`);
  }

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

  if (cmd === "help") {
    renderTable();
    console.log(`${BOLD}Available commands:${RESET}`);
    console.log(`  ${CYAN}${pad("combat [start]", 25)}${RESET} Start combat mode (resorts by initiative)`);
    console.log(`  ${CYAN}${pad("combat end", 25)}${RESET} End combat mode`);
    console.log(`  ${CYAN}${pad("next / n [count]", 25)}${RESET} Advance 1 or [count] turns`);
    console.log(`  ${CYAN}${pad("prev / p [count]", 25)}${RESET} Go back 1 or [count] turns`);
    console.log(`  ${CYAN}${pad("add pc n1 n2", 25)}${RESET} Add PCs`);
    console.log(`  ${CYAN}${pad("add enemy n1 n2", 25)}${RESET} Add enemies`);
    console.log(`  ${CYAN}${pad("add neutral n1 n2", 25)}${RESET} Add neutral creatures`);
    console.log(`  ${CYAN}${pad("add dmg <val> n1 n2", 25)}${RESET} Add damage to targets`);
    console.log(`  ${CYAN}${pad("add cond <str> n1 n2", 25)}${RESET} Add condition to targets`);
    console.log(`  ${CYAN}${pad("set hp <val> n1 n2", 25)}${RESET} Set HP max for targets`);
    console.log(`  ${CYAN}${pad("set ac <val> n1 n2", 25)}${RESET} Set AC for targets`);
    console.log(`  ${CYAN}${pad("set init <val> n1 n2", 25)}${RESET} Set initiative for targets`);
    console.log(`  ${CYAN}${pad("clear dmg [n1 / all]", 25)}${RESET} Clear damage for targets (or all)`);
    console.log(`  ${CYAN}${pad("clear init [n1 / all]", 25)}${RESET} Clear initiative for targets (or all)`);
    console.log(`  ${CYAN}${pad("remove enemies [all]", 25)}${RESET} Remove all enemies`);
    console.log(`  ${CYAN}${pad("remove pcs [all]", 25)}${RESET} Remove all PCs`);
    console.log(`  ${CYAN}${pad("remove neutrals [all]", 25)}${RESET} Remove all neutral creatures`);
    console.log(`  ${CYAN}${pad("remove cond <str> n1 n2", 25)}${RESET} Remove condition from targets`);
    console.log(`  ${CYAN}${pad("remove char n1 n2", 25)}${RESET} Remove specific creatures`);
    console.log(`  ${CYAN}${pad("test [simple]", 25)}${RESET} Load test data`);
    console.log(`  ${CYAN}${pad("help", 25)}${RESET} Show this help`);
    console.log(`  ${CYAN}${pad("quit", 25)}${RESET} Exit\n`);
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
    const subCmd = parts[1]?.toLowerCase() ?? "";
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

    // --- Bulk Removal by Creature Type ---
    const isEnemyCmd = matchPrefix(subCmd, ["enemy", "enemies"]) !== null || (subCmd === "all" && matchPrefix(parts[2]?.toLowerCase() ?? "", ["enemy", "enemies"]) !== null);
    const isPcCmd = matchPrefix(subCmd, ["pc", "pcs"]) !== null || (subCmd === "all" && matchPrefix(parts[2]?.toLowerCase() ?? "", ["pc", "pcs"]) !== null);
    const isNeutralCmd = matchPrefix(subCmd, ["neutral", "neutrals"]) !== null || (subCmd === "all" && matchPrefix(parts[2]?.toLowerCase() ?? "", ["neutral", "neutrals"]) !== null);

    const typeToRemove: CreatureType | null = isEnemyCmd ? "enemy" : isPcCmd ? "pc" : isNeutralCmd ? "neutral" : null;

    if (typeToRemove) {
      const targets = subCmd === "all" ? parts.slice(3) : parts.slice(2);

      // Bulk remove if no specific target names given or explicit all / *
      if (targets.length === 0 || targets[0] === "all" || targets[0] === "*") {
        let removedCount = 0;
        withTurnPreservation(() => {
          for (let i = creatures.length - 1; i >= 0; i--) {
            if (creatures[i].type === typeToRemove) {
              creatures.splice(i, 1);
              removedCount++;
            }
          }
        });
        renderTable();
        const label = typeToRemove === "pc" ? "PCs" : typeToRemove === "enemy" ? "enemies" : "neutral creatures";
        if (removedCount > 0) {
          console.log(`${YELLOW}- Removed all ${label} (${removedCount} creatures).${RESET}\n`);
        } else {
          console.log(`${YELLOW}No ${label} found to remove.${RESET}\n`);
        }
        return true;
      }
    }

    // --- Specific Character Removal ---
    const isCharSubCmd = matchPrefix(subCmd, ["char", "creature", "pc", "pcs", "enemy", "enemies", "neutral", "neutrals"]) !== null;
    const targets = isCharSubCmd ? parts.slice(2) : parts.slice(1);

    if (targets.length === 0) {
      renderTable();
      console.log(`${RED}Usage: remove <enemies|pcs|neutrals|char> (e.g. "remove enemies" or "remove char Ajax")${RESET}\n`);
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
    renderTable();
    console.log(`${GREEN}✓ Loaded test data${isSimple ? " (simple)" : ""} (${creatures.length} creatures)${RESET}\n`);
    return true;
  }

  renderTable();
  console.log(`${RED}Unknown command: "${input.trim()}". Type "help" for commands.${RESET}\n`);
  return true;
}

// --- REPL ---

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

renderTable();

function prompt() {
  const promptStr = pendingConfirmation
    ? `${YELLOW}End combat and clear init & dmg for all creatures? (y/n) > ${RESET}`
    : `${MAGENTA}> ${RESET}`;

  rl.question(promptStr, (answer) => {
    if (pendingConfirmation) {
      const choice = answer.trim().toLowerCase();
      if (pendingConfirmation.type === "end_combat") {
        pendingConfirmation = null;
        if (choice === "y" || choice === "yes") {
          inCombat = false;
          currentRound = 1;
          currentTurnIndex = 0;
          for (const c of creatures) {
            c.initiative = null;
            c.dmg = 0;
          }
          renderTable();
          console.log(`${YELLOW}⚔ Combat ended. Initiative and damage cleared for all creatures.${RESET}\n`);
        } else {
          renderTable();
          console.log(`${DIM}Combat end cancelled.${RESET}\n`);
        }
      }
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

