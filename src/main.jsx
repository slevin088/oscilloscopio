import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './osci.jsx'
import './style.css'     // usa style.css, non index.css

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
