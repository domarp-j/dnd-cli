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

Start the interactive CLI directly with the `dnd` alias:

```bash
# Start tracker (automatically loads your last saved session by default):
dnd

# Start a fresh, unsaved game session:
dnd --new
# or
dnd -n

# Load a specific session by name directly:
dnd <session_name>

# View CLI options:
dnd --help
```

Alternatively, run via Bun:

```bash
bun run start
# or
bun run dnd
```

## Usage & Capabilities

Once launched, `dnd-cli` presents an interactive terminal interface. Commands follow the unified `<field|entity> <command> <value> <target>...` convention (e.g. `save delete`, `hp set 40 Ajax`, `dmg add 10 Ajax`). You can access the full command reference menu inside the app at any time by typing `help` (or `h`), or search and highlight specific commands using `help <query>` (or `h <query>`).

Press `Tab` at any time to activate **interactive typeahead**: it searches all commands that contain your current string anywhere in their body, highlights the matching characters within the options, and lets you use the `↑` / `↓` arrow keys to select a command.

Here is a sampling of useful commands to demonstrate the CLI's capabilities:

### Creature & Stat Management
- **Add PCs, enemies, and neutral creatures:**
  ```text
  char add pc Ajax Kaelor
  char add enemy "Goblin Warrior" Bugbear
  char add neutral Merchant
  char add MysteriousTraveler      # Prompts interactively for creature type
  # Or type-first shorthand:
  pc add Ajax Kaelor
  enemy add "Goblin Warrior" Bugbear
  ```
- **Set HP, AC, and Initiative (supports multiple targets or alternating pairs):**
  ```text
  hp set 45 Ajax Kaelor            # Sets HP to 45 for both Ajax and Kaelor
  ac set 18 Ajax Kaelor            # Sets AC to 18 for both Ajax and Kaelor
  init set 14 Ajax Kaelor          # Sets init to 14 for both Ajax and Kaelor
  hp set 45 Ajax 38 Kaelor         # Alternating pairs syntax
  ```
- **Change creature type (supports multiple targets or type shorthands `pc`, `enemy`, `neutral`):**
  ```text
  type set enemy Ajax Kaelor
  type set pc Legolas Gimli
  type set neutral "Goblin Warrior"
  ```
- **Clear stats (supports specific targets or `all`):**
  ```text
  hp clear Ajax Kaelor
  ac clear all
  init clear all
  ```
- **Swap initiative order:**
  ```text
  init swap Ajax Kaelor            # Swap initiative order between Ajax and Kaelor
  ```
- **Rename an existing creature:**
  ```text
  char rename Ajax "Ajax the Great"
  ```
- **Remove creatures (individually by name with multiple targets, or bulk by type):**
  ```text
  char remove Ajax Kaelor
  enemy remove                     # Bulk remove all enemies
  pc remove                        # Bulk remove all PCs
  neutral remove                   # Bulk remove all neutrals
  ```

### Damage, Status Conditions & Resource Usage
- **Apply damage, heal, or clear damage (supports multiple targets):**
  ```text
  dmg add 12 Ajax Kaelor           # Deal 12 damage to Ajax and Kaelor
  dmg add max Ajax                 # Set dmg to equal HP max (Dead)
  kill Ajax Kaelor                 # Alias for dmg add max (instantly kill target(s))
  dmg remove 6 Ajax Kaelor         # Heal / subtract 6 damage
  dmg clear all                    # Clear all damage taken
  ```
- **Track status conditions (supports multiple targets as the last args, with aliases `eff` / `cond` / `stat` / `status`):**
  ```text
  eff add Poisoned Ajax Kaelor
  eff add Blinded Ajax
  eff remove Poisoned Ajax Kaelor
  eff remove Blinded Ajax
  ```
  *(Standard D&D 5.5e conditions, statuses, defenses, and advantage/disadvantage modifiers are defined in `statusEffects.ts`)*
- **Track resource usages (supports `res`, multiple targets, and partial matching):**
  ```text
  res add legaction Joe Bob        # Adds legaction=1 for Joe and Bob
  res use legaction Joe            # Increments legaction to 2 (via partial match)
  res remove legaction Joe         # Decrements legaction back to 1 (removes completely when 0)
  res clear Joe                    # Clears all resource usages for Joe
  ```

### Combat Mode
- **Activate combat mode (automatically sorts by descending initiative):**
  ```text
  combat                           # Start combat mode (alias 'c' or 'combat start')
  combat end                       # End combat mode (clears all damage & initiative)
  ```
- **Navigate turns and skip ahead or back:**
  ```text
  turn next                        # Advance 1 turn
  turn next 3                      # Advance 3 turns
  turn prev                        # Go back 1 turn
  turn prev 2                      # Go back 2 turns
  ```
- **Track reaction usage (automatically resets when the creature's turn starts):**
  ```text
  rxn set Aragorn                  # Mark Aragorn's reaction as used (shows "✓" in "Rxn" column)
  rxn remove Aragorn               # Restore Aragorn's reaction manually (removes checkmark)
  ```
- **Swap initiative order during combat (supports ties with automatic decimal tie-breaking and undo):**
  ```text
  init swap Aragorn Legolas        # Swaps initiative order (aliases 'combat swap' or 'swap')
  combat swap Aragorn Legolas      # Combat-specific alias for swapping initiative order
  ```

### Game State Persistence
- **Save/load state snapshots, list saves, and rename sessions:**
  ```text
  save list                        # View all saved game files with paths
  save dungeon_room1               # Save session snapshot
  save load dungeon_room1          # Load specific save (or interactive list)
  save rename dungeon_room2        # Rename current game session
  save delete dungeon_room1        # Delete save file(s)
  game new                         # Reset to a fresh unsaved game
  ```
  *(Note: When launched, the tracker automatically loads your most recently saved session by default.)*

### Utilities & History
- **Activity log:**
  ```text
  activity show                    # Show all actions logged in this session
  ```
- **Undo and Redo History (supports optional count arguments):**
  ```text
  undo                             # Undo the last action (alias 'u')
  undo 3                           # Undo the last 3 actions
  redo                             # Redo the last undone action (alias 'r')
  redo 2                           # Redo the last 2 undone actions
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
