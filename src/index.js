import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

function GoogleLoader({ children }) {
  useEffect(() => {
    const existing = document.querySelector('script[data-google-maps]');
    if (existing) return;
    const key = process.env.REACT_APP_GOOGLE_BROWSER_KEY;
    if (!key) {
      console.warn('REACT_APP_GOOGLE_BROWSER_KEY is not set. Google Maps may fail to load.');
      return;
    }
    const script = document.createElement('script');
    script.setAttribute('data-google-maps', 'true');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, []);
  return children;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <GoogleLoader>
      <App />
    </GoogleLoader>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
