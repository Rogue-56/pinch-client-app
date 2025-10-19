import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import '../App.css';

// STUN servers for cross-network connectivity
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

function RoomPage() {
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const localVideoRef = useRef(null);
  const peersRef = useRef([]);
  const localStreamRef = useRef(null);
  const socketRef = useRef(null);
  const { roomId } = useParams();

  // Get user media once on mount
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
      // Cleanup media stream on unmount
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Setup socket listeners and join room once we have local stream
  useEffect(() => {
    if (!localStream) return;

    // Create a fresh socket connection for this component instance
    console.log("Creating new socket connection...");
    const socket = io('https://pinch-server-app.onrender.com/', { 
      path: "/socket.io/",
      transports: ['polling', 'websocket'],
      forceNew: true,  // Force a new connection, don't reuse
      reconnection: false  // Disable auto-reconnection to prevent duplicates
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log(`Socket connected with ID: ${socket.id}`);
      console.log(`Joining room: ${roomId}`);
      socket.emit('join-room', roomId);
    });

    // I'm joining - these are users already in the room, I initiate connection
    socket.on('existing-users', (users) => {
      console.log("Existing users in room:", users);
      console.log("My socket ID:", socket.id);
      
      // Clear any existing peers before adding new ones
      peersRef.current.forEach(({ peer }) => {
        if (peer && !peer.destroyed) {
          peer.destroy();
        }
      });
      peersRef.current = [];
      setPeers([]);

      users.forEach(userId => {
        // CRITICAL: Don't connect to yourself
        if (userId === socket.id) {
          console.log("Skipping self-connection");
          return;
        }
        
        const peer = createPeer(userId, socket.id, localStream, socket);
        peersRef.current.push({ peerId: userId, peer });
        setPeers(prev => [...prev, { peerId: userId, peer }]);
      });
    });

    // Someone else joined - I'm existing user, I wait for their offer
    socket.on('user-joined', (userId) => {
      console.log(`New user joined: ${userId}`);
      console.log("My socket ID:", socket.id);
      
      // CRITICAL: Don't connect to yourself
      if (userId === socket.id) {
        console.log("Skipping self-connection in user-joined");
        return;
      }
      
      // Check if peer already exists to prevent duplicates
      const existingPeer = findPeer(userId);
      if (existingPeer) {
        console.log(`Peer ${userId} already exists, skipping`);
        return;
      }
      const peer = addPeer(userId, localStream, socket);
      peersRef.current.push({ peerId: userId, peer });
      setPeers(prev => [...prev, { peerId: userId, peer }]);
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
      const peerRef = findPeer(userId);
      if (peerRef && !peerRef.peer.destroyed) {
        peerRef.peer.destroy();
      }
      peersRef.current = peersRef.current.filter(p => p.peerId !== userId);
      setPeers(prev => prev.filter(p => p.peerId !== userId));
    });

    return () => {
      console.log("Cleaning up socket and peers");
      
      // Destroy all peer connections
      peersRef.current.forEach(({ peer }) => {
        if (peer && !peer.destroyed) {
          peer.destroy();
        }
      });
      peersRef.current = [];
      setPeers([]);
      
      // Disconnect socket
      if (socket && socket.connected) {
        socket.disconnect();
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

  // Create peer as initiator (I'm calling them)
  function createPeer(userIdToSignal, callerId, stream, socket) {
    console.log(`Creating peer (initiator) for: ${userIdToSignal}`);
    const peer = new Peer({
      initiator: true,
      trickle: true,
      stream: stream,
      config: ICE_SERVERS
    });

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

    peer.on('error', (err) => {
      console.error(`Peer error with ${userIdToSignal}:`, err);
    });

    return peer;
  }

  // Add peer as receiver (they're calling me)
  function addPeer(userIdSignaling, stream, socket) {
    console.log(`Adding peer (receiver) for: ${userIdSignaling}`);
    const peer = new Peer({
      initiator: false,
      trickle: true,
      stream: stream,
      config: ICE_SERVERS
    });

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

    peer.on('error', (err) => {
      console.error(`Peer error with ${userIdSignaling}:`, err);
    });

    return peer;
  }

  function findPeer(userId) {
    return peersRef.current.find(p => p.peerId === userId);
  }

  return (
    <div className="App-header">
      <h1>Pinch Room: {roomId}</h1>
      
      <div className="controls-container">
        <button onClick={toggleAudio}>
          {isAudioEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button onClick={toggleVideo}>
          {isVideoEnabled ? 'Stop Video' : 'Start Video'}
        </button>
      </div>

      <div className="video-grid">
        <div className="video-container">
          <h2>My Video</h2>
          <video ref={localVideoRef} autoPlay playsInline muted />
        </div>

        {peers.map(({ peerId, peer }) => (
          <RemoteVideo key={peerId} peer={peer} />
        ))}
      </div>
    </div>
  );
}

const RemoteVideo = ({ peer }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    peer.on('stream', (stream) => {
      console.log("Received remote stream");
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    });

    peer.on('close', () => {
      console.log("Peer connection closed");
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    });

    peer.on('error', (err) => {
      console.error('Remote peer error:', err);
    });
  }, [peer]);

  return (
    <div className="video-container">
      <h2>Remote User</h2>
      <video ref={videoRef} autoPlay playsInline />
    </div>
  );
};

export default RoomPage;