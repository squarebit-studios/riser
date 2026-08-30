import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element in index.html');

ReactDOM.createRoot(root).render(
  // StrictMode is deliberately NOT used. It double-invokes effects in
  // development, which would mount and dispose the WebGL context twice per
  // load - leaking a context each time and making the viewport's lifecycle
  // impossible to reason about while debugging.
  <App />
);
