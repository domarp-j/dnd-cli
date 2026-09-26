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
  getHistoryStacks,
  processCharTypePrompt,
  getPendingCharTypePrompt,
  completer,
  wrapStatusEffects,
  highlightMatch,
  getLatestSave,
  initializeSession,
  normalizeCommandTokens,
  tokenize,
  OLD_DISALLOWED_COMMANDS,
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
      handleCommand("char add pc Aragorn Legolas");
      expect(creatures.length).toBe(2);
      expect(creatures[0]?.type).toBe("pc");

      handleCommand("char add enemy Orc1 Orc2");
      expect(creatures.length).toBe(4);
      expect(creatures.filter((c) => c.type === "enemy").length).toBe(2);

      handleCommand("char add neutral Merchant");
      expect(creatures.length).toBe(5);
      expect(creatures.find((c) => c.name === "Merchant")?.type).toBe("neutral");
    });

    test("supports shorthand type IDs (p, e, n)", () => {
      handleCommand("char add p Frodo");
      handleCommand("char add e Nazgul");
      handleCommand("char add n Gollum");

      expect(creatures.find((c) => c.name === "Frodo")?.type).toBe("pc");
      expect(creatures.find((c) => c.name === "Nazgul")?.type).toBe("enemy");
      expect(creatures.find((c) => c.name === "Gollum")?.type).toBe("neutral");
    });
  });

  describe("Stat Management", () => {
    test("sets HP, AC, initiative, and damage", () => {
      handleCommand("char add pc Hero");
      handleCommand("hp set 50 Hero");
      handleCommand("ac set 16 Hero");
      handleCommand("init set 15 Hero");
      handleCommand("dmg add 10 Hero");

      const hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.hpMax).toBe(50);
      expect(hero?.ac).toBe(16);
      expect(hero?.initiative).toBe(15);
      expect(hero?.dmg).toBe(10);
    });

    test("supports dmg add and dmg remove commands", () => {
      handleCommand("char add pc Hero");
      handleCommand("dmg add 15 Hero");
      const hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.dmg).toBe(15);

      handleCommand("dmg remove 5 Hero");
      expect(hero?.dmg).toBe(10);

      // heal down to 0 cap
      handleCommand("dmg remove 20 Hero");
      expect(hero?.dmg).toBe(0);
    });

    test("supports multiple value and target pairs for setting HP, AC, and initiative", () => {
      handleCommand("char add pc HeroA HeroB");
      handleCommand("hp set 40 HeroA 35 HeroB");
      handleCommand("ac set 18 HeroA 15 HeroB");
      handleCommand("init set 14 HeroA 20 HeroB");

      const heroA = creatures.find((c) => c.name === "HeroA");
      const heroB = creatures.find((c) => c.name === "HeroB");

      expect(heroA?.hpMax).toBe(40);
      expect(heroA?.ac).toBe(18);
      expect(heroA?.initiative).toBe(14);

      expect(heroB?.hpMax).toBe(35);
      expect(heroB?.ac).toBe(15);
      expect(heroB?.initiative).toBe(20);
    });

    test("adds and removes status effects", () => {
      handleCommand("char add pc Hero");
      handleCommand("eff add Poisoned Hero");
      let hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).toContain("Poisoned");

      handleCommand("eff remove Poisoned Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).not.toContain("Poisoned");

      // Verify that "cond" alias works
      handleCommand("cond add Poisoned Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).toContain("Poisoned");

      handleCommand("cond remove Poisoned Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).not.toContain("Poisoned");

      // Verify that "stat" alias works
      handleCommand("stat add Blinded Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).toContain("Blinded");

      handleCommand("stat remove Blinded Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).not.toContain("Blinded");

      // Verify that "status" alias works
      handleCommand("status add Invisible Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).toContain("Invisible");

      handleCommand("status remove Invisible Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).not.toContain("Invisible");
    });
  });

  describe("Clear Safety Checks", () => {
    test("requires explicit target or all to clear initiative, damage, HP max, and AC", () => {
      handleCommand("test");
      const initBefore = creatures.map((c) => c.initiative);
      const dmgBefore = creatures.map((c) => c.dmg);
      const hpBefore = creatures.map((c) => c.hpMax);
      const acBefore = creatures.map((c) => c.ac);

      // Running without target should NOT modify creatures
      handleCommand("init clear");
      expect(creatures.map((c) => c.initiative)).toEqual(initBefore);

      handleCommand("dmg clear");
      expect(creatures.map((c) => c.dmg)).toEqual(dmgBefore);

      handleCommand("hp clear");
      expect(creatures.map((c) => c.hpMax)).toEqual(hpBefore);

      handleCommand("ac clear");
      expect(creatures.map((c) => c.ac)).toEqual(acBefore);

      // Explicit target clears for specified creature
      handleCommand("init clear ajax");
      expect(creatures.find((c) => c.name.toLowerCase().includes("ajax"))?.initiative).toBeNull();

      handleCommand("hp clear kaelor");
      expect(creatures.find((c) => c.name.toLowerCase().includes("kaelor"))?.hpMax).toBeNull();

      handleCommand("ac clear thorgan");
      expect(creatures.find((c) => c.name.toLowerCase().includes("thorgan"))?.ac).toBeNull();

      // Explicit all clears for all creatures
      handleCommand("init clear all");
      expect(creatures.every((c) => c.initiative === null)).toBeTrue();

      handleCommand("dmg clear all");
      expect(creatures.every((c) => c.dmg === 0)).toBeTrue();

      handleCommand("hp clear all");
      expect(creatures.every((c) => c.hpMax === null)).toBeTrue();

      handleCommand("ac clear all");
      expect(creatures.every((c) => c.ac === null)).toBeTrue();

      // Test the same on a clean test state
      handleCommand("test");
      handleCommand("init clear ajax");
      expect(creatures.find((c) => c.name.toLowerCase().includes("ajax"))?.initiative).toBeNull();

      handleCommand("hp clear kaelor");
      expect(creatures.find((c) => c.name.toLowerCase().includes("kaelor"))?.hpMax).toBeNull();

      handleCommand("ac clear thorgan");
      expect(creatures.find((c) => c.name.toLowerCase().includes("thorgan"))?.ac).toBeNull();

      handleCommand("dmg clear thorgan");
      expect(creatures.find((c) => c.name.toLowerCase().includes("thorgan"))?.dmg).toBe(0);

      // Explicit all clears
      handleCommand("init clear all");
      expect(creatures.every((c) => c.initiative === null)).toBeTrue();

      handleCommand("dmg clear all");
      expect(creatures.every((c) => c.dmg === 0)).toBeTrue();

      handleCommand("hp clear all");
      expect(creatures.every((c) => c.hpMax === null)).toBeTrue();

      handleCommand("ac clear all");
      expect(creatures.every((c) => c.ac === null)).toBeTrue();
    });
  });

  describe("Combat Mode & Turn Navigation", () => {
    test("sorts by initiative descending in combat mode", () => {
      handleCommand("char add pc HeroA");
      handleCommand("char add pc HeroB");
      handleCommand("init set 10 HeroA");
      handleCommand("init set 20 HeroB");

      handleCommand("combat");
      const sorted = getSortedCreatures();
      expect(sorted[0]?.name).toBe("HeroB"); // Init 20
      expect(sorted[1]?.name).toBe("HeroA"); // Init 10
    });

    test("navigates turns with turn next/prev and skip counts", () => {
      handleCommand("test");
      handleCommand("dmg clear \"goblin archer\"");
      handleCommand("combat");

      const initialActive = getCombatState().activeCreature?.name;
      expect(initialActive).toBe("elaria shadowstep"); // Highest init (20)

      handleCommand("turn next 2");
      expect(getCombatState().activeCreature?.name).toBe("goblin archer");

      handleCommand("turn prev 1");
      expect(getCombatState().activeCreature?.name).toBe("kaelor stormstride");
    });

    test("increments/decrements round counter on wrap-around", () => {
      handleCommand("char add pc A B");
      handleCommand("init set 20 A");
      handleCommand("init set 10 B");
      handleCommand("combat");

      expect(getCombatState().currentRound).toBe(1);
      handleCommand("turn next 2"); // A -> B -> A (Round 2)
      expect(getCombatState().currentRound).toBe(2);

      handleCommand("turn prev 1"); // A (Round 2) -> B (Round 1)
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

      handleCommand("enemy remove"); // Remove all enemies
      expect(creatures.some((c) => c.type === "enemy")).toBeFalse();

      handleCommand("pc remove"); // Remove all PCs
      expect(creatures.some((c) => c.type === "pc")).toBeFalse();

      handleCommand("neutral remove"); // Remove all neutrals
      expect(creatures.length).toBe(0);
    });

    test("supports bulk removal using e, p, n shorthands", () => {
      handleCommand("test");
      expect(creatures.length).toBe(20);

      handleCommand("char remove e"); // Remove all enemies
      expect(creatures.some((c) => c.type === "enemy")).toBeFalse();

      handleCommand("char remove p"); // Remove all PCs
      expect(creatures.some((c) => c.type === "pc")).toBeFalse();

      handleCommand("char remove n"); // Remove all neutrals
      expect(creatures.length).toBe(0);
    });

    test("removes specific creature by name", () => {
      handleCommand("char add pc HeroA HeroB");
      handleCommand("char remove HeroA");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("HeroB");
    });
  });

  describe("Local Game State Persistence", () => {
    test("saves and loads game state", () => {
      handleCommand("char add pc Hero1 Hero2");
      handleCommand("hp set 40 Hero1");
      handleCommand("save test_slot");

      handleCommand("game new");
      expect(creatures.length).toBe(0);

      handleCommand("save load test_slot");
      expect(creatures.length).toBe(2);
      expect(creatures.find((c) => c.name === "Hero1")?.hpMax).toBe(40);
    });

    test("auto-saves on mutating commands", () => {
      handleCommand("game new");
      handleCommand("char add pc AutoSavedHero");
      const sessionName = getCombatState().currentSessionName;

      // Reset in-memory creatures
      resetState();
      expect(creatures.length).toBe(0);

      // Loading the active session save file should restore AutoSavedHero
      if (sessionName) {
        handleCommand(`save load ${sessionName}`);
        expect(creatures.some((c) => c.name === "AutoSavedHero")).toBeTrue();
      }
    });

    test("deletes a saved game file", () => {
      handleCommand("save test_file_to_delete");
      expect(handleCommand("save load test_file_to_delete")).toBeTrue();

      handleCommand("save delete test_file_to_delete");
      handleCommand("save load test_file_to_delete");
      expect(creatures.some((c) => c.name === "AutoSavedHero")).toBeFalse();
    });

    test("shows interactive options when typing load save without arguments", () => {
      handleCommand("char add pc InteractiveHero");
      handleCommand("save test_interactive_slot");

      resetState();
      expect(creatures.length).toBe(0);

      // Trigger 'save load' without arguments -> presents options
      handleCommand("save load");

      // Select option by typing 1 or save name
      processSaveSelection("test_interactive_slot");
      expect(creatures.some((c) => c.name === "InteractiveHero")).toBeTrue();
    });

    test("bare old commands load and delete and rename and new without field show unknown command", () => {
      // These should NOT perform any action, just reject as unknown
      expect(handleCommand("load")).toBeTrue();
      expect(handleCommand("delete")).toBeTrue();
      expect(handleCommand("rename")).toBeTrue();
      expect(handleCommand("new")).toBeTrue();
      // State should be unchanged (no creatures, no pending state)
      expect(creatures.length).toBe(0);
    });

    test("shows interactive options when typing delete save without arguments", () => {
      handleCommand("save test_slot_to_del_interactively");
      expect(handleCommand("save load test_slot_to_del_interactively")).toBeTrue();

      // Trigger 'save delete' without arguments -> presents options
      handleCommand("save delete");

      // Select option by save name
      processSaveDeleteSelection("test_slot_to_del_interactively");

      // Attempting to load deleted save file should now fail
      expect(handleCommand("save load test_slot_to_del_interactively")).toBeTrue();
    });

    test("prompts for session name with preset default when saving without argument", () => {
      handleCommand("char add pc PromptHero");
      handleCommand("save");

      // Respond with custom name
      processSaveNamePrompt("test_prompted_custom_slot");
    });

    test("deletes multiple save files at once via direct command and interactive selection", () => {
      handleCommand("save test_multi_del_1");
      handleCommand("save test_multi_del_2");
      handleCommand("save test_multi_del_3");

      // Direct multi-delete
      handleCommand("save delete test_multi_del_1 test_multi_del_2");
      expect(handleCommand("save load test_multi_del_1")).toBeTrue();
      expect(handleCommand("save load test_multi_del_2")).toBeTrue();

      // Interactive multi-delete
      handleCommand("save test_multi_del_interactive_a");
      handleCommand("save test_multi_del_interactive_b");
      handleCommand("save delete");
      processSaveDeleteSelection("test_multi_del_interactive_a test_multi_del_interactive_b");
    });

    test("auto-saves with random name when adding first PC in a blank session", () => {
      resetState();
      expect(creatures.length).toBe(0);

      // Add first PC -> generates random save name and auto-saves
      handleCommand("char add pc FirstHero");
      expect(creatures.length).toBe(1);

      const sessionName = getCombatState().currentSessionName;
      expect(sessionName).toBeTruthy();
    });

    test("renames current game session via rename command", () => {
      resetState();
      handleCommand("char add pc HeroToRename");

      expect(handleCommand("save rename test_renamed_session")).toBeTrue();

      // Reset state and load renamed session file
      resetState();
      expect(handleCommand("save load test_renamed_session")).toBeTrue();
      expect(creatures.some((c) => c.name === "HeroToRename")).toBeTrue();
    });

    test("prompts with preset default when typing rename without arguments", () => {
      resetState();
      handleCommand("char add pc PresetHero");

      handleCommand("save rename"); // triggers pendingRenamePrompt

      processRenamePrompt("test_prompted_rename_slot");
      resetState();
      expect(handleCommand("save load test_prompted_rename_slot")).toBeTrue();
    });
  });

  describe("Activity Log", () => {
    test("records actions and activity show returns true", () => {
      handleCommand("char add pc LogHero");
      handleCommand("char add enemy Goblin");
      handleCommand("hp set 20 LogHero");
      handleCommand("dmg add 5 Goblin");

      const log = getActivityLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log.some((e) => e.message.includes("LogHero"))).toBeTrue();
      expect(log.some((e) => e.message.includes("Goblin"))).toBeTrue();

      expect(handleCommand("activity show")).toBeTrue();
    });

    test("activity log is empty after resetState", () => {
      handleCommand("char add pc LogHero");
      resetState();
      expect(getActivityLog().length).toBe(0);
    });

    test("activity log persists across save and load", () => {
      handleCommand("char add pc PersistHero");
      handleCommand("dmg add 10 PersistHero");
      const sessionName = getCombatState().currentSessionName;
      if (sessionName) {
        resetState();
        handleCommand(`save load ${sessionName}`);
        const log = getActivityLog();
        expect(log.some((e) => e.message.includes("PersistHero"))).toBeTrue();
      }
    });

    test("activity show returns true when log is empty", () => {
      expect(handleCommand("activity show")).toBeTrue();
    });
  });

  describe("Undo / Redo Functionality", () => {
    test("tracks mutating command changes in undoStack", () => {
      expect(getHistoryStacks().undoLength).toBe(0);
      handleCommand("char add pc TestHero");
      expect(creatures.length).toBe(1);
      expect(getHistoryStacks().undoLength).toBe(1);

      handleCommand("undo");
      expect(creatures.length).toBe(0);
      expect(getHistoryStacks().undoLength).toBe(0);
      expect(getHistoryStacks().redoLength).toBe(1);

      handleCommand("redo");
      expect(creatures.length).toBe(1);
      expect(getHistoryStacks().undoLength).toBe(1);
      expect(getHistoryStacks().redoLength).toBe(0);
    });

    test("rolls back activityLog on undo and restores on redo", () => {
      handleCommand("char add pc LoggedHero");
      handleCommand("hp set 15 LoggedHero");
      expect(getActivityLog().length).toBeGreaterThan(0);
      const preUndoLength = getActivityLog().length;

      handleCommand("undo"); // undo hp set
      expect(getActivityLog().length).toBe(preUndoLength - 1);

      handleCommand("redo"); // redo hp set
      expect(getActivityLog().length).toBe(preUndoLength);
    });

    test("handles multiple undo/redo levels sequentially", () => {
      handleCommand("char add pc HeroA");
      handleCommand("char add pc HeroB");
      handleCommand("char add pc HeroC");
      expect(creatures.length).toBe(3);

      handleCommand("undo"); // removes HeroC
      expect(creatures.length).toBe(2);
      expect(creatures.map(c => c.name)).toEqual(["HeroA", "HeroB"]);

      handleCommand("undo"); // removes HeroB
      expect(creatures.length).toBe(1);
      expect(creatures.map(c => c.name)).toEqual(["HeroA"]);

      handleCommand("redo"); // restores HeroB
      expect(creatures.length).toBe(2);
      expect(creatures.map(c => c.name)).toEqual(["HeroA", "HeroB"]);

      handleCommand("redo"); // restores HeroC
      expect(creatures.length).toBe(3);
    });

    test("clears redo history on a new mutating action", () => {
      handleCommand("char add pc HeroA");
      handleCommand("undo");
      expect(getHistoryStacks().redoLength).toBe(1);

      handleCommand("char add pc HeroB"); // new mutating action clears redo stack
      expect(getHistoryStacks().redoLength).toBe(0);
    });

    test("interactive prompt changes (e.g. combat confirmation) are tracked and undoable", () => {
      handleCommand("char add pc CombatHero");
      handleCommand("init set 15 CombatHero");
      handleCommand("combat"); // start combat
      expect(getCombatState().inCombat).toBeTrue();

      handleCommand("combat end"); // prompt set
      expect(getCombatState().pendingConfirmation).not.toBeNull();

      processConfirmation("y"); // confirms end combat (mutates state)
      expect(getCombatState().inCombat).toBeFalse();
      expect(creatures[0]?.initiative).toBeNull();

      handleCommand("undo"); // undoes the combat end confirmation
      expect(getCombatState().inCombat).toBeTrue();
      expect(creatures[0]?.initiative).toBe(15);
    });

    test("supports count parameter to undo or redo multiple times at once", () => {
      handleCommand("char add pc HeroA");
      handleCommand("char add pc HeroB");
      handleCommand("char add pc HeroC");
      expect(creatures.length).toBe(3);

      handleCommand("undo 2"); // Reverts adding HeroC and HeroB
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("HeroA");

      handleCommand("redo 2"); // Restores HeroB and HeroC
      expect(creatures.length).toBe(3);

      // Verify that requesting more undos than available caps out gracefully
      handleCommand("undo 10");
      expect(creatures.length).toBe(0);
    });

    test("game state & storage and utility commands are not undoable and clear stacks on load/new", () => {
      handleCommand("char add pc HeroA");
      expect(getHistoryStacks().undoLength).toBe(1);

      // 'save' should be exempt from undo tracking and not push to undoStack
      handleCommand("save test_exempt_save");
      expect(getHistoryStacks().undoLength).toBe(1);

      // 'save rename' should be exempt
      handleCommand("save rename test_exempt_rename");
      expect(getHistoryStacks().undoLength).toBe(1);

      // 'game new' should clear the history stacks entirely
      handleCommand("game new");
      expect(creatures.length).toBe(0);
      expect(getHistoryStacks().undoLength).toBe(0);

      // Setup state for load test
      handleCommand("char add pc LoadHero");
      handleCommand("save test_load_exempt");
      expect(getHistoryStacks().undoLength).toBe(1);

      // Save to another slot to shift active session and prevent overwriting test_load_exempt.json
      handleCommand("save test_another_session");

      handleCommand("char add pc AnotherHero");
      expect(getHistoryStacks().undoLength).toBe(2);

      // 'save load' should clear history stacks
      handleCommand("save load test_load_exempt");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("LoadHero");
      expect(getHistoryStacks().undoLength).toBe(0);
    });

    test("running test command runs internal subcommands with tracking, allowing command-by-command undo", () => {
      handleCommand("game new");
      expect(creatures.length).toBe(0);
      expect(getHistoryStacks().undoLength).toBe(0);

      // Run test simple (which runs 3 subcommands internally: char add pc, char add enemy, char add neutral)
      handleCommand("test simple");
      expect(creatures.length).toBe(20);
      // The 3 subcommands should be recorded on the undo stack
      expect(getHistoryStacks().undoLength).toBe(3);

      // Revert the 3rd subcommand (char add neutral)
      handleCommand("undo");
      expect(creatures.length).toBe(16);
      expect(creatures.some(c => c.type === "neutral")).toBeFalse();

      // Revert the 2nd subcommand (char add enemy)
      handleCommand("undo");
      expect(creatures.length).toBe(7);
      expect(creatures.every(c => c.type === "pc")).toBeTrue();

      // Revert the 1st subcommand (char add pc)
      handleCommand("undo");
      expect(creatures.length).toBe(0);
    });

    test("add char command prompts for character type, adds correctly, and is undoable", () => {
      handleCommand("game new");
      expect(creatures.length).toBe(0);

      // Running 'char add' should set the pending prompt and NOT add any creatures yet
      handleCommand("char add Legolas Aragorn");
      expect(creatures.length).toBe(0);
      expect(getPendingCharTypePrompt()?.names).toEqual(["Legolas", "Aragorn"]);

      // Invalid selection should keep prompt active
      const resInvalid = processCharTypePrompt("invalid");
      expect(resInvalid).toBeFalse();
      expect(getPendingCharTypePrompt()).not.toBeNull();
      expect(creatures.length).toBe(0);

      // Valid selection (enemy) should add creatures as enemy, clear prompt, and be undoable
      const resValid = processCharTypePrompt("enemy");
      expect(resValid).toBeTrue();
      expect(getPendingCharTypePrompt()).toBeNull();
      expect(creatures.length).toBe(2);
      expect(creatures.every(c => c.type === "enemy")).toBeTrue();
      expect(getHistoryStacks().undoLength).toBe(1);

      // Undoing should remove the characters
      handleCommand("undo");
      expect(creatures.length).toBe(0);
      expect(getHistoryStacks().undoLength).toBe(0);
    });

    test("completer function provides command and context autocomplete", () => {
      // 1. Match main command prefix
      const [hitsMain, lineMain] = completer("ch");
      expect(hitsMain).toContain("char add");
      expect(lineMain).toBe("ch");

      // 2. Match char subcommands
      const [hitsChar, lineChar] = completer("char ");
      expect(hitsChar).toContain("char add");
      expect(hitsChar).toContain("char remove");

      // 3. Match status effects
      const [hitsEff, lineEff] = completer("eff add Pois");
      expect(hitsEff).toContain("eff add Poisoned");

      const [hitsStat, _stat] = completer("stat add Pois");
      expect(hitsStat).toContain("stat add Poisoned");

      const [hitsStatus, _status] = completer("status add Pois");
      expect(hitsStatus).toContain("status add Poisoned");

      const [hitsRmEff, _rmEff] = completer("eff remove Pois");
      expect(hitsRmEff).toContain("eff remove Poisoned");

      // 4. Match target names when setting stats
      handleCommand("game new");
      handleCommand("char add pc Legolas Aragorn");

      const [hitsSet, lineSet] = completer("hp set 10 L");
      expect(hitsSet).toContain("hp set 10 Legolas");
      expect(lineSet).toBe("hp set 10 L");

      // 5. Match string anywhere in command body
      const [hitsStatAny] = completer("stat");
      expect(hitsStatAny).toContain("stat add");
      expect(hitsStatAny).toContain("stat remove");

      const [hitsEffAll] = completer("eff");
      expect(hitsEffAll).toContain("eff add");
      expect(hitsEffAll).toContain("eff remove");

      const [hitsHp] = completer("hp");
      expect(hitsHp).toContain("hp clear");
      expect(hitsHp).toContain("hp set");

      const [hitsSave] = completer("save");
      expect(hitsSave).toContain("save list");
      expect(hitsSave).toContain("save load");
      expect(hitsSave).toContain("save rename");
      expect(hitsSave).toContain("save delete");
    });

    test("highlightMatch colors matching substring within options", () => {
      const highlighted = highlightMatch("stat add", "stat");
      expect(highlighted).toContain("stat");
      // Check that ANSI styling wraps the matched text
      expect(highlighted).toContain("\x1b[33mstat\x1b[0m");

      // Case insensitive match preserves original casing
      const casePreserved = highlightMatch("eff add Poisoned", "pois");
      expect(casePreserved).toContain("\x1b[33mPois\x1b[0m");

      // Empty query or no match returns base string
      const noMatch = highlightMatch("ac clear", "xyz");
      expect(noMatch).toContain("ac clear");
      expect(noMatch).not.toContain("\x1b[33m");
    });

    test("reaction state is set, cleared on turn start, manually restored, and undoable", () => {
      handleCommand("game new");
      handleCommand("char add pc Aragorn Legolas");
      handleCommand("init set 15 Aragorn 10 Legolas");
      
      handleCommand("combat start");
      const aragorn = creatures.find(c => c.name.toLowerCase() === "aragorn");
      const legolas = creatures.find(c => c.name.toLowerCase() === "legolas");
      expect(aragorn).toBeDefined();
      expect(legolas).toBeDefined();
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeFalse();
      expect(creatures.find(c => c.name.toLowerCase() === "legolas")?.reactionUsed).toBeFalsy();

      handleCommand("rxn set Aragorn");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeTrue();

      handleCommand("rxn set Legolas");
      expect(creatures.find(c => c.name.toLowerCase() === "legolas")?.reactionUsed).toBeTrue();

      handleCommand("turn next");
      expect(creatures.find(c => c.name.toLowerCase() === "legolas")?.reactionUsed).toBeFalse();
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeTrue();

      handleCommand("turn next");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeFalse();

      handleCommand("rxn set Aragorn");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeTrue();
      handleCommand("rxn remove Aragorn");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeFalse();

      handleCommand("rxn set Aragorn");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeTrue();
      handleCommand("undo");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeFalse();
    });

    test("c alias starts and ends combat correctly and autocompletes", () => {
      handleCommand("game new");
      handleCommand("char add pc Aragorn");
      handleCommand("init set 15 Aragorn");

      expect(getCombatState().inCombat).toBeFalse();

      handleCommand("c");
      expect(getCombatState().inCombat).toBeTrue();

      handleCommand("c end");
      expect(processConfirmation("y")).toBeTrue();
      expect(getCombatState().inCombat).toBeFalse();

      const [hitsC, lineC] = completer("c ");
      expect(hitsC).toContain("c start");
      expect(hitsC).toContain("c end");
      expect(lineC).toBe("c ");
    });

    test("skips dead creatures during combat turn transitions", () => {
      handleCommand("game new");
      handleCommand("char add pc A B C");
      handleCommand("hp set 10 A 10 B 10 C");
      handleCommand("init set 30 A 20 B 10 C");

      handleCommand("dmg add 10 B");
      expect(creatures.find(c => c.name === "A")?.statusEffects).not.toContain("Dead");
      expect(creatures.find(c => c.name === "B")?.statusEffects).toContain("Dead");

      handleCommand("combat");
      expect(getCombatState().activeCreature?.name).toBe("A");

      handleCommand("turn next");
      expect(getCombatState().activeCreature?.name).toBe("C");

      handleCommand("turn next");
      expect(getCombatState().activeCreature?.name).toBe("A");

      handleCommand("dmg remove 10 B");
      expect(creatures.find(c => c.name === "B")?.statusEffects).not.toContain("Dead");

      handleCommand("turn next");
      expect(getCombatState().activeCreature?.name).toBe("B");
    });

    test("does not restart combat if already started", () => {
      handleCommand("game new");
      handleCommand("char add pc A");
      handleCommand("combat");
      expect(getCombatState().inCombat).toBeTrue();

      handleCommand("combat");
      expect(getCombatState().inCombat).toBeTrue();
    });

    test("wraps status effects to multiple lines when exceeding column width", () => {
      const effects = ["Poisoned", "Raging", "Concentrating", "Blessed", "Inspired", "Restrained"];
      const wrapped = wrapStatusEffects(effects, 20);
      expect(wrapped.length).toBeGreaterThan(1);
      
      for (const line of wrapped) {
        expect(line.length).toBeLessThanOrEqual(20);
      }

      const singleLong = ["SuperLongEffectNameThatIsWayMoreThanTenCharacters"];
      const wrappedLong = wrapStatusEffects(singleLong, 10);
      expect(wrappedLong).toEqual(["SuperLongEffectNameThatIsWayMoreThanTenCharacters"]);
    });

    test("supports Resource Usage column, incrementing/decrementing, alias res, and partial matching", () => {
      handleCommand("game new");
      handleCommand("char add pc Joe");

      // Verify initial state
      const joe = creatures.find(c => c.name === "Joe")!;
      expect(joe.resourceUsage).toEqual({});

      // Increment legaction
      handleCommand("res add legaction Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(1);

      // Increment again
      handleCommand("res add legaction Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(2);

      // Partial matching with "res use" alias
      handleCommand("res use lega Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(3);

      // Partial matching is case-insensitive
      handleCommand("res use LEGA Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(4);

      // Decrementing/removing resource
      handleCommand("res remove leg Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(3);

      // Verify it is removed completely when reaching 0
      handleCommand("res remove leg Joe"); // 2
      handleCommand("res remove leg Joe"); // 1
      handleCommand("res remove leg Joe"); // 0 -> deleted
      expect(joe.resourceUsage?.["legaction"]).toBeUndefined();

      // Test clearing resource usage
      handleCommand("res add spellslot Joe");
      expect(joe.resourceUsage?.["spellslot"]).toBe(1);
      handleCommand("res clear Joe");
      expect(joe.resourceUsage?.["spellslot"]).toBeUndefined();
    });

    test("resource command autocompletions", () => {
      handleCommand("game new");
      handleCommand("char add pc Joe");
      handleCommand("res add spellslot Joe");

      // Autocomplete "res "
      const [resHits, _] = completer("res ");
      expect(resHits).toContain("res add");
      expect(resHits).toContain("res use");
      expect(resHits).toContain("res remove");
      expect(resHits).toContain("res clear");

      // Autocomplete existing resources
      const [useHits, _2] = completer("res use ");
      expect(useHits).toContain("res use spellslot");
    });

    test("help command with filter highlights matching lines", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        handleCommand("help res");
        
        const resLine = logs.find(l => l.includes("res (add | use)"));
        const charLine = logs.find(l => l.includes("char add"));

        expect(resLine).toBeDefined();
        expect(resLine).toContain("\x1b[1m");
        expect(resLine).toContain("\x1b[33m");

        expect(charLine).toBeDefined();
        expect(charLine).not.toContain("\x1b[33m");
      } finally {
        console.log = originalLog;
      }
    });

    test("help menu lists commands cleanly in noun-first format", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        handleCommand("help");
        const fullOutput = logs.join("\n");

        expect(fullOutput).toContain("(pc | enemy | neutral) remove");
        expect(fullOutput).toContain("type set (pc | enemy | neutral)");
        expect(fullOutput).not.toContain("type set <target>...");
        expect(fullOutput).toContain("dmg add <value> <target>...");
        expect(fullOutput).toContain("dmg remove <value> <target>...");
        expect(fullOutput).toContain("save delete [<name>...]");

        // Disallowed old verbs should not appear in help menu
        expect(fullOutput).not.toContain("  add pc");
        expect(fullOutput).not.toContain("hurt <value>");
        expect(fullOutput).not.toContain("heal <value>");
        expect(fullOutput).not.toContain("delete save");
      } finally {
        console.log = originalLog;
      }
    });

    test("completer includes noun-first templates and excludes legacy commands", () => {
      const [charHits] = completer("char remove ");
      expect(charHits).toContain("char remove pcs");
      expect(charHits).toContain("char remove enemies");
      expect(charHits).toContain("char remove neutrals");

      const [saveHits] = completer("save ");
      expect(saveHits).toContain("save delete");

      const [legacyAdd] = completer("add ");
      expect(legacyAdd).toHaveLength(0);

      const [legacySet] = completer("set ");
      expect(legacySet).toHaveLength(0);

      const [legacyRm] = completer("remove ");
      expect(legacyRm).toHaveLength(0);
    });
  });

  describe("Changing Creature Type", () => {
    test("changes creature type using 'type set <type> <target>' and shorthands", () => {
      handleCommand("char add pc Aragorn");
      const aragorn = creatures.find((c) => c.name === "Aragorn");
      expect(aragorn?.type).toBe("pc");

      handleCommand("type set enemy Aragorn");
      expect(aragorn?.type).toBe("enemy");

      handleCommand("type set neutral Aragorn");
      expect(aragorn?.type).toBe("neutral");

      handleCommand("type set p Aragorn");
      expect(aragorn?.type).toBe("pc");

      handleCommand("type set e Aragorn");
      expect(aragorn?.type).toBe("enemy");

      handleCommand("type set n Aragorn");
      expect(aragorn?.type).toBe("neutral");
    });

    test("supports multiple targets with one type: 'type set <type> <t1> <t2>'", () => {
      handleCommand("char add pc Aragorn Legolas Gimli");
      handleCommand("type set enemy Aragorn Legolas");

      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");
      expect(creatures.find((c) => c.name === "Legolas")?.type).toBe("enemy");
      expect(creatures.find((c) => c.name === "Gimli")?.type).toBe("pc");
    });

    test("supports alternating pairs: 'type set <type1> <t1> <type2> <t2>'", () => {
      handleCommand("char add pc Aragorn Legolas");
      handleCommand("type set enemy Aragorn neutral Legolas");

      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");
      expect(creatures.find((c) => c.name === "Legolas")?.type).toBe("neutral");
    });

    test("rejects target-first syntax: 'type set <target> <type>'", () => {
      handleCommand("char add pc Aragorn Legolas");
      handleCommand("type set Aragorn enemy");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");

      handleCommand("type set Aragorn Legolas neutral");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");
      expect(creatures.find((c) => c.name === "Legolas")?.type).toBe("pc");
    });

    test("supports 'type set' and 'type' command shortcuts", () => {
      handleCommand("char add pc Aragorn");
      handleCommand("type set enemy Aragorn");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");

      handleCommand("type set pc Aragorn");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");

      handleCommand("type neutral Aragorn");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("neutral");
    });

    test("validates invalid types and nonexistent targets", () => {
      handleCommand("char add pc Aragorn");
      
      // Invalid type
      expect(handleCommand("type set dragon Aragorn")).toBeTrue();
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");

      // Nonexistent target
      expect(handleCommand("type set enemy Nonexistent")).toBeTrue();
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");

      // Missing arguments
      expect(handleCommand("type set")).toBeTrue();
      expect(handleCommand("type set pc")).toBeTrue();
    });

    test("is undoable and redoable", () => {
      handleCommand("char add pc Aragorn");
      const aragorn = creatures.find((c) => c.name === "Aragorn");
      expect(aragorn?.type).toBe("pc");

      handleCommand("type set enemy Aragorn");
      expect(aragorn?.type).toBe("enemy");

      handleCommand("undo");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");

      handleCommand("redo");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");
    });

    test("type set autocompletions", () => {
      handleCommand("game new");
      handleCommand("char add pc Aragorn");

      const [typeHits, _] = completer("type ");
      expect(typeHits).toContain("type set");

      const [typeSetHits, _2] = completer("type set ");
      expect(typeSetHits).toContain("type set pc");
      expect(typeSetHits).toContain("type set enemy");
      expect(typeSetHits).toContain("type set neutral");
      expect(typeSetHits).not.toContain("type set Aragorn");

      const [typeSetPcHits] = completer("type set pc ");
      expect(typeSetPcHits).toContain("type set pc Aragorn");
    });
  });

  describe("Death States & HP Thresholds", () => {
    test("marks creature Dead immediately when dmg matches HP for PC, enemy, and neutral", () => {
      handleCommand("game new");
      handleCommand("char add pc Hero");
      handleCommand("char add enemy Goblin");
      handleCommand("char add neutral Merchant");

      handleCommand("hp set 20 Hero 12 Goblin 8 Merchant");

      handleCommand("dmg add 20 Hero");
      expect(creatures.find(c => c.name === "Hero")?.statusEffects).toContain("Dead");

      handleCommand("dmg add 12 Goblin");
      expect(creatures.find(c => c.name === "Goblin")?.statusEffects).toContain("Dead");

      handleCommand("dmg add 8 Merchant");
      expect(creatures.find(c => c.name === "Merchant")?.statusEffects).toContain("Dead");
    });

    test("marks creature Dead immediately when dmg exceeds HP for neutral and other characters", () => {
      handleCommand("game new");
      handleCommand("char add pc Hero");
      handleCommand("char add enemy Goblin");
      handleCommand("char add neutral Villager");

      handleCommand("hp set 15 Hero 10 Goblin 6 Villager");

      handleCommand("dmg add 20 Hero");
      expect(creatures.find(c => c.name === "Hero")?.statusEffects).toContain("Dead");

      handleCommand("dmg add 15 Goblin");
      expect(creatures.find(c => c.name === "Goblin")?.statusEffects).toContain("Dead");

      handleCommand("dmg add 12 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).toContain("Dead");
    });

    test("marks creature Dead when set hp sets HP max at or below current damage", () => {
      handleCommand("game new");
      handleCommand("char add neutral Villager");
      handleCommand("dmg add 10 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).not.toContain("Dead");

      // Setting HP equal to existing damage
      handleCommand("hp set 10 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).toContain("Dead");

      // Setting HP lower than existing damage
      handleCommand("hp set 5 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).toContain("Dead");

      // Setting HP above damage restores alive state
      handleCommand("hp set 20 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).not.toContain("Dead");
    });

    test("removes Dead state when healed below max HP", () => {
      handleCommand("game new");
      handleCommand("char add neutral Villager");
      handleCommand("hp set 10 Villager");
      handleCommand("dmg add 10 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).toContain("Dead");

      handleCommand("dmg remove 1 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).not.toContain("Dead");
    });

    test("preserves manual Dead effect on creatures without hpMax", () => {
      handleCommand("game new");
      handleCommand("char add neutral Ghost");
      handleCommand("eff add Dead Ghost");
      expect(creatures.find(c => c.name === "Ghost")?.statusEffects).toContain("Dead");

      // Running a command should not clear manual Dead on null hpMax creature
      handleCommand("char add neutral Skeleton");
      expect(creatures.find(c => c.name === "Ghost")?.statusEffects).toContain("Dead");
    });
  });

  describe("Default Session Loading & Startup", () => {
    test("getLatestSave returns the most recently saved session file", () => {
      handleCommand("game new");
      handleCommand("char add pc FirstHero");
      handleCommand("save test_startup_older");

      const olderPath = path.join(SAVES_DIR, "test_startup_older.json");
      const olderData = JSON.parse(fs.readFileSync(olderPath, "utf-8"));
      olderData.savedAt = new Date(Date.now() - 100000).toISOString();
      fs.writeFileSync(olderPath, JSON.stringify(olderData, null, 2), "utf-8");

      handleCommand("game new");
      handleCommand("char add pc NewerHero");
      handleCommand("save test_startup_newer");

      const newerPath = path.join(SAVES_DIR, "test_startup_newer.json");
      const newerData = JSON.parse(fs.readFileSync(newerPath, "utf-8"));
      newerData.savedAt = new Date(Date.now()).toISOString();
      fs.writeFileSync(newerPath, JSON.stringify(newerData, null, 2), "utf-8");

      const latest = getLatestSave();
      expect(latest).not.toBeNull();
      expect(latest?.name).toBe("test_startup_newer");
    });

    test("initializeSession loads the latest session by default", () => {
      handleCommand("game new");
      handleCommand("char add pc TargetHero");
      handleCommand("hp set 50 TargetHero");
      handleCommand("save test_default_autoload");

      resetState();
      expect(creatures.length).toBe(0);

      const res = initializeSession();
      expect(res.loaded).toBeTrue();
      expect(res.sessionName).toBe("test_default_autoload");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("TargetHero");
      expect(creatures[0]?.hpMax).toBe(50);
    });

    test("initializeSession respects fresh flag and starts fresh", () => {
      handleCommand("game new");
      handleCommand("char add pc SavedHero");
      handleCommand("save test_fresh_override");

      resetState();
      const res = initializeSession({ fresh: true });
      expect(res.loaded).toBeFalse();
      expect(res.sessionName).toBeNull();
      expect(creatures.length).toBe(0);
    });

    test("initializeSession loads specific session when requested", () => {
      handleCommand("game new");
      handleCommand("char add pc SpecificHero");
      handleCommand("save test_specific_slot");

      resetState();
      const res = initializeSession({ saveName: "test_specific_slot" });
      expect(res.loaded).toBeTrue();
      expect(res.sessionName).toBe("test_specific_slot");
      expect(creatures.some(c => c.name === "SpecificHero")).toBeTrue();
    });

    test("initializeSession falls back cleanly if save not found", () => {
      resetState();
      const res = initializeSession({ saveName: "non_existent_save_file_xyz" });
      expect(res.loaded).toBeFalse();
      expect(res.error).toBeDefined();
      expect(creatures.length).toBe(0);
    });

    test("loaded session correctly supports undo and redo on subsequent commands", () => {
      handleCommand("game new");
      handleCommand("char add pc UndoLoadedHero");
      handleCommand("hp set 40 UndoLoadedHero");
      handleCommand("save test_undo_on_loaded");

      resetState();
      initializeSession({ saveName: "test_undo_on_loaded" });

      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("UndoLoadedHero");
      expect(getHistoryStacks().undoLength).toBe(0);

      // Mutate loaded session
      handleCommand("dmg add 15 UndoLoadedHero");
      expect(creatures[0]?.dmg).toBe(15);
      expect(getHistoryStacks().undoLength).toBe(1);

      // Verify Undo restores pre-mutation loaded state
      handleCommand("undo");
      expect(creatures[0]?.dmg).toBe(0);
      expect(getHistoryStacks().undoLength).toBe(0);

      // Verify Redo re-applies mutation
      handleCommand("redo");
      expect(creatures[0]?.dmg).toBe(15);
      expect(getHistoryStacks().undoLength).toBe(1);

      // Verify batch undo on loaded session
      handleCommand("dmg add 5 UndoLoadedHero");
      handleCommand("ac set 18 UndoLoadedHero");
      expect(creatures[0]?.dmg).toBe(20);
      expect(creatures[0]?.ac).toBe(18);

      handleCommand("undo 2");
      expect(creatures[0]?.dmg).toBe(15);
      expect(creatures[0]?.ac).toBeNull();
    });
  });

  describe("Multi-target commands and Glob * removal", () => {
    test("does not match creatures using glob * patterns", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB Goblin1");

      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };

      try {
        // Passing * or Hero* should fail to match
        handleCommand("dmg add 10 Hero*");
        expect(logs.some(l => l.includes('No creature matching "Hero*"'))).toBeTrue();
        expect(creatures.find(c => c.name === "HeroA")?.dmg).toBe(0);

        logs.length = 0;
        handleCommand("ac clear *");
        expect(logs.some(l => l.includes('No creature matching "*"'))).toBeTrue();
      } finally {
        console.log = originalLog;
      }
    });

    test("ambiguous match message does not recommend wildcards", () => {
      handleCommand("game new");
      handleCommand("char add enemy GoblinA GoblinB");

      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };

      try {
        handleCommand("dmg add 10 Gob");
        const ambigMsg = logs.find(l => l.includes("Ambiguous match"));
        expect(ambigMsg).toBeDefined();
        expect(ambigMsg).not.toContain("Perhaps you meant");
        expect(ambigMsg).not.toContain("*");
      } finally {
        console.log = originalLog;
      }
    });

    test("set hp, ac, and init apply to multiple targets with targets as last args", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB HeroC");

      // Set HP for all 3
      handleCommand("hp set 45 HeroA HeroB HeroC");
      expect(creatures.find(c => c.name === "HeroA")?.hpMax).toBe(45);
      expect(creatures.find(c => c.name === "HeroB")?.hpMax).toBe(45);
      expect(creatures.find(c => c.name === "HeroC")?.hpMax).toBe(45);

      // Set AC for all 3
      handleCommand("ac set 18 HeroA HeroB HeroC");
      expect(creatures.find(c => c.name === "HeroA")?.ac).toBe(18);
      expect(creatures.find(c => c.name === "HeroB")?.ac).toBe(18);
      expect(creatures.find(c => c.name === "HeroC")?.ac).toBe(18);

      // Set init for all 3
      handleCommand("init set 14 HeroA HeroB HeroC");
      expect(creatures.find(c => c.name === "HeroA")?.initiative).toBe(14);
      expect(creatures.find(c => c.name === "HeroB")?.initiative).toBe(14);
      expect(creatures.find(c => c.name === "HeroC")?.initiative).toBe(14);

      // Clear stats with targets last
      handleCommand("ac clear HeroA HeroB");
      expect(creatures.find(c => c.name === "HeroA")?.ac).toBeNull();
      expect(creatures.find(c => c.name === "HeroB")?.ac).toBeNull();
      expect(creatures.find(c => c.name === "HeroC")?.ac).toBe(18);
    });

    test("multi-target set commands are fully undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      const initUndoLen = getHistoryStacks().undoLength;
      handleCommand("hp set 50 HeroA HeroB");
      expect(getHistoryStacks().undoLength).toBe(initUndoLen + 1);
      expect(creatures.find(c => c.name === "HeroA")?.hpMax).toBe(50);
      expect(creatures.find(c => c.name === "HeroB")?.hpMax).toBe(50);

      // Undo reverts both
      handleCommand("undo");
      expect(getHistoryStacks().undoLength).toBe(initUndoLen);
      expect(creatures.find(c => c.name === "HeroA")?.hpMax).toBeNull();
      expect(creatures.find(c => c.name === "HeroB")?.hpMax).toBeNull();

      // Redo restores both
      handleCommand("redo");
      expect(getHistoryStacks().undoLength).toBe(initUndoLen + 1);
      expect(creatures.find(c => c.name === "HeroA")?.hpMax).toBe(50);
      expect(creatures.find(c => c.name === "HeroB")?.hpMax).toBe(50);
    });

    test("type set supports multiple targets as last args and is undoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      handleCommand("type set enemy HeroA HeroB");
      expect(creatures.find(c => c.name === "HeroA")?.type).toBe("enemy");
      expect(creatures.find(c => c.name === "HeroB")?.type).toBe("enemy");

      handleCommand("type set neutral HeroA HeroB");
      expect(creatures.find(c => c.name === "HeroA")?.type).toBe("neutral");
      expect(creatures.find(c => c.name === "HeroB")?.type).toBe("neutral");

      handleCommand("undo");
      expect(creatures.find(c => c.name === "HeroA")?.type).toBe("enemy");
      expect(creatures.find(c => c.name === "HeroB")?.type).toBe("enemy");
    });

    test("char remove removes multiple targets and is undoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB HeroC");
      expect(creatures.length).toBe(3);

      handleCommand("char remove HeroA HeroC");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("HeroB");

      handleCommand("undo");
      expect(creatures.length).toBe(3);
      expect(creatures.map(c => c.name)).toEqual(["HeroA", "HeroB", "HeroC"]);
    });
  });

  describe("Noun-First Command Syntax (<field|entity> <command> <value> <target...>)", () => {
    test("normalizeCommandTokens accurately maps noun-first tokens", () => {
      expect(normalizeCommandTokens(["save", "list"])).toEqual(["saves"]);
      expect(normalizeCommandTokens(["save", "ls"])).toEqual(["saves"]);
      expect(normalizeCommandTokens(["save", "load", "slot1"])).toEqual(["load", "save", "slot1"]);
      expect(normalizeCommandTokens(["save", "delete", "slot1"])).toEqual(["save", "delete", "slot1"]);
      expect(normalizeCommandTokens(["game", "new"])).toEqual(["new", "game"]);
      expect(normalizeCommandTokens(["game", "load", "slot1"])).toEqual(["load", "save", "slot1"]);
      expect(normalizeCommandTokens(["game", "save", "slot1"])).toEqual(["save", "slot1"]);
      expect(normalizeCommandTokens(["game", "rename", "slot2"])).toEqual(["rename", "save", "slot2"]);
      expect(normalizeCommandTokens(["game", "delete", "slot1"])).toEqual(["delete", "save", "slot1"]);
      expect(normalizeCommandTokens(["game", "list"])).toEqual(["saves"]);
      expect(normalizeCommandTokens(["char", "add", "enemy", "G1", "G2"])).toEqual(["add", "enemy", "G1", "G2"]);
      expect(normalizeCommandTokens(["char", "add", "pc", "Hero"])).toEqual(["add", "pc", "Hero"]);
      expect(normalizeCommandTokens(["char", "add", "neutral", "Merchant"])).toEqual(["add", "neutral", "Merchant"]);
      expect(normalizeCommandTokens(["char", "add", "G1"])).toEqual(["add", "char", "G1"]);
      expect(normalizeCommandTokens(["char", "remove", "G1"])).toEqual(["remove", "char", "G1"]);
      expect(normalizeCommandTokens(["char", "remove", "pcs"])).toEqual(["remove", "pcs"]);
      expect(normalizeCommandTokens(["pc", "add", "P1"])).toEqual(["add", "pc", "P1"]);
      expect(normalizeCommandTokens(["enemy", "add", "E1"])).toEqual(["add", "enemy", "E1"]);
      expect(normalizeCommandTokens(["neutral", "add", "N1"])).toEqual(["add", "neutral", "N1"]);
      expect(normalizeCommandTokens(["pc", "remove", "P1"])).toEqual(["remove", "pc", "P1"]);
      expect(normalizeCommandTokens(["type", "set", "enemy", "Hero"])).toEqual(["set", "type", "enemy", "Hero"]);
      expect(normalizeCommandTokens(["type", "set", "pc", "Hero"])).toEqual(["set", "type", "pc", "Hero"]);
      expect(normalizeCommandTokens(["hp", "set", "40", "Hero"])).toEqual(["set", "hp", "40", "Hero"]);
      expect(normalizeCommandTokens(["hp", "clear", "Hero"])).toEqual(["clear", "hp", "Hero"]);
      expect(normalizeCommandTokens(["ac", "set", "16", "Hero"])).toEqual(["set", "ac", "16", "Hero"]);
      expect(normalizeCommandTokens(["ac", "clear", "all"])).toEqual(["clear", "ac", "all"]);
      expect(normalizeCommandTokens(["init", "set", "12", "Hero"])).toEqual(["set", "init", "12", "Hero"]);
      expect(normalizeCommandTokens(["init", "clear", "Hero"])).toEqual(["clear", "init", "Hero"]);
      expect(normalizeCommandTokens(["dmg", "add", "10", "Hero"])).toEqual(["add", "dmg", "10", "Hero"]);
      expect(normalizeCommandTokens(["dmg", "remove", "5", "Hero"])).toEqual(["remove", "dmg", "5", "Hero"]);
      expect(normalizeCommandTokens(["dmg", "clear", "Hero"])).toEqual(["clear", "dmg", "Hero"]);
      expect(normalizeCommandTokens(["eff", "add", "Stunned", "Hero"])).toEqual(["add", "eff", "Stunned", "Hero"]);
      expect(normalizeCommandTokens(["eff", "remove", "Stunned", "Hero"])).toEqual(["remove", "eff", "Stunned", "Hero"]);
      expect(normalizeCommandTokens(["cond", "add", "Poisoned", "Hero"])).toEqual(["add", "eff", "Poisoned", "Hero"]);
      expect(normalizeCommandTokens(["res", "add", "rage", "Hero"])).toEqual(["add", "res", "rage", "Hero"]);
      expect(normalizeCommandTokens(["res", "use", "rage", "Hero"])).toEqual(["add", "res", "rage", "Hero"]);
      expect(normalizeCommandTokens(["res", "remove", "rage", "Hero"])).toEqual(["remove", "res", "rage", "Hero"]);
      expect(normalizeCommandTokens(["res", "clear", "Hero"])).toEqual(["clear", "res", "Hero"]);
      expect(normalizeCommandTokens(["rxn", "set", "Hero"])).toEqual(["add", "rxn", "Hero"]);
      expect(normalizeCommandTokens(["rxn", "remove", "Hero"])).toEqual(["remove", "rxn", "Hero"]);
      expect(normalizeCommandTokens(["turn", "next"])).toEqual(["next"]);
      expect(normalizeCommandTokens(["turn", "prev", "2"])).toEqual(["prev", "2"]);
      expect(normalizeCommandTokens(["activity", "show"])).toEqual(["show", "activity"]);
    });

    test("game new resets state cleanly", () => {
      handleCommand("char add pc HeroA");
      expect(creatures.length).toBe(1);
      handleCommand("game new");
      expect(creatures.length).toBe(0);
      expect(getHistoryStacks().undoLength).toBe(0);
    });

    test("char add [type] and pc/enemy/neutral add are undoable and redoable", () => {
      handleCommand("game new");
      
      // char add pc
      const initialUndo = getHistoryStacks().undoLength;
      handleCommand("char add pc HeroA HeroB");
      expect(creatures.length).toBe(2);
      expect(creatures[0]?.type).toBe("pc");
      expect(creatures[1]?.type).toBe("pc");
      expect(getHistoryStacks().undoLength).toBe(initialUndo + 1);

      handleCommand("undo");
      expect(creatures.length).toBe(0);
      expect(getHistoryStacks().undoLength).toBe(initialUndo);

      handleCommand("redo");
      expect(creatures.length).toBe(2);
      expect(creatures.map(c => c.name)).toEqual(["HeroA", "HeroB"]);

      // char add enemy & neutral
      handleCommand("char add enemy Goblin1 Goblin2");
      expect(creatures.length).toBe(4);
      expect(creatures[2]?.type).toBe("enemy");

      handleCommand("char add neutral Merchant");
      expect(creatures.length).toBe(5);
      expect(creatures[4]?.type).toBe("neutral");

      handleCommand("undo");
      expect(creatures.length).toBe(4);
      handleCommand("redo");
      expect(creatures.length).toBe(5);

      // (pc | enemy | neutral) add
      handleCommand("pc add HeroC");
      expect(creatures.length).toBe(6);
      expect(creatures[5]?.type).toBe("pc");

      handleCommand("enemy add Goblin3");
      expect(creatures.length).toBe(7);
      expect(creatures[6]?.type).toBe("enemy");

      handleCommand("neutral add Villager");
      expect(creatures.length).toBe(8);
      expect(creatures[7]?.type).toBe("neutral");

      handleCommand("undo");
      expect(creatures.length).toBe(7);
      handleCommand("redo");
      expect(creatures.length).toBe(8);
    });

    test("char add prompts for type and is undoable", () => {
      handleCommand("game new");
      handleCommand("char add PromptedChar");
      expect(getCombatState().pendingQuitConfirmation).toBeFalse();
      expect(getPendingCharTypePrompt()).not.toBeNull();
      expect(getPendingCharTypePrompt()?.names).toEqual(["PromptedChar"]);

      processCharTypePrompt("pc");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("PromptedChar");
      expect(creatures[0]?.type).toBe("pc");

      handleCommand("undo");
      expect(creatures.length).toBe(0);

      handleCommand("redo");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("PromptedChar");
    });

    test("char remove and type remove are undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");
      handleCommand("char add enemy Goblin1 Goblin2");
      expect(creatures.length).toBe(4);

      // Specific removal with multiple targets
      handleCommand("char remove HeroA Goblin1");
      expect(creatures.length).toBe(2);
      expect(creatures.map(c => c.name)).toEqual(["HeroB", "Goblin2"]);

      handleCommand("undo");
      expect(creatures.length).toBe(4);

      handleCommand("redo");
      expect(creatures.length).toBe(2);

      // Bulk remove enemies
      handleCommand("enemy remove");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("HeroB");

      handleCommand("undo");
      expect(creatures.length).toBe(2);
      expect(creatures.some(c => c.name === "Goblin2")).toBeTrue();

      // Bulk remove pcs
      handleCommand("pc remove");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("Goblin2");

      handleCommand("undo");
      expect(creatures.length).toBe(2);
    });

    test("type set is undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      handleCommand("type set enemy HeroA HeroB");
      expect(creatures[0]?.type).toBe("enemy");
      expect(creatures[1]?.type).toBe("enemy");

      handleCommand("undo");
      expect(creatures[0]?.type).toBe("pc");
      expect(creatures[1]?.type).toBe("pc");

      handleCommand("redo");
      expect(creatures[0]?.type).toBe("enemy");
      expect(creatures[1]?.type).toBe("enemy");

      // Update one target: type set pc HeroA
      handleCommand("type set pc HeroA");
      expect(creatures[0]?.type).toBe("pc");
      handleCommand("undo");
      expect(creatures[0]?.type).toBe("enemy");
    });

    test("hp set and hp clear are undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      // hp set <val> <target...>
      handleCommand("hp set 50 HeroA HeroB");
      expect(creatures[0]?.hpMax).toBe(50);
      expect(creatures[1]?.hpMax).toBe(50);

      handleCommand("undo");
      expect(creatures[0]?.hpMax).toBeNull();
      expect(creatures[1]?.hpMax).toBeNull();

      handleCommand("redo");
      expect(creatures[0]?.hpMax).toBe(50);
      expect(creatures[1]?.hpMax).toBe(50);

      // hp clear <target...>
      handleCommand("hp clear HeroA");
      expect(creatures[0]?.hpMax).toBeNull();
      expect(creatures[1]?.hpMax).toBe(50);

      handleCommand("undo");
      expect(creatures[0]?.hpMax).toBe(50);

      // hp clear all
      handleCommand("hp clear all");
      expect(creatures[0]?.hpMax).toBeNull();
      expect(creatures[1]?.hpMax).toBeNull();

      handleCommand("undo");
      expect(creatures[0]?.hpMax).toBe(50);
      expect(creatures[1]?.hpMax).toBe(50);
    });

    test("ac set and ac clear are undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      handleCommand("ac set 17 HeroA HeroB");
      expect(creatures[0]?.ac).toBe(17);
      expect(creatures[1]?.ac).toBe(17);

      handleCommand("undo");
      expect(creatures[0]?.ac).toBeNull();
      expect(creatures[1]?.ac).toBeNull();

      handleCommand("redo");
      expect(creatures[0]?.ac).toBe(17);
      expect(creatures[1]?.ac).toBe(17);

      handleCommand("ac clear HeroA");
      expect(creatures[0]?.ac).toBeNull();
      expect(creatures[1]?.ac).toBe(17);

      handleCommand("undo");
      expect(creatures[0]?.ac).toBe(17);

      handleCommand("ac clear all");
      expect(creatures[0]?.ac).toBeNull();
      expect(creatures[1]?.ac).toBeNull();

      handleCommand("undo");
      expect(creatures[0]?.ac).toBe(17);
      expect(creatures[1]?.ac).toBe(17);
    });

    test("init set and init clear are undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      handleCommand("init set 15 HeroA HeroB");
      expect(creatures[0]?.initiative).toBe(15);
      expect(creatures[1]?.initiative).toBe(15);

      handleCommand("undo");
      expect(creatures[0]?.initiative).toBeNull();
      expect(creatures[1]?.initiative).toBeNull();

      handleCommand("redo");
      expect(creatures[0]?.initiative).toBe(15);
      expect(creatures[1]?.initiative).toBe(15);

      handleCommand("init clear HeroA");
      expect(creatures[0]?.initiative).toBeNull();
      expect(creatures[1]?.initiative).toBe(15);

      handleCommand("undo");
      expect(creatures[0]?.initiative).toBe(15);

      handleCommand("init clear all");
      expect(creatures[0]?.initiative).toBeNull();
      expect(creatures[1]?.initiative).toBeNull();

      handleCommand("undo");
      expect(creatures[0]?.initiative).toBe(15);
      expect(creatures[1]?.initiative).toBe(15);
    });

    test("dmg add, dmg remove, and dmg clear are undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      // dmg add
      handleCommand("dmg add 14 HeroA HeroB");
      expect(creatures[0]?.dmg).toBe(14);
      expect(creatures[1]?.dmg).toBe(14);

      handleCommand("undo");
      expect(creatures[0]?.dmg).toBe(0);
      expect(creatures[1]?.dmg).toBe(0);

      handleCommand("redo");
      expect(creatures[0]?.dmg).toBe(14);
      expect(creatures[1]?.dmg).toBe(14);

      // dmg remove (heal)
      handleCommand("dmg remove 6 HeroA HeroB");
      expect(creatures[0]?.dmg).toBe(8);
      expect(creatures[1]?.dmg).toBe(8);

      handleCommand("undo");
      expect(creatures[0]?.dmg).toBe(14);
      expect(creatures[1]?.dmg).toBe(14);

      handleCommand("redo");
      expect(creatures[0]?.dmg).toBe(8);
      expect(creatures[1]?.dmg).toBe(8);

      // dmg clear
      handleCommand("dmg clear HeroA");
      expect(creatures[0]?.dmg).toBe(0);
      expect(creatures[1]?.dmg).toBe(8);

      handleCommand("undo");
      expect(creatures[0]?.dmg).toBe(8);

      handleCommand("dmg clear all");
      expect(creatures[0]?.dmg).toBe(0);
      expect(creatures[1]?.dmg).toBe(0);

      handleCommand("undo");
      expect(creatures[0]?.dmg).toBe(8);
      expect(creatures[1]?.dmg).toBe(8);
    });

    test("eff add and eff remove are undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      handleCommand("eff add Stunned HeroA HeroB");
      expect(creatures[0]?.statusEffects).toContain("Stunned");
      expect(creatures[1]?.statusEffects).toContain("Stunned");

      handleCommand("undo");
      expect(creatures[0]?.statusEffects).not.toContain("Stunned");
      expect(creatures[1]?.statusEffects).not.toContain("Stunned");

      handleCommand("redo");
      expect(creatures[0]?.statusEffects).toContain("Stunned");
      expect(creatures[1]?.statusEffects).toContain("Stunned");

      handleCommand("eff remove Stunned HeroA HeroB");
      expect(creatures[0]?.statusEffects).not.toContain("Stunned");
      expect(creatures[1]?.statusEffects).not.toContain("Stunned");

      handleCommand("undo");
      expect(creatures[0]?.statusEffects).toContain("Stunned");
      expect(creatures[1]?.statusEffects).toContain("Stunned");

      handleCommand("redo");
      expect(creatures[0]?.statusEffects).not.toContain("Stunned");
      expect(creatures[1]?.statusEffects).not.toContain("Stunned");
    });

    test("res add, res use, res remove, and res clear are undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      // res add
      handleCommand("res add \"action surge\" HeroA HeroB");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBe(1);
      expect(creatures[1]?.resourceUsage?.["action surge"]).toBe(1);

      handleCommand("undo");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBeUndefined();
      expect(creatures[1]?.resourceUsage?.["action surge"]).toBeUndefined();

      handleCommand("redo");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBe(1);
      expect(creatures[1]?.resourceUsage?.["action surge"]).toBe(1);

      // res use (increment)
      handleCommand("res use \"action surge\" HeroA");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBe(2);

      handleCommand("undo");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBe(1);

      handleCommand("redo");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBe(2);

      // res remove (decrement)
      handleCommand("res remove \"action surge\" HeroA");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBe(1);

      handleCommand("undo");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBe(2);

      // res clear
      handleCommand("res clear HeroA");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBeUndefined();

      handleCommand("undo");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBe(2);

      handleCommand("res clear all");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBeUndefined();
      expect(creatures[1]?.resourceUsage?.["action surge"]).toBeUndefined();

      handleCommand("undo");
      expect(creatures[0]?.resourceUsage?.["action surge"]).toBe(2);
      expect(creatures[1]?.resourceUsage?.["action surge"]).toBe(1);
    });

    test("rxn set and rxn remove are undoable and redoable", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");

      handleCommand("rxn set HeroA HeroB");
      expect(creatures[0]?.reactionUsed).toBeTrue();
      expect(creatures[1]?.reactionUsed).toBeTrue();

      handleCommand("undo");
      expect(creatures[0]?.reactionUsed).toBeFalsy();
      expect(creatures[1]?.reactionUsed).toBeFalsy();

      handleCommand("redo");
      expect(creatures[0]?.reactionUsed).toBeTrue();
      expect(creatures[1]?.reactionUsed).toBeTrue();

      handleCommand("rxn remove HeroA");
      expect(creatures[0]?.reactionUsed).toBeFalse();
      expect(creatures[1]?.reactionUsed).toBeTrue();

      handleCommand("undo");
      expect(creatures[0]?.reactionUsed).toBeTrue();

      handleCommand("redo");
      expect(creatures[0]?.reactionUsed).toBeFalse();
    });

    test("turn next and turn prev are undoable and redoable in combat mode", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA HeroB");
      handleCommand("init set 20 HeroA 10 HeroB");
      handleCommand("combat start");

      const state1 = getCombatState();
      expect(state1.inCombat).toBeTrue();
      expect(state1.currentRound).toBe(1);
      expect(state1.currentTurnIndex).toBe(0);

      // Advance turn with turn next
      handleCommand("turn next");
      const state2 = getCombatState();
      expect(state2.currentTurnIndex).toBe(1);

      handleCommand("undo");
      const state3 = getCombatState();
      expect(state3.currentTurnIndex).toBe(0);

      handleCommand("redo");
      const state4 = getCombatState();
      expect(state4.currentTurnIndex).toBe(1);

      // Rewind turn with turn prev
      handleCommand("turn prev");
      expect(getCombatState().currentTurnIndex).toBe(0);

      handleCommand("undo");
      expect(getCombatState().currentTurnIndex).toBe(1);

      handleCommand("redo");
      expect(getCombatState().currentTurnIndex).toBe(0);
    });

    test("save commands (list, rename, delete) function cleanly with noun-first syntax", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA");
      handleCommand("save test_noun_save");

      const saveFile = path.join(SAVES_DIR, "test_noun_save.json");
      expect(fs.existsSync(saveFile)).toBeTrue();

      // save list is undo exempt
      const preUndoLen = getHistoryStacks().undoLength;
      handleCommand("save list");
      expect(getHistoryStacks().undoLength).toBe(preUndoLen);

      // activity show is undo exempt
      handleCommand("activity show");
      expect(getHistoryStacks().undoLength).toBe(preUndoLen);

      // save rename
      handleCommand("save rename test_noun_save_renamed");
      const renamedFile = path.join(SAVES_DIR, "test_noun_save_renamed.json");
      expect(fs.existsSync(renamedFile)).toBeTrue();

      // save delete
      handleCommand("save delete test_noun_save_renamed");
      expect(fs.existsSync(renamedFile)).toBeFalse();
    });

    test("batch undo 3 correctly unwinds multiple noun-first commands", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA");
      handleCommand("hp set 40 HeroA");
      handleCommand("ac set 16 HeroA");
      handleCommand("dmg add 10 HeroA");

      expect(creatures[0]?.hpMax).toBe(40);
      expect(creatures[0]?.ac).toBe(16);
      expect(creatures[0]?.dmg).toBe(10);

      // Undo 3 commands: dmg add, ac set, hp set
      handleCommand("undo 3");
      expect(creatures[0]?.hpMax).toBeNull();
      expect(creatures[0]?.ac).toBeNull();
      expect(creatures[0]?.dmg).toBe(0);

      // Redo 3 commands
      handleCommand("redo 3");
      expect(creatures[0]?.hpMax).toBe(40);
      expect(creatures[0]?.ac).toBe(16);
      expect(creatures[0]?.dmg).toBe(10);
    });

    test("completer provides autocompletions for noun-first syntax", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA");

      // hp
      const [hpHits] = completer("hp ");
      expect(hpHits).toContain("hp set");
      expect(hpHits).toContain("hp clear");

      // ac
      const [acHits] = completer("ac ");
      expect(acHits).toContain("ac set");
      expect(acHits).toContain("ac clear");

      // dmg
      const [dmgHits] = completer("dmg ");
      expect(dmgHits).toContain("dmg add");
      expect(dmgHits).toContain("dmg remove");
      expect(dmgHits).toContain("dmg clear");

      // char
      const [charHits] = completer("char ");
      expect(charHits).toContain("char add");
      expect(charHits).toContain("char remove");

      // pc
      const [pcHits] = completer("pc ");
      expect(pcHits).toContain("pc add");
      expect(pcHits).toContain("pc remove");

      // save
      const [saveHits] = completer("save ");
      expect(saveHits).toContain("save list");
      expect(saveHits).toContain("save delete");
      expect(saveHits).toContain("save load");
      expect(saveHits).toContain("save rename");

      // game
      const [gameHits] = completer("game ");
      expect(gameHits).toContain("game new");
      expect(gameHits).toContain("game load");
      expect(gameHits).toContain("game save");

      // turn
      const [turnHits] = completer("turn ");
      expect(turnHits).toContain("turn next");
      expect(turnHits).toContain("turn prev");

      // activity
      const [actHits] = completer("activity ");
      expect(actHits).toContain("activity show");
    });
  });

  describe("Disallowed Legacy Commands & Exception Preservation", () => {
    test("rejects all legacy verb-first commands as unknown commands and prevents state mutation", () => {
      handleCommand("game new");
      handleCommand("char add pc HeroA");
      const preUndoLength = getHistoryStacks().undoLength;

      const disallowedSamples = [
        "add pc HeroB",
        "add enemy Goblin1",
        "set hp 20 HeroA",
        "set ac 15 HeroA",
        "set init 12 HeroA",
        "remove HeroA",
        "rm HeroA",
        "clear hp HeroA",
        "clear all",
        "delete save slot1",
        "del save slot1",
        "load save slot1",
        "loadgame slot1",
        "new game",
        "rename save slot1 slot2",
        "saves",
        "list",
        "hurt 10 HeroA",
        "heal 5 HeroA",
        "use rage HeroA",
        "change type HeroA enemy",
        "show activity",
        "next",
        "prev",
        "n",
        "p",
        "start combat",
        "end combat",
      ];

      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        for (const cmd of disallowedSamples) {
          logs.length = 0;
          const handled = handleCommand(cmd);
          expect(handled).toBeTrue();
          expect(logs.some(l => l.includes(`Unknown command: "${cmd}". Type "help" for commands.`))).toBeTrue();
        }
      } finally {
        console.log = originalLog;
      }

      // State and undo stack remain completely untouched
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("HeroA");
      expect(getHistoryStacks().undoLength).toBe(preUndoLength);
    });

    test("every keyword in OLD_DISALLOWED_COMMANDS is rejected as unknown command", () => {
      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        for (const disCmd of OLD_DISALLOWED_COMMANDS) {
          logs.length = 0;
          handleCommand(disCmd);
          expect(logs.some(l => l.includes(`Unknown command: "${disCmd}". Type "help" for commands.`))).toBeTrue();
        }
      } finally {
        console.log = originalLog;
      }
    });

    test("allowed exceptions without field/entity continue to function", () => {
      handleCommand("game new");

      // 1. test and test simple
      handleCommand("test simple");
      expect(creatures.length).toBeGreaterThan(0);

      // 2. undo / redo
      handleCommand("char add pc Hero");
      handleCommand("hp set 50 Hero");
      expect(creatures.find(c => c.name === "Hero")?.hpMax).toBe(50);
      handleCommand("u");
      expect(creatures.find(c => c.name === "Hero")?.hpMax).toBeNull();
      handleCommand("r");
      expect(creatures.find(c => c.name === "Hero")?.hpMax).toBe(50);

      // 3. quit / exit / q
      expect(getCombatState().pendingQuitConfirmation).toBeFalse();
      handleCommand("q");
      expect(getCombatState().pendingQuitConfirmation).toBeTrue();
      processQuitConfirmation("n");
      expect(getCombatState().pendingQuitConfirmation).toBeFalse();

      // 4. help / h
      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };
      try {
        handleCommand("h");
        expect(logs.some(l => l.includes("Available commands:"))).toBeTrue();
      } finally {
        console.log = originalLog;
      }
    });
  });
});

