const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

let dbInstance = null;

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function initializeAndSeed(db, callback) {
    db.serialize(() => {
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        db.exec(schema, (err) => {
            if (err) return console.error('Error creating tables:', err);
            
            console.log('Database tables created successfully. Seeding data...');

            const client1Id = generateUUID();
            const client2Id = generateUUID();
            const client3Id = generateUUID();
            const client4Id = generateUUID();
            const client5Id = generateUUID();

            const clients = [
                { client_id: client1Id, name: 'John Doe', email: 'john@example.com', password: 'johndoe*' },
                { client_id: client2Id, name: 'Jane Smith', email: 'jane@example.com', password: 'janesmith*' },
                { client_id: client3Id, name: 'Leo Vinci', email: 'leo@example.com', password: 'leovinci*' },
                { client_id: client4Id, name: 'Charlie Munger', email: 'charlie@example.com', password: 'charliemunger*' },
                { client_id: client5Id, name: 'Donald Trump', email: 'donald@example.com', password: 'donaldtrump*' },
            ];

            const positions = [
                { position_id: generateUUID(), client_id: client1Id, symbol: 'BTC/USD', quantity: 100, cost_basis: 27350.42 },
                { position_id: generateUUID(), client_id: client1Id, symbol: 'ETH/USD', quantity: 50, cost_basis: 1780.15 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'SOL/USD', quantity: 30, cost_basis: 24.67 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'BTC/USD', quantity: 10, cost_basis: 27350.42 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'DOGE/USD', quantity: 10, cost_basis: 0.07 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'AAPL', quantity: 50, cost_basis: 145.32 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'TSLA', quantity: 15, cost_basis: 730.11 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'PEP', quantity: 15, cost_basis: 170.25 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'BAC', quantity: 15, cost_basis: 27.50 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'NVDA', quantity: 15, cost_basis: 420.90 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'KO', quantity: 15, cost_basis: 62.75 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'WMT', quantity: 15, cost_basis: 140.40 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'COST', quantity: 15, cost_basis: 490.12 },
                { position_id: generateUUID(), client_id: client2Id, symbol: 'PYPL', quantity: 15, cost_basis: 70.35 },
                { position_id: generateUUID(), client_id: client4Id, symbol: 'BTC/USD', quantity: 500, cost_basis: 27350.42 },
                { position_id: generateUUID(), client_id: client4Id, symbol: 'BRK.A', quantity: 1000, cost_basis: 740396.00 },
            ];

            const marginAccounts = [
                { account_id: generateUUID(), client_id: client1Id, loan: 3000 },
                { account_id: generateUUID(), client_id: client2Id, loan: 1000000 },
                { account_id: generateUUID(), client_id: client5Id, loan: 20000000 },
            ];

            const insertClient = db.prepare("INSERT INTO clients (client_id, name, email, password) VALUES (?, ?, ?, ?)");
            clients.forEach(c => insertClient.run(c.client_id, c.name, c.email, c.password));
            insertClient.finalize();

            const insertPosition = db.prepare("INSERT INTO positions (position_id, client_id, symbol, quantity, cost_basis) VALUES (?, ?, ?, ?, ?)");
            positions.forEach(p => insertPosition.run(p.position_id, p.client_id, p.symbol, p.quantity, p.cost_basis));
            insertPosition.finalize();

            const insertMargin = db.prepare("INSERT INTO margins (account_id, client_id, loan) VALUES (?, ?, ?)");
            marginAccounts.forEach(m => insertMargin.run(m.account_id, m.client_id, m.loan));
            insertMargin.finalize((err) => {
                if (err) console.error('Seeding error:', err);
                else console.log('Database seeded successfully.');
                if (callback) callback();
            });
        });
    });
}

function getDatabase({ inMemory = false, onReady = () => {} } = {}) {
    if (dbInstance) {
        return Promise.resolve(dbInstance);
    }
    
    const dbPath = inMemory ? ':memory:' : path.join(__dirname, 'risk-monitor.db');
    
    dbInstance = new sqlite3.Database(dbPath, (err) => {
        if (err) return console.error('DB Connection Error:', err);
        
        dbInstance.get("SELECT name FROM sqlite_master WHERE type='table' AND name='clients'", (err, row) => {
            if (err) return console.error('Error checking tables:', err);
            
            if (!row) {
                console.log('Initializing new database...');
                initializeAndSeed(dbInstance, () => onReady(dbInstance));
            } else {
                console.log('Database already initialized.');
                onReady(dbInstance);
            }
        });
    });

    return dbInstance;
}


module.exports = getDatabase();