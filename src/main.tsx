import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/reader.css';
import './styles/ui.css';
import './styles/overlays.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
