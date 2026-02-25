const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Track per-room data
const rooms = {}; // roomCode -> { users: Map<socketId, {callsign, role}>, usedOTPKeys: Set }

function ensureRoom(roomCode) {
    if (!rooms[roomCode]) {
        rooms[roomCode] = { users: new Map(), usedOTPKeys: new Set() };
    }
    return rooms[roomCode];
}

function getRoomUserCount(roomCode) {
    return rooms[roomCode] ? rooms[roomCode].users.size : 0;
}

function broadcastRoomInfo(roomCode) {
    if (!rooms[roomCode]) return;
    const users = Array.from(rooms[roomCode].users.values());
    io.to(roomCode).emit('room-info', {
        roomCode,
        userCount: users.length,
        users: users.map(u => ({ callsign: u.callsign, role: u.role }))
    });
}

io.on('connection', (socket) => {
    console.log(`[CONNECT] Socket: ${socket.id}`);

    let currentRoom = null;
    let currentCallsign = null;
    let currentRole = null;

    // ── JOIN ROOM ──────────────────────────────────────────────────
    socket.on('join-room', ({ roomCode, callsign, role }) => {
        if (currentRoom) {
            socket.leave(currentRoom);
            if (rooms[currentRoom]) {
                rooms[currentRoom].users.delete(socket.id);
                broadcastRoomInfo(currentRoom);
            }
        }

        currentRoom = roomCode.toUpperCase().trim();
        currentCallsign = callsign;
        currentRole = role;

        socket.join(currentRoom);
        const room = ensureRoom(currentRoom);
        room.users.set(socket.id, { callsign, role });

        console.log(`[JOIN] ${callsign} (${role}) → Room: ${currentRoom}`);
        socket.emit('join-ack', { roomCode: currentRoom, userCount: room.users.size });
        broadcastRoomInfo(currentRoom);
    });

    // ── ENCRYPTED MESSAGE ──────────────────────────────────────────
    socket.on('encrypted-message', (data) => {
        if (!currentRoom) return;

        const { scheduledTime } = data;
        const delay = scheduledTime ? new Date(scheduledTime).getTime() - Date.now() : 0;
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const payload = { ...data, messageId, sender: currentCallsign, role: currentRole };

        const dispatch = () => {
            socket.to(currentRoom).emit('encrypted-message', payload);
            console.log(`[TX] ${currentCallsign} → Room: ${currentRoom} | ID: ${messageId}`);
        };

        if (delay > 0) {
            console.log(`[SCHEDULED] Delivery in ${delay}ms`);
            setTimeout(dispatch, delay);
        } else {
            dispatch();
        }
    });

    // ── READ RECEIPT ───────────────────────────────────────────────
    socket.on('message-read', ({ messageId, reader }) => {
        if (!currentRoom) return;
        // Broadcast to everyone else in the room (sender will see it)
        socket.to(currentRoom).emit('message-read', { messageId, reader });
        console.log(`[READ] ${reader} read message ${messageId}`);
    });

    // ── SELF DESTRUCT ──────────────────────────────────────────────
    socket.on('self-destruct', ({ messageId, delay }) => {
        if (!currentRoom) return;
        setTimeout(() => {
            io.to(currentRoom).emit('self-destruct', { messageId });
            console.log(`[DESTRUCT] Message ${messageId} destroyed`);
        }, delay * 1000);
    });

    // ── OTP KEY CHECK ──────────────────────────────────────────────
    socket.on('check-otp-key', ({ key }) => {
        if (!currentRoom) { socket.emit('otp-result', { allowed: false }); return; }
        const room = ensureRoom(currentRoom);
        if (room.usedOTPKeys.has(key)) {
            socket.emit('otp-result', { allowed: false, reason: 'KEY_ALREADY_CONSUMED' });
        } else {
            room.usedOTPKeys.add(key);
            socket.emit('otp-result', { allowed: true });
        }
    });

    // ── DISCONNECT ─────────────────────────────────────────────────
    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] ${currentCallsign || socket.id}`);
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].users.delete(socket.id);
            broadcastRoomInfo(currentRoom);
            if (rooms[currentRoom].users.size === 0) {
                delete rooms[currentRoom];
                console.log(`[ROOM] ${currentRoom} dissolved (empty)`);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[SERVER] CovertOps running on http://localhost:${PORT}`);
});
