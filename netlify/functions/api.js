'use strict';
const serverless = require('serverless-http');
const { connectLambda } = require('@netlify/blobs');
const app = require('../../lib/app');

const sls = serverless(app);

// serverless-http bypasses Netlify's automatic Blobs wiring, so connect the
// Blobs context from the Lambda event ourselves before the app runs.
module.exports.handler = async (event, context) => {
  try { connectLambda(event); } catch (e) { /* falls back to manual/env config in store.js */ }
  return sls(event, context);
};
