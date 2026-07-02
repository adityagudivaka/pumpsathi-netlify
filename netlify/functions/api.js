'use strict';
const serverless = require('serverless-http');
const app = require('../../lib/app');
module.exports.handler = serverless(app);
