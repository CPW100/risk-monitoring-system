# 1. High Level Architecture
This application is designed as a modern full-stack solution, separating concerns into three distinct tiers: a database for persistence, a backend for business logic and data serving, and a frontend for user interaction and data visualization. The architecture emphasizes maintainability and clear separation of responsibilities, as required by the assignment evaluation criteria.

## 1.1 Backend Architecture
The backend is built on Node.js and features two primary components working in tandem: a RESTful API server and a WebSocket server for real-time communication.

- REST API (Express.js): The Express server handles all standard HTTP requests. Its main responsibilities are client authentication and serving initial data to the dashboard. The core endpoints include:

    - `POST /api/login`: Authenticates a user.
    - `GET /api/positions/:clientId`: Retrieves a specific client's current stock positions.
    - `GET /api/margin-status/:clientId`: Calculates and returns a client's complete, up-to-date margin status, including portfolio value, net equity, and any margin shortfall.
    - `GET /api/chart-data`: Provides historical data for stock charts.
- WebSocket Server (`ws` library): The WebSocket server provides real-time updates to connected clients. After a client logs in, the frontend establishes a persistent connection. The server then pushes two types of messages:

    - `priceUpdate`: Sent whenever a new market price for a subscribed stock is received.
    - `marginUpdate`: Proactively sent whenever a price update triggers a change in the client's margin status.
- Service Layer: Business logic is abstracted into a service layer to keep the API and WebSocket handlers clean. `marginService.js` contains the core margin calculation logic, which is called by both the REST API and the WebSocket server. `stockService.js` is dedicated to fetching data from the external Twelve Data API.


## 1.2 Database Architecture
Persistence is handled by a self-contained SQLite database, chosen for its simplicity and ease of local setup. The schema is designed not only to support the core margin calculation requirements but also to provide historical data for charting, a feature implemented as an optional extra. The database consists of the following tables:

- `clients`: Stores user account information required for authentication.

    - Key Columns: client_id (Primary Key), name, email (Unique), password.
- `positions`: Tracks each client's individual stock holdings. 

    - Key Columns: position_id (Primary Key), client_id (Foreign Key), symbol, quantity, cost_basis. 
- `market_data`: Caches the latest fetched real-time price for each stock.  This minimizes redundant calls to the external API.

    - Key Columns: symbol (Primary Key), current_price, timestamp. 
- `margins`: Stores information related to each client's margin account. 

    - Key Columns: account_id (Primary Key), client_id (Foreign Key), loan, margin_requirement. 
- `chart_data`: Stores historical time-series data (OHLCV) for different stocks and time intervals, which is used to power the data visualization charts on the frontend.

    - Key Columns: symbol, interval, timestamp (Composite Primary Key), open, high, low, close, volume.
- `chart_metadata`: Acts as a caching layer for the historical chart data. It tracks the last time data for a specific stock and interval was fetched from the API to avoid unnecessary refetching.

    - Key Columns: symbol, interval (Composite Primary Key), last_updated.


## 1.3 Frontend Architecture
The frontend is a single-page application (SPA) built with React.

- Component Structure: The UI is broken down into logical components:

    - `App.jsx`: The root component that manages routing, the WebSocket connection lifecycle, and global authentication state.
    - `Login.jsx`: A dedicated page for handling user login.
    - `Dashboard.jsx`: The main interface where a logged-in user can view their portfolio positions and real-time margin status.
- Communication with Backend: The frontend communicates with the backend via two channels:

    - Initial Data Load (HTTP): Upon loading, the dashboard makes API calls to the REST endpoints to fetch the initial portfolio and margin state.
    - Real-Time Updates (WebSockets): After the initial load, the dashboard listens for `priceUpdate` and `marginUpdate` messages from the WebSocket server. This allows the UI to reflect changes instantly without user action, fulfilling the real-time update requirement. If a margin call is triggered, the UI highlights the relevant data in red.

## Architecture Diagram

### General Diagram
```
+------------------+      +----------------------+      +--------------------------------+
| External API     |      |       Backend        |      |       Frontend (React)         |
| (Twelve Data)    |----->| (Node.js / Express)  |----->|           (Browser)            |
+------------------+      +----------+-----------+      +--------------------------------+
                                      |
                                      |
                                      v
                             +-----------------+
                             |    Database     |
                             |    (SQLite)     |
                             +-----------------+
```

### Graphviz Diagram
[Architecture Diagram](https://drive.google.com/file/d/1-wjYC6i51GMSj5RbrS5uaf20DOxBzYqV/view?usp=sharing)

# 2. Tech Stack
This section explains the technology choices for the project as required.

## Tech Stack Explanation

| **Layer**               | **Strategic Choice for this Assignment**                                                                                                                                                                                                                                                                                                                                                             | **Scalability and Production Considerations**                                                                                                                                                                                                                                                                                                                                                   |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Backend**<br>Node.js & Express.js | Express.js was selected for its minimalist philosophy, enabling rapid development of a clean and understandable REST API. Its non-blocking, event-driven architecture is highly effective for I/O-heavy operations like fetching data from external stock market APIs. This allowed more focus on implementing the core business logic for margin calculation.                  | In production, the backend would evolve by migrating to TypeScript for static typing, reducing runtime errors. The application would be containerized using Docker and orchestrated with Kubernetes for consistent deployment and automatic scaling.                                                                                                                                            |
| **Database**<br>SQLite | SQLite was chosen for its serverless and zero-configuration nature, making the project easy to run and evaluate. It provided persistent storage without requiring a separate database server. The schema was designed to be logical and consistent, meeting database design criteria.                                                                              | SQLite lacks support for high write concurrency. In production, the data layer would be migrated to PostgreSQL, which offers better concurrency control, data integrity, and scalability. A modern ORM like Prisma would be used for type-safe and maintainable data access.                                                                                                                     |
| **Frontend**<br>React.js | React’s component-based architecture was ideal for building a dynamic and interactive dashboard. It allowed clean separation of UI concerns like position lists and margin status displays. Built-in hooks were sufficient for managing state within the scope of the project.                                                                             | For larger applications, state management would be centralized using Redux Toolkit or Zustand. A framework like Next.js might be used for features such as server-side rendering (SSR) and code splitting to enhance performance and initial load times.                                                                                                  |
| **Real-Time Communication**<br>ws Library | The `ws` library was used to implement a lightweight WebSocket server, demonstrating an understanding of real-time communication. This satisfied the requirement for live updates of prices and margin status in the dashboard.                                                                                                                  | For production-grade robustness, `ws` would be replaced with Socket.IO, which offers features like automatic reconnection, heartbeat monitoring, and message broadcasting to user-specific rooms. This would significantly improve the reliability and scalability of the real-time layer.                                                               |


# 3. Setup & Installation
Follow these steps to run the application locally.

**Prerequisites:**

- Node.js (v16 or later)
- npm or yarn

**Backend Setup:**

1. Navigate to the project's root/backend directory.
2. Install dependencies:

```
Bash

npm install
Run the server:
```
```
Bash

npm start
The REST API will be running on http://localhost:5000 and the WebSocket server on ws://localhost:8080.
```

**Frontend Setup:**

1. In a separate terminal, navigate to the frontend directory.
2. Install dependencies:

```
Bash

npm install
Run the development server:
```
```
Bash

npm run dev
```
The application will be accessible at `http://localhost:5173`.
3. **(Optional) To access the server from your phone or another device:**
You can expose the development server to your local network.

- First, find your computer's local IP address:

    - On Windows: Open Command Prompt and type `ipconfig`. Look for the "IPv4 Address".
    - On macOS/Linux: Open Terminal and type `ifconfig` or `ip addr`. Look for the "inet" address.
- Update the IP address in both .env files in the backend and frontend folder.
- Then, run the development server with the `--host` flag:

```
Bash

npm run dev -- --host
```
*(Note: The extra -- is necessary for npm to pass the flag to the Vite script).*

- **Finally, on your phone** (ensuring it's on the same Wi-Fi network), open a web browser and navigate to:
`http://<YOUR_COMPUTER_IP>:5173`
(Replace` <YOUR_COMPUTER_IP>` with the address you found above).


# 4. Usage
The database has been pre-seeded with several sample users to demonstrate the system's ability to handle various portfolio and risk scenarios. The following credentials can be used to log in and test the application.

| Name            | Email               | Password        |
|-----------------|---------------------|-----------------|
| John Doe        | john@example.com    | johndoe*        |
| Jane Smith      | jane@example.com    | janesmith*      |
| Leo Vinci       | leo@example.com     | leovinci*       |
| Charlie Munger  | charlie@example.com | charliemunger*  |
| Donald Trump    | donald@example.com  | donaldtrump*    |

## Demonstration Scenarios
Each user represents a unique use case to showcase the application's features and robustness.

**Scenario 1: Healthy, Low-Leverage Account**
- Log in as: `John Doe`
- Profile: This user holds a simple portfolio and a small loan, designed to mirror the example use case in the assignment documentation. 
- Expected Outcome: The dashboard will display a high net equity and a significant margin cushion. There will be no margin call, demonstrating the baseline calculation for a healthy account.

**Scenario 2: High-Leverage and Diversified Account**
- Log in as: `Jane Smith`
- Profile: This user has a highly diversified portfolio but has taken on a substantial loan, making them sensitive to market fluctuations.
- Expected Outcome: This account is designed to be at risk. The dashboard will likely display a margin shortfall and an active margin call alert highlighted in red, demonstrating the system's primary risk-detection functionality. 

**Scenario 3: New or Inactive Account**
- Log in as: `Leo Vinci`
- Profile: This user has a registered account but currently holds no positions and has no outstanding loan.
- Expected Outcome: The dashboard will cleanly display an empty state, showing "No positions available" or zero values for all financial metrics. This demonstrates the UI's ability to gracefully handle new users or empty portfolios without errors.

**Scenario 4: High Net Worth, No-Leverage Account**
- Log in as: `Charlie Munger`
- Profile: This user holds a high-value portfolio but has taken no loan.
- Expected Outcome: The system will show a large portfolio value and net equity, with a margin requirement of $0. This demonstrates the correct handling of accounts that do not use leverage.

**Scenario 5: Edge Case - Loan with No Assets**
- Log in as: `Donald Trump`
- Profile: This user represents an edge case where a client has a significant loan but no positions in their portfolio.
- Expected Outcome: The portfolio value will be $0, and the net equity will be negative. This will trigger an immediate and significant margin call, showcasing the system's robustness in handling unusual financial situations.


## API and Websocket Usage
The application can be used via the frontend dashboard or by interacting directly with the backend API.

**Dashboard Usage**
1. Open your browser to `http://localhost:5173`.
2. Use the login credentials provided in the "Demonstration Scenarios" section to authenticate.
3. The dashboard will display the selected client's portfolio and real-time margin status.

**API Usage**
The backend exposes a RESTful API on port `5000` and a WebSocket API on port `8080`. The API can be tested using standard tools like Postman or cURL.

**A) Using the Postman Collection (Recommended)**

A comprehensive Postman collection, `RiskMonitoringSystemAPI.postman_collection.json`, is included in the repository. This is the easiest way to test all API functionalities.

1. Import: Import the `RiskMonitoringSystemAPI.postman_collection.json` file into your Postman application.
2. Configuration: The collection is pre-configured with a `baseUrl` variable pointing to `http://localhost:5000/api`.
3. Execution Flow: The requests are designed to be run in order.
    - First, execute the 1.1 Successful Login request. Its test script will automatically save the logged-in user's `clientId` to a collection variable.
    - All subsequent requests (e.g., retrieving positions or margin status) will automatically use this `clientId` variable.

**B) WebSocket API Manual Testing**

The WebSocket server runs on ws://localhost:8080. You can use a WebSocket client like the one built into Postman to connect and send messages.

1. Connect: Establish a connection to ws://localhost:8080.
2. Register Client: After connecting, send a registration message. Replace {{clientId}} with the ID from the login step.
```
JSON

{
  "type": "register",
  "clientId": "{{clientId}}"
}
```
3. Subscribe to Symbols: Send a subscription message to start receiving price updates.
```
JSON

{
  "type": "subscribe",
  "symbols": ["AAPL", "MSFT", "BTC/USD"]
}
```
The server will now push priceUpdate and marginUpdate messages to your client in real-time.

## Reference to Usage:
[Postman Test And Output Reference](https://drive.google.com/file/d/1BKwmwXqiBMwCedhZqdYqidZI256gznWh/view?usp=drive_link)


# 5. Testing
A comprehensive testing strategy was implemented to ensure the reliability and correctness of the application's core components. The strategy includes unit tests for critical business logic and integration tests for the API and WebSocket servers, utilizing the Jest framework and its mocking capabilities.

This layered approach ensures that individual functions are correct in isolation and that they are integrated properly at the application's boundaries.

**1. Unit Testing: Core Margin Logic**
The most critical piece of business logic—the `calculateMarginStatus` function—was rigorously unit-tested in `marginService.test.js`.

- **Methodology:** To test the function in isolation, its external dependencies (`stockService` and the `db` module) were mocked. This allowed for providing controlled inputs and verifying the output against expected results without making real database or network requests.

- **Key Scenarios Validated:**

    - No Positions: Correctly returns default values and handles margin calls for clients with a loan but no assets.
    - Missing Price Data: Successfully triggers `fetchStockPrice` when a position's price is not available in the local database cache.
    - Accurate Margin Calculation: Correctly calculates portfolio value, net equity, and margin shortfall.
    - Margin Call Trigger: Accurately identifies when a margin shortfall is positive and a margin call should be triggered.
    - Error Handling: Gracefully handles and throws errors when database calls fail.

**2. Integration Testing: REST API Endpoints**
The entire REST API was tested at the integration level using `supertest` in `api.test.js`.

- **Methodology**: `supertest` was used to make live HTTP requests to the Express application. The database and service layers were mocked to test the API controller and routing logic in isolation, ensuring that requests are handled correctly and produce the right status codes and JSON responses.

- **Endpoints Covered:**

    - `GET /api/clients`
    - `GET /api/positions/:clientId`
    - `GET /api/margin-status/:clientId`
    - `GET /api/market-data (including tests for query parameter filtering)`
    - `GET /api/chart-data (including tests for caching logic)`
    - `POST /api/login`
For each endpoint, tests were written to validate both successful "happy path" responses and expected error states (e.g., 401 for invalid login, 500 for database errors).

**3. Integration Testing: WebSocket Server**
The real-time communication layer was tested in `wsServer.test.js` to validate its complex, event-driven logic.

- **Methodology**: The `ws` library itself was mocked to allow for simulating WebSocket client connections and mock incoming messages from the Twelve Data feed. This enabled testing the server's reactive logic without any actual network communication.

- **Key Functionalities Validated:**

- Connection Lifecycle: Correctly handles new client connections, registrations, and subscriptions.
- Data Broadcasting: Properly processes price updates from the (mocked) Twelve Data feed and broadcasts `priceUpdate` messages to subscribed clients.
- Proactive Margin Updates: Successfully triggers `calculateMarginStatus` and pushes marginUpdate messages to clients when a relevant price change occurs.
- Resource Management: Ensures client data is cleaned up properly upon disconnection.

## Running Test
```
cd backend
npm
```


# 6. Known Limitations & Performance Considerations
The technical choices for this project were made to deliver a feature-complete and stable application within the assignment's scope. This section transparently outlines the primary constraints encountered and details the engineering solutions implemented to manage them.

**1. Third-Party API Rate Limiting**
The application's primary constraint is its reliance on the free tier of the Twelve Data API, which imposes strict rate limits. A multi-faceted throttling and scheduling strategy was engineered to ensure the application remains robust and functional without exceeding these limits.

- **Initial Price Fetching (Margin Calculation):**
When a client's margin status is calculated, the system may need to fetch prices for multiple assets not present in the local cache. To manage this, the logic in `marginService.js` fetches these prices in controlled batches: a maximum of 8 symbols are requested at a time, and after each batch, the system enforces a 61-second pause before sending the next one, which might cause the display of *loading page* to persist for 1 minute. This ensures the application stays reliably within the API's per-minute request limit.

- **Real-Time WebSocket Subscriptions:**
A similar strategy is used for real-time updates. The WebSocket server (wsServer.js) rotates its active price subscriptions to provide broad coverage over time:

    - It subscribes to a maximum of 8 symbols at once.
    - This subscription list is refreshed every 2 minutes, cycling through all unique symbols required by connected clients. Hence, first time subscription might take 2 minutes to load due to the rotation subscription logic.
    - **Theoretical Throughput:** This rotation logic gives the system the capacity to provide quasi-real-time updates for approximately 240 unique symbols per hour (8 symbols / 2 minutes = 4 symbols/minute).

- **Historical Chart Data Caching:**
To ensure a fast user experience for chart visualizations and to further conserve API credits, historical chart data is cached in the database for 12 hours.

    - **Theoretical Throughput:** This allows the system to handle a maximum of 8 new (uncached) chart data requests per minute. Repeated requests for the same chart are served instantly from the database.

The trade-off of this comprehensive strategy is a potential delay (1 to 2 minutes) when fetching prices for new or untracked stocks, but it guarantees the application's stability and adherence to API constraints.

**2. Database for Demonstration Purposes**
For this project, SQLite was chosen to ensure simplicity and portability, allowing an evaluator to run the application without needing to install or configure a separate database server. While ideal for a take-home assignment, SQLite is not designed for the high-concurrency write operations of a large-scale production environment. In a real-world application, this data layer would be migrated to a client-server database like PostgreSQL or MySQL.

**Better Solution**
In a production setting, the current rate-limiting workarounds would be replaced by upgrading to a commercial-tier plan with the data provider. This would provide significantly higher API limits for true real-time data across all assets and allow for the removal of the complex throttling logic in favor of a simpler, more robust codebase.
