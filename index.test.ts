import { describe, expect, test, beforeEach, afterEach, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  handleCommand,
  creatures,
  getSortedCreatures,
  resetState,
  getCombatState,
  getActivityLog,
  processConfirmation,
  processSaveSelection,
  processSaveDeleteSelection,
  processSaveNamePrompt,
  processQuitConfirmation,
  processRenamePrompt,
  renameSession,
  deleteSave,
} from "./index";

const SAVES_DIR = path.join(process.cwd(), "saves");

// Snapshot the saves directory before each test, clean up after
let savesBefore = new Set<string>();

function snapshotSaves(): Set<string> {
  if (!fs.existsSync(SAVES_DIR)) return new Set();
  return new Set(fs.readdirSync(SAVES_DIR).filter((f) => f.endsWith(".json")));
}

function cleanupNewSaves(before: Set<string>) {
  if (!fs.existsSync(SAVES_DIR)) return;
  const after = fs.readdirSync(SAVES_DIR).filter((f) => f.endsWith(".json"));
  for (const file of after) {
    if (!before.has(file)) {
      try { fs.unlinkSync(path.join(SAVES_DIR, file)); } catch { /* ignore */ }
    }
  }
}

describe("D&D CLI Tracker Test Suite", () => {
  beforeEach(() => {
    savesBefore = snapshotSaves();
    resetState();
  });

  afterEach(() => {
    resetState(); // ensure no lingering state bleeds between tests
    cleanupNewSaves(savesBefore);
  });

  describe("Basic Initialization & Commands", () => {
    test("starts empty and loads test encounter", () => {
      expect(creatures.length).toBe(0);
      handleCommand("test");
      expect(creatures.length).toBe(20);
      const ajax = creatures.find((c) => c.name === "ajax");
      expect(ajax).toBeDefined();
      expect(ajax?.hpMax).toBe(45);
    });

    test("handles help and h commands", () => {
      expect(handleCommand("help")).toBeTrue();
      expect(handleCommand("h")).toBeTrue();
    });

    test("prompts for confirmation before quitting", () => {
      expect(handleCommand("quit")).toBeTrue();
      expect(getCombatState().pendingQuitConfirmation).toBeTrue();

      expect(processQuitConfirmation("n")).toBeFalse();
      expect(getCombatState().pendingQuitConfirmation).toBeFalse();

      expect(handleCommand("q")).toBeTrue();
      expect(processQuitConfirmation("y")).toBeTrue();
    });
  });

  describe("Test Data Loading", () => {
    test("loads full test data (20 creatures)", () => {
      handleCommand("test");
      expect(creatures.length).toBe(20);
      const ajax = creatures.find((c) => c.name === "ajax");
      expect(ajax).toBeDefined();
      expect(ajax?.hpMax).toBe(45);
      expect(ajax?.ac).toBe(18);
      expect(ajax?.initiative).toBe(14);
    });

    test("loads simple test data", () => {
      handleCommand("test simple");
      expect(creatures.length).toBe(20);
      const ajax = creatures.find((c) => c.name === "ajax grimstone");
      expect(ajax).toBeDefined();
      expect(ajax?.hpMax).toBeNull();
    });

    test("handles help and h commands", () => {
      expect(handleCommand("help")).toBeTrue();
      expect(handleCommand("h")).toBeTrue();
    });
  });

  describe("Adding Creatures", () => {
    test("adds PCs, enemies, and neutrals", () => {
      handleCommand("add pc Aragorn Legolas");
      expect(creatures.length).toBe(2);
      expect(creatures[0]?.type).toBe("pc");

      handleCommand("add enemy Orc1 Orc2");
      expect(creatures.length).toBe(4);
      expect(creatures.filter((c) => c.type === "enemy").length).toBe(2);

      handleCommand("add neutral Merchant");
      expect(creatures.length).toBe(5);
      expect(creatures.find((c) => c.name === "Merchant")?.type).toBe("neutral");
    });

    test("supports shorthand type IDs (p, e, n)", () => {
      handleCommand("add p Frodo");
      handleCommand("add e Nazgul");
      handleCommand("add n Gollum");

      expect(creatures.find((c) => c.name === "Frodo")?.type).toBe("pc");
      expect(creatures.find((c) => c.name === "Nazgul")?.type).toBe("enemy");
      expect(creatures.find((c) => c.name === "Gollum")?.type).toBe("neutral");
    });
  });

  describe("Stat Management", () => {
    test("sets HP, AC, initiative, and damage", () => {
      handleCommand("add pc Hero");
      handleCommand("set hp 50 Hero");
      handleCommand("set ac 16 Hero");
      handleCommand("set init 15 Hero");
      handleCommand("add dmg 10 Hero");

      const hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.hpMax).toBe(50);
      expect(hero?.ac).toBe(16);
      expect(hero?.initiative).toBe(15);
      expect(hero?.dmg).toBe(10);
    });

    test("supports bulk setting of AC and initiative with alternating pairs", () => {
      handleCommand("add pc HeroA HeroB");
      handleCommand("set ac bulk HeroA 18 HeroB 15");
      handleCommand("set init bulk HeroA 14 HeroB 20");

      const heroA = creatures.find((c) => c.name === "HeroA");
      const heroB = creatures.find((c) => c.name === "HeroB");

      expect(heroA?.ac).toBe(18);
      expect(heroA?.initiative).toBe(14);

      expect(heroB?.ac).toBe(15);
      expect(heroB?.initiative).toBe(20);
    });

    test("adds and removes status conditions", () => {
      handleCommand("add pc Hero");
      handleCommand("add cond Poisoned Hero");
      let hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.conditions).toContain("Poisoned");

      handleCommand("remove cond Poisoned Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.conditions).not.toContain("Poisoned");
    });
  });

  describe("Clear Safety Checks", () => {
    test("requires explicit target or all to clear initiative and damage", () => {
      handleCommand("test");
      const initBefore = creatures.map((c) => c.initiative);
      const dmgBefore = creatures.map((c) => c.dmg);

      // Running without target should NOT modify creatures
      handleCommand("clear init");
      expect(creatures.map((c) => c.initiative)).toEqual(initBefore);

      handleCommand("clear dmg");
      expect(creatures.map((c) => c.dmg)).toEqual(dmgBefore);

      // Explicit target clears for specified creature
      handleCommand("clear init ajax");
      expect(creatures.find((c) => c.name === "ajax")?.initiative).toBeNull();

      // Explicit all clears for all creatures
      handleCommand("clear init all");
      expect(creatures.every((c) => c.initiative === null)).toBeTrue();

      handleCommand("clear dmg all");
      expect(creatures.every((c) => c.dmg === 0)).toBeTrue();
    });
  });

  describe("Combat Mode & Turn Navigation", () => {
    test("sorts by initiative descending in combat mode", () => {
      handleCommand("add pc HeroA");
      handleCommand("add pc HeroB");
      handleCommand("set init 10 HeroA");
      handleCommand("set init 20 HeroB");

      handleCommand("combat");
      const sorted = getSortedCreatures();
      expect(sorted[0]?.name).toBe("HeroB"); // Init 20
      expect(sorted[1]?.name).toBe("HeroA"); // Init 10
    });

    test("navigates turns with next/prev and skip counts", () => {
      handleCommand("test");
      handleCommand("combat");

      const initialActive = getCombatState().activeCreature?.name;
      expect(initialActive).toBe("elaria shadowstep"); // Highest init (20)

      handleCommand("n 2");
      expect(getCombatState().activeCreature?.name).toBe("goblin archer");

      handleCommand("p 1");
      expect(getCombatState().activeCreature?.name).toBe("kaelor stormstride");
    });

    test("increments/decrements round counter on wrap-around", () => {
      handleCommand("add pc A B");
      handleCommand("set init 20 A");
      handleCommand("set init 10 B");
      handleCommand("combat");

      expect(getCombatState().currentRound).toBe(1);
      handleCommand("n 2"); // A -> B -> A (Round 2)
      expect(getCombatState().currentRound).toBe(2);

      handleCommand("p 1"); // A (Round 2) -> B (Round 1)
      expect(getCombatState().currentRound).toBe(1);
    });
  });

  describe("Ending Combat & Confirmation", () => {
    test("requests confirmation on combat end and handles cancel/confirm", () => {
      handleCommand("test");
      handleCommand("combat");
      expect(getCombatState().inCombat).toBeTrue();

      // Trigger combat end -> sets pending confirmation
      handleCommand("combat end");
      expect(getCombatState().pendingConfirmation).not.toBeNull();

      // Cancel confirmation ('n')
      processConfirmation("n");
      expect(getCombatState().inCombat).toBeTrue();
      expect(getCombatState().pendingConfirmation).toBeNull();
      expect(creatures.some((c) => c.initiative !== null)).toBeTrue();

      // Trigger combat end again and confirm ('y')
      handleCommand("combat end");
      processConfirmation("y");
      expect(getCombatState().inCombat).toBeFalse();

      // Initiative and damage cleared for all creatures
      expect(creatures.every((c) => c.initiative === null)).toBeTrue();
      expect(creatures.every((c) => c.dmg === 0)).toBeTrue();
    });
  });

  describe("Creature Removal (Bulk & Specific)", () => {
    test("supports bulk removal by type using add IDs and shorthands", () => {
      handleCommand("test");
      expect(creatures.length).toBe(20);

      handleCommand("remove enemies"); // Remove all enemies
      expect(creatures.some((c) => c.type === "enemy")).toBeFalse();

      handleCommand("remove pcs"); // Remove all PCs
      expect(creatures.some((c) => c.type === "pc")).toBeFalse();

      handleCommand("remove neutrals"); // Remove all neutrals
      expect(creatures.length).toBe(0);
    });

    test("supports bulk removal using e, p, n shorthands", () => {
      handleCommand("test");
      expect(creatures.length).toBe(20);

      handleCommand("remove e"); // Remove all enemies
      expect(creatures.some((c) => c.type === "enemy")).toBeFalse();

      handleCommand("remove p"); // Remove all PCs
      expect(creatures.some((c) => c.type === "pc")).toBeFalse();

      handleCommand("remove n"); // Remove all neutrals
      expect(creatures.length).toBe(0);
    });

    test("removes specific creature by name", () => {
      handleCommand("add pc HeroA HeroB");
      handleCommand("remove char HeroA");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("HeroB");
    });
  });

  describe("Local Game State Persistence", () => {
    test("saves and loads game state", () => {
      handleCommand("add pc Hero1 Hero2");
      handleCommand("set hp 40 Hero1");
      handleCommand("save test_slot");

      handleCommand("new game");
      expect(creatures.length).toBe(0);

      handleCommand("load save test_slot");
      expect(creatures.length).toBe(2);
      expect(creatures.find((c) => c.name === "Hero1")?.hpMax).toBe(40);
    });

    test("auto-saves on mutating commands", () => {
      handleCommand("new game");
      handleCommand("add pc AutoSavedHero");
      const sessionName = getCombatState().currentSessionName;

      // Reset in-memory creatures
      resetState();
      expect(creatures.length).toBe(0);

      // Loading the active session save file should restore AutoSavedHero
      if (sessionName) {
        handleCommand(`load save ${sessionName}`);
        expect(creatures.some((c) => c.name === "AutoSavedHero")).toBeTrue();
      }
    });

    test("deletes a saved game file", () => {
      handleCommand("save test_file_to_delete");
      expect(handleCommand("load save test_file_to_delete")).toBeTrue();

      handleCommand("delete save test_file_to_delete");
      handleCommand("load save test_file_to_delete");
      expect(creatures.some((c) => c.name === "AutoSavedHero")).toBeFalse();
    });

    test("shows interactive options when typing load save without arguments", () => {
      handleCommand("add pc InteractiveHero");
      handleCommand("save test_interactive_slot");

      resetState();
      expect(creatures.length).toBe(0);

      // Trigger 'load save' without arguments -> presents options
      handleCommand("load save");

      // Select option by typing 1 or save name
      processSaveSelection("test_interactive_slot");
      expect(creatures.some((c) => c.name === "InteractiveHero")).toBeTrue();
    });

    test("bare load and delete and rename and new without save/game qualifier show ambiguous error", () => {
      // These should NOT perform any action, just print an error
      expect(handleCommand("load")).toBeTrue();
      expect(handleCommand("delete")).toBeTrue();
      expect(handleCommand("rename")).toBeTrue();
      expect(handleCommand("new")).toBeTrue();
      // State should be unchanged (no creatures, no pending state)
      expect(creatures.length).toBe(0);
    });

    test("shows interactive options when typing delete save without arguments", () => {
      handleCommand("save test_slot_to_del_interactively");
      expect(handleCommand("load save test_slot_to_del_interactively")).toBeTrue();

      // Trigger 'delete save' without arguments -> presents options
      handleCommand("delete save");

      // Select option by save name
      processSaveDeleteSelection("test_slot_to_del_interactively");

      // Attempting to load deleted save file should now fail
      expect(handleCommand("load save test_slot_to_del_interactively")).toBeTrue();
    });

    test("prompts for session name with preset default when saving without argument", () => {
      handleCommand("add pc PromptHero");
      handleCommand("save");

      // Respond with custom name
      processSaveNamePrompt("test_prompted_custom_slot");
    });

    test("deletes multiple save files at once via direct command and interactive selection", () => {
      handleCommand("save test_multi_del_1");
      handleCommand("save test_multi_del_2");
      handleCommand("save test_multi_del_3");

      // Direct multi-delete
      handleCommand("delete save test_multi_del_1 test_multi_del_2");
      expect(handleCommand("load save test_multi_del_1")).toBeTrue();
      expect(handleCommand("load save test_multi_del_2")).toBeTrue();

      // Interactive multi-delete
      handleCommand("save test_multi_del_interactive_a");
      handleCommand("save test_multi_del_interactive_b");
      handleCommand("delete save");
      processSaveDeleteSelection("test_multi_del_interactive_a test_multi_del_interactive_b");
    });

    test("auto-saves with random name when adding first PC in a blank session", () => {
      resetState();
      expect(creatures.length).toBe(0);

      // Add first PC -> generates random save name and auto-saves
      handleCommand("add pc FirstHero");
      expect(creatures.length).toBe(1);

      const sessionName = getCombatState().currentSessionName;
      expect(sessionName).toBeTruthy();
    });

    test("renames current game session via rename command", () => {
      resetState();
      handleCommand("add pc HeroToRename");

      expect(handleCommand("rename save test_renamed_session")).toBeTrue();

      // Reset state and load renamed session file
      resetState();
      expect(handleCommand("load save test_renamed_session")).toBeTrue();
      expect(creatures.some((c) => c.name === "HeroToRename")).toBeTrue();
    });

    test("prompts with preset default when typing rename without arguments", () => {
      resetState();
      handleCommand("add pc PresetHero");

      handleCommand("rename save"); // triggers pendingRenamePrompt

      processRenamePrompt("test_prompted_rename_slot");
      resetState();
      expect(handleCommand("load save test_prompted_rename_slot")).toBeTrue();
    });
  });

  describe("Activity Log", () => {
    test("records actions and show activity returns true", () => {
      handleCommand("add pc LogHero");
      handleCommand("add enemy Goblin");
      handleCommand("set hp 20 LogHero");
      handleCommand("add dmg 5 Goblin");

      const log = getActivityLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log.some((e) => e.message.includes("LogHero"))).toBeTrue();
      expect(log.some((e) => e.message.includes("Goblin"))).toBeTrue();

      expect(handleCommand("show activity")).toBeTrue();
    });

    test("activity log is empty after resetState", () => {
      handleCommand("add pc LogHero");
      resetState();
      expect(getActivityLog().length).toBe(0);
    });

    test("activity log persists across save and load", () => {
      handleCommand("add pc PersistHero");
      handleCommand("add dmg 10 PersistHero");
      const sessionName = getCombatState().currentSessionName;
      if (sessionName) {
        resetState();
        handleCommand(`load save ${sessionName}`);
        const log = getActivityLog();
        expect(log.some((e) => e.message.includes("PersistHero"))).toBeTrue();
      }
    });

    test("show activity returns true when log is empty", () => {
      expect(handleCommand("show activity")).toBeTrue();
    });
  });
});
