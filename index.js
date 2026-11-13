// Universal Serverless Function Entry Point for AnalystPath AI
const fs = require('fs');

// Serverless Read-Only Filesystem Protection
try {
  const origMkdirSync = fs.mkdirSync;
  fs.mkdirSync = function (targetPath, options) {
    try {
      return origMkdirSync.call(fs, targetPath, options);
    } catch (err) {
      if (err && (err.code === 'EROFS' || err.code === 'EACCES' || err.code === 'EPERM')) {
        return undefined;
      }
      throw err;
    }
  };
} catch (e) {}

let connectToMongo, requestHandler;

try {
  ({ connectToMongo } = require('./mongo_database'));
  ({ requestHandler } = require('./server'));
} catch (e) {
  ({ connectToMongo } = require('../mongo_database'));
  ({ requestHandler } = require('../server'));
}

let mongoInitPromise = null;

module.exports = async (req, res) => {
  if (!mongoInitPromise) {
    mongoInitPromise = connectToMongo().catch(err => {
      console.warn('[MongoDB Serverless Connect Note]', err.message);
      mongoInitPromise = null;
    });
  }
  try {
    await mongoInitPromise;
  } catch (e) {
    // Non-fatal fallback
  }

  try {
    return await requestHandler(req, res);
  } catch (err) {
    console.error('[Serverless Request Error]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Serverless invocation error: ' + err.message }));
    }
  }
};
