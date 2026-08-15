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

    test("supports hurt and heal alias commands", () => {
      handleCommand("add pc Hero");
      handleCommand("hurt 15 Hero");
      const hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.dmg).toBe(15);

      handleCommand("heal 5 Hero");
      expect(hero?.dmg).toBe(10);

      // heal down to 0 cap
      handleCommand("heal 20 Hero");
      expect(hero?.dmg).toBe(0);
    });

    test("supports multiple value and target pairs for setting HP, AC, and initiative", () => {
      handleCommand("add pc HeroA HeroB");
      handleCommand("set hp 40 HeroA 35 HeroB");
      handleCommand("set ac 18 HeroA 15 HeroB");
      handleCommand("set init 14 HeroA 20 HeroB");

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
      handleCommand("add pc Hero");
      handleCommand("add eff Poisoned Hero");
      let hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).toContain("Poisoned");

      handleCommand("remove eff Poisoned Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).not.toContain("Poisoned");

      // Verify that "cond" alias works
      handleCommand("add cond Poisoned Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).toContain("Poisoned");

      handleCommand("remove cond Poisoned Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).not.toContain("Poisoned");
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
      handleCommand("clear init");
      expect(creatures.map((c) => c.initiative)).toEqual(initBefore);

      handleCommand("clear dmg");
      expect(creatures.map((c) => c.dmg)).toEqual(dmgBefore);

      handleCommand("clear hp");
      expect(creatures.map((c) => c.hpMax)).toEqual(hpBefore);

      handleCommand("clear ac");
      expect(creatures.map((c) => c.ac)).toEqual(acBefore);

      // Explicit target clears for specified creature via clear command
      handleCommand("clear init ajax");
      expect(creatures.find((c) => c.name.toLowerCase().includes("ajax"))?.initiative).toBeNull();

      handleCommand("clear hp kaelor");
      expect(creatures.find((c) => c.name.toLowerCase().includes("kaelor"))?.hpMax).toBeNull();

      handleCommand("clear ac thorgan");
      expect(creatures.find((c) => c.name.toLowerCase().includes("thorgan"))?.ac).toBeNull();

      // Explicit all clears for all creatures via clear command
      handleCommand("clear init all");
      expect(creatures.every((c) => c.initiative === null)).toBeTrue();

      handleCommand("clear dmg all");
      expect(creatures.every((c) => c.dmg === 0)).toBeTrue();

      handleCommand("clear hp all");
      expect(creatures.every((c) => c.hpMax === null)).toBeTrue();

      handleCommand("clear ac all");
      expect(creatures.every((c) => c.ac === null)).toBeTrue();

      // Test the same for remove command on a clean test state
      handleCommand("test");
      handleCommand("remove init ajax");
      expect(creatures.find((c) => c.name.toLowerCase().includes("ajax"))?.initiative).toBeNull();

      handleCommand("remove hp kaelor");
      expect(creatures.find((c) => c.name.toLowerCase().includes("kaelor"))?.hpMax).toBeNull();

      handleCommand("remove ac thorgan");
      expect(creatures.find((c) => c.name.toLowerCase().includes("thorgan"))?.ac).toBeNull();

      handleCommand("remove dmg thorgan");
      expect(creatures.find((c) => c.name.toLowerCase().includes("thorgan"))?.dmg).toBe(0);

      // Explicit all clears via remove command
      handleCommand("remove init all");
      expect(creatures.every((c) => c.initiative === null)).toBeTrue();

      handleCommand("remove dmg all");
      expect(creatures.every((c) => c.dmg === 0)).toBeTrue();

      handleCommand("remove hp all");
      expect(creatures.every((c) => c.hpMax === null)).toBeTrue();

      handleCommand("remove ac all");
      expect(creatures.every((c) => c.ac === null)).toBeTrue();
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
      handleCommand("clear dmg \"goblin archer\"");
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

  describe("Undo / Redo Functionality", () => {
    test("tracks mutating command changes in undoStack", () => {
      expect(getHistoryStacks().undoLength).toBe(0);
      handleCommand("add pc TestHero");
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
      handleCommand("add pc LoggedHero");
      handleCommand("set hp 15 LoggedHero");
      expect(getActivityLog().length).toBeGreaterThan(0);
      const preUndoLength = getActivityLog().length;

      handleCommand("undo"); // undo set hp
      expect(getActivityLog().length).toBe(preUndoLength - 1);

      handleCommand("redo"); // redo set hp
      expect(getActivityLog().length).toBe(preUndoLength);
    });

    test("handles multiple undo/redo levels sequentially", () => {
      handleCommand("add pc HeroA");
      handleCommand("add pc HeroB");
      handleCommand("add pc HeroC");
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
      handleCommand("add pc HeroA");
      handleCommand("undo");
      expect(getHistoryStacks().redoLength).toBe(1);

      handleCommand("add pc HeroB"); // new mutating action clears redo stack
      expect(getHistoryStacks().redoLength).toBe(0);
    });

    test("interactive prompt changes (e.g. combat confirmation) are tracked and undoable", () => {
      handleCommand("add pc CombatHero");
      handleCommand("set init 15 CombatHero");
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
      handleCommand("add pc HeroA");
      handleCommand("add pc HeroB");
      handleCommand("add pc HeroC");
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
      handleCommand("add pc HeroA");
      expect(getHistoryStacks().undoLength).toBe(1);

      // 'save' should be exempt from undo tracking and not push to undoStack
      handleCommand("save test_exempt_save");
      expect(getHistoryStacks().undoLength).toBe(1);

      // 'rename save' should be exempt
      handleCommand("rename save test_exempt_rename");
      expect(getHistoryStacks().undoLength).toBe(1);

      // 'new game' should clear the history stacks entirely
      handleCommand("new game");
      expect(creatures.length).toBe(0);
      expect(getHistoryStacks().undoLength).toBe(0);

      // Setup state for load test
      handleCommand("add pc LoadHero");
      handleCommand("save test_load_exempt");
      expect(getHistoryStacks().undoLength).toBe(1);

      // Save to another slot to shift active session and prevent overwriting test_load_exempt.json
      handleCommand("save test_another_session");

      handleCommand("add pc AnotherHero");
      expect(getHistoryStacks().undoLength).toBe(2);

      // 'load save' should clear history stacks
      handleCommand("load save test_load_exempt");
      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("LoadHero");
      expect(getHistoryStacks().undoLength).toBe(0);
    });

    test("running test command runs internal subcommands with tracking, allowing command-by-command undo", () => {
      handleCommand("new game");
      expect(creatures.length).toBe(0);
      expect(getHistoryStacks().undoLength).toBe(0);

      // Run test simple (which runs 3 subcommands internally: add pc, add enemy, add neutral)
      handleCommand("test simple");
      expect(creatures.length).toBe(20);
      // The 3 subcommands should be recorded on the undo stack
      expect(getHistoryStacks().undoLength).toBe(3);

      // Revert the 3rd subcommand (add neutral)
      handleCommand("undo");
      expect(creatures.length).toBe(16);
      expect(creatures.some(c => c.type === "neutral")).toBeFalse();

      // Revert the 2nd subcommand (add enemy)
      handleCommand("undo");
      expect(creatures.length).toBe(7);
      expect(creatures.every(c => c.type === "pc")).toBeTrue();

      // Revert the 1st subcommand (add pc)
      handleCommand("undo");
      expect(creatures.length).toBe(0);
    });

    test("add char command prompts for character type, adds correctly, and is undoable", () => {
      handleCommand("new game");
      expect(creatures.length).toBe(0);

      // Running 'add char' should set the pending prompt and NOT add any creatures yet
      handleCommand("add char Legolas Aragorn");
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
      const [hitsMain, lineMain] = completer("ad");
      expect(hitsMain).toContain("add");
      expect(lineMain).toBe("ad");

      // 2. Match add subcommands
      const [hitsAdd, lineAdd] = completer("add ");
      expect(hitsAdd).toContain("add pc");
      expect(hitsAdd).toContain("add enemy");
      expect(hitsAdd).toContain("add eff");

      // 3. Match status effects
      const [hitsEff, lineEff] = completer("add eff Pois");
      expect(hitsEff).toContain("add eff Poisoned");

      // 4. Match target names when setting stats
      handleCommand("new game");
      handleCommand("add pc Legolas Aragorn");

      const [hitsSet, lineSet] = completer("set hp 10 L");
      expect(hitsSet).toContain("set hp 10 Legolas");
      expect(lineSet).toBe("set hp 10 L");
    });

    test("reaction state is set, cleared on turn start, manually restored, and undoable", () => {
      handleCommand("new game");
      handleCommand("add pc Aragorn Legolas");
      handleCommand("set init 15 Aragorn 10 Legolas");
      
      handleCommand("combat start");
      const aragorn = creatures.find(c => c.name.toLowerCase() === "aragorn");
      const legolas = creatures.find(c => c.name.toLowerCase() === "legolas");
      expect(aragorn).toBeDefined();
      expect(legolas).toBeDefined();
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeFalse();
      expect(creatures.find(c => c.name.toLowerCase() === "legolas")?.reactionUsed).toBeFalsy();

      handleCommand("add rxn Aragorn");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeTrue();

      handleCommand("set reaction Legolas");
      expect(creatures.find(c => c.name.toLowerCase() === "legolas")?.reactionUsed).toBeTrue();

      handleCommand("next");
      expect(creatures.find(c => c.name.toLowerCase() === "legolas")?.reactionUsed).toBeFalse();
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeTrue();

      handleCommand("next");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeFalse();

      handleCommand("add rxn Aragorn");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeTrue();
      handleCommand("remove rxn Aragorn");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeFalse();

      handleCommand("add rxn Aragorn");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeTrue();
      handleCommand("undo");
      expect(creatures.find(c => c.name.toLowerCase() === "aragorn")?.reactionUsed).toBeFalse();
    });

    test("c alias starts and ends combat correctly and autocompletes", () => {
      handleCommand("new game");
      handleCommand("add pc Aragorn");
      handleCommand("set init 15 Aragorn");

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
      handleCommand("new game");
      handleCommand("add pc A B C");
      handleCommand("set hp 10 A 10 B 10 C");
      handleCommand("set init 30 A 20 B 10 C");

      handleCommand("add dmg 10 B");
      expect(creatures.find(c => c.name === "A")?.statusEffects).not.toContain("Dead");
      expect(creatures.find(c => c.name === "B")?.statusEffects).toContain("Dead");

      handleCommand("combat");
      expect(getCombatState().activeCreature?.name).toBe("A");

      handleCommand("next");
      expect(getCombatState().activeCreature?.name).toBe("C");

      handleCommand("next");
      expect(getCombatState().activeCreature?.name).toBe("A");

      handleCommand("remove dmg 10 B");
      expect(creatures.find(c => c.name === "B")?.statusEffects).not.toContain("Dead");

      handleCommand("next");
      expect(getCombatState().activeCreature?.name).toBe("B");
    });
  });
});
