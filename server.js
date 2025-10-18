// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors()); 

const server = http.createServer(app);


const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", 
    methods: ["GET", "POST"],
  },
});

const PORT = 8000; 

io.on("connection", (socket) => {
  console.log(`⚡: New user connected: ${socket.id}`);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
    
    const otherUsers = [];
    const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (clientsInRoom) {
      clientsInRoom.forEach(clientId => {
        if (clientId !== socket.id) {
          otherUsers.push(clientId);
        }
      });
    }

    socket.emit("existing-users", otherUsers);

    socket.to(roomId).emit("user-joined", socket.id);
  });


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
    io.to(payload.target).emit("ice-candidate", {
      candidate: payload.candidate,
      from: socket.id,
    });
  });


  socket.on("disconnect", () => {
    console.log(`🔥: User disconnected: ${socket.id}`);
    io.emit("user-disconnected", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});