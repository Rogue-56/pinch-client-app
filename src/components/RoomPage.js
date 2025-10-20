import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import '../App.css';

// Configuration for ICE servers, used by WebRTC for NAT traversal.
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

/**
 * The main component for the video chat room.
 * Handles video/audio streams, peer connections, screen sharing, and chat.
 */
function RoomPage({ theme, setTheme }) {
  // State variables for managing the component's data and UI.
  const [localStream, setLocalStream] = useState(null); // The user's local video/audio stream.
  const [videoPeers, setVideoPeers] = useState([]); // Array of peers for video streams.
  const [isAudioEnabled, setIsAudioEnabled] = useState(true); // Is the user's audio muted?
  const [isVideoEnabled, setIsVideoEnabled] = useState(true); // Is the user's video turned off?
  const [showUserList, setShowUserList] = useState(false); // Should the user list be displayed?
  const [isChatOpen, setIsChatOpen] = useState(false); // Is the chat panel open?
  const [currentUser, setCurrentUser] = useState({ id: null, name: null }); // The current user's info.
  const [message, setMessage] = useState(''); // The current chat message input.
  const [chatHistory, setChatHistory] = useState([]); // The history of chat messages.
  const [isScreenSharing, setIsScreenSharing] = useState(false); // Is the user currently sharing their screen?
  const [screenStream, setScreenStream] = useState(null); // The stream for screen sharing.
  const [screenPeers, setScreenPeers] = useState([]); // Array of peers for screen sharing streams.

  // Refs for accessing DOM elements and other mutable values.
  const localVideoRef = useRef(null); // Ref for the local video element.
  const videoPeersRef = useRef([]); // Ref for the array of video peers.
  const screenPeersRef = useRef([]); // Ref for the array of screen sharing peers.
  const localStreamRef = useRef(null); // Ref for the local stream object.
  const screenStreamRef = useRef(null); // Ref for the screen sharing stream object.
  const socketRef = useRef(null); // Ref for the socket.io connection.
  const isScreenSharingRef = useRef(isScreenSharing); // Ref to track screen sharing state.
  const userJoinedSoundRef = useRef(null); // Ref for the user joined sound.
  const userLeftSoundRef = useRef(null); // Ref for the user left sound.
  const newMessageSoundRef = useRef(null); // Ref for the new message sound.
  const { roomId } = useParams(); // Get the room ID from the URL.

  // Keep the isScreenSharingRef updated with the latest state.
  useEffect(() => {
    isScreenSharingRef.current = isScreenSharing;
  }, [isScreenSharing]);

  // Initialize the audio objects for notification sounds.
  useEffect(() => {
    userJoinedSoundRef.current = new Audio('/mixkit-long-pop-2358.wav');
    userLeftSoundRef.current = new Audio('/new-notification-08-352461.mp3');
    newMessageSoundRef.current = new Audio('/mixkit-correct-answer-tone-2870.wav');
  }, []);

  // Functions to play the notification sounds.
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

  // Get the user's media stream (video and audio) when the component mounts.
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

    // Clean up the stream when the component unmounts.
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Set up the socket.io connection and event listeners.
  useEffect(() => {
    if (!localStream || !localStreamRef.current) return;
    
    if (socketRef.current && socketRef.current.connected) {
      return;
    }

    // Connect to the server.
    const socket = io('https://pinch-server-app.onrender.com/', { 
      path: "/socket.io/",
      transports: ['polling', 'websocket'],
      reconnection: false
    });
    socketRef.current = socket;

    // When connected, join the room.
    socket.on('connect', () => {
      setCurrentUser(prev => ({ ...prev, id: socket.id }));
      socket.emit('join-room', roomId);
      playUserJoinedSound();
    });

    // When a name is assigned by the server.
    socket.on('name-assigned', (name) => {
      setCurrentUser(prev => ({ ...prev, name }));
    });

    // When receiving the list of existing users in the room.
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

    // When a new user joins the room.
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

    // When receiving the chat history.
    socket.on('chat-history', (history) => {
      setChatHistory(history);
    });

    // When a new chat message is received.
    socket.on('new-message', (message) => {
      setChatHistory(prev => [...prev, message]);
      playNewMessageSound();
    });

    // WebRTC signaling: when an offer is received.
    socket.on('offer', (payload) => {
      const peerRef = findVideoPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    // WebRTC signaling: when an answer is received.
    socket.on('answer', (payload) => {
      const peerRef = findVideoPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.sdp);
      }
    });

    // WebRTC signaling: when an ICE candidate is received.
    socket.on('ice-candidate', (payload) => {
      const peerRef = findVideoPeer(payload.from);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.signal(payload.candidate);
      }
    });

    // When a user disconnects from the room.
    socket.on('user-disconnected', (userId) => {
      playUserLeftSound();
      const peerRef = findVideoPeer(userId);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.destroy();
      }
      videoPeersRef.current = videoPeersRef.current.filter(p => p.peerId !== userId);
      setVideoPeers(prev => prev.filter(p => p.peerId !== userId));
    });

    // When a user starts screen sharing.
    socket.on('user-started-screen-share', ({ id, name }) => {
      const peer = acceptScreenSharePeer(id, socket);
      const newPeerRef = { peerId: id, peer, name };
      screenPeersRef.current.push(newPeerRef);
      setScreenPeers(prev => [...prev, newPeerRef]);
    });

    // When a user stops screen sharing.
    socket.on('user-stopped-screen-share', ({ id }) => {
      const peerRef = findScreenSharePeer(id);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.destroy();
      }
      screenPeersRef.current = screenPeersRef.current.filter(p => p.peerId !== id);
      setScreenPeers(prev => prev.filter(p => p.peerId !== id));
    });

    // WebRTC signaling for screen sharing.
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

    // Clean up connections when the component unmounts.
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

  /**
   * Toggles the audio on and off.
   */
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

  /**
   * Toggles the video on and off.
   */
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

  /**
   * Toggles screen sharing on and off.
   */
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop screen sharing
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
      // Start screen sharing
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setScreenStream(stream);
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        socketRef.current.emit('start-screen-share');

        // Create screen sharing peers for existing users.
        const newScreenPeers = videoPeersRef.current.map(p => {
          const peer = initiateScreenSharePeer(p.peerId, socketRef.current.id, stream, socketRef.current);
          return { peerId: p.peerId, peer, name: p.name };
        });
        screenPeersRef.current = newScreenPeers;
        setScreenPeers(newScreenPeers);

        // When the user stops sharing from the browser UI.
        stream.getVideoTracks()[0].onended = () => toggleScreenShare();
      } catch (err) {
        console.error("Error starting screen share:", err);
      }
    }
  };

  /**
   * Sends a chat message.
   */
  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && socketRef.current) {
      socketRef.current.emit('send-message', message);
      setMessage('');
    }
  };

  /**
   * Creates a new video peer connection (as the initiator).
   */
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

  /**
   * Adds a new video peer connection (not as the initiator).
   */
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

  /**
   * Finds a video peer by user ID.
   */
  function findVideoPeer(userId) {
    return videoPeersRef.current.find(p => p.peerId === userId);
  }

  /**
   * Initiates a screen sharing peer connection.
   */
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

  /**
   * Accepts a screen sharing peer connection.
   */
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

  /**
   * Finds a screen sharing peer by user ID.
   */
  function findScreenSharePeer(userId) {
    return screenPeersRef.current.find(p => p.peerId === userId);
  }

  /**
   * Toggles the color theme.
   */
  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'dark' ? 'light' : 'dark');
  };

  // Check if there is any screen sharing happening.
  const hasScreenShare = isScreenSharing || screenPeers.length > 0;

  return (
    <div className="room-container">
      <div className={`main-content ${hasScreenShare ? 'screen-sharing-active' : ''}`}>
        {/* Video grid for all participants */}
        <div
          className="video-grid"
          style={videoPeers.length === 0 && !hasScreenShare ? { display: 'flex' } : {}}
        >
          {/* Local user's video */}
          <div
            className="video-container self-video"
            style={{
              maxWidth: videoPeers.length === 0 && !hasScreenShare ? 'calc(min(80vh * 4 / 3, 90vw))' : undefined,
              aspectRatio: videoPeers.length === 0 && !hasScreenShare ? '4 / 3' : undefined,
              margin: videoPeers.length === 0 && !hasScreenShare ? 'auto' : undefined,
            }}
          >
            <video ref={localVideoRef} autoPlay playsInline muted />
            <div className="video-label">You ({currentUser.name || '...'})</div>
          </div>
          {/* Remote users' videos */}
          {videoPeers.map(({ peerId, peer, name }) => (
            <RemoteVideo key={peerId} peerId={peerId} peer={peer} name={name} />
          ))}
        </div>

        {/* Container for screen sharing */}
        {hasScreenShare && (
          <div className="screen-share-container">
            {/* Local user's screen share */}
            {isScreenSharing && (
              <div className="video-container screen-share-video">
                <video ref={video => { if (video) video.srcObject = screenStream; }} autoPlay playsInline />
                <div className="video-label">Your Screen</div>
              </div>
            )}
            {/* Remote users' screen shares */}
            {screenPeers.map(({ peerId, peer, name }) => (
              <ScreenShareVideo key={`screen-${peerId}`} peerId={peerId} peer={peer} name={`${name}'s Screen`} />
            ))}
          </div>
        )}
      </div>

      {/* Chat panel */}
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

      {/* Controls for the room */}
      <div className="controls-container">
        <div className="room-id-display">Meeting Code: {roomId}</div>
        <button onClick={toggleAudio}>{isAudioEnabled ? 'Mute' : 'Unmute'}</button>
        <button onClick={toggleVideo}>{isVideoEnabled ? 'Stop Video' : 'Start Video'}</button>
        <button onClick={toggleScreenShare}>{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</button>
        <button onClick={() => setShowUserList(!showUserList)}>{showUserList ? 'Hide Users' : 'Show Users'}</button>
        <button onClick={() => setIsChatOpen(!isChatOpen)}>{isChatOpen ? 'Hide Chat' : 'Show Chat'}</button>
        <button onClick={toggleTheme}>Theme</button>
      </div>

      {/* User list modal */}
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

/**
 * Component for rendering a remote user's video.
 */
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

/**
 * Component for rendering a remote user's screen share.
 */
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
