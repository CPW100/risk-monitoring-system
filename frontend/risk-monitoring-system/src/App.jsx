import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

export default function App() {
  const [client, setClient] = useState(null);
  const ws = useRef(null);

  // Restore client session and connect WS if needed
  useEffect(() => {
    // localStorage.removeItem('client');
    const stored = localStorage.getItem('client');
    if (stored) {
      const clientData = JSON.parse(stored);
      setClient(clientData);
      connectWebSocket(clientData.client_id);
    }
  }, []);

  // Connect WebSocket and register client
  const connectWebSocket = (clientId) => {
    ws.current = new WebSocket('ws://192.168.1.83:8080'); // update URL as needed

    ws.current.onopen = () => {
      ws.current.send(JSON.stringify({ type: 'register', clientId }));
      console.log('WebSocket connected and registered', clientId);
    };

    ws.current.onclose = () => {
      console.log('WebSocket disconnected');
    };

    ws.current.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    // Add your onmessage handling here or pass ws.current to Dashboard
  };

  const handleLogin = (clientData) => {
    setClient(clientData);
    localStorage.setItem('client', JSON.stringify(clientData));
    connectWebSocket(clientData.client_id);
  };

  const handleLogout = () => {
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    setClient(null);
    localStorage.removeItem('client');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (ws.current) {
        ws.current.close();
        ws.current = null;
      }
    };
  }, []);

  return (
    <Routes>
      <Route
        path="/login"
        element={client ? <Navigate to="/" /> : <Login onLogin={handleLogin} />}
      />
      <Route
        path="/"
        element={client ? <Dashboard client={client} onLogout={handleLogout} ws={ws.current} /> : <Navigate to="/login" />}
      />
      <Route path="*" element={<Navigate to={client ? "/" : "/login"} />} />
    </Routes>
  );
}
