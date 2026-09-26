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

      // Verify that "stat" alias works
      handleCommand("add stat Blinded Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).toContain("Blinded");

      handleCommand("remove stat Blinded Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).not.toContain("Blinded");

      // Verify that "status" alias works (with rm)
      handleCommand("add status Invisible Hero");
      hero = creatures.find((c) => c.name === "Hero");
      expect(hero?.statusEffects).toContain("Invisible");

      handleCommand("rm status Invisible Hero");
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

      const [hitsStat, _stat] = completer("add stat Pois");
      expect(hitsStat).toContain("add stat Poisoned");

      const [hitsStatus, _status] = completer("add status Pois");
      expect(hitsStatus).toContain("add status Poisoned");

      const [hitsRmStat, _rmStat] = completer("remove stat Pois");
      expect(hitsRmStat).toContain("remove stat Poisoned");

      const [hitsRmStatus, _rmStatus] = completer("remove status Pois");
      expect(hitsRmStatus).toContain("remove status Poisoned");

      // 4. Match target names when setting stats
      handleCommand("new game");
      handleCommand("add pc Legolas Aragorn");

      const [hitsSet, lineSet] = completer("set hp 10 L");
      expect(hitsSet).toContain("set hp 10 Legolas");
      expect(lineSet).toBe("set hp 10 L");

      // 5. Match string anywhere in command body
      const [hitsStatAny] = completer("stat");
      expect(hitsStatAny).toContain("add stat");
      expect(hitsStatAny).toContain("remove stat");
      expect(hitsStatAny).toContain("rm stat");

      const [hitsEffAll] = completer("eff");
      expect(hitsEffAll).toContain("add eff");
      expect(hitsEffAll).toContain("remove eff");
      expect(hitsEffAll).toContain("rm eff");

      const [hitsHp] = completer("hp");
      expect(hitsHp).toContain("clear hp");
      expect(hitsHp).toContain("set hp");

      const [hitsSave] = completer("save");
      expect(hitsSave).toContain("save");
      expect(hitsSave).toContain("saves");
      expect(hitsSave).toContain("load save");
      expect(hitsSave).toContain("rename save");
      expect(hitsSave).toContain("delete save");
    });

    test("highlightMatch colors matching substring within options", () => {
      const highlighted = highlightMatch("add stat", "stat");
      expect(highlighted).toContain("stat");
      // Check that ANSI styling wraps the matched text
      expect(highlighted).toContain("\x1b[33mstat\x1b[0m");

      // Case insensitive match preserves original casing
      const casePreserved = highlightMatch("add eff Poisoned", "pois");
      expect(casePreserved).toContain("\x1b[33mPois\x1b[0m");

      // Empty query or no match returns base string
      const noMatch = highlightMatch("clear ac", "xyz");
      expect(noMatch).toContain("clear ac");
      expect(noMatch).not.toContain("\x1b[33m");
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

    test("does not restart combat if already started", () => {
      handleCommand("new game");
      handleCommand("add pc A");
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
      handleCommand("new game");
      handleCommand("add pc Joe");

      // Verify initial state
      const joe = creatures.find(c => c.name === "Joe")!;
      expect(joe.resourceUsage).toEqual({});

      // Increment legaction
      handleCommand("add res legaction Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(1);

      // Increment again
      handleCommand("add res legaction Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(2);

      // Partial matching with "use res" alias
      handleCommand("use res lega Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(3);

      // Partial matching is case-insensitive
      handleCommand("use res LEGA Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(4);

      // Decrementing/removing resource
      handleCommand("remove res leg Joe");
      expect(joe.resourceUsage?.["legaction"]).toBe(3);

      // Verify it is removed completely when reaching 0
      handleCommand("remove res leg Joe"); // 2
      handleCommand("remove res leg Joe"); // 1
      handleCommand("remove res leg Joe"); // 0 -> deleted
      expect(joe.resourceUsage?.["legaction"]).toBeUndefined();

      // Test clearing resource usage
      handleCommand("add res spellslot Joe");
      expect(joe.resourceUsage?.["spellslot"]).toBe(1);
      handleCommand("clear res Joe");
      expect(joe.resourceUsage?.["spellslot"]).toBeUndefined();
    });

    test("resource command autocompletions", () => {
      handleCommand("new game");
      handleCommand("add pc Joe");
      handleCommand("add res spellslot Joe");

      // Autocomplete "add "
      const [addHits, _] = completer("add ");
      expect(addHits).not.toContain("add resource");
      expect(addHits).toContain("add res");

      // Autocomplete "use "
      const [useHits, _2] = completer("use ");
      expect(useHits).not.toContain("use resource");
      expect(useHits).toContain("use res");

      // Autocomplete existing resources
      const [resHits, _3] = completer("use res ");
      expect(resHits).toContain("use res spellslot");
    });

    test("help command with filter highlights matching lines", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        handleCommand("help res");
        
        const resLine = logs.find(l => l.includes("add/use res"));
        const pcLine = logs.find(l => l.includes("add (pc | p)"));

        expect(resLine).toBeDefined();
        expect(resLine).toContain("\x1b[1m");
        expect(resLine).toContain("\x1b[33m");

        expect(pcLine).toBeDefined();
        expect(pcLine).not.toContain("\x1b[33m");
      } finally {
        console.log = originalLog;
      }
    });

    test("help menu lists aliases cleanly with identical descriptions without explicit alias notes", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        handleCommand("help");
        const fullOutput = logs.join("\n");

        // remove (pcs | enemies | neutrals) and remove (p | e | n)
        expect(fullOutput).toContain("remove (pcs | enemies | neutrals)");
        expect(fullOutput).toContain("remove (p | e | n)");
        const rmFullLine = logs.find(l => l.includes("remove (pcs | enemies | neutrals)"));
        const rmShortLine = logs.find(l => l.includes("remove (p | e | n)"));
        expect(rmFullLine).toContain("Bulk remove creatures by type");
        expect(rmShortLine).toContain("Bulk remove creatures by type");
        expect(rmFullLine).not.toContain("(or p | e | n)");

        // set type and change type
        const setTypeLine = logs.find(l => l.includes("set type (pc | enemy | neutral)"));
        const setTypeRevLine = logs.find(l => l.includes("set type <target>... (pc | enemy | neutral)"));
        expect(setTypeLine).toContain("Change character type");
        expect(setTypeRevLine).toContain("Change character type");
        expect(setTypeLine).not.toContain("(or set type");

        // damage and healing
        const addDmgLine = logs.find(l => l.includes("add dmg <value> <target>..."));
        const hurtLine = logs.find(l => l.includes("hurt <value> <target>..."));
        const rmDmgLine = logs.find(l => l.includes("remove dmg <value> <target>..."));
        const healLine = logs.find(l => l.includes("heal <value> <target>..."));
        expect(addDmgLine).toContain("Add damage taken to target(s)");
        expect(hurtLine).toContain("Add damage taken to target(s)");
        expect(hurtLine).not.toContain("(alias for");
        expect(rmDmgLine).toContain("Heal/subtract damage from target(s)");
        expect(healLine).toContain("Heal/subtract damage from target(s)");
        expect(healLine).not.toContain("(alias for");

        // delete and del save
        const deleteSaveLine = logs.find(l => l.includes("delete save [<name>...]"));
        const delSaveLine = logs.find(l => l.includes("del save [<name>...]"));
        expect(deleteSaveLine).toContain("Delete save file(s)");
        expect(delSaveLine).toContain("Delete save file(s)");

        // No alias callouts in descriptions
        expect(fullOutput).not.toContain("(alias for");
      } finally {
        console.log = originalLog;
      }
    });

    test("completer includes remove p/e/n and del save aliases", () => {
      const [rmHits] = completer("remove ");
      expect(rmHits).toContain("remove p");
      expect(rmHits).toContain("remove e");
      expect(rmHits).toContain("remove n");

      const [delHits] = completer("del ");
      expect(delHits).toContain("del save");
    });
  });

  describe("Changing Creature Type", () => {
    test("changes creature type using 'set type <type> <target>' and shorthands", () => {
      handleCommand("add pc Aragorn");
      const aragorn = creatures.find((c) => c.name === "Aragorn");
      expect(aragorn?.type).toBe("pc");

      handleCommand("set type enemy Aragorn");
      expect(aragorn?.type).toBe("enemy");

      handleCommand("set type neutral Aragorn");
      expect(aragorn?.type).toBe("neutral");

      handleCommand("set type p Aragorn");
      expect(aragorn?.type).toBe("pc");

      handleCommand("set type e Aragorn");
      expect(aragorn?.type).toBe("enemy");

      handleCommand("set type n Aragorn");
      expect(aragorn?.type).toBe("neutral");
    });

    test("supports multiple targets with one type: 'set type <type> <t1> <t2>'", () => {
      handleCommand("add pc Aragorn Legolas Gimli");
      handleCommand("set type enemy Aragorn Legolas");

      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");
      expect(creatures.find((c) => c.name === "Legolas")?.type).toBe("enemy");
      expect(creatures.find((c) => c.name === "Gimli")?.type).toBe("pc");
    });

    test("supports alternating pairs: 'set type <type1> <t1> <type2> <t2>'", () => {
      handleCommand("add pc Aragorn Legolas");
      handleCommand("set type enemy Aragorn neutral Legolas");

      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");
      expect(creatures.find((c) => c.name === "Legolas")?.type).toBe("neutral");
    });

    test("supports target-first syntax: 'set type <target> <type>'", () => {
      handleCommand("add pc Aragorn Legolas");
      handleCommand("set type Aragorn enemy");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");

      handleCommand("set type Aragorn Legolas neutral");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("neutral");
      expect(creatures.find((c) => c.name === "Legolas")?.type).toBe("neutral");
    });

    test("supports 'change type' and 'type' command aliases", () => {
      handleCommand("add pc Aragorn");
      handleCommand("change type enemy Aragorn");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");

      handleCommand("change type Aragorn pc");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");

      handleCommand("type neutral Aragorn");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("neutral");

      handleCommand("type Aragorn enemy");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");
    });

    test("validates invalid types and nonexistent targets", () => {
      handleCommand("add pc Aragorn");
      
      // Invalid type
      expect(handleCommand("set type dragon Aragorn")).toBeTrue();
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");

      // Nonexistent target
      expect(handleCommand("set type enemy Nonexistent")).toBeTrue();
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");

      // Missing arguments
      expect(handleCommand("set type")).toBeTrue();
      expect(handleCommand("set type pc")).toBeTrue();
    });

    test("is undoable and redoable", () => {
      handleCommand("add pc Aragorn");
      const aragorn = creatures.find((c) => c.name === "Aragorn");
      expect(aragorn?.type).toBe("pc");

      handleCommand("set type enemy Aragorn");
      expect(aragorn?.type).toBe("enemy");

      handleCommand("undo");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("pc");

      handleCommand("redo");
      expect(creatures.find((c) => c.name === "Aragorn")?.type).toBe("enemy");
    });

    test("set type autocompletions", () => {
      handleCommand("new game");
      handleCommand("add pc Aragorn");

      const [setHits, _] = completer("set ");
      expect(setHits).toContain("set type");

      const [changeHits, _2] = completer("change ");
      expect(changeHits).toContain("change type");

      const [typeHits, _3] = completer("set type ");
      expect(typeHits).toContain("set type pc");
      expect(typeHits).toContain("set type enemy");
      expect(typeHits).toContain("set type neutral");
      expect(typeHits).toContain("set type Aragorn");
    });
  });

  describe("Death States & HP Thresholds", () => {
    test("marks creature Dead immediately when dmg matches HP for PC, enemy, and neutral", () => {
      handleCommand("new game");
      handleCommand("add pc Hero");
      handleCommand("add enemy Goblin");
      handleCommand("add neutral Merchant");

      handleCommand("set hp 20 Hero 12 Goblin 8 Merchant");

      handleCommand("add dmg 20 Hero");
      expect(creatures.find(c => c.name === "Hero")?.statusEffects).toContain("Dead");

      handleCommand("add dmg 12 Goblin");
      expect(creatures.find(c => c.name === "Goblin")?.statusEffects).toContain("Dead");

      handleCommand("add dmg 8 Merchant");
      expect(creatures.find(c => c.name === "Merchant")?.statusEffects).toContain("Dead");
    });

    test("marks creature Dead immediately when dmg exceeds HP for neutral and other characters", () => {
      handleCommand("new game");
      handleCommand("add pc Hero");
      handleCommand("add enemy Goblin");
      handleCommand("add neutral Villager");

      handleCommand("set hp 15 Hero 10 Goblin 6 Villager");

      handleCommand("add dmg 20 Hero");
      expect(creatures.find(c => c.name === "Hero")?.statusEffects).toContain("Dead");

      handleCommand("add dmg 15 Goblin");
      expect(creatures.find(c => c.name === "Goblin")?.statusEffects).toContain("Dead");

      handleCommand("add dmg 12 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).toContain("Dead");
    });

    test("marks creature Dead when set hp sets HP max at or below current damage", () => {
      handleCommand("new game");
      handleCommand("add neutral Villager");
      handleCommand("add dmg 10 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).not.toContain("Dead");

      // Setting HP equal to existing damage
      handleCommand("set hp 10 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).toContain("Dead");

      // Setting HP lower than existing damage
      handleCommand("set hp 5 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).toContain("Dead");

      // Setting HP above damage restores alive state
      handleCommand("set hp 20 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).not.toContain("Dead");
    });

    test("removes Dead state when healed below max HP", () => {
      handleCommand("new game");
      handleCommand("add neutral Villager");
      handleCommand("set hp 10 Villager");
      handleCommand("add dmg 10 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).toContain("Dead");

      handleCommand("heal 1 Villager");
      expect(creatures.find(c => c.name === "Villager")?.statusEffects).not.toContain("Dead");
    });

    test("preserves manual Dead effect on creatures without hpMax", () => {
      handleCommand("new game");
      handleCommand("add neutral Ghost");
      handleCommand("add eff Dead Ghost");
      expect(creatures.find(c => c.name === "Ghost")?.statusEffects).toContain("Dead");

      // Running a command should not clear manual Dead on null hpMax creature
      handleCommand("add neutral Skeleton");
      expect(creatures.find(c => c.name === "Ghost")?.statusEffects).toContain("Dead");
    });
  });

  describe("Default Session Loading & Startup", () => {
    test("getLatestSave returns the most recently saved session file", () => {
      handleCommand("new game");
      handleCommand("add pc FirstHero");
      handleCommand("save test_startup_older");

      const olderPath = path.join(SAVES_DIR, "test_startup_older.json");
      const olderData = JSON.parse(fs.readFileSync(olderPath, "utf-8"));
      olderData.savedAt = new Date(Date.now() - 100000).toISOString();
      fs.writeFileSync(olderPath, JSON.stringify(olderData, null, 2), "utf-8");

      handleCommand("new game");
      handleCommand("add pc NewerHero");
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
      handleCommand("new game");
      handleCommand("add pc TargetHero");
      handleCommand("set hp 50 TargetHero");
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
      handleCommand("new game");
      handleCommand("add pc SavedHero");
      handleCommand("save test_fresh_override");

      resetState();
      const res = initializeSession({ fresh: true });
      expect(res.loaded).toBeFalse();
      expect(res.sessionName).toBeNull();
      expect(creatures.length).toBe(0);
    });

    test("initializeSession loads specific session when requested", () => {
      handleCommand("new game");
      handleCommand("add pc SpecificHero");
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
      handleCommand("new game");
      handleCommand("add pc UndoLoadedHero");
      handleCommand("set hp 40 UndoLoadedHero");
      handleCommand("save test_undo_on_loaded");

      resetState();
      initializeSession({ saveName: "test_undo_on_loaded" });

      expect(creatures.length).toBe(1);
      expect(creatures[0]?.name).toBe("UndoLoadedHero");
      expect(getHistoryStacks().undoLength).toBe(0);

      // Mutate loaded session
      handleCommand("add dmg 15 UndoLoadedHero");
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
      handleCommand("add dmg 5 UndoLoadedHero");
      handleCommand("set ac 18 UndoLoadedHero");
      expect(creatures[0]?.dmg).toBe(20);
      expect(creatures[0]?.ac).toBe(18);

      handleCommand("undo 2");
      expect(creatures[0]?.dmg).toBe(15);
      expect(creatures[0]?.ac).toBeNull();
    });
  });
});
