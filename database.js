// database.js - Unified MongoDB-Backed Database Layer
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  connectToMongo,
  getMongoDb,
  isMongoConnected,
  seedMongoInitialData,
  initMongoIndexes,
  hashPassword,
  verifyPassword,
  logAuditEvent,
  generateScheduleForUser,
  careerPathsData
} = require('./mongo_database');
const { coursesData, sampleLessonsData, quizzesData, interviewQuestionsData, guidedProjectsData, questionsData } = require('./seed_data');
const { lessonVideosAndTests } = require('./lesson_videos_and_tests_data');
const { customers, products, orders, employee_churn } = require('./sample_datasets');

const LOCAL_STORE_PATH = path.join(__dirname, 'mongo_data_store.json');
let dbInstance = null;

const JSON_FIELDS = [
  'day_to_day', 'transferable_skills', 'essential_skills', 'useful_additions',
  'portfolio_projects', 'learning_roadmap', 'salaries_by_location', 'hiring_employers',
  'career_progression', 'skills_gap_checklist', 'recommended_courses', 'prerequisites',
  'learning_objectives', 'key_terms', 'formula_sheet', 'worked_examples', 'common_mistakes',
  'external_resources', 'practice_exercise', 'video_transcript', 'video_transcript_hi',
  'lesson_test', 'options', 'rubric', 'key_points', 'steps', 'skills', 'weak_topics'
];

/**
 * Initialize Unified Database (backed by MongoDB)
 */
function getDb() {
  if (dbInstance) return dbInstance;

  console.log('🍃 [Database] Initializing MongoDB-backed data layer...');

  // Use in-memory synchronized engine for SQL query compatibility & practice console
  const memDb = new DatabaseSync(':memory:');
  initSchema(memDb);

  // Load from MongoDB document store if available
  if (fs.existsSync(LOCAL_STORE_PATH)) {
    try {
      console.log('🍃 [Database] Loading records from MongoDB document store (mongo_data_store.json)...');
      loadFromMongoStore(memDb);
    } catch (err) {
      console.warn('⚠️  [Database Warning] Could not load from mongo_data_store.json, seeding fresh:', err.message);
      seedInitialData(memDb);
      syncAllToMongoStore(memDb);
    }
  } else {
    console.log('🍃 [Database] First run: seeding initial data and creating MongoDB document store...');
    seedInitialData(memDb);
    syncAllToMongoStore(memDb);
  }

  // Intercept prepare to sync writes to MongoDB store & MongoDB Atlas
  const originalPrepare = memDb.prepare.bind(memDb);
  memDb.prepare = function (sql) {
    const stmt = originalPrepare(sql);
    const upper = sql.trim().toUpperCase();
    const isWrite = upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE') || upper.startsWith('REPLACE');

    if (isWrite) {
      // Extract target table name
      let tableName = null;
      const mInsert = sql.match(/INSERT\s+INTO\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
      const mUpdate = sql.match(/UPDATE\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
      const mDelete = sql.match(/DELETE\s+FROM\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
      if (mInsert) tableName = mInsert[1];
      else if (mUpdate) tableName = mUpdate[1];
      else if (mDelete) tableName = mDelete[1];

      const originalRun = stmt.run.bind(stmt);
      stmt.run = function (...args) {
        const result = originalRun(...args);
        if (tableName) {
          syncTableToMongo(memDb, tableName);
        }
        return result;
      };
    }

    return stmt;
  };

  // Attach native MongoDB collection accessor
  memDb.collection = function (colName) {
    const mDb = getMongoDb();
    return mDb.collection(colName);
  };

  dbInstance = memDb;
  return dbInstance;
}

/**
 * Sync a single table's rows to MongoDB document store & Atlas
 */
function syncTableToMongo(memDb, tableName) {
  try {
    const rows = memDb.prepare(`SELECT * FROM "${tableName}"`).all();
    const docs = rows.map(r => {
      const doc = { ...r };
      if (doc.id) doc._id = String(doc.id);
      for (const f of JSON_FIELDS) {
        if (doc[f] && typeof doc[f] === 'string') {
          try { doc[f] = JSON.parse(doc[f]); } catch (e) {}
        }
      }
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

    // Write to local MongoDB JSON store
    let store = {};
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      try {
        store = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'));
      } catch (e) {}
    }
    store[tableName] = docs;
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');

    // If connected to MongoDB Atlas, push async
    if (isMongoConnected()) {
      const atlasDb = getMongoDb();
      if (atlasDb) {
        atlasDb.collection(tableName).deleteMany({}).then(() => {
          if (docs.length > 0) {
            atlasDb.collection(tableName).insertMany(docs, { ordered: false }).catch(() => {});
          }
        }).catch(() => {});
      }
    }
  } catch (err) {
    // Non-blocking sync error
  }
}

/**
 * Sync all tables to MongoDB JSON store
 */
function syncAllToMongoStore(memDb) {
  try {
    const tables = memDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const store = {};
    for (const t of tables) {
      const rows = memDb.prepare(`SELECT * FROM "${t.name}"`).all();
      store[t.name] = rows.map(r => {
        const doc = { ...r };
        if (doc.id) doc._id = String(doc.id);
        for (const f of JSON_FIELDS) {
          if (doc[f] && typeof doc[f] === 'string') {
            try { doc[f] = JSON.parse(doc[f]); } catch (e) {}
          }
        }
        return doc;
      });
    }
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Sync All Warning]:', e.message);
  }
}

/**
 * Load documents from MongoDB store into memory
 */
function loadFromMongoStore(memDb) {
  memDb.exec('PRAGMA foreign_keys = OFF;');
  const store = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'));
  for (const [colName, docs] of Object.entries(store)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;

    // Check if table exists
    const tableExists = memDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(colName);
    if (!tableExists) continue;

    // Get table column names
    const colsInfo = memDb.prepare(`PRAGMA table_info("${colName}")`).all();
    const colNames = colsInfo.map(c => c.name);

    for (const d of docs) {
      const record = {};
      for (const c of colNames) {
        let val = d[c];
        if (val === undefined) val = null;
        if (val !== null && typeof val === 'object') {
          val = JSON.stringify(val);
        } else if (typeof val === 'boolean') {
          val = val ? 1 : 0;
        }
        record[c] = val;
      }

      const placeholders = colNames.map(() => '?').join(', ');
      const quotedCols = colNames.map(c => `"${c}"`).join(', ');
      const values = colNames.map(c => record[c]);

      try {
        memDb.prepare(`INSERT OR REPLACE INTO "${colName}" (${quotedCols}) VALUES (${placeholders})`).run(...values);
      } catch (e) {
        // Ignore individual insert error
      }
    }
  }
  memDb.exec('PRAGMA foreign_keys = ON;');
}

function checkInitialAdmin(database) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && adminEmail.trim()) {
    try {
      const email = adminEmail.trim();
      const user = database.prepare("SELECT id, role FROM users WHERE email = ? COLLATE NOCASE").get(email);
      if (user && user.role !== 'admin') {
        database.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
        console.log(`[Admin] Granted admin role to configured ADMIN_EMAIL: ${email}`);
        logAuditEvent(database, 'account_elevated', user.id, '127.0.0.1', 'Configured via ADMIN_EMAIL');
      }
    } catch (e) {
      console.warn('[Check Admin Warning]', e.message);
    }
  }
}

function initSchema(database) {
  const schemaPath = path.join(__dirname, 'all_schemas.sql');
  if (fs.existsSync(schemaPath)) {
    const ddl = fs.readFileSync(schemaPath, 'utf8');
    database.exec(ddl);
  }
}

function seedInitialData(database) {
  // Courses
  const insertCourse = database.prepare(`
    INSERT OR REPLACE INTO courses (id, slug, title, title_hi, domain, level, icon, estimated_hours, order_idx, prerequisites, description, description_hi, learning_objectives, final_project_teaser)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of coursesData) {
    insertCourse.run(c.id, c.slug, c.title, c.title_hi, c.domain, c.level, c.icon, c.estimated_hours, c.order_idx, JSON.stringify(c.prerequisites), c.description, c.description_hi, JSON.stringify(c.learning_objectives), c.final_project_teaser);
  }

  // Career Paths
  const insertCp = database.prepare(`
    INSERT OR REPLACE INTO career_paths (
      id, slug, title, title_hi, domain, tech_intensity, non_tech_friendly,
      summary, summary_hi, day_to_day, background_applicability, transferable_skills,
      essential_skills, useful_additions, portfolio_projects, entry_requirements,
      common_barriers, learning_roadmap, salaries_by_location, pay_variation_factors,
      hiring_employers, career_progression, skills_gap_checklist, recommended_courses,
      disclaimer, information_checked_date, order_idx
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `);
  for (const cp of careerPathsData) {
    insertCp.run(
      cp.id, cp.slug, cp.title, cp.title_hi, cp.domain, cp.tech_intensity, cp.non_tech_friendly,
      cp.summary, cp.summary_hi,
      typeof cp.day_to_day === 'string' ? cp.day_to_day : JSON.stringify(cp.day_to_day),
      cp.background_applicability,
      typeof cp.transferable_skills === 'string' ? cp.transferable_skills : JSON.stringify(cp.transferable_skills),
      typeof cp.essential_skills === 'string' ? cp.essential_skills : JSON.stringify(cp.essential_skills),
      typeof cp.useful_additions === 'string' ? cp.useful_additions : JSON.stringify(cp.useful_additions),
      typeof cp.portfolio_projects === 'string' ? cp.portfolio_projects : JSON.stringify(cp.portfolio_projects),
      cp.entry_requirements, cp.common_barriers,
      typeof cp.learning_roadmap === 'string' ? cp.learning_roadmap : JSON.stringify(cp.learning_roadmap),
      typeof cp.salaries_by_location === 'string' ? cp.salaries_by_location : JSON.stringify(cp.salaries_by_location),
      cp.pay_variation_factors,
      typeof cp.hiring_employers === 'string' ? cp.hiring_employers : JSON.stringify(cp.hiring_employers),
      typeof cp.career_progression === 'string' ? cp.career_progression : JSON.stringify(cp.career_progression),
      typeof cp.skills_gap_checklist === 'string' ? cp.skills_gap_checklist : JSON.stringify(cp.skills_gap_checklist),
      typeof cp.recommended_courses === 'string' ? cp.recommended_courses : JSON.stringify(cp.recommended_courses),
      cp.disclaimer, cp.information_checked_date, cp.order_idx
    );
  }

  // Lessons
  const insertLesson = database.prepare(`
    INSERT OR REPLACE INTO lessons (
      id, course_id, title, title_hi, slug, estimated_minutes, order_idx,
      content_en, content_hi, key_terms, formula_sheet, worked_examples,
      common_mistakes, external_resources, practice_exercise,
      video_url, video_duration, video_summary, video_script, video_transcript,
      video_url_hi, video_duration_hi, video_summary_hi, video_script_hi, video_transcript_hi,
      video_status, video_provider, avatar_model, lesson_test
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);
  for (const l of sampleLessonsData) {
    const v = lessonVideosAndTests[l.id] || {};
    insertLesson.run(
      l.id, l.course_id, l.title, l.title_hi, l.slug, l.estimated_minutes, l.order_idx,
      l.content_en, l.content_hi,
      JSON.stringify(l.key_terms || []), JSON.stringify(l.formula_sheet || []), JSON.stringify(l.worked_examples || []),
      JSON.stringify(l.common_mistakes || []), JSON.stringify(l.external_resources || []), JSON.stringify(l.practice_exercise || null),
      v.video_url || null, v.video_duration || '15:00', v.video_summary || '', v.video_script || '', JSON.stringify(v.video_transcript || []),
      v.video_url_hi || null, v.video_duration_hi || v.video_duration || '15:00', v.video_summary_hi || '', v.video_script_hi || '', JSON.stringify(v.video_transcript_hi || []),
      v.video_status || 'ready', v.video_provider || 'heygen', v.avatar_model || 'ananya-data-mentor', JSON.stringify(v.lesson_test || [])
    );
  }

  // Datasets
  const insertCustomer = database.prepare(`INSERT OR REPLACE INTO customers VALUES (?, ?, ?, ?, ?, ?)`);
  for (const c of customers) insertCustomer.run(c.customer_id, c.full_name, c.city, c.country, c.signup_date, c.segment);

  const insertProduct = database.prepare(`INSERT OR REPLACE INTO products VALUES (?, ?, ?, ?, ?)`);
  for (const p of products) insertProduct.run(p.product_id, p.product_name, p.category, p.unit_price, p.in_stock);

  const insertOrder = database.prepare(`INSERT OR REPLACE INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const o of orders) insertOrder.run(o.order_id, o.customer_id, o.product_id, o.order_date, o.quantity, o.total_amount, o.status);

  const insertChurn = database.prepare(`INSERT OR REPLACE INTO employee_churn VALUES (?, ?, ?, ?, ?)`);
  for (const ec of employee_churn) insertChurn.run(ec.emp_id, ec.department, ec.monthly_salary, ec.tenure_months, ec.churned);

  // Guided Projects
  const insertProject = database.prepare(`
    INSERT OR REPLACE INTO guided_projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of guidedProjectsData) {
    insertProject.run(p.id, p.slug, p.title, p.title_hi, p.domain, p.difficulty, p.business_problem, p.dataset_description, p.tools_required, JSON.stringify(p.rubric), JSON.stringify(p.steps));
  }
}

if (require.main === module) {
  getDb();
}

module.exports = {
  getDb,
  connectToMongo,
  getMongoDb,
  isMongoConnected,
  hashPassword,
  verifyPassword,
  generateScheduleForUser,
  logAuditEvent,
  checkInitialAdmin,
  careerPathsData
};
