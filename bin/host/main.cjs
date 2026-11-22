'use strict';
const path = require('node:path');
const config = require('./host.json');
try { require(config.target === 'antigravity' ? './antigravity-bridge.cjs' : ['claude', 'opencode', 'zcode'].includes(config.target) ? './desktop-bridge.cjs' : './bridge.cjs').install(require('electron'), config); }
catch (error) { console.error('[Rasta] Native controls unavailable:', error.message); }
// The vendor entry and all its dependencies remain byte-for-byte unchanged.
require(path.resolve(__dirname, '..', config.originalMain));
