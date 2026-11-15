const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PROD_BASE_URI = process.env.MONGO_URI || 'mongodb+srv://naveen935186_db_user:NaveenSdlp123%20@cluster0.n5ytpsh.mongodb.net';

// Source is production ('test' DB)
const PROD_URI = PROD_BASE_URI.includes('?') 
  ? PROD_BASE_URI.replace(/\/[^/?]+(\?)/, '/test$1')
  : (PROD_BASE_URI.endsWith('/') ? `${PROD_BASE_URI}test` : `${PROD_BASE_URI}/test`);

// Target is development ('dineviq_dev' DB)
const DEV_URI = PROD_BASE_URI.includes('?') 
  ? PROD_BASE_URI.replace(/\/[^/?]+(\?)/, '/dineviq_dev$1')
  : (PROD_BASE_URI.endsWith('/') ? `${PROD_BASE_URI}dineviq_dev` : `${PROD_BASE_URI}/dineviq_dev`);

async function syncProdToDev() {
  console.log('====================================================');
  console.log('🔄 SYNCING DATA: Production (test) -> Dev (dineviq_dev)');
  console.log('⚠️  ONE-WAY SYNC: Prod data is ONLY READ, never modified.');
  console.log('====================================================\n');

  let prodConn = null;
  let devConn = null;

  try {
    console.log('📡 Connecting to Production database (test)...');
    prodConn = await mongoose.createConnection(PROD_URI).asPromise();
    console.log('✅ Connected to Production database.');

    console.log('📡 Connecting to Dev database (dineviq_dev)...');
    devConn = await mongoose.createConnection(DEV_URI).asPromise();
    console.log('✅ Connected to Dev database.\n');

    const collections = await prodConn.db.listCollections().toArray();
    console.log(`📦 Found ${collections.length} collections to clone.\n`);

    for (const colInfo of collections) {
      const colName = colInfo.name;
      
      // Skip system collections if any
      if (colName.startsWith('system.')) continue;

      const prodCol = prodConn.db.collection(colName);
      const devCol = devConn.db.collection(colName);

      const count = await prodCol.countDocuments();
      if (count === 0) {
        console.log(`ℹ️  [${colName}]: 0 documents, skipping data.`);
        continue;
      }

      console.log(`⏳ [${colName}]: Cloning ${count} documents...`);

      // Read from prod
      const docs = await prodCol.find({}).toArray();

      // Clear dev collection first to prevent duplicate key conflicts
      await devCol.deleteMany({});

      // Insert into dev
      if (docs.length > 0) {
        // Chunk inserts if large
        const chunkSize = 1000;
        for (let i = 0; i < docs.length; i += chunkSize) {
          const chunk = docs.slice(i, i + chunkSize);
          await devCol.insertMany(chunk, { ordered: false });
        }
      }

      // Copy indexes from prod to dev
      try {
        const indexes = await prodCol.indexes();
        const validIndexes = indexes.filter(idx => idx.name !== '_id_');
        if (validIndexes.length > 0) {
          for (const idx of validIndexes) {
            const { key, name, unique, sparse } = idx;
            const options = { name };
            if (unique) options.unique = true;
            if (sparse) options.sparse = true;
            try {
              await devCol.createIndex(key, options);
            } catch (_) {}
          }
        }
      } catch (idxErr) {
        console.warn(`  ⚠️ Could not copy all indexes for ${colName}:`, idxErr.message);
      }

      console.log(`✅ [${colName}]: Successfully copied ${docs.length} documents.`);
    }

    console.log('\n====================================================');
    console.log('🎉 One-way sync completed successfully!');
    console.log('Dev database (dineviq_dev) is now up to date with Production.');
    console.log('====================================================');

  } catch (err) {
    console.error('❌ Sync failed:', err);
    process.exit(1);
  } finally {
    if (prodConn) await prodConn.close();
    if (devConn) await devConn.close();
    process.exit(0);
  }
}

syncProdToDev();
