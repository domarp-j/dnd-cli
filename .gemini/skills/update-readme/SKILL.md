---
name: update-readme
description: Automatically updates and syncs the project README.md whenever CLI commands, features, subcommands, options, or flags are added, removed, or modified in the codebase. Activate or invoke this skill after implementing new features, modifying existing CLI commands, or updating flags and subcommands.
---

# README Auto-Updater Skill

This skill ensures that `README.md` remains continuously up to date with all CLI features, commands, subcommands, flags, and options defined in the codebase.

## Trigger Conditions

Activate this skill whenever:
- New CLI commands, subcommands, or options are added to the codebase.
- Command signatures, syntax, arguments, or default behaviors are modified.
- Features (such as Combat Mode, initiative tracking, condition management) are added or updated.
- Command aliases or shorthands (e.g., `n` for `next`, `p` for `prev`) are modified.

## Workflow

### 1. Codebase Audit
- Search for command definitions and handlers (e.g. `handleCommand` in `index.ts`).
- Identify all command names, subcommands, arguments, flags, and shorthand aliases.
- Note any quantitative defaults or quantitative limits.

### 2. Compare against `README.md`
- Inspect `README.md` to identify missing or outdated command references.
- Check section headings (e.g. `Installation`, `Running the Tracker`, `Combat Mode`, `General Commands`).

### 3. Update `README.md`
- Update or add command code blocks with accurate syntax and flags.
- Include clear, realistic example usages.
- Update the quick-reference command list.

### 4. Verification
- Verify that every command listed in `README.md` functions as described.
