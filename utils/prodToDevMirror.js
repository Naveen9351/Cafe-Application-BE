const mongoose = require('mongoose');

/**
 * Real-Time One-Way Database Mirroring (Production -> Development)
 *
 * Automatically mirrors all inserts, updates, replacements, and deletes from
 * the production database ('test') to the development database ('dineviq_dev')
 * using native MongoDB Change Streams.
 *
 * Rules:
 * 1. ONE-WAY ONLY: Production -> Dev. Dev changes NEVER touch Production.
 * 2. NON-BLOCKING: Production queries & HTTP responses are completely unaffected.
 * 3. ONLY RUNS ON PROD: Does nothing if the current server is already connected to dev.
 */

let devConnection = null;
let changeStream = null;

function getDevMongoUri(prodUri) {
  if (process.env.DEV_MONGO_URI) return process.env.DEV_MONGO_URI;
  if (!prodUri) return null;

  try {
    if (prodUri.includes('?')) {
      const [base, query] = prodUri.split('?');
      const parts = base.replace(/\/+$/, '').split('/');
      const prefix = parts.slice(0, 3).join('/');
      return `${prefix}/dineviq_dev?${query}`;
    }
    const parts = prodUri.replace(/\/+$/, '').split('/');
    const prefix = parts.slice(0, 3).join('/');
    return `${prefix}/dineviq_dev`;
  } catch (_) {
    return null;
  }
}

async function initProdToDevMirror(prodConnection) {
  try {
    const currentDbName = prodConnection.name;

    // Safety check: only mirror from 'test' (prod) to 'dineviq_dev'
    if (currentDbName === 'dineviq_dev') {
      console.log('ℹ️  [DB Mirror] Running on Dev database. Mirroring disabled.');
      return;
    }

    if (process.env.MIRROR_TO_DEV === 'false') {
      console.log('ℹ️  [DB Mirror] MIRROR_TO_DEV is set to false. Mirroring disabled.');
      return;
    }

    const devUri = getDevMongoUri(process.env.MONGO_URI);

    if (!devUri) {
      console.log('ℹ️  [DB Mirror] No Dev MongoDB URI available. Mirroring skipped.');
      return;
    }

    console.log('📡 [DB Mirror] Initializing Real-Time One-Way Sync (Prod -> Dev)...');

    // Create a dedicated, lightweight connection to the Dev database
    devConnection = await mongoose.createConnection(devUri, {
      maxPoolSize: 5,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    }).asPromise();

    console.log('✅ [DB Mirror] Connected to Dev database (dineviq_dev).');

    // Watch production database for all write operations
    changeStream = prodConnection.db.watch([], { fullDocument: 'updateLookup' });

    changeStream.on('change', async (change) => {
      try {
        const colName = change.ns?.coll;
        if (!colName || colName.startsWith('system.')) return;

        const devCol = devConnection.db.collection(colName);

        if (['insert', 'update', 'replace'].includes(change.operationType) && change.fullDocument) {
          await devCol.replaceOne(
            { _id: change.documentKey._id },
            change.fullDocument,
            { upsert: true }
          );
        } else if (change.operationType === 'delete') {
          await devCol.deleteOne({ _id: change.documentKey._id });
        }
      } catch (err) {
        // Non-blocking: log warning without affecting production
        console.warn(`⚠️ [DB Mirror] Failed to mirror ${change.ns?.coll || 'doc'}:`, err.message);
      }
    });

    changeStream.on('error', (err) => {
      console.warn('⚠️ [DB Mirror] Change stream error (will retry automatically):', err.message);
    });

    console.log('⚡ [DB Mirror] Real-time Prod -> Dev mirroring is ACTIVE.');
  } catch (err) {
    console.warn('⚠️ [DB Mirror] Could not initialize mirror stream:', err.message);
  }
}

module.exports = { initProdToDevMirror };
