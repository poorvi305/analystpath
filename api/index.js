// api/index.js - Universal Serverless Function for AnalystPath AI
const fs = require('fs');
const path = require('path');

// Safe filesystem monkey-patch for read-only Vercel environment
try {
  const origMkdirSync = fs.mkdirSync;
  fs.mkdirSync = function (targetPath, options) {
    try {
      return origMkdirSync.call(fs, targetPath, options);
    } catch (err) {
      return undefined;
    }
  };
} catch (e) {}

let requestHandler = null;
let connectToMongo = null;
let initError = null;

try {
  const server = require('../server');
  requestHandler = server.requestHandler || server;
} catch (err1) {
  try {
    const server = require('./server');
    requestHandler = server.requestHandler || server;
  } catch (err2) {
    initError = err1 || err2;
    console.error('[AnalystPath Server Load Error]', initError);
  }
}

try {
  const mongoDb = require('../mongo_database');
  connectToMongo = mongoDb.connectToMongo;
} catch (e1) {
  try {
    const mongoDb = require('./mongo_database');
    connectToMongo = mongoDb.connectToMongo;
  } catch (e2) {}
}

let mongoInitPromise = null;
const DEMO_TOKEN = '065833a1316881fb94960d5f825601d6c684376fa7577d5cafab99984331a8d9';

module.exports = async (req, res) => {
  if (initError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Backend Initialization Error',
      message: initError.message,
      stack: initError.stack
    }, null, 2));
  }

  // Restore true original path from Vercel rewrite
  const urlParts = (req.url || '').split('?');
  const searchParams = new URLSearchParams(urlParts[1] || '');
  if (searchParams.has('path')) {
    req.url = '/api/' + searchParams.get('path');
  } else if (req.headers && req.headers['x-matched-path']) {
    req.url = req.headers['x-matched-path'];
  }

  // Allow guest visitors to explore public courses, careers, and questions without auth error
  if (!req.headers['authorization'] && !req.headers['x-session-token']) {
    const p = req.url.split('?')[0];
    if (p === '/api/courses' || p === '/api/career-paths' || p === '/api/questions') {
      req.headers['authorization'] = `Bearer ${DEMO_TOKEN}`;
    }
  }

  // Ensure database initialization
  if (connectToMongo && !mongoInitPromise) {
    mongoInitPromise = connectToMongo().catch(err => {
      console.warn('[MongoDB Serverless Connect Note]', err.message);
      mongoInitPromise = null;
    });
  }
  try {
    if (mongoInitPromise) await mongoInitPromise;
  } catch (e) {}

  try {
    return await requestHandler(req, res);
  } catch (reqError) {
    console.error('[API Request Error]', reqError);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'API Execution Error',
        message: reqError.message
      }));
    }
  }
};
