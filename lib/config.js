'use strict';
module.exports = {
  appName: process.env.APP_NAME || 'PumpSathi',
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '12h',
  ownerMobile: process.env.OWNER_MOBILE || '9999999999',
  ownerPassword: process.env.OWNER_PASSWORD || 'admin123',
  ownerFirmName: process.env.OWNER_FIRM_NAME || 'Aditya Filling Station',
  wa: {
    provider: process.env.WA_PROVIDER || 'meta',
    token: process.env.WA_TOKEN || '',
    phoneId: process.env.WA_PHONE_ID || '',
    apiVersion: process.env.WA_API_VERSION || 'v21.0',
    twilioSid: process.env.TWILIO_SID || '',
    twilioToken: process.env.TWILIO_TOKEN || '',
    twilioFrom: process.env.TWILIO_FROM || '',
  },
};
