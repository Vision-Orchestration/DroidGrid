import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {LoginGate} from './components/LoginGate.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary name="App">
      <LoginGate>
        <App />
      </LoginGate>
    </ErrorBoundary>
  </StrictMode>,
);
