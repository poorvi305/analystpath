// mongo_database.js - Production MongoDB Atlas Driver, ODM & Data Access Layer
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { coursesData, sampleLessonsData, quizzesData, interviewQuestionsData, guidedProjectsData, questionsData } = require('./seed_data');
const { careerPathsData } = require('./career_paths_data');
const { lessonVideosAndTests } = require('./lesson_videos_and_tests_data');
const { comprehensiveInterviewQuestions } = require('./comprehensive_interview_data');
const { customers, products, orders, employee_churn } = require('./sample_datasets');

// Configuration
const LOCAL_STORE_PATH = path.join(__dirname, 'mongo_data_store.json');
const DB_NAME = process.env.MONGODB_DB_NAME || 'analystpath';

let mongoClient = null;
let mongoDb = null;
let isConnected = false;
let localStore = null;
let mongoConnectPromise = null;

// Read MONGODB_URI from environment or .env file
function getMongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/MONGODB_URI\s*=\s*(.+)/);
    if (match) {
      return match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}

// Ensure local MongoDB document store is loaded
function getLocalStore() {
  if (localStore) return localStore;
  if (fs.existsSync(LOCAL_STORE_PATH)) {
    try {
      localStore = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'));
      return localStore;
    } catch (e) {
      console.warn('[MongoDB Local Store Read Warning]:', e.message);
    }
  }
  localStore = {};
  return localStore;
}

// Persist local MongoDB document store to disk
let saveTimeout = null;
function persistLocalStore() {
  if (!localStore) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(localStore, null, 2), 'utf8');
    } catch (e) {
      console.error('[MongoDB Local Store Persist Error]:', e.message);
    }
  }, 50);
}

// Immediate flush to disk
function flushLocalStoreSync() {
  if (!localStore) return;
  try {
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(localStore, null, 2), 'utf8');
  } catch (e) {
    console.error('[MongoDB Local Store Flush Error]:', e.message);
  }
}

/**
 * Filter match helper for local MongoDB documents
 */
function matchesQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true;

  for (const [key, val] of Object.entries(query)) {
    if (key === '$or') {
      const matchAny = val.some(subQ => matchesQuery(doc, subQ));
      if (!matchAny) return false;
      continue;
    }
    if (key === '$and') {
      const matchAll = val.every(subQ => matchesQuery(doc, subQ));
      if (!matchAll) return false;
      continue;
    }

    const docVal = doc[key];

    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof RegExp)) {
      for (const [op, opVal] of Object.entries(val)) {
        if (op === '$gt' && !(docVal > opVal)) return false;
        if (op === '$gte' && !(docVal >= opVal)) return false;
        if (op === '$lt' && !(docVal < opVal)) return false;
        if (op === '$lte' && !(docVal <= opVal)) return false;
        if (op === '$ne' && docVal === opVal) return false;
        if (op === '$in' && (!Array.isArray(opVal) || !opVal.includes(docVal))) return false;
        if (op === '$nin' && Array.isArray(opVal) && opVal.includes(docVal)) return false;
      }
    } else if (val instanceof RegExp) {
      if (!val.test(String(docVal || ''))) return false;
    } else {
      if (docVal !== val) return false;
    }
  }

  return true;
}

/**
 * Local Document Collection implementing MongoDB Collection API
 */
class LocalDocumentCollection {
  constructor(name) {
    this.name = name;
    const store = getLocalStore();
    if (!store[name]) {
      store[name] = [];
    }
  }

  get _docs() {
    const store = getLocalStore();
    if (!store[this.name]) store[this.name] = [];
    return store[this.name];
  }

  set _docs(val) {
    const store = getLocalStore();
    store[this.name] = val;
  }

  async find(filter = {}, options = {}) {
    const cursor = {
      _filter: filter,
      _sort: null,
      _limit: 0,
      _skip: 0,
      sort(sortObj) {
        cursor._sort = sortObj;
        return cursor;
      },
      limit(n) {
        cursor._limit = n;
        return cursor;
      },
      skip(n) {
        cursor._skip = n;
        return cursor;
      },
      async toArray() {
        let results = this._docs.filter(d => matchesQuery(d, cursor._filter)).map(d => ({ ...d }));
        if (cursor._sort) {
          const [sortKey, sortDir] = Object.entries(cursor._sort)[0] || [];
          if (sortKey) {
            results.sort((a, b) => {
              if (a[sortKey] < b[sortKey]) return sortDir === -1 ? 1 : -1;
              if (a[sortKey] > b[sortKey]) return sortDir === -1 ? -1 : 1;
              return 0;
            });
          }
        }
        if (cursor._skip > 0) results = results.slice(cursor._skip);
        if (cursor._limit > 0) results = results.slice(0, cursor._limit);
        return results;
      }
    };
    cursor._docs = this._docs;
    return cursor;
  }

  async findOne(filter = {}) {
    const doc = this._docs.find(d => matchesQuery(d, filter));
    return doc ? { ...doc } : null;
  }

  async insertOne(doc) {
    const copy = { ...doc };
    if (!copy.id) copy.id = 'doc_' + crypto.randomBytes(8).toString('hex');
    if (!copy._id) copy._id = String(copy.id);
    this._docs.push(copy);
    persistLocalStore();
    return { acknowledged: true, insertedId: copy._id };
  }

  async insertMany(docs) {
    const insertedIds = {};
    let idx = 0;
    for (const d of docs) {
      const copy = { ...d };
      if (!copy.id) copy.id = 'doc_' + crypto.randomBytes(8).toString('hex');
      if (!copy._id) copy._id = String(copy.id);
      this._docs.push(copy);
      insertedIds[idx++] = copy._id;
    }
    persistLocalStore();
    return { acknowledged: true, insertedCount: docs.length, insertedIds };
  }

  async updateOne(filter, update, options = {}) {
    const idx = this._docs.findIndex(d => matchesQuery(d, filter));
    if (idx === -1) {
      if (options.upsert) {
        const newDoc = { ...filter };
        if (update.$set) Object.assign(newDoc, update.$set);
        return await this.insertOne(newDoc);
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const doc = this._docs[idx];
    if (update.$set) {
      Object.assign(doc, update.$set);
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        doc[k] = (doc[k] || 0) + v;
      }
    }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        if (!Array.isArray(doc[k])) doc[k] = [];
        doc[k].push(v);
      }
    }

    persistLocalStore();
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async updateMany(filter, update) {
    let modified = 0;
    for (const doc of this._docs) {
      if (matchesQuery(doc, filter)) {
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$inc) {
          for (const [k, v] of Object.entries(update.$inc)) {
            doc[k] = (doc[k] || 0) + v;
          }
        }
        modified++;
      }
    }
    if (modified > 0) persistLocalStore();
    return { matchedCount: modified, modifiedCount: modified };
  }

  async deleteOne(filter) {
    const idx = this._docs.findIndex(d => matchesQuery(d, filter));
    if (idx !== -1) {
      this._docs.splice(idx, 1);
      persistLocalStore();
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  async deleteMany(filter = {}) {
    if (Object.keys(filter).length === 0) {
      const count = this._docs.length;
      this._docs.length = 0;
      persistLocalStore();
      return { deletedCount: count };
    }
    const before = this._docs.length;
    this._docs = this._docs.filter(d => !matchesQuery(d, filter));
    const deletedCount = before - this._docs.length;
    if (deletedCount > 0) persistLocalStore();
    return { deletedCount };
  }

  async countDocuments(filter = {}) {
    if (Object.keys(filter).length === 0) return this._docs.length;
    return this._docs.filter(d => matchesQuery(d, filter)).length;
  }

  async createIndex() {
    return 'index_created';
  }

  async drop() {
    this._docs = [];
    persistLocalStore();
    return true;
  }
}

/**
 * Local Database implementation matching MongoDB Database API
 */
class LocalMongoDatabase {
  constructor() {
    this.name = DB_NAME;
  }

  collection(name) {
    return new LocalDocumentCollection(name);
  }

  async listCollections() {
    const store = getLocalStore();
    const list = Object.keys(store).map(name => ({ name }));
    return {
      async toArray() {
        return list;
      }
    };
  }

  async command(cmd) {
    return { ok: 1 };
  }
}

const localMongoDbInstance = new LocalMongoDatabase();

// Password Hashing
function hashPassword(password, salt = null) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, actualSalt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt: actualSalt };
}

function verifyPassword(password, storedHash, salt) {
  if (!storedHash || !salt) return false;
  if (salt === 'analystpath_salt_2026') {
    const legacyCheck = crypto.pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(legacyCheck), Buffer.from(storedHash));
  }
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(storedHash));
}

/**
 * Connect to MongoDB Atlas (or fallback to local MongoDB document store)
 */
async function connectToMongo() {
  if (mongoDb && isConnected) return mongoDb;
  if (mongoConnectPromise) return mongoConnectPromise;

  mongoConnectPromise = (async () => {
    const uri = getMongoUri();

    if (!uri) {
      console.log('--------------------------------------------------------');
      console.log('🍃 [MongoDB Layer] Running in Local Document Store mode.');
      console.log('   Storage: mongo_data_store.json (34 Collections Active)');
      console.log('   To connect to MongoDB Atlas cloud cluster, add to .env:');
      console.log('   MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/analystpath?retryWrites=true&w=majority');
      console.log('--------------------------------------------------------');
      mongoDb = localMongoDbInstance;
      isConnected = false;
      await seedMongoInitialData(localMongoDbInstance);
      return localMongoDbInstance;
    }

    try {
      console.log(`🍃 [MongoDB Atlas] Connecting to cluster...`);
      mongoClient = new MongoClient(uri, {
        maxPoolSize: 20,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000
      });

      await mongoClient.connect();
      mongoDb = mongoClient.db(DB_NAME);
      isConnected = true;
      console.log(`✅ [MongoDB Atlas] Connected successfully to Database: "${DB_NAME}"`);

      // Ensure indexes for performance & uniqueness
      await initMongoIndexes(mongoDb);

      // Initial seed check
      await seedMongoInitialData(mongoDb);

      return mongoDb;
    } catch (err) {
      console.warn('⚠️  [MongoDB Atlas Connection Note]:', err.message);
      console.log('   Falling back to Local MongoDB Document Store (mongo_data_store.json)...');
      mongoDb = localMongoDbInstance;
      isConnected = false;
      await seedMongoInitialData(localMongoDbInstance);
      return localMongoDbInstance;
    }
  })();

  try {
    const db = await mongoConnectPromise;
    return db;
  } catch (e) {
    mongoConnectPromise = null;
    throw e;
  }
}

/**
 * Create necessary indexes in MongoDB collections
 */
async function initMongoIndexes(db) {
  try {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('sessions').createIndex({ token: 1 }, { unique: true });
    await db.collection('sessions').createIndex({ expires_at: 1 });
    await db.collection('courses').createIndex({ slug: 1 }, { unique: true });
    await db.collection('lessons').createIndex({ slug: 1 }, { unique: true });
    await db.collection('lessons').createIndex({ course_id: 1, order_idx: 1 });
    await db.collection('career_paths').createIndex({ slug: 1 }, { unique: true });
    await db.collection('career_paths').createIndex({ domain: 1 });
    await db.collection('study_groups').createIndex({ invite_code: 1 }, { unique: true });
    await db.collection('study_group_members').createIndex({ group_id: 1, user_id: 1 }, { unique: true });
    await db.collection('chat_messages').createIndex({ group_id: 1, created_at: -1 });
    await db.collection('questions').createIndex({ course_id: 1, topic: 1 });
    await db.collection('audit_logs').createIndex({ created_at: -1 });
  } catch (err) {
    console.warn('[MongoDB Index Note]:', err.message);
  }
}

function getMongoDb() {
  return mongoDb || localMongoDbInstance;
}

function isMongoConnected() {
  return isConnected;
}

/**
 * Seed initial content (Courses, Lessons, 16 Career Paths, Datasets) into MongoDB
 */
async function seedMongoInitialData(db) {
  try {
    // 1. Seed Courses
    const coursesCount = await db.collection('courses').countDocuments();
    if (coursesCount < coursesData.length) {
      console.log(`[MongoDB] Upserting ${coursesData.length} courses...`);
      for (const c of coursesData) {
        await db.collection('courses').updateOne(
          { id: c.id },
          {
            $set: {
              id: c.id,
              slug: c.slug,
              title: c.title,
              title_hi: c.title_hi,
              domain: c.domain,
              level: c.level,
              icon: c.icon,
              estimated_hours: c.estimated_hours,
              order_idx: c.order_idx,
              prerequisites: c.prerequisites || [],
              description: c.description,
              description_hi: c.description_hi,
              learning_objectives: c.learning_objectives || [],
              final_project_teaser: c.final_project_teaser
            }
          },
          { upsert: true }
        );
      }
    }

    // 2. Seed 16 Career Paths
    const cpCount = await db.collection('career_paths').countDocuments();
    if (cpCount < careerPathsData.length) {
      console.log(`[MongoDB] Upserting ${careerPathsData.length} research-based career paths...`);
      for (const cp of careerPathsData) {
        await db.collection('career_paths').updateOne(
          { slug: cp.slug },
          {
            $set: {
              id: cp.id,
              slug: cp.slug,
              title: cp.title,
              title_hi: cp.title_hi,
              domain: cp.domain,
              tech_intensity: cp.tech_intensity,
              non_tech_friendly: cp.non_tech_friendly,
              summary: cp.summary,
              summary_hi: cp.summary_hi,
              day_to_day: typeof cp.day_to_day === 'string' ? JSON.parse(cp.day_to_day) : cp.day_to_day,
              background_applicability: cp.background_applicability,
              transferable_skills: typeof cp.transferable_skills === 'string' ? JSON.parse(cp.transferable_skills) : cp.transferable_skills,
              essential_skills: typeof cp.essential_skills === 'string' ? JSON.parse(cp.essential_skills) : cp.essential_skills,
              useful_additions: typeof cp.useful_additions === 'string' ? JSON.parse(cp.useful_additions) : cp.useful_additions,
              portfolio_projects: typeof cp.portfolio_projects === 'string' ? JSON.parse(cp.portfolio_projects) : cp.portfolio_projects,
              entry_requirements: cp.entry_requirements,
              common_barriers: cp.common_barriers,
              learning_roadmap: typeof cp.learning_roadmap === 'string' ? JSON.parse(cp.learning_roadmap) : cp.learning_roadmap,
              salaries_by_location: typeof cp.salaries_by_location === 'string' ? JSON.parse(cp.salaries_by_location) : cp.salaries_by_location,
              pay_variation_factors: cp.pay_variation_factors,
              hiring_employers: typeof cp.hiring_employers === 'string' ? JSON.parse(cp.hiring_employers) : cp.hiring_employers,
              career_progression: typeof cp.career_progression === 'string' ? JSON.parse(cp.career_progression) : cp.career_progression,
              skills_gap_checklist: typeof cp.skills_gap_checklist === 'string' ? JSON.parse(cp.skills_gap_checklist) : cp.skills_gap_checklist,
              recommended_courses: typeof cp.recommended_courses === 'string' ? JSON.parse(cp.recommended_courses) : cp.recommended_courses,
              disclaimer: cp.disclaimer,
              information_checked_date: cp.information_checked_date || 'November 2026',
              order_idx: cp.order_idx || 1
            }
          },
          { upsert: true }
        );
      }
    }

    // 3. Seed Lessons with Video Mode & Tests
    const lessonsCount = await db.collection('lessons').countDocuments();
    if (lessonsCount < sampleLessonsData.length) {
      console.log(`[MongoDB] Upserting ${sampleLessonsData.length} lessons with bilingual videos & tests...`);
      for (const l of sampleLessonsData) {
        const v = lessonVideosAndTests[l.id] || {};
        await db.collection('lessons').updateOne(
          { id: l.id },
          {
            $set: {
              id: l.id,
              course_id: l.course_id,
              title: l.title,
              title_hi: l.title_hi,
              slug: l.slug,
              estimated_minutes: l.estimated_minutes || 20,
              order_idx: l.order_idx,
              content_en: l.content_en,
              content_hi: l.content_hi,
              key_terms: l.key_terms || [],
              formula_sheet: l.formula_sheet || [],
              worked_examples: l.worked_examples || [],
              common_mistakes: l.common_mistakes || [],
              external_resources: l.external_resources || [],
              practice_exercise: l.practice_exercise || null,
              video_url: v.video_url || null,
              video_duration: v.video_duration || '15:00',
              video_summary: v.video_summary || '',
              video_script: v.video_script || '',
              video_transcript: v.video_transcript || [],
              video_url_hi: v.video_url_hi || null,
              video_duration_hi: v.video_duration_hi || v.video_duration || '15:00',
              video_summary_hi: v.video_summary_hi || '',
              video_script_hi: v.video_script_hi || '',
              video_transcript_hi: v.video_transcript_hi || [],
              video_status: v.video_status || 'ready',
              video_provider: v.video_provider || 'heygen',
              avatar_model: v.avatar_model || 'ananya-data-mentor',
              lesson_test: v.lesson_test || []
            }
          },
          { upsert: true }
        );
      }
    }

    // 4. Seed Questions Bank
    const qCount = await db.collection('questions').countDocuments();
    if (qCount < questionsData.length) {
      console.log(`[MongoDB] Upserting ${questionsData.length} questions...`);
      for (const q of questionsData) {
        await db.collection('questions').updateOne(
          { id: q.id },
          { $set: { ...q } },
          { upsert: true }
        );
      }
    }

    // 5. Seed Practice Datasets
    const custCount = await db.collection('customers').countDocuments();
    if (custCount === 0) {
      await db.collection('customers').insertMany(customers);
      await db.collection('products').insertMany(products);
      await db.collection('orders').insertMany(orders);
      await db.collection('employee_churn').insertMany(employee_churn);
      console.log(`[MongoDB] Practice SQL datasets initialized.`);
    }

    // 6. Seed Guided Projects
    const projCount = await db.collection('guided_projects').countDocuments();
    if (projCount < guidedProjectsData.length) {
      for (const p of guidedProjectsData) {
        await db.collection('guided_projects').updateOne(
          { slug: p.slug },
          { $set: { ...p } },
          { upsert: true }
        );
      }
    }

    // Strictly enforce zero fake users
    await db.collection('users').deleteMany({ email: 'learner@analystpath.ai', id: 'usr_demo_01' });

  } catch (err) {
    console.warn('[MongoDB Seeding Note]:', err.message);
  }
}

async function logAuditEvent(dbOrNull, eventType, userId = null, ipAddress = null, details = null) {
  try {
    const id = 'aud_' + crypto.randomBytes(8).toString('hex');
    const doc = {
      id,
      event_type: eventType,
      user_id: userId,
      ip_address: ipAddress,
      details: details,
      created_at: new Date().toISOString()
    };
    const targetDb = getMongoDb();
    if (targetDb) {
      await targetDb.collection('audit_logs').insertOne(doc);
    }
  } catch (err) {
    console.warn('[Mongo Audit Log Note]:', err.message);
  }
}

async function generateScheduleForUser(dbOrNull, userId, hoursPerWeek = 10) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const tasks = [
    { title: "SQL Basics: Master SELECT & WHERE filtering", title_hi: "एसक्यूएल बेसिक्स: SELECT और WHERE से डेटा छांटना", course_id: "sql", dur: 45 },
    { title: "Practice: Solve 3 SQL filtering exercises", title_hi: "प्रैक्टिस: 3 एसक्यूएल फिल्टरिंग सवाल हल करें", course_id: "sql", dur: 30 },
    { title: "Excel Lookups: Practice XLOOKUP & INDEX/MATCH", title_hi: "एक्सेल: XLOOKUP और फॉर्मूले का अभ्यास", course_id: "excel", dur: 60 },
    { title: "Statistics: Mean vs Median in skewed distributions", title_hi: "स्टैटिस्टिक्स: Mean vs Median का अंतर समझें", course_id: "statistics", dur: 45 },
    { title: "SQL Joins: Master INNER and LEFT JOINs", title_hi: "एसक्यूएल जॉइन्स: दो टेबल्स को आपस में जोड़ना", course_id: "sql", dur: 60 },
    { title: "Portfolio: Start E-Commerce Sales & Margin Brief", title_hi: "पोर्टफोलियो प्रोजेक्ट: ई-कॉमर्स सेल्स केस स्टडी शुरू करें", course_id: "foundations", dur: 90 },
    { title: "Weekly Review: Partner check-in & mock interview", title_hi: "वीकली रिवीजन: पार्टनर चेक-इन और मॉक इंटरव्यू", course_id: "interview-prep", dur: 45 }
  ];

  const now = new Date();
  const scheduleItems = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const dayName = days[d.getDay() === 0 ? 6 : d.getDay() - 1];
    const task = tasks[i % tasks.length];
    const taskId = `sched_${userId}_${i}_${Date.now()}`;
    scheduleItems.push({
      id: taskId,
      user_id: userId,
      date_str: dateStr,
      day_name: dayName,
      task_title: task.title,
      task_title_hi: task.title_hi || null,
      course_id: task.course_id,
      duration_minutes: task.dur,
      is_completed: 0,
      is_rescheduled: 0,
      created_at: new Date().toISOString()
    });
  }

  const targetDb = getMongoDb();
  if (targetDb) {
    try {
      await targetDb.collection('study_schedule').deleteMany({ user_id: userId });
      await targetDb.collection('study_schedule').insertMany(scheduleItems);
    } catch (e) {
      console.warn('[Mongo Schedule Note]:', e.message);
    }
  }

  return scheduleItems;
}

/**
 * Domain Models Object providing clean ORM-like API for MongoDB
 */
const models = {
  users: {
    async findByEmail(email) {
      const db = getMongoDb();
      return await db.collection('users').findOne({ email: email.toLowerCase().trim() });
    },
    async findById(id) {
      const db = getMongoDb();
      return await db.collection('users').findOne({ id });
    },
    async create(userDoc) {
      const db = getMongoDb();
      return await db.collection('users').insertOne(userDoc);
    },
    async update(id, updates) {
      const db = getMongoDb();
      return await db.collection('users').updateOne({ id }, { $set: updates });
    },
    async delete(id) {
      const db = getMongoDb();
      return await db.collection('users').deleteOne({ id });
    }
  },
  sessions: {
    async create(userId, token, expiresAt) {
      const db = getMongoDb();
      const id = 'sess_' + crypto.randomBytes(8).toString('hex');
      return await db.collection('sessions').insertOne({ id, user_id: userId, token, expires_at: expiresAt });
    },
    async findByToken(token) {
      const db = getMongoDb();
      return await db.collection('sessions').findOne({ token, expires_at: { $gt: Date.now() } });
    },
    async deleteByToken(token) {
      const db = getMongoDb();
      return await db.collection('sessions').deleteMany({ token });
    }
  },
  courses: {
    async getAll() {
      const db = getMongoDb();
      const cursor = await db.collection('courses').find({});
      return await cursor.sort({ order_idx: 1 }).toArray();
    },
    async getBySlug(slug) {
      const db = getMongoDb();
      return await db.collection('courses').findOne({ slug });
    }
  },
  careerPaths: {
    async getAll() {
      const db = getMongoDb();
      const cursor = await db.collection('career_paths').find({});
      return await cursor.sort({ order_idx: 1 }).toArray();
    },
    async getBySlug(slug) {
      const db = getMongoDb();
      return await db.collection('career_paths').findOne({ slug });
    }
  }
};

module.exports = {
  connectToMongo,
  getMongoDb,
  isMongoConnected,
  seedMongoInitialData,
  initMongoIndexes,
  hashPassword,
  verifyPassword,
  logAuditEvent,
  generateScheduleForUser,
  flushLocalStoreSync,
  models,
  careerPathsData
};
