# Overview

Worktree Studio is a standalone, project-agnostic CLI and local Web UI for operating existing git worktrees.

V1 supports:

- listing git worktrees;
- discovering `package.json` scripts and Nx `project.json` targets;
- running configured dev/build/preview/test/lint commands;
- running sequential pipelines;
- streaming live logs through a local Web UI;
- editing `worktree-studio.json` from the browser;
- exposing agent bootstrap instructions from config.

V1 does not create, delete, prune, commit, or push worktrees.
