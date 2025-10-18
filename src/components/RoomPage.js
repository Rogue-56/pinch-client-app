import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import '../App.css';

const socket = io('https://pinch-server-app.vercel.app/', { 
  transports: ['polling', 'websocket'],
  autoConnect: false 
});

function RoomPage() {
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const localVideoRef = useRef(null);
  const peersRef = useRef([]);
  const localStreamRef = useRef(null); 
  const { roomId } = useParams();

  useEffect(() => {
    console.log("Attempting to get user media...");
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        console.log("Successfully got user media.");
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
  }, []); 

  useEffect(() => {
    if (localStream) {
      console.log("Local stream available, connecting to socket...");
      socket.connect(); 
      
      console.log(`Emitting 'join-room' for room: ${roomId}`);
      socket.emit('join-room', roomId);

      socket.on('existing-users', (users) => {
        console.log("Received 'existing-users':", users);
        const newPeers = [];
        users.forEach(userId => {
          const peer = createPeer(userId, socket.id, localStream);
          peersRef.current.push({ peerId: userId, peer });
          newPeers.push({ peerId: userId, peer });
        });
        setPeers(newPeers);
      });

      socket.on('user-joined', (userId) => {
        console.log(`'user-joined' event received for user: ${userId}`);
        const peer = addPeer(userId, socket.id, localStream);
        peersRef.current.push({ peerId: userId, peer });
        setPeers(prevPeers => [...prevPeers, { peerId: userId, peer }]);
      });

      socket.on('offer', (payload) => {
        console.log("Received 'offer' from:", payload.from);
        const peerRef = findPeer(payload.from);
        if (peerRef && !peerRef.peer.destroyed) {
          peerRef.peer.signal(payload.sdp);
        }
      });

      socket.on('answer', (payload) => {
        console.log("Received 'answer' from:", payload.from);
        const peerRef = findPeer(payload.from);
        if (peerRef && !peerRef.peer.destroyed) {
          peerRef.peer.signal(payload.sdp);
        }
      });

      socket.on('ice-candidate', (payload) => {
        console.log("Received 'ice-candidate' from:", payload.from);
        const peerRef = findPeer(payload.from);
        if (peerRef && !peerRef.peer.destroyed) {
          peerRef.peer.signal({
            type: 'candidate',
            candidate: payload.candidate,
          });
        }
      });

      socket.on('user-disconnected', (userId) => {
        console.log(`'user-disconnected' event for user: ${userId}`);
        const peerRef = findPeer(userId);
        if (peerRef) {
          peerRef.peer.destroy();
        }
        peersRef.current = peersRef.current.filter(p => p.peerId !== userId);
        setPeers(prevPeers => prevPeers.filter(p => p.peerId !== userId));
      });
    }

    return () => {
      console.log("Cleaning up and disconnecting socket...");
      socket.disconnect(); 
      socket.off('existing-users');
      socket.off('user-joined');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('user-disconnected');
      
      peersRef.current.forEach(peerRef => peerRef.peer.destroy());
      peersRef.current = [];
      setPeers([]);
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

  function createPeer(userIdToSignal, callerId, stream) {
    const peer = new Peer({
      initiator: true, 
      trickle: true,
      stream: stream,
    });

    peer.on('signal', (data) => {
      if (data.type === 'offer') {
        socket.emit('offer', {
          target: userIdToSignal,
          from: callerId,
          sdp: data,
        });
      } else if (data.candidate) {
        socket.emit('ice-candidate', {
          target: userIdToSignal,
          from: callerId,
          candidate: data.candidate,
        });
      }
    });
    return peer;
  }

  function addPeer(userIdSignaling, callerId, stream) {
    const peer = new Peer({
      initiator: false, 
      trickle: true,
      stream: stream,
    });

    peer.on('signal', (data) => {
      if (data.type === 'answer') {
        socket.emit('answer', {
          target: userIdSignaling,
          from: callerId,
          sdp: data,
        });
      } else if (data.candidate) {
        socket.emit('ice-candidate', {
          target: userIdSignaling,
          from: callerId,
          candidate: data.candidate,
        });
      }
    });
    return peer;
  }

  function findPeer(userId) {
    return peersRef.current.find(p => p.peerId === userId);
  }

  return (
    <div className="App-header">
      <h1>Pinch Room: {roomId}</h1>
      
      {}
      <div className="controls-container">
        <button onClick={toggleAudio}>
          {isAudioEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button onClick={toggleVideo}>
          {isVideoEnabled ? 'Stop Video' : 'Start Video'}
        </button>
      </div>
      {}

      <div className="video-grid">
        <div className="video-container">
          <h2>My Video</h2>
          <video ref={localVideoRef} autoPlay playsInline muted />
        </div>

        {peers.map(({ peerId, peer }) => {
          return (
            <RemoteVideo key={peerId} peer={peer} />
          );
        })}
      </div>
    </div>
  );
}

const RemoteVideo = ({ peer }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    peer.on('stream', (stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    });

    peer.on('close', () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
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