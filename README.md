# dnd-cli

A fast, interactive command-line tool for tracking D&D combat state (creatures, HP, AC, initiative, conditions, and damage).

## Prerequisites

- [Bun](https://bun.com) runtime installed.

## Installation

Install dependencies using Bun:

```bash
bun install
```

## Running the Tracker

Start the interactive CLI:

```bash
bun run start
```

## Usage & Capabilities

Once launched, `dnd-cli` presents an interactive terminal interface. You can access the full command reference menu inside the app at any time by typing `help` (or `h`).

Here is a sampling of useful commands to demonstrate the CLI's capabilities:

### Creature & Stat Management
- **Add PCs, enemies, and neutral creatures:**
  ```text
  add pc Ajax Kaelor
  add enemy "Goblin Warrior" Bugbear
  ```
- **Bulk set HP, AC, and Initiative:**
  ```text
  set hp bulk Ajax 45 Kaelor 38
  set ac bulk Ajax 18 Kaelor 15
  set init bulk Ajax 14 Kaelor 18
  ```
- **Clear stats (using `null`, `none`, `clear`, `-`, or `—`):**
  ```text
  set ac null Ajax
  clear init all
  ```

### Damage & Status Conditions
- **Apply damage or clear it:**
  ```text
  add dmg 12 Kaelor
  clear dmg all
  ```
- **Track status conditions (supports aliases `eff` / `effect` / `cond` / `condition`):**
  ```text
  add eff Poisoned Kaelor
  remove cond Poisoned Kaelor
  ```
  *(Standard D&D 5.5e conditions, statuses, defenses, and advantage/disadvantage modifiers are defined in `statusEffects.ts`)*

### Combat Mode
- **Activate combat mode (automatically sorts by descending initiative):**
  ```text
  combat
  ```
- **Navigate turns and skip ahead or back:**
  ```text
  next       # Advance 1 turn
  n 3        # Advance 3 turns
  prev       # Go back 1 turn
  ```
- **End combat (clears all damage & initiative):**
  ```text
  combat end
  ```

### Game State Persistence
- **Save/load state snapshots and rename sessions:**
  ```text
  save dungeon_room1
  rename save dungeon_room2
  load save               # Lists saves interactively
  load save dungeon_room2  # Loads specific save
  saves                   # View all saved game files
  ```

---

## Development & Testing

### Running Tests

Run the automated test suite using Bun:

```bash
bun test
```

### Seeding Test Data

During an active CLI session, you can quickly seed the tracker with test combatants:

```text
test          # Load full test encounter (with stats & conditions)
test simple   # Load simple test encounter (names only)
```
