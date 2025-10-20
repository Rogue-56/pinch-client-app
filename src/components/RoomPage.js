import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import '../App.css';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

function RoomPage({ theme, setTheme }) {
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [showUserList, setShowUserList] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [localUser, setLocalUser] = useState({ id: null, name: null });
  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [screenPeers, setScreenPeers] = useState([]);

  const localVideoRef = useRef(null);
  const peersRef = useRef([]);
  const screenPeersRef = useRef([]);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const socketRef = useRef(null);
  const isScreenSharingRef = useRef(isScreenSharing);
  const userJoinedSoundRef = useRef(null);
  const userLeftSoundRef = useRef(null);
  const newMessageSoundRef = useRef(null);
  const { roomId } = useParams();

  useEffect(() => {
    isScreenSharingRef.current = isScreenSharing;
  }, [isScreenSharing]);

  const playUserJoinedSound = () => {
    if (userJoinedSoundRef.current) {
      userJoinedSoundRef.current.play().catch(error => {
        console.error("Audio playback failed:", error);
      });
    }
  };

  const playUserLeftSound = () => {
    if (userLeftSoundRef.current) {
      userLeftSoundRef.current.play().catch(error => {
        console.error("Audio playback failed:", error);
      });
    }
  };

  const playNewMessageSound = () => {
    if (newMessageSoundRef.current) {
      newMessageSoundRef.current.play().catch(error => {
        console.error("Audio playback failed:", error);
      });
    }
  };

  useEffect(() => {
    console.log("Getting user media...");
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        console.log("Got user media successfully");
        setLocalStream(stream);
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      })
      .catch(err => {
        console.error('Error getting media stream:', err);
        alert('Could not get camera/mic permission');
      });

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!localStream || !localStreamRef.current) return;
    
    if (socketRef.current && socketRef.current.connected) {
      console.log("Socket already exists, reusing:", socketRef.current.id);
      return;
    }

    console.log("Creating new socket connection...");
    const socket = io('https://pinch-server-app.onrender.com/', { 
      path: "/socket.io/",
      transports: ['polling', 'websocket'],
      reconnection: false
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log(`Socket connected with ID: ${socket.id}`);
      setLocalUser(prev => ({ ...prev, id: socket.id }));
      console.log(`Joining room: ${roomId}`);
      socket.emit('join-room', roomId);
      playUserJoinedSound();
    });

    socket.on('name-assigned', (name) => {
      console.log(`Assigned name: ${name}`);
      setLocalUser(prev => ({ ...prev, name }));
    });

    socket.on('existing-users', (users) => {
      console.log("Existing users in room:", users);
      
      const newPeers = users
        .filter(user => user.id !== socket.id && !findPeer(user.id))
        .map(user => {
          const peer = addPeer(user.id, localStreamRef.current, socket);
          return { peerId: user.id, peer, name: user.name };
        });

      if (newPeers.length > 0) {
        peersRef.current = [...peersRef.current, ...newPeers];
        setPeers(prev => [...prev, ...newPeers]);
      }
    });

    socket.on('user-joined', (user) => {
      console.log(`New user joined: ${user.name} (${user.id})`);
      playUserJoinedSound();
      
      if (user.id === socket.id) return;
      if (findPeer(user.id)) {
        console.log(`Peer ${user.id} already exists, skipping`);
        return;
      }

      const peer = createPeer(user.id, socket.id, localStreamRef.current, socket);
      const newPeerRef = { peerId: user.id, peer, name: user.name };
      peersRef.current.push(newPeerRef);
      setPeers(prev => [...prev, newPeerRef]);

      if (isScreenSharingRef.current) {
        const screenPeer = createScreenPeer(user.id, socket.id, screenStreamRef.current, socket);
        const newScreenPeerRef = { peerId: user.id, peer: screenPeer, name: user.name };
        screenPeersRef.current.push(newScreenPeerRef);
        setScreenPeers(prev => [...prev, newScreenPeerRef]);
      }
    });

    socket.on('chat-history', (history) => {
      setChatHistory(history);
    });

    socket.on('new-message', (message) => {
      setChatHistory(prev => [...prev, message]);
      playNewMessageSound();
    });

    socket.on('offer', (payload) => {
      console.log(`Received offer from: ${payload.from}`);
      const peerRef = findPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    socket.on('answer', (payload) => {
      console.log(`Received answer from: ${payload.from}`);
      const peerRef = findPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    socket.on('ice-candidate', (payload) => {
      console.log(`Received ICE candidate from: ${payload.from}`);
      const peerRef = findPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.candidate);
      }
    });

    socket.on('user-disconnected', (userId) => {
      console.log(`User disconnected: ${userId}`);
      playUserLeftSound();
      const peerRef = findPeer(userId);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.destroy();
      }
      peersRef.current = peersRef.current.filter(p => p.peerId !== userId);
      setPeers(prev => prev.filter(p => p.peerId !== userId));
    });

    socket.on('user-started-screen-share', ({ id, name }) => {
      console.log(`User ${name} (${id}) started screen sharing`);
      const peer = addScreenPeer(id, socket);
      const newPeerRef = { peerId: id, peer, name };
      screenPeersRef.current.push(newPeerRef);
      setScreenPeers(prev => [...prev, newPeerRef]);
    });

    socket.on('user-stopped-screen-share', ({ id }) => {
      console.log(`User ${id} stopped screen sharing`);
      const peerRef = findScreenPeer(id);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.destroy();
      }
      screenPeersRef.current = screenPeersRef.current.filter(p => p.peerId !== id);
      setScreenPeers(prev => prev.filter(p => p.peerId !== id));
    });

    socket.on('screen-offer', (payload) => {
      console.log(`Received screen offer from: ${payload.from}`);
      const peerRef = findScreenPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    socket.on('screen-answer', (payload) => {
      console.log(`Received screen answer from: ${payload.from}`);
      const peerRef = findScreenPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    socket.on('screen-ice-candidate', (payload) => {
      console.log(`Received screen ICE candidate from: ${payload.from}`);
      const peerRef = findScreenPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.candidate);
      }
    });

    return () => {
      console.log("Cleaning up socket and peers");
      
      peersRef.current.forEach(({ peer }) => {
        if (peer && !peer.destroyed) {
          peer.destroy();
        }
      });
      peersRef.current = [];
      setPeers([]);

      screenPeersRef.current.forEach(({ peer }) => {
        if (peer && !peer.destroyed) {
          peer.destroy();
        }
      });
      screenPeersRef.current = [];
      setScreenPeers([]);
      
      if (socket) {
        socket.removeAllListeners();
        if (socket.connected) {
          socket.disconnect();
        }
        socket.close();
      }
      socketRef.current = null;
    };
  }, [roomId, localStream]);

  const toggleAudio = () => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    const stream = localStreamRef.current;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      socketRef.current.emit('stop-screen-share');
      setScreenStream(null);
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      screenPeersRef.current.forEach(({ peer }) => {
        if (peer && !peer.destroyed) {
          peer.destroy();
        }
      });
      screenPeersRef.current = [];
      setScreenPeers([]);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setScreenStream(stream);
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        socketRef.current.emit('start-screen-share');

        const newScreenPeers = peersRef.current.map(p => {
          const peer = createScreenPeer(p.peerId, socketRef.current.id, stream, socketRef.current);
          return { peerId: p.peerId, peer, name: p.name };
        });
        screenPeersRef.current = newScreenPeers;
        setScreenPeers(newScreenPeers);

        stream.getVideoTracks()[0].onended = () => {
          toggleScreenShare();
        };
      } catch (err) {
        console.error("Error starting screen share:", err);
      }
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && socketRef.current) {
      socketRef.current.emit('send-message', message);
      setMessage('');
    }
  };

  function createPeer(userIdToSignal, callerId, stream, socket) {
    console.log(`Creating peer (initiator) for: ${userIdToSignal}`);
    const peer = new Peer({
      initiator: true,
      trickle: true,
      config: ICE_SERVERS
    });

    stream.getTracks().forEach(track => peer.addTrack(track, stream));

    peer.on('signal', (data) => {
      if (data.type === 'offer') {
        console.log(`Sending offer to: ${userIdToSignal}`);
        socket.emit('offer', {
          target: userIdToSignal,
          from: callerId,
          sdp: data,
        });
      } else if (data.candidate) {
        socket.emit('ice-candidate', {
          target: userIdToSignal,
          from: callerId,
          candidate: data,
        });
      }
    });

    return peer;
  }

  function addPeer(userIdSignaling, stream, socket) {
    console.log(`Adding peer (receiver) for: ${userIdSignaling}`);
    const peer = new Peer({
      initiator: false,
      trickle: true,
      config: ICE_SERVERS
    });

    stream.getTracks().forEach(track => peer.addTrack(track, stream));

    peer.on('signal', (data) => {
      if (data.type === 'answer') {
        console.log(`Sending answer to: ${userIdSignaling}`);
        socket.emit('answer', {
          target: userIdSignaling,
          from: socket.id,
          sdp: data,
        });
      } else if (data.candidate) {
        socket.emit('ice-candidate', {
          target: userIdSignaling,
          from: socket.id,
          candidate: data,
        });
      }
    });

    return peer;
  }

  function findPeer(userId) {
    return peersRef.current.find(p => p.peerId === userId);
  }

  function createScreenPeer(userIdToSignal, callerId, stream, socket) {
    console.log(`Creating screen peer (initiator) for: ${userIdToSignal}`);
    const peer = new Peer({
      initiator: true,
      trickle: true,
      config: ICE_SERVERS
    });

    stream.getTracks().forEach(track => peer.addTrack(track, stream));

    peer.on('signal', (data) => {
      if (data.type === 'offer') {
        console.log(`Sending screen offer to: ${userIdToSignal}`);
        socket.emit('screen-offer', {
          target: userIdToSignal,
          from: callerId,
          sdp: data,
        });
      } else if (data.candidate) {
        socket.emit('screen-ice-candidate', {
          target: userIdToSignal,
          from: callerId,
          candidate: data,
        });
      }
    });

    return peer;
  }

  function addScreenPeer(userIdSignaling, socket) {
    console.log(`Adding screen peer (receiver) for: ${userIdSignaling}`);
    const peer = new Peer({
      initiator: false,
      trickle: true,
      config: ICE_SERVERS
    });

    peer.on('signal', (data) => {
      if (data.type === 'answer') {
        console.log(`Sending screen answer to: ${userIdSignaling}`);
        socket.emit('screen-answer', {
          target: userIdSignaling,
          from: socket.id,
          sdp: data,
        });
      } else if (data.candidate) {
        socket.emit('screen-ice-candidate', {
          target: userIdSignaling,
          from: socket.id,
          candidate: data,
        });
      }
    });

    return peer;
  }

  function findScreenPeer(userId) {
    return screenPeersRef.current.find(p => p.peerId === userId);
  }

  const removeUser = (peerId) => {
    console.log(`Manually removing user: ${peerId}`);
    const peerRef = findPeer(peerId);
    if (peerRef && !peerRef.peer.destroyed) {
      peerRef.peer.destroy();
    }
    peersRef.current = peersRef.current.filter(p => p.peerId !== peerId);
    setPeers(prev => prev.filter(p => p.peerId !== peerId));
  };

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="App-header">
      <audio ref={userJoinedSoundRef} src="/mixkit-correct-answer-tone-2870.wav" preload="auto" />
      <audio ref={userLeftSoundRef} src="/new-notification-08-352461.mp3" preload="auto" />
      <audio ref={newMessageSoundRef} src="/mixkit-long-pop-2358.wav" preload="auto" />
      <h1>Pinch Room: {roomId}</h1>
      <p style={{ fontSize: '14px', color: '#888' }}>
        Your Name: {localUser.name || 'Assigning...'} | 
        Participants: {peers.length + 1}
      </p>
      
      <div className="controls-container">
        <button onClick={toggleAudio}>
          {isAudioEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button onClick={toggleVideo}>
          {isVideoEnabled ? 'Stop Video' : 'Start Video'}
        </button>
        <button onClick={toggleScreenShare}>
          {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
        </button>
        <button onClick={() => setShowUserList(!showUserList)}>
          {showUserList ? 'Hide Users' : 'Show Users'}
        </button>
        <button onClick={() => setIsChatOpen(!isChatOpen)}>
          {isChatOpen ? 'Hide Chat' : 'Show Chat'}
        </button>
        <button onClick={toggleTheme}>
          Toggle Theme
        </button>
      </div>

      {showUserList && (
        <div style={{
          background: '#1a1a1a',
          padding: '15px',
          borderRadius: '8px',
          marginBottom: '20px',
          maxWidth: '400px',
          margin: '0 auto 20px'
        }}>
          <h3 style={{ margin: '0 0 10px 0' }}>Connected Users ({peers.length + 1})</h3>
          <div style={{ textAlign: 'left' }}>
            <div style={{ padding: '8px', borderBottom: '1px solid #333' }}>
              <strong>You ({localUser.name})</strong>
            </div>
            {peers.map(({ peerId, name }) => (
              <div key={peerId} style={{ 
                padding: '8px', 
                borderBottom: '1px solid #333',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>{name}</span>
                <button 
                  onClick={() => removeUser(peerId)}
                  style={{
                    background: '#d32f2f',
                    border: 'none',
                    padding: '4px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="video-grid">
        <div className="video-container">
          <h2>You ({localUser.name || '...'})</h2>
          <video ref={localVideoRef} autoPlay playsInline muted />
        </div>

        {isScreenSharing && (
          <div className="video-container">
            <h2>Your Screen</h2>
            <video ref={video => { if (video) video.srcObject = screenStream; }} autoPlay playsInline muted />
          </div>
        )}

        {peers.map(({ peerId, peer, name }) => (
          <RemoteVideo key={peerId} peerId={peerId} peer={peer} name={name} onRemove={() => removeUser(peerId)} />
        ))}
        {screenPeers.map(({ peerId, peer, name }) => (
          <ScreenShareVideo key={`screen-${peerId}`} peerId={peerId} peer={peer} name={`${name}'s Screen`} />
        ))}
      </div>

      <div className={`chat-container ${isChatOpen ? 'open' : ''}`}>
        <button onClick={() => setIsChatOpen(false)} className="chat-close-button">X</button>
        <div className="chat-history">
          {chatHistory.map((msg, index) => (
            <div key={index} className="chat-message">
              <strong>{msg.name}:</strong> {msg.message}
            </div>
          ))}
        </div>
        <form onSubmit={sendMessage} className="chat-input-form">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
          />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  );
}

const RemoteVideo = ({ peerId, peer, name, onRemove }) => {
  const videoRef = useRef(null);
  const [hasStream, setHasStream] = useState(false);

  useEffect(() => {
    peer.on('stream', (stream) => {
      console.log(`Received remote stream from ${peerId}`);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setHasStream(true);
      }
    });

    peer.on('close', () => {
      console.log(`Peer connection closed: ${peerId}`);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setHasStream(false);
    });

    peer.on('error', (err) => {
      console.error(`Remote peer error (${peerId}):`, err);
    });
  }, [peer, peerId]);

  return (
    <div className="video-container" style={{ position: 'relative' }}>
      <h2>{name}</h2>
      <p style={{ fontSize: '12px', color: '#666' }}>
        {hasStream ? '✓' : '⏳'}
      </p>
      <video ref={videoRef} autoPlay playsInline />
      <button
        onClick={onRemove}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(211, 47, 47, 0.9)',
          border: 'none',
          padding: '6px 12px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
          color: 'white'
        }}
      >
        Remove
      </button>
    </div>
  );
};

const ScreenShareVideo = ({ peerId, peer, name }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    peer.on('stream', (stream) => {
      console.log(`Received screen share stream from ${peerId}`);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    });
  }, [peer, peerId]);

  return (
    <div className="video-container">
      <h2>{name}</h2>
      <video ref={videoRef} autoPlay playsInline />
    </div>
  );
};

export default RoomPage;