import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:8000', { transports: ['websocket'] });

function App() {

  const [localStream, setLocalStream] = useState(null);

  const localVideoRef = useRef(null);

  useEffect(() => {
    console.log('App component mounted');

    socket.on('connect', () => {
      console.log('⚡: Connected to server!', socket.id);
    });

    navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    })
    .then(stream => {

      console.log('Got local video stream');
      setLocalStream(stream); 

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    })
    .catch(err => {
      console.error('Error getting media stream:', err);
      alert('You must allow camera and microphone access to use this app.');
    });

    return () => {
      socket.disconnect(); 
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []); 

  return (
    <div className="App">
      <header className="App-header">
        <h1>Pinch Video Chat</h1>
        <div className="video-container">
          <h2>My Video</h2>
          {}
          <video ref={localVideoRef} autoPlay playsInline muted />
        </div>
      </header>
    </div>
  );
}

export default App;
