const app = require('./app');
const WSServer = require('./services/wsServer');

const port = 5000;
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}


const wsServer = new WSServer({ host: '0.0.0.0', port: 8080 });
console.log('WebSocket server running on port 8080');