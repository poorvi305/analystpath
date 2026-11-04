// migrate_to_mongodb.js - Full SQLite to MongoDB Atlas & Local Migration Utility
const { DatabaseSync } = require('node:sqlite');
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs');

// Check for MONGODB_URI in CLI args or environment
let mongoUri = process.argv[2] || process.env.MONGODB_URI;

// Try reading from .env if present
if (!mongoUri && fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const match = envContent.match(/MONGODB_URI\s*=\s*(.+)/);
  if (match) {
    mongoUri = match[1].trim().replace(/^['"]|['"]$/g, '');
  }
}

const SQLITE_PATH = fs.existsSync(path.join(__dirname, 'analystpath.db.backup'))
  ? path.join(__dirname, 'analystpath.db.backup')
  : path.join(__dirname, 'analystpath.db');

const LOCAL_STORE_PATH = path.join(__dirname, 'mongo_data_store.json');
const DB_NAME = process.env.MONGODB_DB_NAME || 'analystpath';

const JSON_FIELDS = [
  'day_to_day', 'transferable_skills', 'essential_skills', 'useful_additions',
  'portfolio_projects', 'learning_roadmap', 'salaries_by_location', 'hiring_employers',
  'career_progression', 'skills_gap_checklist', 'recommended_courses', 'prerequisites',
  'learning_objectives', 'key_terms', 'formula_sheet', 'worked_examples', 'common_mistakes',
  'external_resources', 'practice_exercise', 'video_transcript', 'video_transcript_hi',
  'lesson_test', 'options', 'rubric', 'key_points', 'steps', 'skills', 'weak_topics'
];

async function runMigration() {
  console.log('========================================================');
  console.log('🚀 SQLITE TO MONGODB MIGRATION UTILITY');
  console.log('========================================================\n');

  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`❌ SQLite database file not found at: ${SQLITE_PATH}`);
    process.exit(1);
  }

  console.log(`📖 Reading source SQLite database: ${path.basename(SQLITE_PATH)}...`);
  const sqlite = new DatabaseSync(SQLITE_PATH);
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC").all();

  const mongoDatabase = {};
  const report = [];
  let totalDocs = 0;

  for (const t of tables) {
    const tableName = t.name;
    const collectionName = tableName; // Map 1:1 to MongoDB collection

    const rows = sqlite.prepare(`SELECT * FROM "${tableName}"`).all();
    if (rows.length === 0) {
      mongoDatabase[collectionName] = [];
      report.push({ 'Collection': collectionName, 'Migrated': 0, 'Status': '⚪ Empty (Preserved)' });
      continue;
    }

    // Convert SQL rows into MongoDB documents
    const docs = rows.map(r => {
      const doc = { ...r };
      if (doc.id) {
        doc._id = String(doc.id);
      }

      // Parse any stringified JSON fields into native JSON arrays/objects
      for (const field of JSON_FIELDS) {
        if (doc[field] && typeof doc[field] === 'string') {
          try {
            doc[field] = JSON.parse(doc[field]);
          } catch (e) {}
        }
      }

      // Convert SQLite 1/0 flags to boolean
      if (tableName === 'users') {
        doc.is_verified = !!doc.is_verified;
        doc.is_phone_verified = !!doc.is_phone_verified;
        doc.share_profile_photo = !!doc.share_profile_photo;
        doc.share_phone = !!doc.share_phone;
        doc.share_current_role = !!doc.share_current_role;
        doc.share_employer_info = !!doc.share_employer_info;
      }

      return doc;
    });

    mongoDatabase[collectionName] = docs;
    totalDocs += docs.length;

    report.push({
      'Collection': collectionName,
      'Migrated': docs.length,
      'Status': '✅ Converted'
    });
  }

  // 1. Write local MongoDB JSON store
  fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(mongoDatabase, null, 2), 'utf8');
  console.log(`💾 Saved ${totalDocs} documents across ${tables.length} collections to: mongo_data_store.json\n`);
  console.table(report);

  // 2. If MONGODB_URI is provided, sync to MongoDB Atlas
  if (mongoUri) {
    console.log(`\n🍃 Connecting to MongoDB Atlas (${mongoUri.replace(/:([^:@]+)@/, ':****@')})...`);
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
    try {
      await client.connect();
      const mongoDb = client.db(DB_NAME);
      console.log(`✅ Connected to MongoDB Atlas! Target Database: "${DB_NAME}"\n`);

      for (const [colName, docs] of Object.entries(mongoDatabase)) {
        if (docs.length === 0) continue;
        const col = mongoDb.collection(colName);
        await col.deleteMany({});
        await col.insertMany(docs, { ordered: false });
        console.log(`  - Synced ${docs.length} documents into Atlas collection "${colName}"`);
      }

      // Create essential MongoDB indexes
      console.log('\nCreating indexes in MongoDB Atlas collections...');
      try {
        await mongoDb.collection('users').createIndex({ email: 1 }, { unique: true });
        await mongoDb.collection('sessions').createIndex({ token: 1 }, { unique: true });
        await mongoDb.collection('career_paths').createIndex({ slug: 1 }, { unique: true });
        await mongoDb.collection('courses').createIndex({ slug: 1 }, { unique: true });
        await mongoDb.collection('lessons').createIndex({ slug: 1 }, { unique: true });
        await mongoDb.collection('study_groups').createIndex({ invite_code: 1 }, { unique: true });
        console.log('✅ Unique indexes created in MongoDB Atlas.');
      } catch (e) {
        console.warn('Index note:', e.message);
      }

      console.log('\n========================================================');
      console.log('🎉 ALL DATA FULLY SYNCED TO MONGODB ATLAS CLUSTER!');
      console.log('========================================================\n');
    } catch (err) {
      console.error('❌ MongoDB Atlas Sync Warning:', err.message);
      console.log('Note: Data is fully saved in local MongoDB document store (mongo_data_store.json).');
    } finally {
      await client.close();
    }
  } else {
    console.log('\n--------------------------------------------------------');
    console.log('💡 To sync these documents directly to your MongoDB Atlas cloud cluster:');
    console.log('   node migrate_to_mongodb.js "mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/analystpath?retryWrites=true&w=majority"');
    console.log('--------------------------------------------------------\n');
  }

  console.log('========================================================');
  console.log(`🎉 MIGRATION SUCCESSFUL! Total: ${totalDocs} documents across ${tables.length} collections.`);
  console.log('========================================================\n');
}

runMigration();
