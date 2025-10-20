import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './components/HomePage';
import RoomPage from './components/RoomPage';
import './App.css';

/**
 * The main application component.
 * It sets up the routing and manages the theme.
 */
function App() {
  // State for the current theme (dark or light).
  const [theme, setTheme] = useState('dark');

  // Effect to update the theme on the body element whenever it changes.
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <Router>
      <div className="App">
        <Routes>
          {/* Route for the home page */}
          <Route path="/" element={<HomePage />} />
          {/* Route for the room page, with the theme and setTheme passed as props */}
          <Route path="/room/:roomId" element={<RoomPage theme={theme} setTheme={setTheme} />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
