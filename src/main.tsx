import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './theme-dunkel.css';
import App from './App';
import { darstellungAnwenden } from './lib/theme';

darstellungAnwenden();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
