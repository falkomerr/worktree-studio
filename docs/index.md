---
layout: home

hero:
  name: Worktree Studio
  text: A control room for every git worktree.
  tagline: Discover repo scripts, launch dev previews, follow live logs, and hand agents a repeatable bootstrap path without baking assumptions into the project.
  image:
    src: /hero-control-room.svg
    alt: Worktree Studio rail map
  actions:
    - theme: brand
      text: Open the GUI
      link: /worktree-studio/gui
    - theme: alt
      text: Agent self-configure
      link: /agents/self-configure

features:
  - title: Project-agnostic discovery
    details: Reads git worktrees, package scripts, Nx targets, and VitePress commands, then turns them into editable command cards.
  - title: Local control room
    details: Run dev, build, preview, test, and pipeline flows from one dense web dashboard bound to localhost.
  - title: Persistent JSON config
    details: Saves durable project settings into worktree-studio.json with validation and atomic writes.
  - title: Agent-ready bootstrap
    details: Gives coding agents a documented path to initialize, validate, and operate a repo without guessing shell commands.
---

<section class="wts-home-grid">
  <div class="wts-home-panel wts-home-panel--wide">
    <p class="wts-home-kicker">First five minutes</p>
    <h2>Bootstrap once, reuse across every worktree.</h2>
    <p>
      Worktree Studio keeps command knowledge outside package scripts and inside a project-local
      config file. Teams and agents can import discovered scripts, keep labels readable, and launch
      the same flows from CLI or GUI.
    </p>
    <div class="wts-terminal" aria-label="Worktree Studio bootstrap commands">
      <span>git status --short --branch</span>
      <span>wts init .</span>
      <span>wts config validate</span>
      <span>wts gui --port 0</span>
    </div>
  </div>
  <div class="wts-home-panel">
    <p class="wts-home-kicker">Operator view</p>
    <h2>Launch, stop, inspect.</h2>
    <p>
      Long-running dev servers and one-shot verification jobs share the same run model, log store,
      and local API session.
    </p>
  </div>
  <div class="wts-home-panel">
    <p class="wts-home-kicker">Agent contract</p>
    <h2>No tribal shell memory.</h2>
    <p>
      The Agents section describes how an autonomous agent should discover scripts, write config,
      avoid destructive actions, and leave a reproducible setup behind.
    </p>
  </div>
</section>
