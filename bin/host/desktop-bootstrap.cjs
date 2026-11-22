'use strict';
try { require('./desktop-bridge.cjs').install(require('electron'), require('./host.json')); }
catch (error) { console.error('[Rasta] Native controls unavailable:', error.message); }
