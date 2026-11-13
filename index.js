// Universal Serverless Function Entry Point for AnalystPath AI
const fs = require('fs');
const path = require('path');
const url = require('url');

// Serverless Read-Only Filesystem & Avatar Directory Protection
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

let loadError = null;
let connectToMongo = null;
let requestHandler = null;

try {
  ({ connectToMongo } = require('./mongo_database'));
} catch (e1) {
  try {
    ({ connectToMongo } = require('../mongo_database'));
  } catch (e2) {
    console.warn('[MongoDatabase load note]', e2.message);
  }
}

try {
  ({ requestHandler } = require('./server'));
} catch (e1) {
  try {
    ({ requestHandler } = require('../server'));
  } catch (e2) {
    loadError = e1 || e2;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

let mongoInitPromise = null;

module.exports = async (req, res) => {
  // If server.js failed to load, display clear diagnostics instead of crashing
  if (loadError) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Module Load Failure',
      message: loadError.message,
      stack: loadError.stack
    }, null, 2));
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Serve static files directly if not an API endpoint
  if (!pathname.startsWith('/api')) {
    const rootDir = __dirname;
    const publicDir = fs.existsSync(path.join(rootDir, 'public')) ? path.join(rootDir, 'public') : rootDir;
    let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);

    if (!fs.existsSync(filePath)) {
      const baseName = path.basename(pathname);
      const fallback = path.join(publicDir, baseName);
      if (fs.existsSync(fallback)) {
        filePath = fallback;
      } else if (fs.existsSync(path.join(rootDir, baseName))) {
        filePath = path.join(rootDir, baseName);
      } else {
        filePath = path.join(publicDir, 'index.html');
        if (!fs.existsSync(filePath)) filePath = path.join(rootDir, 'index.html');
      }
    }

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(data);
      } catch (e) {}
    }
  }

  // Connect to MongoDB asynchronously
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
  } catch (err) {
    console.error('[Serverless Request Error]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Serverless invocation error: ' + err.message, stack: err.stack }));
    }
  }
};
