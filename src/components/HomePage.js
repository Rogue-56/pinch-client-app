import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

function HomePage() {
  const navigate = useNavigate();
  const [joinRoomId, setJoinRoomId] = useState('');

  const createRoom = () => {
    const newRoomId = generateRoomId();
    navigate(`/room/${newRoomId}`);
  };

  const joinRoom = () => {
    if (joinRoomId.trim() === '') return;
    try {
      const url = new URL(joinRoomId);
      const pathParts = url.pathname.split('/');
      const roomId = pathParts.find(part => part.length > 4);
      if (roomId) {
        navigate(`/room/${roomId}`);
      } else {
        alert("Could not find a valid Room ID in the URL.");
      }
    } catch (error) {
      navigate(`/room/${joinRoomId}`);
    }
  };

  const handleJoinInputChange = (e) => {
    setJoinRoomId(e.target.value);
  };

  const handleJoinKeyPress = (e) => {
    if (e.key === 'Enter') {
      joinRoom();
    }
  };

  return (
    <div className="home-container">
      <div className="home-card">
        <h1 className="home-title">Pinch Video Chat</h1>
        <p className="home-subtitle">High-quality video calls, simple and fast.</p>
        
        <div className="home-actions">
          <div className="join-room-container">
            <input
              type="text"
              placeholder="Enter Meeting ID or Link"
              value={joinRoomId}
              onChange={handleJoinInputChange}
              onKeyPress={handleJoinKeyPress}
              className="join-room-input"
            />
            <button onClick={joinRoom} className="join-room-button">Join</button>
          </div>
          <div className="separator">or</div>
          <button onClick={createRoom} className="create-room-button">
            Create New Meeting
          </button>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
