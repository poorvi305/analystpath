// api/index.js - Vercel Serverless Function Entry Point for AnalystPath AI
const { connectToMongo } = require('../mongo_database');
const { requestHandler } = require('../server');

let handler;

try {
  const express = require('express');
  const app = express();

  // Middleware: ensure MongoDB connection is active
  app.use(async (req, res, next) => {
    try {
      await connectToMongo();
    } catch (e) {
      console.warn('[MongoDB Serverless Connect Note]', e.message);
    }
    next();
  });

  // Delegate all requests to platform request handler
  app.use((req, res) => {
    return requestHandler(req, res);
  });

  handler = app;
} catch (e) {
  // Direct Serverless Handler fallback
  handler = async (req, res) => {
    try {
      await connectToMongo();
    } catch (err) {
      console.warn('[MongoDB Serverless Connect Note]', err.message);
    }
    return requestHandler(req, res);
  };
}

module.exports = handler;
