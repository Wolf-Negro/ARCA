#!/usr/bin/env node
// Copies a real Node.js binary into a fixed staging path that
// electron-builder's extraResources can reference with a static path in
// package.json (.staging/node.exe on Windows, .staging/node elsewhere).
//
// Why: arca-desktop bundles a real Node.js binary alongside the app so the
// packaged server (a standalone Next.js build) runs with the same module ABI
// it was installed against, instead of Electron's own embedded Node (see
// main.js's spawnServer). process.execPath is always the exact path of
// whatever Node binary is executing right now, so resolving it here at build
// time (via npm's automatic pre<script> hook — this file runs as
// `prebuild:win` / `prebuild:mac`) works on any machine unmodified.
//
// ARCA_NODE_BINARY overrides the source, for cross-arch builds in CI where
// the Node that runs npm isn't the Node that should ship (e.g. packaging an
// x64 app from an arm64 macOS runner).
'use strict'

const fs   = require('fs')
const path = require('path')

const source   = process.env.ARCA_NODE_BINARY || process.execPath
const destName = process.platform === 'win32' ? 'node.exe' : 'node'
const dest     = path.join(__dirname, '..', '.staging', destName)

fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.copyFileSync(source, dest)
if (process.platform !== 'win32') fs.chmodSync(dest, 0o755)

console.log(`[stage-node-binary] ${source} -> ${dest}`)
