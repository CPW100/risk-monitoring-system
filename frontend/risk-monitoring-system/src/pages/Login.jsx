import React, { useState } from 'react';
import api from '../api/api';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
        const res = await api.post('/login', { email, password });
        const { client } = res.data;

        // Optionally check if status is not 200
        if (res.status !== 200) {
            setError(res.data?.error || 'Login failed');
            setLoading(false);
            return;
        }

        // Pass client info to parent (Dashboard or App)
        onLogin(client);
    } catch (err) {
        console.error(err);

        // Axios error message
        const message = err.response?.data?.error || 'Network error';
        setError(message);
        setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <form onSubmit={handleSubmit} style={styles.form} noValidate>
        <h2 style={styles.title}>Login</h2>

        <label htmlFor="email" style={styles.label}>Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={styles.input}
          disabled={loading}
        />

        <label htmlFor="password" style={styles.label}>Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={styles.input}
          disabled={loading}
        />

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '1rem',
    background: '#f9fafb',
  },
  form: {
    width: '100%',
    maxWidth: 400,
    background: 'white',
    padding: '2rem',
    borderRadius: 8,
    boxShadow: '0 0 10px rgba(0,0,0,0.1)',
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    marginBottom: '1.5rem',
    textAlign: 'center',
    fontSize: '1.5rem',
    fontWeight: '600',
  },
  label: {
    marginBottom: '0.25rem',
    fontWeight: '500',
  },
  input: {
    marginBottom: '1rem',
    padding: '0.5rem 0.75rem',
    fontSize: '1rem',
    borderRadius: 4,
    border: '1px solid #ccc',
    outlineColor: '#3182ce',
  },
  button: {
    padding: '0.75rem',
    fontSize: '1rem',
    backgroundColor: '#3182ce',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  },
  error: {
    marginBottom: '1rem',
    color: 'red',
    fontWeight: '500',
    textAlign: 'center',
  },
};
