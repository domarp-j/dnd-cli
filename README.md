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

## Usage Instructions

Once launched, `dnd-cli` presents an interactive terminal interface where you can manage player characters (PCs), enemies, and neutral creatures.

### Adding Creatures

You can add one or multiple creatures at once:

```text
add pc <name1> <name2> ...       # Add Player Character(s) (shorthand: add p)
add enemy <name1> <name2> ...    # Add Enemy creature(s) (shorthand: add e)
add neutral <name1> <name2> ...  # Add Neutral creature(s) (shorthand: add n)
```

*Example:*
```text
add pc Ajax Kaelor               # Or: add p Ajax Kaelor
add enemy "Goblin Warrior" Bugbear # Or: add e "Goblin Warrior" Bugbear
remove pcs / enemies / neutrals  # Or: remove p / e / n
```

### Setting Stats

Set maximum HP, Armor Class (AC), or Initiative values for targets:

```text
set hp <value> <target1> <target2> ...
set ac <value> <target1> <target2> ...
set init <value> <target1> <target2> ...
set ac bulk <target1> <val1> <target2> <val2> ...    # Bulk set AC pairs
set init bulk <target1> <val1> <target2> <val2> ...  # Bulk set initiative pairs
clear init <all | target1 target2 ...>              # Clear initiative for targets (or all)
```

*Example:*
```text
set hp 45 Ajax
set ac 18 Ajax
set init 14 Ajax
set ac bulk aj 18 drago 15                          # Bulk set AC for Ajax & Dragon
set init bulk aj 14 kae 18 drago 10                 # Bulk set initiative for multiple creatures
clear init Ajax                                     # Clear initiative for Ajax
clear init all                                      # Explicitly clear initiative for all creatures
```

### Damage & Conditions

Track accumulated damage and ongoing status conditions:

```text
add dmg <value> <target1> <target2> ...   # Increase damage taken
clear dmg <all | target1 target2 ...>    # Clear damage for targets (or all)
add cond <condition> <target1> ...       # Apply condition (e.g., Poisoned, Stunned)
remove cond <condition> <target1> ...    # Remove condition from targets
```

*Example:*
```text
add dmg 5 "Goblin Warrior"
clear dmg "Goblin Warrior"                # Reset damage for Goblin Warrior to 0
clear dmg all                             # Reset damage for all creatures to 0
add cond Poisoned Kaelor
remove cond Poisoned Kaelor
```

### Combat Mode

Start interactive turn tracking sorted by initiative:

```text
combat [start]    # Activate Combat Mode
combat end        # Exit Combat Mode
```

- **Initiative Sorting**: In Combat Mode, the table is automatically sorted by initiative score in descending order (highest first). Creatures without initiative are placed at the bottom.
- **Active Turn Highlighting**: The creature whose turn it currently is highlighted with a `▶` pointer and colored row.
- **Round Tracking**: Tracks the current combat round, automatically incrementing when advancing past the last creature in initiative order.
- **Ending Combat**: Running `combat end` prompts for confirmation (`(y/n)`). Upon confirmation (`y`), combat ends, table sorting reverts to alphabetical, and initiative and damage are automatically cleared for all creatures.
- **Turn Navigation**:
  - `next` or `n` — Move to the next creature's turn (e.g., `next` or `n`).
  - `next <count>` or `n <count>` — Skip ahead `<count>` turns (e.g., `n 3` to skip ahead 3 turns).
  - `prev` or `p` — Go back to the previous creature's turn (e.g., `prev` or `p`).
  - `prev <count>` or `p <count>` — Go back `<count>` turns (e.g., `p 2` to go back 2 turns).

### Target Selection & Matching

- Names with spaces should be wrapped in quotes (`"Goblin Archer"`).
- Target selection supports partial matching and wildcards (`*`).
  - `add dmg 5 Goblin*` will target all creatures starting with "Goblin".
  - If a partial target match is ambiguous, the CLI will alert you and suggest using a wildcard.

### Removing Creatures

Remove specific creatures or entire groups of creatures by type:

```text
remove <pc|enemy|neutral|char> [target1 ...]   # Remove creatures or bulk by type
```

*Example:*
```text
remove e                                 # Bulk remove all enemies (shorthand for enemy)
remove p                                 # Bulk remove all PCs (shorthand for pc)
remove n                                 # Bulk remove all neutral creatures (shorthand for neutral)
remove char "Goblin Warrior 1"
remove e "Goblin Arch*"                  # Remove specific enemy matching wildcard
```

### Game State Persistence

The CLI automatically persists your game state locally after **every command execution**, so you never lose progress.

```text
new                     # Clear current encounter and start a fresh game
save                    # Save session with interactive name prompt (preset random snake_cased default)
save <name>             # Directly save game state with a specific session name
load                    # Show interactive list of saved games to pick from to load
load <name>             # Directly load a specific saved game snapshot
delete save             # Show interactive list to pick save(s) to delete (e.g. "1 3", "1,2", or "all")
delete save s1 s2 s3    # Delete multiple saved game files at once
saves                   # List all saved game files
```

*Example:*
```text
save                     # Prompts for session name with preset (e.g. "bold_encounter_42", press Enter or edit)
save dungeon_room1       # Save snapshot as "dungeon_room1" directly
load                     # Interactive load selection menu (pick 1, 2, 3... or enter name)
new                      # Start clean session
load dungeon_room1       # Restore saved "dungeon_room1" session directly
delete save 1 3          # Interactively delete save options 1 and 3
delete save room1 room2  # Delete save files "room1" and "room2" directly
saves                    # View all saved sessions with creature counts and paths
```

### Testing & Test Suite

Run the automated Bun test suite:

```bash
bun test
```

Quickly seed the encounter state with test creatures during CLI session:

```text
test          # Load full test encounter (with stats & conditions)
test simple   # Load simple test encounter (names only)
```

### POSIX & Docopt Syntax Rules

The help menu follows standard POSIX & `docopt` CLI conventions:
- `[ ]` — **Optional** element (e.g. `combat [start]`)
- `< >` — **Variable / Argument** placeholder (e.g. `<name>`, `<value>`)
- `( )` — **Required** grouping (e.g. `(next | n)`)
- `|` — **Mutually Exclusive** choice (e.g. `(pc | p)`)
- `...` — **Repeatable** element (1 or more, e.g. `<name>...`)
- `[...]` — **Optional & Repeatable** (0 or more, e.g. `[<name>...]`)

### General Commands

- `combat [start]` — Start combat mode.
- `combat end` — End combat mode.
- `(next | n) [<count>]` — Move forward 1 or `<count>` turns (e.g., `n 3`).
- `(prev | p) [<count>]` — Move backward 1 or `<count>` turns (e.g., `p 2`).
- `new` — Start a new game session.
- `save [<name>]` / `load [<name>]` — Save or load game state snapshots.
- `delete save [<name>...]` — Delete save file(s) or select interactively.
- `saves` — List all local saved game files with paths.
- `remove (pcs | enemies | neutrals)` — Bulk remove creatures by type (or `p` | `e` | `n`).
- `(help | h)` — Show POSIX / docopt command reference menu.
- `(quit | q | exit)` — Exit the application.
