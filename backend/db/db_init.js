/**
 * @file This module handles the initialization, connection, and seeding of a SQLite database.
 * It ensures a single database instance (singleton pattern) is used throughout the application.
 */

// Import required Node.js modules.
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

let dbInstance = null;

/**
 * Generates a random UUID (Universally Unique Identifier) version 4.
 * This UUID is comprised of 32 hexadecimal digits displayed in five groups
 * separated by hyphens in the form 8-4-4-4-12. The version 4 UUIDs are
 * randomly generated.
 * 
 * @returns {string} A randomly generated UUID string.
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Initializes and seeds the database with schema and initial data.
 * 
 * This function reads the database schema from a SQL file, executes it to create
 * the necessary tables, and then inserts a predefined set of client, position, and
 * margin account records into the database.
 * 
 * @param {sqlite3.Database} db - The SQLite database instance to be initialized and seeded.
 * @param {function} callback - A callback function to be called once seeding is complete.
 * 
 * The function logs an error if table creation or data seeding fails, otherwise it logs
 * success messages. Predefined data includes multiple clients, their positions across 
 * various symbols, and margin accounts for some clients.
 */
function initializeAndSeed(db, callback) {
    db.serialize(() => {
        // Read the database schema from an external SQL file.
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

        // Execute the schema to create tables.
        db.exec(schema, (err) => {
            if (err) return console.error('Error creating tables:', err);
            
            console.log('Database tables created successfully. Seeding data...');

            // --- SEED DATA ---
            // Generate unique IDs for clients to ensure relational integrity.
            const client1Id = generateUUID();
            const client2Id = generateUUID();
            const client3Id = generateUUID();
            const client4Id = generateUUID();
            const client5Id = generateUUID();

            // Define initial client data.
            const clients = [
                { client_id: client1Id, name: 'John Doe', email: 'john@example.com', password: 'johndoe*' },
                { client_id: client2Id, name: 'Jane Smith', email: 'jane@example.com', password: 'janesmith*' },
                { client_id: client3Id, name: 'Leo Vinci', email: 'leo@example.com', password: 'leovinci*' },
                { client_id: client4Id, name: 'Charlie Munger', email: 'charlie@example.com', password: 'charliemunger*' },
                { client_id: client5Id, name: 'Donald Trump', email: 'donald@example.com', password: 'donaldtrump*' },
            ];

            // Define initial position data, linking them to the clients.
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

            // Define initial margin account data.
            const marginAccounts = [
                { account_id: generateUUID(), client_id: client1Id, loan: 3000 },
                { account_id: generateUUID(), client_id: client2Id, loan: 1000000 },
                { account_id: generateUUID(), client_id: client5Id, loan: 20000000 },
            ];

            // --- DATABASE INSERTION ---
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

/**
 * Returns a SQLite database instance with the Risk Monitor schema and data.
 * If the database doesn't exist, it will be created and seeded with initial data.
 * If the database does exist, the existing instance will be returned.
 * 
 * @param {Object} [options] - Optional parameters.
 * @param {boolean} [options.inMemory=false] - Whether to create an in-memory database.
 * @param {function} [options.onReady=() => {}] - A callback function to be called once the database is ready.
 * 
 * @returns {sqlite3.Database} The SQLite database instance.
 */
function getDatabase({ inMemory = false, onReady = () => {} } = {}) {

    // Return the existing instance if it has already been created.
    if (dbInstance) {
        return Promise.resolve(dbInstance);
    }
    
    // Determine the database path: ':memory:' for in-memory, or a file path.
    const dbPath = inMemory ? ':memory:' : path.join(__dirname, 'risk-monitor.db');
    
    // Create a new database connection.
    dbInstance = new sqlite3.Database(dbPath, (err) => {
        if (err) return console.error('DB Connection Error:', err);
        
        // Check if the 'clients' table exists to determine if the DB is already initialized.
        dbInstance.get("SELECT name FROM sqlite_master WHERE type='table' AND name='clients'", (err, row) => {
            if (err) return console.error('Error checking tables:', err);
            
            // If the table doesn't exist, initialize and seed the database.
            if (!row) {
                console.log('Initializing new database...');
                initializeAndSeed(dbInstance, () => onReady(dbInstance));
            } else {
                console.log('Database already initialized.');
                onReady(dbInstance);
            }
        });
    });

    // Return the database instance. Note that operations should be chained via callbacks
    // or promises to ensure the connection is established before use.
    return dbInstance;
}

// Export the singleton instance of the database, ready for use in other modules.
module.exports = getDatabase();