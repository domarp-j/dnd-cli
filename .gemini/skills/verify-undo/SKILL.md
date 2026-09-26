---
name: verify-undo
description: Verifies that any newly added or modified CLI commands properly support undo and redo operations, ensuring state changes are tracked in snapshot history, restored cleanly, and validated with comprehensive unit tests. Activate or invoke this skill whenever implementing, modifying, or refactoring CLI commands, interactive prompts, creature fields, or game state mutations.
---

# Verify Command Undo & Redo Skill

This skill ensures that every new or modified CLI command, subcommand, or interactive mutation within `dnd-cli` is fully undoable and redoable, preventing game state corruption or lost player data.

## Trigger Conditions

Activate and execute this skill whenever:
- A new CLI command, subcommand, alias, or parameter is added to `index.ts`.
- An existing command handler or state mutation function is modified or refactored.
- New fields or properties are added to `Creature` or global game/combat state (e.g. `reactionUsed`, `resourceUsage`, conditions).
- Interactive prompts or confirmation flows (e.g. `processConfirmation`, `processCharTypePrompt`) are introduced or altered.
- Modifying command exemption lists or undo stack behavior.

## Core Architectural Checklist

`dnd-cli` utilizes a snapshot-based history system (`captureSnapshot`, `restoreSnapshot`, `undoStack`, `redoStack`). To guarantee undo functions reliably, verify each of the following:

### 1. Undo Tracking Wrapper
- Ensure the command execution is routed through `executeWithUndoTracking(action, commandInput)`.
- If the command runs through `handleCommand(input)`, it is automatically wrapped.
- If the command uses an asynchronous or secondary interactive prompt (e.g., `processConfirmation`, `processCharTypePrompt`), verify that the prompt handler itself explicitly calls `executeWithUndoTracking`.

### 2. Command Exemption Integrity
- Check `isUndoExemptCommand(commandInput)` in `index.ts`.
- **Mutating commands** (e.g. `add`, `set`, `heal`, `hurt`, `damage`, `combat`, `next`, `prev`, etc.) must **never** be included in `isUndoExemptCommand`.
- **Non-mutating / read-only commands** (e.g. `help`, `saves`, `show`, `undo`, `redo`, `quit`) should be listed in `isUndoExemptCommand` so they do not pollute the undo stack with empty snapshots.

### 3. Snapshot Completeness (`captureSnapshot` & `restoreSnapshot`)
If the command introduces or touches new state:
- Verify `captureSnapshot()` performs a **deep clone** of all creature fields (including nested arrays and objects like `statusEffects`, `resourceUsage`, or flags like `reactionUsed`).
- Verify `restoreSnapshot()` properly resets and repopulates the active state from the snapshot.
- Avoid shared object references between snapshots and the live state.

### 4. Idempotency on No-Op / Invalid Inputs
- If a command fails validation (e.g. target not found, invalid syntax) and leaves state unchanged:
  - `JSON.stringify(pre) === JSON.stringify(post)` should evaluate to true.
  - The invalid command must **not** push a redundant entry to `undoStack`.

---

## Workflow

### Step 1: Code Audit & Implementation
1. Inspect the command implementation in `handleCommand` or `handleCommandInternal`.
2. Confirm the command modifies state through tracked variables (`creatures`, `inCombat`, `currentRound`, `currentTurnIndex`, etc.).
3. If new creature or combat fields were created, update `captureSnapshot()` and `restoreSnapshot()` accordingly.

### Step 2: Implement Undo/Redo Unit Tests in `index.test.ts`
For every new or updated command, write dedicated unit test cases verifying:
1. **Mutation**: Executing the command mutates state as expected.
2. **Undo**: Calling `handleCommand("undo")` (or `u`) restores state identically to pre-command state.
3. **Redo**: Calling `handleCommand("redo")` (or `r`) re-applies the mutation accurately.
4. **Stack Length**: `getHistoryStacks().undoLength` increments by 1 on mutation and decrements on undo.

#### Test Template:
```typescript
test("<command> is undoable and redoable", () => {
  handleCommand("new game");
  handleCommand("add pc HeroA");
  
  // Record pre-state
  const preSnapshot = creatures.map(c => ({ ...c }));
  const initialUndoLength = getHistoryStacks().undoLength;

  // Execute new/modified command
  handleCommand("<new_command_here>");
  expect(getHistoryStacks().undoLength).toBe(initialUndoLength + 1);
  // Assert post-mutation state...

  // Test Undo
  handleCommand("undo");
  expect(getHistoryStacks().undoLength).toBe(initialUndoLength);
  expect(creatures.map(c => ({ ...c }))).toEqual(preSnapshot);

  // Test Redo
  handleCommand("redo");
  expect(getHistoryStacks().undoLength).toBe(initialUndoLength + 1);
  // Assert re-applied state...
});
```

### Step 3: Run the Test Suite
Execute the test runner via terminal:
```bash
bun test
```
Ensure all tests (including the new undo tests) pass with exit code `0`.

### Step 4: Verification of Multi-Count & Chained Undos
Ensure the command behaves correctly when undone as part of a batch:
- Test `undo 2` or chained sequential undos to ensure snapshots in the stack do not produce cumulative state drift.
