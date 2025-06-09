import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

/**
 * The App component serves as the root component for the application.
 * It manages the authentication state, WebSocket connection, and routing.
 * 
 * - Initializes and manages the `client` state to track the authenticated user.
 * - Uses `useEffect` to restore the client session from `localStorage` and establish a WebSocket connection on mount.
 * - Defines `connectWebSocket`, `handleLogin`, and `handleLogout` functions to manage WebSocket interactions and client authentication.
 * - Cleans up the WebSocket connection on component unmount.
 * - Renders routes for the Login and Dashboard components, navigating users based on authentication state.
 */

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
    const wsUrl = import.meta.env.VITE_WEBSOCKET_URL || 'ws://localhost:8080';
    ws.current = new WebSocket(wsUrl);

    // Fired when the WebSocket connection is established.
    // Sends the 'register' message with the client ID to the server.
    // Logs a message to the console to indicate a successful connection.
    ws.current.onopen = () => {
      ws.current.send(JSON.stringify({ type: 'register', clientId }));
      console.log('WebSocket connected and registered', clientId);
    };

    // Fired when the WebSocket connection is terminated.
    // Logs a message to the console to indicate a disconnection.
    ws.current.onclose = () => {
      console.log('WebSocket disconnected');
    };

    /**
     * Handles WebSocket errors by logging the error information to the console.
     * 
     * @param {Event} err - The error event that occurred on the WebSocket connection.
     */
    ws.current.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  };

  /**
   * Handles a successful login by updating the client state and connecting the WebSocket.
   * 
   * @param {Object} clientData - The client data object containing the client ID and other information.
   */
  const handleLogin = (clientData) => {
    setClient(clientData);
    localStorage.setItem('client', JSON.stringify(clientData));
    connectWebSocket(clientData.client_id);
  };

  /**
   * Handles user logout by closing the WebSocket connection, clearing the client state,
   * and removing the client data from localStorage.
   */
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
