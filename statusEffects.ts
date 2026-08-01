// D&D 5.5e (2024) Conditions, Statuses, Defenses, and Modifiers

export const STANDARD_CONDITIONS = [
  "Blinded",
  "Charmed",
  "Deafened",
  "Exhausted",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
] as const;

export const COMBAT_STATUSES = [
  "Banishment",
  "Blessed",
  "Bloodied",
  "Bane",
  "Burrowing",
  "Concentrated",
  "Cover (Half)",
  "Cover (Three-Quarters)",
  "Cover (Total)",
  "Curse",
  "Dodging",
  "Faerie Fire",
  "Flying",
  "Hasted",
  "Hexed",
  "Hidden",
  "Hovering",
  "Hunter's Mark",
  "Raging",
  "Slowed",
  "Staggered",
  "Surprised",
  "Taunted",
  "Ward",
] as const;

export const DAMAGE_TYPES = [
  "Acid",
  "Bludgeoning",
  "Cold",
  "Fire",
  "Force",
  "Lightning",
  "Necrotic",
  "Piercing",
  "Poison",
  "Psychic",
  "Radiant",
  "Slashing",
  "Thunder",
] as const;

export const RESISTANCES = DAMAGE_TYPES.map((type) => `Resistant (${type})`);
export const IMMUNITIES = DAMAGE_TYPES.map((type) => `Immune (${type})`);
export const VULNERABILITIES = DAMAGE_TYPES.map((type) => `Vulnerable (${type})`);

export const DEFENSES = [
  ...RESISTANCES,
  ...IMMUNITIES,
  ...VULNERABILITIES,
  "Resistant (nonmagical bludgeoning, piercing, slashing)",
  "Immune (nonmagical bludgeoning, piercing, slashing)",
] as const;

export const ADVANTAGE_EFFECTS = [
  "Advantage on attack rolls",
  "Advantage on melee attack rolls",
  "Advantage on ranged attack rolls",
  "Advantage on saving throws",
  "Advantage on Strength saving throws",
  "Advantage on Dexterity saving throws",
  "Advantage on Constitution saving throws",
  "Advantage on Intelligence saving throws",
  "Advantage on Wisdom saving throws",
  "Advantage on Charisma saving throws",
  "Advantage on Death saving throws",
  "Advantage on Concentration checks",
  "Advantage on ability checks",
  "Advantage on Perception checks",
  "Advantage on Stealth checks",
  "Advantage on Athletics checks",
  "Advantage on Acrobatics checks",
  "Advantage on Insight checks",
  "Advantage on Investigation checks",
  "Advantage on Initiative checks",
  "Attacks against have advantage",
] as const;

export const DISADVANTAGE_EFFECTS = [
  "Disadvantage on attack rolls",
  "Disadvantage on melee attack rolls",
  "Disadvantage on ranged attack rolls",
  "Disadvantage on saving throws",
  "Disadvantage on Strength saving throws",
  "Disadvantage on Dexterity saving throws",
  "Disadvantage on Constitution saving throws",
  "Disadvantage on Intelligence saving throws",
  "Disadvantage on Wisdom saving throws",
  "Disadvantage on Charisma saving throws",
  "Disadvantage on Death saving throws",
  "Disadvantage on Concentration checks",
  "Disadvantage on ability checks",
  "Disadvantage on Perception checks",
  "Disadvantage on Stealth checks",
  "Disadvantage on Athletics checks",
  "Disadvantage on Acrobatics checks",
  "Disadvantage on Insight checks",
  "Disadvantage on Investigation checks",
  "Disadvantage on Initiative checks",
  "Attacks against have disadvantage",
] as const;

export const ALL_STATUS_EFFECTS: string[] = [
  ...STANDARD_CONDITIONS,
  ...COMBAT_STATUSES,
  ...DEFENSES,
  ...ADVANTAGE_EFFECTS,
  ...DISADVANTAGE_EFFECTS,
];

export function findMatchingStatusEffects(query: string): string[] {
  const lower = query.toLowerCase();
  return ALL_STATUS_EFFECTS.filter((c) => c.toLowerCase().includes(lower));
}
