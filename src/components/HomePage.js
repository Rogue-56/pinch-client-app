import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Generates a random room ID.
 * @returns {string} A random 8-character string.
 */
function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * The home page component, where users can create or join a room.
 */
function HomePage() {
  const navigate = useNavigate();
  const [joinRoomId, setJoinRoomId] = useState('');

  /**
   * Creates a new room and navigates to it.
   */
  const createRoom = () => {
    const newRoomId = generateRoomId();
    navigate(`/room/${newRoomId}`);
  };

  /**
   * Joins an existing room using the entered room ID or link.
   */
  const joinRoom = () => {
    if (joinRoomId.trim() === '') return;
    try {
      // Check if the input is a valid URL.
      const url = new URL(joinRoomId);
      const pathParts = url.pathname.split('/');
      // Find the room ID in the URL path.
      const roomId = pathParts.find(part => part.length > 4);
      if (roomId) {
        navigate(`/room/${roomId}`);
      } else {
        alert("Could not find a valid Room ID in the URL.");
      }
    } catch (error) {
      // If the input is not a URL, assume it's a room ID.
      navigate(`/room/${joinRoomId}`);
    }
  };

  /**
   * Handles changes to the join room input field.
   */
  const handleJoinInputChange = (e) => {
    setJoinRoomId(e.target.value);
  };

  /**
   * Joins the room when the Enter key is pressed in the input field.
   */
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