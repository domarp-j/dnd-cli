---
name: run-tests
description: Automatically runs the test suite (`bun test`) after code or configuration changes to verify that all unit and integration tests pass cleanly before completing a task or declaring success.
---

# Automated Test Execution Skill

This skill ensures that the application's test suite (`bun test`) is automatically executed after code edits or configuration modifications to verify correctness and prevent regression bugs.

## Trigger Conditions

Activate and execute this skill whenever:
- Code files (e.g. `index.ts`) are modified or refactored.
- CLI commands, subcommands, arguments, or options are added, edited, or removed.
- State management, combat sorting, turn tracking, or data models are updated.
- Before committing changes or declaring a task complete.

## Workflow

### 1. Execute Test Suite
- Run `bun test` (or `npm test`) via terminal command execution (`run_command`).
- Observe the empirical test output and exit code.

### 2. Verify Output & Fix Failures
- If all tests pass with exit code `0`: proceed with staging, committing, and reporting success.
- If any test fails or errors occur:
  - Inspect the specific failure traceback and error message.
  - Fix the underlying bug or update the test suite assertions to match intentional contract changes.
  - Re-run `bun test` until 100% of tests pass cleanly.

### 3. Maintain Test Coverage
- When adding new CLI commands or features, update `index.test.ts` to add corresponding test coverage.
