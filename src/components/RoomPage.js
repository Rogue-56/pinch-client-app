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
  const [videoPeers, setVideoPeers] = useState([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [showUserList, setShowUserList] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState({ id: null, name: null });
  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [screenPeers, setScreenPeers] = useState([]);

  const localVideoRef = useRef(null);
  const videoPeersRef = useRef([]);
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
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
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
      return;
    }

    const socket = io('https://pinch-server-app.onrender.com/', { 
      path: "/socket.io/",
      transports: ['polling', 'websocket'],
      reconnection: false
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setCurrentUser(prev => ({ ...prev, id: socket.id }));
      socket.emit('join-room', roomId);
      playUserJoinedSound();
    });

    socket.on('name-assigned', (name) => {
      setCurrentUser(prev => ({ ...prev, name }));
    });

    socket.on('existing-users', (users) => {
      const newPeers = users
        .filter(user => user.id !== socket.id && !findVideoPeer(user.id))
        .map(user => {
          const peer = addVideoPeer(user.id, localStreamRef.current, socket);
          return { peerId: user.id, peer, name: user.name };
        });

      if (newPeers.length > 0) {
        videoPeersRef.current = [...videoPeersRef.current, ...newPeers];
        setVideoPeers(prev => [...prev, ...newPeers]);
      }
    });

    socket.on('user-joined', (user) => {
      playUserJoinedSound();
      
      if (user.id === socket.id) return;
      if (findVideoPeer(user.id)) return;

      const peer = createVideoPeer(user.id, socket.id, localStreamRef.current, socket);
      const newPeerRef = { peerId: user.id, peer, name: user.name };
      videoPeersRef.current.push(newPeerRef);
      setVideoPeers(prev => [...prev, newPeerRef]);

      if (isScreenSharingRef.current) {
        const screenPeer = initiateScreenSharePeer(user.id, socket.id, screenStreamRef.current, socket);
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
      const peerRef = findVideoPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    socket.on('answer', (payload) => {
      const peerRef = findVideoPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    socket.on('ice-candidate', (payload) => {
      const peerRef = findVideoPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.candidate);
      }
    });

    socket.on('user-disconnected', (userId) => {
      playUserLeftSound();
      const peerRef = findVideoPeer(userId);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.destroy();
      }
      videoPeersRef.current = videoPeersRef.current.filter(p => p.peerId !== userId);
      setVideoPeers(prev => prev.filter(p => p.peerId !== userId));
    });

    socket.on('user-started-screen-share', ({ id, name }) => {
      const peer = acceptScreenSharePeer(id, socket);
      const newPeerRef = { peerId: id, peer, name };
      screenPeersRef.current.push(newPeerRef);
      setScreenPeers(prev => [...prev, newPeerRef]);
    });

    socket.on('user-stopped-screen-share', ({ id }) => {
      const peerRef = findScreenSharePeer(id);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.destroy();
      }
      screenPeersRef.current = screenPeersRef.current.filter(p => p.peerId !== id);
      setScreenPeers(prev => prev.filter(p => p.peerId !== id));
    });

    socket.on('screen-offer', (payload) => {
      const peerRef = findScreenSharePeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    socket.on('screen-answer', (payload) => {
      const peerRef = findScreenSharePeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    socket.on('screen-ice-candidate', (payload) => {
      const peerRef = findScreenSharePeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.candidate);
      }
    });

    return () => {
      videoPeersRef.current.forEach(({ peer }) => {
        if (peer && !peer.destroyed) peer.destroy();
      });
      videoPeersRef.current = [];
      setVideoPeers([]);

      screenPeersRef.current.forEach(({ peer }) => {
        if (peer && !peer.destroyed) peer.destroy();
      });
      screenPeersRef.current = [];
      setScreenPeers([]);
      
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
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
        if (peer && !peer.destroyed) peer.destroy();
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

        const newScreenPeers = videoPeersRef.current.map(p => {
          const peer = initiateScreenSharePeer(p.peerId, socketRef.current.id, stream, socketRef.current);
          return { peerId: p.peerId, peer, name: p.name };
        });
        screenPeersRef.current = newScreenPeers;
        setScreenPeers(newScreenPeers);

        stream.getVideoTracks()[0].onended = () => toggleScreenShare();
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

  function createVideoPeer(userIdToSignal, callerId, stream, socket) {
    const peer = new Peer({ initiator: true, trickle: true, config: ICE_SERVERS });
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    peer.on('signal', (data) => {
      if (data.type === 'offer') {
        socket.emit('offer', { target: userIdToSignal, from: callerId, sdp: data });
      } else if (data.candidate) {
        socket.emit('ice-candidate', { target: userIdToSignal, from: callerId, candidate: data });
      }
    });
    return peer;
  }

  function addVideoPeer(userIdSignaling, stream, socket) {
    const peer = new Peer({ initiator: false, trickle: true, config: ICE_SERVERS });
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    peer.on('signal', (data) => {
      if (data.type === 'answer') {
        socket.emit('answer', { target: userIdSignaling, from: socket.id, sdp: data });
      } else if (data.candidate) {
        socket.emit('ice-candidate', { target: userIdSignaling, from: socket.id, candidate: data });
      }
    });
    return peer;
  }

  function findVideoPeer(userId) {
    return videoPeersRef.current.find(p => p.peerId === userId);
  }

  function initiateScreenSharePeer(userIdToSignal, callerId, stream, socket) {
    const peer = new Peer({ initiator: true, trickle: true, config: ICE_SERVERS });
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    peer.on('signal', (data) => {
      if (data.type === 'offer') {
        socket.emit('screen-offer', { target: userIdToSignal, from: callerId, sdp: data });
      } else if (data.candidate) {
        socket.emit('screen-ice-candidate', { target: userIdToSignal, from: callerId, candidate: data });
      }
    });
    return peer;
  }

  function acceptScreenSharePeer(userIdSignaling, socket) {
    const peer = new Peer({ initiator: false, trickle: true, config: ICE_SERVERS });
    peer.on('signal', (data) => {
      if (data.type === 'answer') {
        socket.emit('screen-answer', { target: userIdSignaling, from: socket.id, sdp: data });
      } else if (data.candidate) {
        socket.emit('screen-ice-candidate', { target: userIdSignaling, from: socket.id, candidate: data });
      }
    });
    return peer;
  }

  function findScreenSharePeer(userId) {
    return screenPeersRef.current.find(p => p.peerId === userId);
  }

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="room-container">
      <div
        className="video-grid"
        style={videoPeers.length === 0 ? { display: 'flex' } : {}}
      >
        <div
          className="video-container self-video"
          style={{
            maxWidth: videoPeers.length === 0 ? 'calc(min(80vh * 4 / 3, 90vw))' : undefined,
            aspectRatio: videoPeers.length === 0 ? '4 / 3' : undefined,
            margin: videoPeers.length === 0 ? 'auto' : undefined,
          }}
        >
          <video ref={localVideoRef} autoPlay playsInline muted />
          <div className="video-label">You ({currentUser.name || '...'})</div>
        </div>
        {videoPeers.map(({ peerId, peer, name }) => (
          <RemoteVideo key={peerId} peerId={peerId} peer={peer} name={name} />
        ))}
        {isScreenSharing && (
            <div className="video-container screen-share-video">
                <video ref={video => { if (video) video.srcObject = screenStream; }} autoPlay playsInline />
                <div className="video-label">Your Screen</div>
            </div>
        )}
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

      <div className="controls-container">
        <div className="room-id-display">Meeting Code: {roomId}</div>
        <button onClick={toggleAudio}>{isAudioEnabled ? 'Mute' : 'Unmute'}</button>
        <button onClick={toggleVideo}>{isVideoEnabled ? 'Stop Video' : 'Start Video'}</button>
        <button onClick={toggleScreenShare}>{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</button>
        <button onClick={() => setShowUserList(!showUserList)}>{showUserList ? 'Hide Users' : 'Show Users'}</button>
        <button onClick={() => setIsChatOpen(!isChatOpen)}>{isChatOpen ? 'Hide Chat' : 'Show Chat'}</button>
        <button onClick={toggleTheme}>Theme</button>
      </div>

      {showUserList && (
        <div className="user-list-modal">
            <h3>Connected Users ({videoPeers.length + 1})</h3>
            <div>
                <div><strong>You ({currentUser.name})</strong></div>
                {videoPeers.map(({ peerId, name }) => (
                    <div key={peerId}>{name}</div>
                ))}
            </div>
        </div>
      )}
    </div>
  );
}

const RemoteVideo = ({ peer, name }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    peer.on('stream', stream => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    });
  }, [peer]);

  return (
    <div className="video-container">
      <video ref={videoRef} autoPlay playsInline />
      <div className="video-label">{name}</div>
    </div>
  );
};

const ScreenShareVideo = ({ peer, name }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    peer.on('stream', stream => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    });
  }, [peer]);

  return (
    <div className="video-container screen-share-video">
      <video ref={videoRef} autoPlay playsInline />
      <div className="video-label">{name}</div>
    </div>
  );
};

export default RoomPage;