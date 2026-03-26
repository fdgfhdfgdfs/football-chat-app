import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import crypto from "crypto";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  const PORT = 3000;

  type Player = { id: string; name: string; score: number; connected: boolean; socketId: string };
  type Message = { id: string; senderId: string; senderName: string; text: string; timestamp: number };
  type Submission = { playerId: string; playerName: string; answer: string; wager: number; judged: boolean; isCorrect?: boolean };
  
  type Room = {
    adminId: string;
    players: Player[];
    messages: Message[];
    gameState: 'waiting' | 'asking' | 'playing' | 'judging';
    currentJudgeId: string | null;
    currentQuestion: string | null;
    submissions: Submission[];
    usedWagers: Record<string, number[]>;
    timerEnd: number | null;
    timerId?: NodeJS.Timeout;
  };

  const rooms = new Map<string, Room>();

  const generateId = () => crypto.randomBytes(16).toString("hex");

  function getRoomData(room: Room) {
    const { timerId, ...rest } = room;
    return rest;
  }

  function handleTimerEnd(roomCode: string) {
    const room = rooms.get(roomCode);
    if (!room || room.gameState !== 'playing') return;

    const activePlayers = room.players.filter(p => p.connected && p.id !== room.currentJudgeId);
    
    activePlayers.forEach(player => {
      const hasSubmitted = room.submissions.some(s => s.playerId === player.id);
      if (!hasSubmitted) {
        // Find lowest available wager
        const used = room.usedWagers[player.id] || [];
        let lowestWager = 1;
        for (let i = 1; i <= 20; i++) {
          if (!used.includes(i)) {
            lowestWager = i;
            break;
          }
        }

        room.submissions.push({
          playerId: player.id,
          playerName: player.name,
          answer: "لم يجب",
          wager: lowestWager,
          judged: true, // Auto judge as incorrect
          isCorrect: false
        });
        
        if (!room.usedWagers[player.id]) room.usedWagers[player.id] = [];
        room.usedWagers[player.id].push(lowestWager);
      }
    });

    room.gameState = 'judging';
    room.timerEnd = null;
    io.to(roomCode).emit("room-update", getRoomData(room));
  }

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("create-room", ({ userName, userId }) => {
      const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
      
      const systemMsg: Message = {
        id: generateId(),
        senderId: "system",
        senderName: "النظام",
        text: `تم إنشاء الغرفة بواسطة ${userName}`,
        timestamp: Date.now()
      };

      rooms.set(roomCode, {
        adminId: userId,
        players: [{ id: userId, name: userName || "مستخدم", score: 0, connected: true, socketId: socket.id }],
        messages: [systemMsg],
        gameState: 'waiting',
        currentJudgeId: null,
        currentQuestion: null,
        submissions: [],
        usedWagers: { [userId]: [] },
        timerEnd: null
      });
      socket.join(roomCode);
      socket.emit("room-created", { roomCode });
      io.to(roomCode).emit("room-update", getRoomData(rooms.get(roomCode)!));
    });

    socket.on("join-room", ({ roomCode, userName, userId }) => {
      const room = rooms.get(roomCode);
      if (!room) {
        socket.emit("error", "الغرفة غير موجودة");
        return;
      }
      
      const playerName = userName || "مستخدم";
      const existingPlayer = room.players.find(p => p.id === userId);
      
      if (existingPlayer) {
        existingPlayer.socketId = socket.id;
        existingPlayer.connected = true;
        existingPlayer.name = playerName;
      } else {
        room.players.push({ id: userId, name: playerName, score: 0, connected: true, socketId: socket.id });
        if (!room.usedWagers[userId]) room.usedWagers[userId] = [];
        const joinMsg: Message = {
          id: generateId(),
          senderId: "system",
          senderName: "النظام",
          text: `انضم ${playerName} إلى الغرفة`,
          timestamp: Date.now()
        };
        room.messages.push(joinMsg);
      }
      
      socket.join(roomCode);
      socket.emit("room-joined", { roomCode });
      io.to(roomCode).emit("room-update", getRoomData(room));
    });

    socket.on("send-message", ({ roomCode, text, userId }) => {
      const room = rooms.get(roomCode);
      if (!room) return;

      const player = room.players.find((p) => p.id === userId);
      if (!player) return;

      const message: Message = {
        id: generateId(),
        senderId: player.id,
        senderName: player.name,
        text,
        timestamp: Date.now()
      };

      room.messages.push(message);
      if (room.messages.length > 100) room.messages.shift();

      io.to(roomCode).emit("new-message", message);
    });

    // Game Events
    socket.on("start-challenge", ({ roomCode, userId }) => {
      const room = rooms.get(roomCode);
      if (room && room.adminId === userId && room.gameState === 'waiting') {
        room.gameState = 'asking';
        room.currentJudgeId = room.adminId;
        room.submissions = [];
        room.currentQuestion = null;
        io.to(roomCode).emit("room-update", getRoomData(room));
      }
    });

    socket.on("submit-question", ({ roomCode, question, userId }) => {
      const room = rooms.get(roomCode);
      if (room && room.gameState === 'asking' && room.currentJudgeId === userId) {
        room.gameState = 'playing';
        room.currentQuestion = question;
        room.submissions = [];
        room.timerEnd = Date.now() + 15000; // 15 seconds
        
        if (room.timerId) clearTimeout(room.timerId);
        room.timerId = setTimeout(() => {
          handleTimerEnd(roomCode);
        }, 15000);

        io.to(roomCode).emit("room-update", getRoomData(room));
      }
    });

    socket.on("submit-answer", ({ roomCode, answer, wager, userId }) => {
      const room = rooms.get(roomCode);
      if (!room || room.gameState !== 'playing') return;

      const player = room.players.find((p) => p.id === userId);
      if (!player || player.id === room.currentJudgeId) return;

      const existing = room.submissions.find(s => s.playerId === userId);
      if (existing) return;

      if (room.usedWagers[userId]?.includes(wager)) return;

      room.submissions.push({
        playerId: player.id,
        playerName: player.name,
        answer,
        wager,
        judged: false
      });
      
      if (!room.usedWagers[userId]) room.usedWagers[userId] = [];
      room.usedWagers[userId].push(wager);

      const activePlayers = room.players.filter(p => p.connected && p.id !== room.currentJudgeId);
      if (room.submissions.length >= activePlayers.length) {
        if (room.timerId) clearTimeout(room.timerId);
        room.gameState = 'judging';
        room.timerEnd = null;
      }

      io.to(roomCode).emit("room-update", getRoomData(room));
    });

    socket.on("judge-answer", ({ roomCode, playerId, isCorrect, userId }) => {
      const room = rooms.get(roomCode);
      if (!room || room.currentJudgeId !== userId || room.gameState !== 'judging') return;

      const submission = room.submissions.find(s => s.playerId === playerId);
      if (submission && !submission.judged) {
        submission.judged = true;
        submission.isCorrect = isCorrect;

        if (isCorrect) {
          const player = room.players.find(p => p.id === playerId);
          if (player) {
            player.score += submission.wager;
          }
        }
        io.to(roomCode).emit("room-update", getRoomData(room));
      }
    });

    socket.on("next-turn", ({ roomCode, userId }) => {
      const room = rooms.get(roomCode);
      if (room && room.currentJudgeId === userId && room.gameState === 'judging') {
        const currentIndex = room.players.findIndex(p => p.id === room.currentJudgeId);
        let nextIndex = (currentIndex + 1) % room.players.length;
        
        let loops = 0;
        while (!room.players[nextIndex].connected && loops < room.players.length) {
          nextIndex = (nextIndex + 1) % room.players.length;
          loops++;
        }

        room.currentJudgeId = room.players[nextIndex].id;
        room.gameState = 'asking';
        room.currentQuestion = null;
        room.submissions = [];
        io.to(roomCode).emit("room-update", getRoomData(room));
      }
    });

    socket.on("leave-room", ({ roomCode, userId }) => {
      socket.leave(roomCode);
      const room = rooms.get(roomCode);
      if (!room) return;

      const playerIndex = room.players.findIndex((p) => p.id === userId);
      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players.splice(playerIndex, 1);
        
        const leaveMsg: Message = {
          id: generateId(),
          senderId: "system",
          senderName: "النظام",
          text: `غادر ${playerName} الغرفة`,
          timestamp: Date.now()
        };
        room.messages.push(leaveMsg);

        if (room.players.length === 0) {
          if (room.timerId) clearTimeout(room.timerId);
          rooms.delete(roomCode);
        } else if (room.adminId === userId && room.players.length > 0) {
          // Reassign admin if admin leaves
          room.adminId = room.players[0].id;
          io.to(roomCode).emit("room-update", getRoomData(room));
        } else {
          io.to(roomCode).emit("room-update", getRoomData(room));
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      for (const [roomCode, room] of rooms.entries()) {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          player.connected = false;
          
          setTimeout(() => {
            const currentRoom = rooms.get(roomCode);
            if (currentRoom) {
              const p = currentRoom.players.find(p => p.id === player.id);
              if (p && !p.connected) {
                currentRoom.players = currentRoom.players.filter(p => p.id !== player.id);
                const leaveMsg: Message = {
                  id: generateId(),
                  senderId: "system",
                  senderName: "النظام",
                  text: `غادر ${player.name} الغرفة`,
                  timestamp: Date.now()
                };
                currentRoom.messages.push(leaveMsg);
                
                if (currentRoom.players.length === 0) {
                  if (currentRoom.timerId) clearTimeout(currentRoom.timerId);
                  rooms.delete(roomCode);
                } else if (currentRoom.adminId === player.id && currentRoom.players.length > 0) {
                  currentRoom.adminId = currentRoom.players[0].id;
                  io.to(roomCode).emit("room-update", getRoomData(currentRoom));
                } else {
                  io.to(roomCode).emit("room-update", getRoomData(currentRoom));
                }
              }
            }
          }, 15000); // 15 seconds grace period
          
          io.to(roomCode).emit("room-update", getRoomData(room));
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
