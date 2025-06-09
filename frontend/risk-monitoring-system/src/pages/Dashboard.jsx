import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import api from '../api/api';

/**
 * A custom tooltip component for Recharts' LineChart.
 * @param {boolean} active If the tooltip is currently active.
 * @param {object} payload The data point payload associated with the active tooltip.
 * @param {string|number} label The label of the data point.
 * @returns {React.ReactElement} A tooltip element with the relevant data point information.
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length > 0) {
    const { open, high, low, close, volume } = payload[0].payload;
    return (
      <div style={{ backgroundColor: '#fff', border: '1px solid #ccc', padding: 10 }}>
        <strong>{new Date(label).toLocaleString()}</strong>
        <div>Open: ${open.toFixed(2)}</div>
        <div>High: ${high.toFixed(2)}</div>
        <div>Low: ${low.toFixed(2)}</div>
        <div>Close: ${close.toFixed(2)}</div>
        <div>Volume: {volume ? volume.toLocaleString() : 0}</div>
      </div>
    );
  }

  return null;
};


/**
 * Dashboard component for displaying client portfolio and margin status.
 * Manages WebSocket connections for real-time updates and displays a price chart.
 * 
 * @param {Object} props - The props for the Dashboard component.
 * @param {Object} props.client - The client data object containing client details.
 * @param {Function} props.onLogout - Callback function to handle logout.
 * @param {WebSocket} props.ws - WebSocket instance for real-time data communication.
 * 
 * @returns {React.ReactElement} A rendered dashboard component.
 */
export default function Dashboard({ client, onLogout, ws }) {
  
  const [positions, setPositions] = useState([]);
  const [marginStatus, setMarginStatus] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [interval, setInterval] = useState('1day');
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [lastUpdatedSymbol, setLastUpdatedSymbol] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const lastSubscribedSymbolsRef = useRef([]);
  const initialSubscriptionSentRef = useRef(false);

  const fetchChartData = useCallback(async () => {
    if (!selectedSymbol) return;
    try {
      const res = await api.get(`/chart-data?symbol=${selectedSymbol}&interval=${interval}`);
      if (Array.isArray(res.data)) {
        const formatted = res.data.map(d => ({
          timestamp: d.timestamp,
          date: new Date(d.timestamp).toLocaleDateString(),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume
        }));
        setChartData(formatted);
      } else {
        setChartData([]);
      }
    } catch (err) {
      console.error('Failed to fetch chart data:', err);
      setChartData([]);
    }
  }, [selectedSymbol, interval]);

  // Fetch client positions on mount
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch all data in parallel for efficiency
        const [positionsRes, marginRes] = await Promise.all([
          api.get(`/positions/${client.client_id}`),
          api.get(`/margin-status/${client.client_id}`)
        ]);
        
        const positionsData = positionsRes.data;
        const marginData = marginRes.data;

        // Use margin data to get initial prices if available
        const initialPositions = positionsData.map(pos => {
            const marginPosition = marginData.positions?.find(p => p.symbol === pos.symbol);
            return marginPosition ? { ...pos, currentPrice: marginPosition.currentPrice } : pos;
        });

        setPositions(initialPositions);
        setMarginStatus(marginData);

        if (initialPositions.length > 0 && !selectedSymbol) {
            setSelectedSymbol(initialPositions[0].symbol);
        }

      } catch (err) {
        console.error('Error fetching initial data:', err);
        setError('Failed to load dashboard data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [client.client_id]);

  // Subscribe when symbols change
  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const symbols = Array.isArray(positions) ? positions.map(pos => pos.symbol) : [];
    const isSame = symbols.length === lastSubscribedSymbolsRef.current.length &&
                   symbols.every((sym, idx) => sym === lastSubscribedSymbolsRef.current[idx]);
                   
    // Send a subscription if the symbols have changed OR if the first subscription hasn't been sent yet
    const timerId = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (!isSame || !initialSubscriptionSentRef.current) {
          ws.send(JSON.stringify({ type: 'subscribe', clientId: client.client_id, symbols }));
          lastSubscribedSymbolsRef.current = symbols;
          initialSubscriptionSentRef.current = true; // Mark that the initial subscription has been sent
        }
      }
    }, 1000)
    return () => clearTimeout(timerId);
  }, [ws, positions, client.client_id]);

  // WebSocket event handlers
  useEffect(() => {
    if (!ws) return;
    /**
     * Handles WebSocket messages from the server.
     * @param {MessageEvent} event - The WebSocket message event.
     * @private
     */
    const handleMessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {

        // Update current price in position table
        case 'priceUpdate':
          setLastUpdatedSymbol(msg.symbol);
          setPositions((prevPositions) => 
            Array.isArray(prevPositions)
                ? prevPositions.map(p => {
                    if (p.symbol === msg.symbol) {
                    return { ...p, currentPrice: msg.price };
                    }
                    return p;
                })
                : []
          );
          setTimeout(() => setLastUpdatedSymbol(null), 500);
          break;

        // Update margin status
        case 'marginUpdate':
          setMarginStatus(msg);
          break;
        default:
          console.warn('Unknown WS message type:', msg.type);
      }
    };

    /**
     * Handles the WebSocket connection open event.
     * @private
     */
    const handleOpen = () => setConnectionStatus('Connected');
    const handleClose = () => setConnectionStatus('Disconnected');
    const handleError = () => setConnectionStatus('Error');

    // Add event listeners
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('open', handleOpen);
    ws.addEventListener('close', handleClose);
    ws.addEventListener('error', handleError);

    // Clean up event listeners
    return () => {
      ws.removeEventListener('message', handleMessage);
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('close', handleClose);
      ws.removeEventListener('error', handleError);
    };
  }, [ws]);

  // Update chart data
  useEffect(() => {
    fetchChartData();
  }, [fetchChartData]);

  if (loading) {
    return <div style={styles.centered}>Loading Dashboard...</div>;
  }
  if (error) {
    return <div style={{ ...styles.centered, ...styles.errorText }}>{error}</div>;
  }


  return (
    <div className="dashboard-container" style={styles.container}>
      <header style={styles.header}>
        {/* Welcome message */}
        <h2>Welcome, {client.name}</h2>
        <div>
          {/* Websocket Connection Indicator */}
          <span style={{...styles.statusIndicator, backgroundColor: connectionStatus === 'Connected' ? '#28a745' : '#dc3545'}}></span>
          {connectionStatus}
        </div>
        {/* Logout button */}
        <button onClick={onLogout} style={styles.logoutButton}>Logout</button>
      </header>

      {/* Render margin status */}
      {marginStatus && (
          <section style={styles.marginSection}>
            <h3>Margin Status</h3>
            <div style={styles.marginGrid}>
              {[
                { label: 'Portfolio Value', value: `$${marginStatus.portfolioValue.toFixed(2)}` },
                { label: 'Loan Amount', value: `$${marginStatus.loanAmount.toFixed(2)}` },
                { label: 'Net Equity', value: `$${marginStatus.netEquity.toFixed(2)}` },
                { label: 'Margin Requirement', value: `$${marginStatus.marginRequirement.toFixed(2)}` },
                {
                  label: 'Margin Shortfall',
                  value: `$${marginStatus.marginShortfall.toFixed(2)}`,
                  highlight: marginStatus.marginShortfall > 0
                },
                {
                  label: 'Margin Call',
                  value: marginStatus.marginCall ? 'YES' : 'NO',
                  highlight: marginStatus.marginCall
                },
                { label: 'Date', value: new Date(marginStatus.timestamp).toLocaleDateString() },
                { label: 'Time', value: new Date(marginStatus.timestamp).toLocaleTimeString() },
              ].map(({ label, value, highlight }) => (
                <div key={label} style={{ ...styles.marginItem, ...(highlight ? styles.highlight : {}) }}>
                  <strong>{label}:</strong> {value}
                </div>
              ))}
            </div>
          </section>
      )}

      <section style={styles.content}>

        {/* Render position table */}
        <aside style={styles.sidebar}>
          <h3>Your Positions</h3>
          <div style={styles.positionTableWrapper}>
            <table style={styles.positionTable}>
              <thead>
                <tr>
                  <th style={styles.th}>Position</th>
                  <th style={styles.th}>Quantity</th>
                  <th style={styles.th}>Current Price</th>
                </tr>
              </thead>
              <tbody>
                {/* Add a check for empty positions array */}
                {Array.isArray(positions) && positions.length > 0 ? (
                  positions.map(pos => (
                    <tr
                      key={pos.symbol}
                      onClick={() => setSelectedSymbol(pos.symbol)}
                      style={{
                        ...styles.tr,
                        backgroundColor: pos.symbol === selectedSymbol ? '#d0e0ff' : 'transparent',
                        cursor: 'pointer'
                      }}
                    >
                      <td style={styles.td}>{pos.symbol}</td>
                      <td style={styles.td}>{pos.quantity}</td>
                      <td 
                        style={styles.td}
                        className={pos.symbol === lastUpdatedSymbol ? 'price-flash' : ''}
                      >
                        {pos.currentPrice ? `$${pos.currentPrice.toFixed(2)}` : 'N/A'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3" style={styles.centeredTd}>
                      No positions available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </aside>

        <main style={styles.mainContent}>
          <h3>Price Chart: {selectedSymbol || 'Select a symbol'}</h3>

          <div style={styles.intervalButtons}>

            {/* Render interval buttons */}
            {['1day', '1week', '1month', '1year'].map(intv => (
              <button
                key={intv}
                onClick={() => setInterval(intv)}
                style={{
                  ...styles.intervalButton,
                  fontWeight: interval === intv ? 'bold' : 'normal'
                }}
              >
                {intv}
              </button>
            ))}
          </div>
          
          <div style={styles.chartWrapper}>

            {/* Render price chart */}
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={(ts) => new Date(ts).toLocaleDateString()} />
                <YAxis domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="close" stroke="#8884d8" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </main>
      </section>
    </div>
  );
}

// Add this new style to your existing styles object
const styles = {
    container: {
    fontFamily: 'Arial, sans-serif',
    padding: '1rem',
    margin: '0 auto',
    maxWidth: '100%',
    overflowX: 'hidden',
    boxSizing: 'border-box'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
    flexWrap: 'wrap',
    gap: '0.5rem'
  },
  logoutButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#c33',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer'
  },
  content: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    width: '100%',
    overflow: 'hidden',
    boxSizing: 'border-box'
  },
  sidebar: {
    flex: '1 1 250px',
    minWidth: 0,
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    border: '1px solid #ddd',
    borderRadius: 4,
    padding: '0.5rem',
    maxHeight: '400px',
    overflowY: 'auto'
  },
  positionTable: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    borderBottom: '2px solid #ddd',
    padding: '0.5rem',
    textAlign: 'left',
    backgroundColor: '#f7f7f7',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
  tr: {
    borderBottom: '1px solid #eee',
  },
  td: {
    padding: '0.5rem',
  },
  positionTableWrapper: {
    maxWidth: '100%',
    overflowX: 'auto',
  },
  marginSection: {
    width: '100%',
    marginBottom: '1rem',
    padding: '0.5rem 1rem',
    border: '1px solid #bbb',
    borderRadius: 4,
    backgroundColor: '#fafafa',
    boxSizing: 'border-box',
  },

  marginGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '8px 24px',
  },

  marginItem: {
    minWidth: 160,
    fontSize: '0.9rem',
    overflowWrap: 'break-word',
    wordBreak: 'break-word'
  },
  mainContent: {
    flex: '2 1 600px',
    minWidth: 0,
    border: '1px solid #ddd',
    borderRadius: 4,
    padding: '1rem'
  },
  highlight: {
    backgroundColor: '#ffe5e5',
    color: '#a00',
    padding: '4px 8px',
    borderRadius: 4,
    fontWeight: 'bold',
    border: '1px solid #f88',
  },
  intervalButtons: {
    marginBottom: '0.5rem',
    display: 'flex',
    gap: '0.5rem'
  },
  intervalButton: {
    padding: '0.3rem 0.6rem',
    border: '1px solid #888',
    borderRadius: 4,
    backgroundColor: 'white',
    cursor: 'pointer'
  },
  chartWrapper: {
    width: '100%',
    minWidth: 0,
    height: 300,
    overflow: 'hidden'
  },
  centered: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '80vh',
    fontSize: '1.5rem',
    color: '#555',
  },
  errorText: {
    color: '#c33',
  },
  statusIndicator: {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    marginRight: '8px'
  },
  centeredTd: {
      padding: '1rem',
      textAlign: 'center',
      color: '#777'
  }
};