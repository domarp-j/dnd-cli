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
add pc <name1> <name2> ...       # Add Player Character(s)
add enemy <name1> <name2> ...    # Add Enemy creature(s)
add neutral <name1> <name2> ...  # Add Neutral creature(s)
```

*Example:*
```text
add pc Ajax Kaelor
add enemy "Goblin Warrior" "Goblin Archer" Bugbear
```

### Setting Stats

Set maximum HP, Armor Class (AC), or Initiative values for targets:

```text
set hp <value> <target1> <target2> ...
set ac <value> <target1> <target2> ...
set init <value> <target1> <target2> ...
clear init <all | target1 target2 ...>    # Clear initiative for targets (or all)
```

*Example:*
```text
set hp 45 Ajax
set ac 18 Ajax
set init 14 Ajax
clear init Ajax                         # Clear initiative for Ajax
clear init all                          # Explicitly clear initiative for all creatures
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

### Testing Data

Quickly seed the encounter state with test creatures:

```text
test          # Load full test encounter (with stats & conditions)
test simple   # Load simple test encounter (names only)
```

### General Commands

- `combat` — Start combat mode.
- `combat end` — End combat mode.
- `next` / `n [count]` — Move forward 1 or `[count]` turns (e.g., `n 3`).
- `prev` / `p [count]` — Move backward 1 or `[count]` turns (e.g., `p 2`).
- `remove enemies` / `pcs` / `neutrals` — Bulk remove creatures by type.
- `help` — Show command reference menu.
- `quit` or `exit` — Exit the application.
