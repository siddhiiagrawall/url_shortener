import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// React 18's createRoot API — enables concurrent features
// The old ReactDOM.render() is deprecated in React 18
ReactDOM.createRoot(document.getElementById('root')).render(
  // StrictMode: in development, renders components twice to detect side effects
  // Has NO effect in production — purely a development tool
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
