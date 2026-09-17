const functions = require('firebase-functions');
const app = require('./server-app');
exports.app = functions.https.onRequest(app);
