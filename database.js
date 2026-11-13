// database.js - Unified MongoDB-Backed Database Layer for AnalystPath AI
let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  DatabaseSync = null;
}

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

// =========================================================================
// UNIVERSAL PURE JAVASCRIPT IN-MEMORY ENGINE (FOR VERCEL SERVERLESS)
// =========================================================================
function getDocVal(row, colName) {
  if (!row) return undefined;
  if (row[colName] !== undefined) return row[colName];
  if (colName.includes('.')) {
    const field = colName.split('.').pop();
    if (row[field] !== undefined) return row[field];
  }
  return undefined;
}

function evalCondition(row, condStr, args, argIndexRef, allTables) {
  let cond = condStr.trim();
  if (!cond) return true;

  const notInMatch = cond.match(/([a-zA-Z0-9_\.]+)\s+NOT\s+IN\s*\(\s*SELECT\s+([a-zA-Z0-9_\.]+)\s+FROM\s+([a-zA-Z0-9_\.]+)(?:\s+WHERE\s+([\s\S]+?))?\s*\)/i);
  if (notInMatch) {
    const leftCol = notInMatch[1];
    const subCol = notInMatch[2];
    const subTable = notInMatch[3];
    const subWhere = notInMatch[4];
    const leftVal = getDocVal(row, leftCol);
    const subRows = allTables[subTable] || [];
    const matchedSubRows = subWhere ? subRows.filter(sr => evalWhere(sr, subWhere, args, argIndexRef, allTables)) : subRows;
    const excludedVals = matchedSubRows.map(sr => getDocVal(sr, subCol));
    return !excludedVals.some(v => String(v) === String(leftVal));
  }

  const inSubMatch = cond.match(/([a-zA-Z0-9_\.]+)\s+IN\s*\(\s*SELECT\s+([a-zA-Z0-9_\.]+)\s+FROM\s+([a-zA-Z0-9_\.]+)(?:\s+WHERE\s+([\s\S]+?))?\s*\)/i);
  if (inSubMatch) {
    const leftCol = inSubMatch[1];
    const subCol = inSubMatch[2];
    const subTable = inSubMatch[3];
    const subWhere = inSubMatch[4];
    const leftVal = getDocVal(row, leftCol);
    const subRows = allTables[subTable] || [];
    const matchedSubRows = subWhere ? subRows.filter(sr => evalWhere(sr, subWhere, args, argIndexRef, allTables)) : subRows;
    const includedVals = matchedSubRows.map(sr => getDocVal(sr, subCol));
    return includedVals.some(v => String(v) === String(leftVal));
  }

  const compMatch = cond.match(/([a-zA-Z0-9_\.]+)\s*(>=|<=|!=|=|>|<|LIKE|IS NOT|IS)\s*([\s\S]+)/i);
  if (!compMatch) return true;

  const col = compMatch[1].trim();
  const op = compMatch[2].trim().toUpperCase();
  let right = compMatch[3].trim();

  let nocase = false;
  if (/COLLATE\s+NOCASE/i.test(right)) {
    nocase = true;
    right = right.replace(/COLLATE\s+NOCASE/i, '').trim();
  }

  let rightVal;
  if (right === '?') {
    rightVal = args[argIndexRef.idx++];
  } else if (right.toUpperCase() === 'NULL') {
    rightVal = null;
  } else if (right.toUpperCase() === 'CURRENT_TIMESTAMP') {
    rightVal = new Date().toISOString();
  } else if (/^\d+$/.test(right)) {
    rightVal = parseInt(right, 10);
  } else if (/^\d+\.\d+$/.test(right)) {
    rightVal = parseFloat(right);
  } else if (/^['"].*['"]$/.test(right)) {
    rightVal = right.slice(1, -1);
  } else {
    rightVal = right;
  }

  const leftVal = getDocVal(row, col);

  let l = leftVal;
  let r = rightVal;
  if (typeof l === 'number' || typeof r === 'number') {
    l = Number(l);
    r = Number(r);
  }

  if (op === 'IS') return leftVal === null || leftVal === undefined;
  if (op === 'IS NOT') return leftVal !== null && leftVal !== undefined;

  if (nocase && typeof leftVal === 'string' && typeof rightVal === 'string') {
    const lStr = leftVal.toLowerCase();
    const rStr = rightVal.toLowerCase();
    if (op === '=') return lStr === rStr;
    if (op === '!=') return lStr !== rStr;
  }

  if (op === '=') {
    if (rightVal === null) return leftVal === null || leftVal === undefined;
    return String(leftVal) === String(rightVal);
  }
  if (op === '!=') return String(leftVal) !== String(rightVal);
  if (op === '>') return l > r;
  if (op === '>=') return l >= r;
  if (op === '<') return l < r;
  if (op === '<=') return l <= r;
  if (op === 'LIKE') {
    const pattern = String(rightVal).replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp(`^${pattern}$`, 'i').test(String(leftVal || ''));
  }
  return true;
}

function evalWhere(row, whereClause, args, argIndexRef, allTables) {
  if (!whereClause || !whereClause.trim()) return true;
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < whereClause.length; i++) {
    const ch = whereClause[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && whereClause.substr(i, 5).toUpperCase() === ' AND ') {
      parts.push(current.trim());
      current = '';
      i += 4;
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    if (!evalCondition(row, part, args, argIndexRef, allTables)) return false;
  }
  return true;
}

class PureJsDb {
  constructor() {
    this.tables = {};
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      try {
        this.tables = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'));
      } catch (e) {
        this.tables = {};
      }
    }
    if (!this.tables.courses || this.tables.courses.length === 0) {
      this.tables.courses = (coursesData || []).map(c => ({ ...c, _id: String(c.id) }));
      this.tables.career_paths = (careerPathsData || []).map(cp => ({ ...cp, _id: String(cp.id) }));
      this.tables.lessons = (sampleLessonsData || []).map(l => ({ ...l, _id: String(l.id) }));
      this.tables.quizzes = (quizzesData || []).map(q => ({ ...q, _id: String(q.id) }));
      this.tables.interview_questions = (interviewQuestionsData || []).map(iq => ({ ...iq, _id: String(iq.id) }));
      this.tables.guided_projects = (guidedProjectsData || []).map(gp => ({ ...gp, _id: String(gp.id) }));
      this.tables.questions_bank = (questionsData || []).map(qd => ({ ...qd, _id: String(qd.id) }));
      this.tables.lesson_videos_and_tests = (lessonVideosAndTests || []).map(vt => ({ ...vt, _id: String(vt.id) }));
      this.tables.customers = (customers || []).map(c => ({ ...c, _id: String(c.id) }));
      this.tables.products = (products || []).map(p => ({ ...p, _id: String(p.id) }));
      this.tables.orders = (orders || []).map(o => ({ ...o, _id: String(o.id) }));
      this.tables.employee_churn = (employee_churn || []).map(ec => ({ ...ec, _id: String(ec.id) }));
      this.tables.users = [];
      this.tables.sessions = [];
      this.tables.audit_logs = [];
    }
  }

  exec(sql) { return this; }

  collection(colName) {
    return getMongoDb().collection(colName);
  }

  prepare(sql) {
    const self = this;
    const cleanSql = sql.trim().replace(/\s+/g, ' ');
    const upper = cleanSql.toUpperCase();

    if (upper.includes('SQLITE_MASTER')) {
      const names = Object.keys(self.tables).sort();
      return {
        all: () => names.map(name => ({ name })),
        get: (name) => names.includes(name) ? { name } : undefined,
        run: () => ({ changes: 0 })
      };
    }

    if (upper.startsWith('PRAGMA TABLE_INFO')) {
      const m = cleanSql.match(/PRAGMA\s+table_info\(["`]?([a-zA-Z0-9_]+)["`]?\)/i);
      const colName = m ? m[1] : '';
      const rows = self.tables[colName] || [];
      const cols = rows.length > 0 ? Object.keys(rows[0]) : ['id'];
      return {
        all: () => cols.map(c => ({ name: c, type: 'TEXT' })),
        get: () => cols.length > 0 ? { name: cols[0], type: 'TEXT' } : undefined,
        run: () => ({ changes: 0 })
      };
    }

    if (upper.startsWith('PRAGMA')) {
      return { all: () => [], get: () => undefined, run: () => ({ changes: 0 }) };
    }

    if (upper.startsWith('INSERT')) {
      const mInsert = cleanSql.match(/INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+["`]?([a-zA-Z0-9_]+)["`]?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (mInsert) {
        const tableName = mInsert[1];
        const cols = mInsert[2].split(',').map(c => c.trim().replace(/["`]/g, ''));
        const valPlaceholders = mInsert[3].split(',').map(v => v.trim());

        return {
          run: (...args) => {
            if (!self.tables[tableName]) self.tables[tableName] = [];
            const doc = {};
            let argIdx = 0;
            for (let i = 0; i < cols.length; i++) {
              const col = cols[i];
              const ph = valPlaceholders[i];
              if (ph === '?') doc[col] = args[argIdx++];
              else if (/^\d+$/.test(ph)) doc[col] = parseInt(ph, 10);
              else if (/^'.*'$/.test(ph)) doc[col] = ph.slice(1, -1);
              else doc[col] = ph;
            }
            if (!doc.id) doc.id = 'doc_' + crypto.randomBytes(8).toString('hex');
            if (!doc._id) doc._id = String(doc.id);
            const existingIdx = self.tables[tableName].findIndex(r => String(r.id) === String(doc.id));
            if (existingIdx >= 0) self.tables[tableName][existingIdx] = { ...self.tables[tableName][existingIdx], ...doc };
            else self.tables[tableName].push(doc);
            syncTableToMongo(self, tableName);
            return { changes: 1, lastInsertRowid: doc.id };
          },
          all: () => [],
          get: () => undefined
        };
      }
    }

    if (upper.startsWith('UPDATE')) {
      const mUpdate = cleanSql.match(/UPDATE\s+["`]?([a-zA-Z0-9_]+)["`]?\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
      if (mUpdate) {
        const tableName = mUpdate[1];
        const setClause = mUpdate[2];
        const whereClause = mUpdate[3];

        return {
          run: (...args) => {
            const rows = self.tables[tableName] || [];
            const assignParts = setClause.split(',').map(s => s.trim());
            let argIdx = 0;
            const assignOps = [];
            for (const ap of assignParts) {
              const [colRaw, valRaw] = ap.split('=').map(x => x.trim());
              const col = colRaw.replace(/["`]/g, '');
              if (valRaw === '?') {
                const curIdx = argIdx++;
                assignOps.push(doc => { doc[col] = args[curIdx]; });
              } else if (valRaw.toUpperCase() === 'NULL') {
                assignOps.push(doc => { doc[col] = null; });
              } else if (valRaw.toUpperCase() === 'CURRENT_TIMESTAMP') {
                assignOps.push(doc => { doc[col] = new Date().toISOString(); });
              } else if (/^\d+$/.test(valRaw)) {
                const num = parseInt(valRaw, 10);
                assignOps.push(doc => { doc[col] = num; });
              } else {
                assignOps.push(doc => { doc[col] = valRaw.replace(/^['"]|['"]$/g, ''); });
              }
            }

            const whereArgs = args.slice(argIdx);
            let changes = 0;
            for (const row of rows) {
              const argRef = { idx: 0 };
              if (!whereClause || evalWhere(row, whereClause, whereArgs, argRef, self.tables)) {
                for (const op of assignOps) op(row);
                changes++;
              }
            }
            if (changes > 0) syncTableToMongo(self, tableName);
            return { changes };
          },
          all: () => [],
          get: () => undefined
        };
      }
    }

    if (upper.startsWith('DELETE')) {
      const mDelete = cleanSql.match(/DELETE\s+FROM\s+["`]?([a-zA-Z0-9_]+)["`]?(?:\s+WHERE\s+([\s\S]+))?$/i);
      if (mDelete) {
        const tableName = mDelete[1];
        const whereClause = mDelete[2];
        return {
          run: (...args) => {
            const rows = self.tables[tableName] || [];
            const initialCount = rows.length;
            if (!whereClause) {
              self.tables[tableName] = [];
            } else {
              self.tables[tableName] = rows.filter(r => {
                const argRef = { idx: 0 };
                return !evalWhere(r, whereClause, args, argRef, self.tables);
              });
            }
            const changes = initialCount - self.tables[tableName].length;
            if (changes > 0) syncTableToMongo(self, tableName);
            return { changes };
          },
          all: () => [],
          get: () => undefined
        };
      }
    }

    return {
      all: (...args) => self._select(cleanSql, args),
      get: (...args) => {
        const rows = self._select(cleanSql, args);
        return rows.length > 0 ? rows[0] : undefined;
      },
      run: () => ({ changes: 0 })
    };
  }

  _select(sql, args) {
    const cleanSql = sql.trim().replace(/\s+/g, ' ');

    const countMatch = cleanSql.match(/^SELECT\s+COUNT\(\*\)\s*(?:AS\s+([a-zA-Z0-9_]+))?\s+FROM\s+([\s\S]+)/i);
    if (countMatch) {
      const alias = countMatch[1] || 'count';
      const rows = this._resolveTableAndJoin(countMatch[2], args);
      return [{ [alias]: rows.length }];
    }

    const mSelect = cleanSql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([\s\S]+)$/i);
    if (!mSelect) return [];

    const selectColsStr = mSelect[1].trim();
    let rows = this._resolveTableAndJoin(mSelect[2].trim(), args);

    if (selectColsStr === '*' || selectColsStr.includes('.*')) return rows;

    const colSpecs = selectColsStr.split(',').map(s => s.trim());
    return rows.map(r => {
      const out = {};
      for (const cs of colSpecs) {
        const asMatch = cs.match(/([\s\S]+?)\s+AS\s+([a-zA-Z0-9_]+)/i);
        if (asMatch) {
          out[asMatch[2].trim()] = getDocVal(r, asMatch[1].trim().replace(/["`]/g, ''));
        } else {
          const rawCol = cs.trim().replace(/["`]/g, '');
          const field = rawCol.includes('.') ? rawCol.split('.').pop() : rawCol;
          out[field] = getDocVal(r, rawCol);
        }
      }
      return out;
    });
  }

  _resolveTableAndJoin(fromRest, args) {
    const m = fromRest.match(/^([\s\S]+?)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+(\d+))?$/i);
    if (!m) return [];

    const fromClause = m[1].trim();
    const whereClause = m[2] ? m[2].trim() : null;
    const orderClause = m[3] ? m[3].trim() : null;
    const limitVal = m[4] ? parseInt(m[4], 10) : null;

    const joinTokens = fromClause.split(/\s+(?:LEFT\s+)?JOIN\s+/i);
    const [baseTableName] = joinTokens[0].trim().split(/\s+/);
    const cleanBaseTable = baseTableName.replace(/["`]/g, '');

    let rows = (this.tables[cleanBaseTable] || []).map(r => ({ ...r }));

    for (let i = 1; i < joinTokens.length; i++) {
      const joinPart = joinTokens[i].trim();
      const onMatch = joinPart.match(/([a-zA-Z0-9_]+)(?:\s+([a-zA-Z0-9_]+))?\s+ON\s+([\s\S]+)/i);
      if (!onMatch) continue;

      const joinTable = onMatch[1].replace(/["`]/g, '');
      const onComp = onMatch[3].trim().match(/([a-zA-Z0-9_\.]+)\s*=\s*([a-zA-Z0-9_\.]+)/);
      if (onComp) {
        const leftKey = onComp[1].trim();
        const rightKey = onComp[2].trim();
        const joinRows = this.tables[joinTable] || [];

        const joined = [];
        for (const r of rows) {
          const lVal = getDocVal(r, leftKey);
          const matches = joinRows.filter(jr => String(getDocVal(jr, rightKey)) === String(lVal));
          if (matches.length > 0) {
            for (const matchRow of matches) joined.push({ ...r, ...matchRow });
          } else {
            joined.push({ ...r });
          }
        }
        rows = joined;
      }
    }

    if (whereClause) {
      rows = rows.filter(r => {
        const argRef = { idx: 0 };
        return evalWhere(r, whereClause, args, argRef, this.tables);
      });
    }

    if (orderClause) {
      const orderClauses = orderClause.split(',').map(s => s.trim());
      rows.sort((a, b) => {
        for (const oc of orderClauses) {
          const parts = oc.split(/\s+/);
          const colRaw = parts[0].replace(/["`]/g, '');
          const dir = (parts[1] || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
          const aVal = getDocVal(a, colRaw);
          const bVal = getDocVal(b, colRaw);
          if (aVal < bVal) return -1 * dir;
          if (aVal > bVal) return 1 * dir;
        }
        return 0;
      });
    }

    if (limitVal !== null && !isNaN(limitVal)) {
      rows = rows.slice(0, limitVal);
    }

    return rows;
  }
}

// =========================================================================
// INITIALIZE DATABASE
// =========================================================================
function getDb() {
  if (dbInstance) return dbInstance;

  console.log('🍃 [Database] Initializing MongoDB-backed data layer...');

  let memDb = null;
  if (DatabaseSync) {
    try {
      memDb = new DatabaseSync(':memory:');
      initSchema(memDb);

      if (fs.existsSync(LOCAL_STORE_PATH)) {
        try {
          loadFromMongoStore(memDb);
        } catch (err) {
          seedInitialData(memDb);
          syncAllToMongoStore(memDb);
        }
      } else {
        seedInitialData(memDb);
        syncAllToMongoStore(memDb);
      }

      const originalPrepare = memDb.prepare.bind(memDb);
      memDb.prepare = function (sql) {
        const stmt = originalPrepare(sql);
        const upper = sql.trim().toUpperCase();
        const isWrite = upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE') || upper.startsWith('REPLACE');

        if (isWrite) {
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

      memDb.collection = function (colName) {
        return getMongoDb().collection(colName);
      };
    } catch (e) {
      memDb = null;
    }
  }

  if (!memDb) {
    console.log('🍃 [Database] Using Universal Pure JavaScript In-Memory Engine (Vercel Ready)');
    memDb = new PureJsDb();
  }

  dbInstance = memDb;
  return dbInstance;
}

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
      return doc;
    });

    let store = {};
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      try {
        store = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'));
      } catch (e) {}
    }
    store[tableName] = docs;
    try {
      fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {}

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
  } catch (err) {}
}

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
  } catch (e) {}
}

function loadFromMongoStore(memDb) {
  memDb.exec('PRAGMA foreign_keys = OFF;');
  const store = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'));
  for (const [colName, docs] of Object.entries(store)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;
    const tableExists = memDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(colName);
    if (!tableExists) continue;

    const colsInfo = memDb.prepare(`PRAGMA table_info("${colName}")`).all();
    const colNames = colsInfo.map(c => c.name);

    for (const d of docs) {
      const record = {};
      for (const c of colNames) {
        let val = d[c];
        if (val === undefined) val = null;
        if (val !== null && typeof val === 'object') val = JSON.stringify(val);
        else if (typeof val === 'boolean') val = val ? 1 : 0;
        record[c] = val;
      }

      const placeholders = colNames.map(() => '?').join(', ');
      const quotedCols = colNames.map(c => `"${c}"`).join(', ');
      const values = colNames.map(c => record[c]);

      try {
        memDb.prepare(`INSERT OR REPLACE INTO "${colName}" (${quotedCols}) VALUES (${placeholders})`).run(...values);
      } catch (e) {}
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
        logAuditEvent(database, 'account_elevated', user.id, '127.0.0.1', 'Configured via ADMIN_EMAIL');
      }
    } catch (e) {}
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
  // Fresh initialization fallback
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
  careerPathsData,
  syncTableToMongo
};
