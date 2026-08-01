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

  console.log(`${BOLD}${MAGENTA}⚔  D&D Game State Tracker${RESET}`);
  console.log(`${DIM}${"─".repeat(80)}${RESET}`);

  if (creatures.length === 0) {
    console.log(`${DIM}  No creatures yet. Use "add char <name>" to begin.${RESET}`);
  } else {
    // Header
    const hdr = `  ${pad("Name", 22)}${pad("Type", 10)}${pad("HP Max", 8)}${pad("Dmg", 6)}${pad("AC", 6)}${pad("Init", 6)}${"Conditions"}`;
    console.log(`${BOLD}${CYAN}${hdr}${RESET}`);
    console.log(`${DIM}  ${"─".repeat(76)}${RESET}`);

    const sorted = [...creatures].sort((a, b) => a.name.localeCompare(b.name));

    sorted.forEach((c) => {
      const color = typeColor(c.type);
      const name = pad(c.name, 22);
      const type = pad(typeLabel(c.type), 10);
      const hpMax = pad(fmt(c.hpMax), 8);
      const dmg = pad(c.dmg > 0 ? String(c.dmg) : "—", 6);
      const ac = pad(fmt(c.ac), 6);
      const init = pad(fmt(c.initiative), 6);
      const cond = c.conditions.length > 0 ? c.conditions.join(", ") : "";
      console.log(`  ${BOLD}${name}${RESET}${color}${type}${RESET}${hpMax}${dmg}${ac}${init}${cond}`);
    });
  }

  console.log(`${DIM}${"─".repeat(80)}${RESET}`);
  console.log(`${DIM}  add char n1 n2 · set hp <val> n1 n2 · add dmg <val> n1 n2 · help · quit${RESET}\n`);
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

type FindResult =
  | { ok: true; creature: Creature }
  | { ok: false; error: string };

function findCreature(identifier: string): FindResult {
  const lower = identifier.toLowerCase();
  const exactMatch = creatures.find((c) => c.name.toLowerCase() === lower);
  if (exactMatch) {
    return { ok: true, creature: exactMatch };
  }

  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");
  const matches = creatures.filter((c) => pattern.test(c.name));

  if (matches.length === 1) {
    return { ok: true, creature: matches[0]! };
  }
  if (matches.length === 0) {
    return { ok: false, error: `No creature matching "${identifier}".` };
  }
  const names = matches.map((c) => c.name).join(", ");
  return { ok: false, error: `Ambiguous match "${identifier}" — matches: ${names}` };
}

type FindManyResult =
  | { ok: true; creatures: Creature[] }
  | { ok: false; error: string };

function findCreatures(identifiers: string[]): FindManyResult {
  const found: Creature[] = [];

  for (const id of identifiers) {
    const result = findCreature(id);
    if (!result.ok) {
      return result;
    }
    if (!found.includes(result.creature)) {
      found.push(result.creature);
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
    console.log(`  ${CYAN}add char n1 n2${RESET}            Add PCs`);
    console.log(`  ${CYAN}add enemy n1 n2${RESET}           Add enemies`);
    console.log(`  ${CYAN}add neutral n1 n2${RESET}         Add neutral creatures`);
    console.log(`  ${CYAN}add dmg <val> n1 n2${RESET}       Add damage to targets`);
    console.log(`  ${CYAN}add condition <str> n1 n2${RESET} Add condition to targets`);
    console.log(`  ${CYAN}set hp <val> n1 n2${RESET}        Set HP max for targets`);
    console.log(`  ${CYAN}set ac <val> n1 n2${RESET}        Set AC for targets`);
    console.log(`  ${CYAN}set init <val> n1 n2${RESET}      Set initiative for targets`);
    console.log(`  ${CYAN}remove cond <str> n1 n2${RESET}   Remove condition from targets`);
    console.log(`  ${CYAN}remove n1 n2${RESET}              Remove creatures`);
    console.log(`  ${CYAN}test [simple]${RESET}           Load test data`);
    console.log(`  ${CYAN}help${RESET}                      Show this help`);
    console.log(`  ${CYAN}quit${RESET}                      Exit\n`);
    return true;
  }

  if (cmd === "add") {
    const subCmd = parts[1]?.toLowerCase() ?? "";
    const addOptions = ["char", "pc", "enemy", "neutral", "dmg", "condition"];
    const matched = matchPrefix(subCmd, addOptions);

    // --- add condition <str> n1 n2 ---
    if (matched === "condition") {
      const cond = parts[2];
      const targets = parts.slice(3);

      if (!cond || targets.length === 0) {
        renderTable();
        console.log(`${RED}Usage: add condition <str> n1 n2${RESET}\n`);
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
      console.log(`${RED}Usage: add <char|enemy|neutral> n1 n2${RESET}\n`);
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

    for (const name of targets) {
      creatures.push({ name, type, hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] });
    }
    renderTable();
    console.log(`${GREEN}+ Added ${typeLabel(type)}: ${targets.join(", ")}${RESET}\n`);
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
        default:
          renderTable();
          console.log(`${RED}Unknown field "${fieldInput}". Use hp, ac, or init.${RESET}\n`);
          return true;
      }
    }

    renderTable();
    const names = result.creatures.map((c) => c.name).join(", ");
    console.log(`${GREEN}✓ ${names}: ${field} → ${val}${RESET}\n`);
    return true;
  }

  if (cmd === "remove" || cmd === "rm") {
    const subCmd = parts[1]?.toLowerCase() ?? "";
    const isCond = matchPrefix(subCmd, ["condition", "cond"]) !== null;

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

    const targets = parts.slice(1);

    if (targets.length === 0) {
      renderTable();
      console.log(`${RED}Usage: remove n1 n2${RESET}\n`);
      return true;
    }

    const result = findCreatures(targets);
    if (!result.ok) {
      renderTable();
      console.log(`${RED}${result.error}${RESET}\n`);
      return true;
    }

    for (const creature of result.creatures) {
      const idx = creatures.indexOf(creature);
      creatures.splice(idx, 1);
    }
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
        { name: "ajax", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "kaelor stormstride", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "lyra moonwhisper", type: "pc", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "goblin warrior", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "goblin archer", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "bugbear", type: "enemy", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
        { name: "captured merchant", type: "neutral", hpMax: null, dmg: 0, ac: null, initiative: null, conditions: [] },
      );
    } else {
      creatures.push(
        { name: "ajax", type: "pc", hpMax: 45, dmg: 0, ac: 18, initiative: 14, conditions: [] },
        { name: "kaelor stormstride", type: "pc", hpMax: 38, dmg: 12, ac: 15, initiative: 18, conditions: [] },
        { name: "lyra moonwhisper", type: "pc", hpMax: 32, dmg: 0, ac: 12, initiative: 9, conditions: [] },
        { name: "goblin warrior", type: "enemy", hpMax: 12, dmg: 5, ac: 13, initiative: 11, conditions: [] },
        { name: "goblin archer", type: "enemy", hpMax: 10, dmg: 10, ac: 12, initiative: 16, conditions: [] },
        { name: "bugbear", type: "enemy", hpMax: 27, dmg: 0, ac: 14, initiative: 7, conditions: [] },
        { name: "captured merchant", type: "neutral", hpMax: 8, dmg: 3, ac: 10, initiative: null, conditions: [] },
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
  rl.question(`${MAGENTA}> ${RESET}`, (answer) => {
    const shouldContinue = handleCommand(answer);
    if (shouldContinue) {
      prompt();
    } else {
      rl.close();
    }
  });
}

prompt();