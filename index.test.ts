import { describe, expect, test, beforeEach } from "bun:test";
import {
  handleCommand,
  creatures,
  getSortedCreatures,
  resetState,
  getCombatState,
  processConfirmation,
} from "./index";

describe("D&D CLI Tracker Test Suite", () => {
  beforeEach(() => {
    resetState();
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
      handleCommand("save slot_test");

      handleCommand("new");
      expect(creatures.length).toBe(0);

      handleCommand("load slot_test");
      expect(creatures.length).toBe(2);
      expect(creatures.find((c) => c.name === "Hero1")?.hpMax).toBe(40);
    });

    test("auto-saves on mutating commands", () => {
      handleCommand("new");
      handleCommand("add pc AutoSavedHero");

      // Reset in-memory creatures without overwriting current.json
      resetState();
      expect(creatures.length).toBe(0);

      // Loading default 'current' save should restore AutoSavedHero
      handleCommand("load current");
      expect(creatures.some((c) => c.name === "AutoSavedHero")).toBeTrue();
    });

    test("deletes a saved game file", () => {
      handleCommand("save file_to_delete");
      expect(handleCommand("load file_to_delete")).toBeTrue();

      handleCommand("delete save file_to_delete");
      handleCommand("load file_to_delete");
      expect(creatures.some((c) => c.name === "AutoSavedHero")).toBeFalse();
    });
  });
});
