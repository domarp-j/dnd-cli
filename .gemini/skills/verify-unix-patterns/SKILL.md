---
name: verify-unix-patterns
description: Verifies that all newly added, modified, or refactored CLI commands adhere strictly to standard Unix command patterns, noun-first syntax (<field|entity> <command> <value> <target...>), end-positioned multi-target arguments, and POSIX/docopt conventions across code, help text, prompts, completions, and documentation.
---

# Verify Unix Command Patterns Skill

This skill enforces strict adherence to standard Unix command patterns, noun-first CLI grammar, and POSIX/docopt documentation conventions across `dnd-cli`. Whenever commands are added, modified, or refactored, this skill ensures the CLI remains consistent, intuitive, and compliant with established design patterns.

## Trigger Conditions

Activate and execute this skill whenever:
- A new CLI command, subcommand, option, or argument is added to `index.ts`.
- An existing command signature, argument order, or parser is modified or refactored.
- Help text, menus, or usage guides (`HELP_DATA`, CLI `--help`, or table footers) are updated.
- Error messages, usage hints, or confirmation prompts are added or changed.
- Autocomplete templates (`ALL_COMMAND_TEMPLATES`) or completion handlers (`completer`) are modified.
- Documentation in `README.md` is updated.
- Unit tests in `index.test.ts` are created or updated for command syntax.

---

## Core Unix Conventions & Architectural Rules

Every command in `dnd-cli` must adhere to the following rules:

### 1. Noun-First Command Syntax (`<field|entity> <command> [value] [target...]`)
All commands must start with the target noun (field or entity), followed by the action/verb subcommand, followed by values/parameters, and ending with target(s).

- **Entity Management**:
  - `char add (pc | enemy | neutral) <name>...`
  - `char remove <target>...`
  - `char rename <target> <new_name>`
  - `(pc | enemy | neutral) add <name>...`
  - `(pc | enemy | neutral) remove`
  - `type set (pc | enemy | neutral) <target>...`
- **Game & Save Management**:
  - `save list`
  - `save delete <target>...`
  - `save load <name>`
  - `save rename <old> <new>`
  - `game new [name]`
  - `game load <name>`
  - `game save [name]`
  - `game list`
  - `game delete <name>...`
- **Combat & Turn Management**:
  - `combat (start | end | reset)`
  - `turn (next | prev | set <index>)`
- **Stat & Condition Management**:
  - `hp set <value> <target>...`, `hp add <value> <target>...`, `hp sub <value> <target>...`
  - `dmg add <value> <target>...`, `dmg sub <value> <target>...`
  - `ac set <value> <target>...`
  - `init set <value> <target>...`, `init roll [target...]`, `init clear`
  - `rxn set (yes | no) <target>...`
  - `res add <resource> [count] <target>...`, `res sub <resource> [count] <target>...`, `res clear [resource] <target>...`
  - `status add <effect> <target>...`, `status remove <effect> <target>...`, `status clear <target>...`

#### Permitted Exceptions (No Field/Entity):
Only commands with **no entity or field to reference** are allowed without a noun prefix:
- `quit` / `q`
- `help` / `h`
- `undo` / `u` [count]
- `redo` / `r` [count]
- `test`

#### Strict Prohibition of Legacy Verb-First Commands:
Legacy verb-first commands (such as `add pc`, `set hp`, `remove char`, `clear init`, `list saves`, `delete save`, etc.) are **strictly disallowed**. If entered, they must be rejected as unknown commands and must never execute or be suggested in autocompletions.

---

### 2. Targets Positioned as the Last Argument(s)
Following the standard Unix utility pattern (e.g. `chmod <mode> <file...>`, `chown <owner> <file...>`, `kill -9 <pid...>`):
- **All target arguments must be placed at the very end of the command invocation.**
- Syntax must be `<field|entity> <command> <value> <target...>` (e.g. `hp set 25 HeroA`, `type set enemy Goblin1`).
- Target-first patterns (such as `type set Goblin1 enemy` or `hp set Goblin1 25`) must not be permitted.

---

### 3. Universal Multi-Target Support
- Any command that accepts creature targets must support specifying multiple targets separated by spaces:
  - e.g., `hp set 20 HeroA Legolas Gimli`
  - e.g., `dmg add 5 Goblin1 Goblin2 Goblin3`
  - e.g., `status add poisoned Goblin1 Orc1`
- Must support quoted strings for targets containing spaces:
  - e.g., `hp set 30 "Goblin Archer" "Young Red Dragon"`
- Keyword `all` should be supported where applicable (e.g., `status clear all`, `init roll all`).

---

### 4. No Wildcard / Glob Matching
- Wildcard glob patterns (`*`) are prohibited.
- Batch mutations must rely on explicit multi-targets, explicit keywords (`all`), or dedicated type commands (e.g., `pc remove`, `enemy remove`).

---

### 5. Standard POSIX / docopt Notation in Help & Errors
When displaying command signatures in `HELP_DATA`, CLI `--help`, table footers, error messages, and documentation:
- **Required parameters / placeholders**: Enclosed in angle brackets `<value>`, `<target>`, `<name>`, `<effect>`, `<resource>`.
- **Optional parameters**: Enclosed in square brackets `[name]`, `[count]`, `[target...]`.
- **Mutually exclusive choices**: Enclosed in parentheses separated by vertical pipes `(a | b)` (e.g., `(pc | enemy | neutral)`, `(start | end | reset)`, `(yes | no)`).
- **Variadic / multiple arguments**: Indicated with a trailing ellipsis `...` (e.g., `<target>...`, `<name>...`).
- **Literal keywords**: Displayed without angle brackets (e.g., `all`, `yes`, `no`).
- **CLI Options**: Standard Unix dashed flags (e.g., `-h, --help`, `-v, --version`).
- **Section Headers**: Standard Unix formatting in `--help` (`Usage:`, `Arguments:`, `Options:`).

---

### 6. Standard Unix Error Feedback
- If invalid arguments or insufficient parameters are supplied:
  - Print a concise usage string in red matching standard Unix patterns:
    ```text
    Usage: <field|entity> <command> <value> <target>...
    ```
  - Return gracefully to the interactive prompt without throwing unhandled exceptions or mutating state.

---

### 7. Completer & Template Synchronization
- Ensure `ALL_COMMAND_TEMPLATES` in `index.ts` contains the exact noun-first command pattern.
- Ensure the readline `completer()` suggests subcommands in noun-first format and auto-completes creature names as trailing arguments.
- Verify no legacy verb commands appear in completion lists.

---

## Workflow Checklist

When adding or modifying any CLI command:

1. **Verify Signature**:
   - [ ] Does the command follow `<field|entity> <command> [value] [target...]`?
   - [ ] Are target arguments at the end of the command?
   - [ ] Does it support multiple targets?
   - [ ] Does it handle quoted multi-word arguments?
   - [ ] Are legacy verb-first patterns disallowed?

2. **Verify Help & Feedback**:
   - [ ] Is `HELP_DATA` in `index.ts` formatted with POSIX/docopt conventions?
   - [ ] Is the usage error message formatted as `Usage: <field|entity> <command> ...`?
   - [ ] Is the table footer prompt updated if a global shortcut is affected?

3. **Verify Completions**:
   - [ ] Is the command added to `ALL_COMMAND_TEMPLATES`?
   - [ ] Does `completer()` suggest the command and its trailing arguments properly?

4. **Verify Documentation**:
   - [ ] Is `README.md` updated with the accurate signature and realistic examples?

5. **Verify Tests**:
   - [ ] Are unit tests added in `index.test.ts` checking execution, multi-target support, error messages, and legacy syntax rejection?
   - [ ] Run `bun test` to confirm all tests pass cleanly.
