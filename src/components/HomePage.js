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
    // Attempt to extract room ID from a full URL
    try {
      const url = new URL(joinRoomId);
      const pathParts = url.pathname.split('/');
      const roomId = pathParts[pathParts.length - 1];
      if (roomId) {
        navigate(`/room/${roomId}`);
        return;
      }
    } catch (error) {
      // Not a valid URL, assume it's a room ID
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
    <div className="App-header">
      <h1>Pinch Video Chat</h1>
      <p>Create a new meeting or join an existing one.</p>
      <button onClick={createRoom} style={{ fontSize: '20px', padding: '10px 20px', width: '300px' }}>
        Create New Meeting
      </button>

      <div style={{ margin: '20px 0', display: 'flex', justifyContent: 'center', width: '300px' }}>
        <input
          type="text"
          placeholder="Enter Meeting ID or Link"
          value={joinRoomId}
          onChange={handleJoinInputChange}
          onKeyPress={handleJoinKeyPress}
          style={{
            fontSize: '16px',
            padding: '10px',
            borderRadius: '8px 0 0 8px',
            border: '1px solid #cccccc',
            width: '100%',
            fontFamily: 'Inter, sans-serif'
          }}
        />
        <button 
          onClick={joinRoom} 
          style={{
            fontSize: '16px',
            padding: '10px 20px',
            borderRadius: '0 8px 8px 0',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: '#ffffff',
            color: '#282c34',
            fontWeight: '500',
            fontFamily: 'Inter, sans-serif'
          }}
        >
          Join
        </button>
      </div>
    </div>
  );
}

export default HomePage;
