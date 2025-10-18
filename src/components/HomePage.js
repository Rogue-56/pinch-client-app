import React from 'react';
import { useNavigate } from 'react-router-dom';

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

function HomePage() {
  const navigate = useNavigate(); 

  const createRoom = () => {
    const newRoomId = generateRoomId();
    navigate(`/room/${newRoomId}`);
  };

  return (
    <div className="App-header">
      <h1>Pinch Video Chat</h1>
      <p>Create a new meeting or join an existing one.</p>
      <button onClick={createRoom} style={{ fontSize: '20px', padding: '10px 20px' }}>
        Create New Meeting
      </button>
    </div>
  );
}

export default HomePage;