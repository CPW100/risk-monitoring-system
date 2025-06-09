-- clients table
CREATE TABLE IF NOT EXISTS clients (
    client_id UUID PRIMARY KEY DEFAULT (
        lower(hex(randomblob(4))) || '-' || 
        lower(hex(randomblob(2))) || '-4' || 
        substr(lower(hex(randomblob(2))), 2) || '-' || 
        substr('89ab', abs(random()) % 4 + 1, 1) || 
        substr(lower(hex(randomblob(2))), 2) || '-' || 
        lower(hex(randomblob(6)))
    ),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
);

-- positions table
CREATE TABLE IF NOT EXISTS positions (
    position_id UUID PRIMARY KEY DEFAULT (
        lower(hex(randomblob(4))) || '-' || 
        lower(hex(randomblob(2))) || '-4' || 
        substr(lower(hex(randomblob(2))), 2) || '-' || 
        substr('89ab', abs(random()) % 4 + 1, 1) || 
        substr(lower(hex(randomblob(2))), 2) || '-' || 
        lower(hex(randomblob(6)))
    ),
    client_id UUID NOT NULL,
    symbol TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    cost_basis REAL NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

-- market data table
CREATE TABLE IF NOT EXISTS market_data (
    symbol TEXT PRIMARY KEY,
    current_price REAL NOT NULL,
    timestamp TEXT NOT NULL
);

-- margins table
CREATE TABLE IF NOT EXISTS margins (
    account_id UUID PRIMARY KEY DEFAULT (
        lower(hex(randomblob(4))) || '-' || 
        lower(hex(randomblob(2))) || '-4' || 
        substr(lower(hex(randomblob(2))), 2) || '-' || 
        substr('89ab', abs(random()) % 4 + 1, 1) || 
        substr(lower(hex(randomblob(2))), 2) || '-' || 
        lower(hex(randomblob(6)))
    ),
    client_id UUID NOT NULL,
    loan REAL NOT NULL,
    margin_requirement REAL DEFAULT 0,
    FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE IF NOT EXISTS chart_data (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume INTEGER,
    PRIMARY KEY (symbol, interval, timestamp)
);

CREATE TABLE IF NOT EXISTS chart_metadata (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    last_updated INTEGER NOT NULL,
    PRIMARY KEY (symbol, interval)
);
