/**
 * @file server.js
 * @description This is the main entry point for the application.
 * It is responsible for initializing and starting both the Express REST API server
 * and the separate WebSocket server for real-time communication.
 */

const app = require('./app');
const WSServer = require('./services/wsServer');

const port = 5000;

// The check ensures that the server starts automatically only in development or production environments.
// When running automated tests (where NODE_ENV is typically 'test'), the server will NOT
// start here. This allows testing frameworks like Jest or Supertest to import the 'app'
// and start/stop it programmatically within test suites.
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

// --- WebSocket Server Initialization ---
const wsServer = new WSServer({ host: '0.0.0.0', port: 8080 });
console.log('WebSocket server running on port 8080');