import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './store';
import { ToastHost } from './components/patterns';
import CommandPalette from './components/CommandPalette';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppProvider>
        <App />
        <CommandPalette />
        <ToastHost />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
