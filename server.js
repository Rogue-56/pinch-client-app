// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors()); // Use cors middleware

const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // This is your React app's address
    methods: ["GET", "POST"],
  },
});

const PORT = 8000; // We'll run the server on a different port

// This is the core of Socket.IO: listening for connections
io.on("connection", (socket) => {
  console.log(`⚡: New user connected: ${socket.id}`);

  // Handle the "join-room" event from the client
  socket.on("join-room", (roomId) => {
    socket.join(roomId); // Put the user in the Socket.IO room
    console.log(`User ${socket.id} joined room ${roomId}`);
    
    // Get all other users in the same room
    const otherUsers = [];
    const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (clientsInRoom) {
      clientsInRoom.forEach(clientId => {
        if (clientId !== socket.id) {
          otherUsers.push(clientId);
        }
      });
    }

    // Send the list of existing users *only to the new user*
    socket.emit("existing-users", otherUsers);

    // Notify *all other users* that a new peer has joined
    socket.to(roomId).emit("user-joined", socket.id);
  });

  // --- WebRTC Signaling Events ---
  // These events just relay messages from one peer to the target peer

  socket.on("offer", (payload) => {
    console.log(`Relaying offer from ${socket.id} to ${payload.target}`);
    io.to(payload.target).emit("offer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  socket.on("answer", (payload) => {
    console.log(`Relaying answer from ${socket.id} to ${payload.target}`);
    io.to(payload.target).emit("answer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  socket.on("ice-candidate", (payload) => {
    // console.log(`Relaying ICE candidate from ${socket.id} to ${payload.target}`); // This is very noisy
    io.to(payload.target).emit("ice-candidate", {
      candidate: payload.candidate,
      from: socket.id,
    });
  });


  // Listen for disconnections
  socket.on("disconnect", () => {
    console.log(`🔥: User disconnected: ${socket.id}`);
    // We'll tell everyone else this user left
    io.emit("user-disconnected", socket.id);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});