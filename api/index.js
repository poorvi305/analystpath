// api/index.js - Universal Serverless Function for AnalystPath AI
const fs = require('fs');

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

module.exports = async (req, res) => {
  if (initError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Initialization Error', message: initError.message }));
  }

  if (connectToMongo && !mongoInitPromise) {
    mongoInitPromise = connectToMongo().catch(err => {
      console.warn('[MongoDB Connect Note]', err.message);
      mongoInitPromise = null;
    });
  }
  try {
    if (mongoInitPromise) await mongoInitPromise;
  } catch (e) {}

  try {
    return await requestHandler(req, res);
  } catch (reqError) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'API Error', message: reqError.message }));
    }
  }
};
