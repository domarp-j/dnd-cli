---
name: git-commit-push
description: Automatically stages changed files, formats a strict Conventional Commit message with detailed bulleted body, and pushes commits to the remote repository after every feature, bugfix, or refactoring change.
---

# Git Commit and Push Skill

This skill enforces a systematic Git workflow that automatically stages modified files, creates standardized Conventional Commit messages, and pushes changes to the remote repository after completing work items.

## Trigger Conditions

Activate and execute this skill whenever:
- A user feature, bugfix, refactor, styling, or documentation task has been completed and verified.
- Code or configuration files have been created, modified, or deleted.
- Unit and integration tests (`bun test`) have passed cleanly.

## Workflow

### 1. Stage All Modified Files
- Run `git add .` (or `git add <specific_files>`) using `run_command` to stage all changes.

### 2. Formulate Conventional Commit Message
Formulate a commit message following strict Conventional Commit format:

- **Type Prefix**:
  - `feat:` — New feature or CLI command added.
  - `fix:` — Bug fix or safety protection fix.
  - `refactor:` — Code structure or algorithm improvements without behavior change.
  - `style:` — Layout, formatting, menu alignment, or prompt text changes.
  - `docs:` — README.md or skill instruction updates.
  - `test:` — Test suite additions or modifications.
  - `chore:` — Dependencies, build configuration, or repository maintenance.

- **Format**:
  ```text
  <type>: <short summary in imperative mood>

  - Bullet point detailing primary changes
  - Bullet point detailing secondary impact or documentation updates
  ```

### 3. Execute Commit & Push
- Execute `git commit -m "..."` followed by `git push` via `run_command`.

### 4. Verify Remote Sync
- Ensure the command returns exit code `0` and confirms successful push to `origin/main`.
