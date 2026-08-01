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
clear init [target1 target2 ...]       # Clear initiative for targets (or all)
```

*Example:*
```text
set hp 45 Ajax
set ac 18 Ajax
set init 14 Ajax
clear init Ajax                         # Clear initiative for Ajax
clear init all                          # Clear initiative for all creatures
```

### Damage & Conditions

Track accumulated damage and ongoing status conditions:

```text
add dmg <value> <target1> <target2> ...   # Increase damage taken
add cond <condition> <target1> ...       # Apply condition (e.g., Poisoned, Stunned)
remove cond <condition> <target1> ...    # Remove condition from targets
```

*Example:*
```text
add dmg 5 "Goblin Warrior"
add cond Poisoned Kaelor
remove cond Poisoned Kaelor
```

### Combat Mode

Start interactive turn tracking sorted by initiative:

```text
combat [start]    # Activate Combat Mode
end combat        # Exit Combat Mode
```

- **Initiative Sorting**: In Combat Mode, the table is automatically sorted by initiative score in descending order (highest first). Creatures without initiative are placed at the bottom.
- **Active Turn Highlighting**: The creature whose turn it currently is highlighted with a `▶` pointer and colored row.
- **Round Tracking**: Tracks the current combat round, automatically incrementing when advancing past the last creature in initiative order.
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

Remove creatures from the tracker:

```text
remove char <target1> <target2> ...
```

### Testing Data

Quickly seed the encounter state with test creatures:

```text
test          # Load full test encounter (with stats & conditions)
test simple   # Load simple test encounter (names only)
```

### General Commands

- `combat` — Start combat mode.
- `end combat` — End combat mode.
- `next` / `n [count]` — Move forward 1 or `[count]` turns (e.g., `n 3`).
- `prev` / `p [count]` — Move backward 1 or `[count]` turns (e.g., `p 2`).
- `help` — Show command reference menu.
- `quit` or `exit` — Exit the application.
