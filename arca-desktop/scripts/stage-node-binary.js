#!/usr/bin/env node
// Copies the Node.js binary currently running this script into a fixed
// staging path (.staging/node.exe) that electron-builder's
// build.win.extraResources can reference with a static path in package.json.
//
// Why: electron-desktop bundles a real Node.js binary alongside the app so
// the packaged server (a standalone Next.js build) runs with the same
// module ABI it was installed against, instead of Electron's own embedded
// Node (see main.js's spawnServer). Hardcoding that binary's location
// (e.g. "C:/Program Files/nodejs/node.exe") only works on a machine that
// installed Node the standard way — it breaks on any machine using Scoop,
// nvm, a custom install path, or a different OS entirely. process.execPath
// is always the exact path of whatever Node binary is executing right now,
// so resolving it here at build time (via npm's automatic `preBUILD_SCRIPT`
// hook — this file is `prebuild:win`, which npm runs before `build:win`
// with zero extra configuration) works on any machine unmodified.
'use strict'

const fs   = require('fs')
const path = require('path')

const dest = path.join(__dirname, '..', '.staging', 'node.exe')

fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.copyFileSync(process.execPath, dest)

console.log(`[stage-node-binary] ${process.execPath} -> ${dest}`)
