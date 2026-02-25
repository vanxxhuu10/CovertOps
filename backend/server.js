// ═══════════════════════════════════════════════════════════════════
//  CovertOps — server.js  (MongoDB + Socket.IO)
//  Persistent rooms, member callsigns, message history across systems
// ═══════════════════════════════════════════════════════════════════
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express   = require('express');
const http      = require('http');
const { Server }= require('socket.io');
const path      = require('path');
const mongoose  = require('mongoose');

const Room    = require('./models/Room');
const Message = require('./models/Message');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ── CONNECT TO MONGODB ─────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
})
.then(() => console.log(`[DB] Connected → ${process.env.MONGO_URI}`))
.catch(err => {
    console.error('[DB] Connection FAILED:', err.message);
    console.warn('[DB] Running in MEMORY-ONLY mode (data will not persist)');
});

// ════════════════════════════════════════════════════════════════════
//  REST API — for joining systems to read persisted room state
// ════════════════════════════════════════════════════════════════════

// GET /api/room/:roomCode  → Room info (members, online count)
app.get('/api/room/:roomCode', async (req, res) => {
    try {
        const code = req.params.roomCode.toUpperCase();
        const room = await Room.findOne({ roomCode: code });
        if (!room) return res.json({ roomCode: code, exists: false, members: [], onlineCount: 0 });
        res.json({
            roomCode:    room.roomCode,
            exists:      true,
            members:     room.members,
            onlineCount: room.getOnlineCount(),
            createdAt:   room.createdAt,
            lastActive:  room.lastActive,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/room/:roomCode/messages?limit=30  → Last N messages
app.get('/api/room/:roomCode/messages', async (req, res) => {
    try {
        const code  = req.params.roomCode.toUpperCase();
        const limit = Math.min(parseInt(req.query.limit) || 30, 100);
        const msgs  = await Message.find({ roomCode: code, destroyed: false })
            .sort({ sentAt: -1 }).limit(limit).lean();
        res.json(msgs.reverse());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rooms  → List all active rooms
app.get('/api/rooms', async (req, res) => {
    try {
        const rooms = await Room.find({}, 'roomCode members lastActive createdAt').lean();
        res.json(rooms.map(r => ({
            roomCode:    r.roomCode,
            totalMembers:r.members.length,
            onlineNow:   r.members.filter(m => m.isOnline).length,
            lastActive:  r.lastActive,
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════
//  SOCKET.IO — Real-time encrypted messaging
// ════════════════════════════════════════════════════════════════════

// In-memory fallback for OTP keys (fast access)
const memoryOTP = {}; // roomCode -> Set of usedKeys

async function broadcastRoomInfo(roomCode) {
    try {
        const room = await Room.findOne({ roomCode });
        if (!room) return;
        io.to(roomCode).emit('room-info', {
            roomCode,
            userCount:   room.getOnlineCount(),
            members:     room.members.map(m => ({
                callsign: m.callsign,
                role:     m.role,
                isOnline: m.isOnline,
                joinedAt: m.joinedAt,
            })),
        });
    } catch (e) {
        console.error('[broadcastRoomInfo]', e.message);
    }
}

io.on('connection', (socket) => {
    console.log(`[CONNECT] ${socket.id}`);

    let currentRoom     = null;
    let currentCallsign = null;
    let currentRole     = null;

    // ── JOIN ROOM ─────────────────────────────────────────────────────
    socket.on('join-room', async ({ roomCode, callsign, role }) => {
        // Leave previous room
        if (currentRoom) {
            socket.leave(currentRoom);
            try {
                await Room.updateOne(
                    { roomCode: currentRoom, 'members.callsign': currentCallsign },
                    { $set: { 'members.$.isOnline': false, 'members.$.socketId': null } }
                );
                broadcastRoomInfo(currentRoom);
            } catch (e) { console.error('[leave-room]', e.message); }
        }

        currentRoom     = roomCode.toUpperCase().trim();
        currentCallsign = callsign.toUpperCase().trim();
        currentRole     = role;
        socket.join(currentRoom);

        try {
            // Upsert room — create if first visit
            let room = await Room.findOne({ roomCode: currentRoom });
            if (!room) {
                room = new Room({ roomCode: currentRoom });
                await room.save();
                console.log(`[ROOM] Created: ${currentRoom}`);
            }

            // Upsert member in the room
            const existingIdx = room.members.findIndex(m => m.callsign === currentCallsign);
            if (existingIdx >= 0) {
                room.members[existingIdx].isOnline  = true;
                room.members[existingIdx].socketId  = socket.id;
                room.members[existingIdx].role      = currentRole;
                room.members[existingIdx].joinedAt  = new Date();
            } else {
                room.members.push({
                    callsign: currentCallsign,
                    role:     currentRole,
                    socketId: socket.id,
                    isOnline: true,
                    joinedAt: new Date(),
                });
            }
            room.lastActive = new Date();
            await room.save();

            const onlineCount = room.getOnlineCount();
            console.log(`[JOIN] ${currentCallsign} (${currentRole}) → ${currentRoom} [${onlineCount} online]`);

            socket.emit('join-ack', {
                roomCode:   currentRoom,
                userCount:  onlineCount,
                members:    room.members.map(m => ({ callsign: m.callsign, role: m.role, isOnline: m.isOnline })),
            });

            broadcastRoomInfo(currentRoom);

            // Replay last 20 messages on join
            const history = await Message.find({ roomCode: currentRoom, destroyed: false })
                .sort({ sentAt: -1 }).limit(20).lean();
            if (history.length > 0) {
                socket.emit('message-history', history.reverse());
            }

        } catch (e) {
            console.error('[join-room DB]', e.message);
            // Graceful fallback — join works even without DB
            socket.emit('join-ack', { roomCode: currentRoom, userCount: 1, members: [{ callsign: currentCallsign, role: currentRole, isOnline: true }] });
        }
    });

    // ── ENCRYPTED MESSAGE ─────────────────────────────────────────────
    socket.on('encrypted-message', async (data) => {
        if (!currentRoom) return;

        const { scheduledTime } = data;
        const delay = scheduledTime ? Math.max(0, new Date(scheduledTime).getTime() - Date.now()) : 0;
        const msgId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

        const payload = {
            ...data,
            messageId:  msgId,
            sender:     currentCallsign,
            role:       currentRole,
        };

        // Persist to DB
        try {
            await Message.create({
                messageId:         msgId,
                roomCode:          currentRoom,
                sender:            currentCallsign,
                senderRole:        currentRole,
                algo:              data.algo || 'XOR',
                cipher:            data.cipher,
                key:               data.key,
                releaseTime:       data.releaseTime,
                scheduledAt:       scheduledTime ? new Date(scheduledTime) : null,
                selfDestruct:      !!data.selfDestruct,
                selfDestructDelay: data.selfDestructDelay || 0,
            });
            await Room.updateOne({ roomCode: currentRoom }, { $set: { lastActive: new Date() } });
        } catch (e) {
            console.error('[message DB save]', e.message);
        }

        const dispatch = () => {
            socket.to(currentRoom).emit('encrypted-message', payload);
            console.log(`[TX] ${currentCallsign} → ${currentRoom} | ${msgId}`);
        };

        if (delay > 0) { console.log(`[SCHEDULED] +${delay}ms`); setTimeout(dispatch, delay); }
        else dispatch();
    });

    // ── READ RECEIPT ──────────────────────────────────────────────────
    socket.on('message-read', async ({ messageId, reader }) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('message-read', { messageId, reader });
        try {
            await Message.updateOne(
                { messageId },
                { $addToSet: { readBy: reader } }
            );
        } catch (e) { console.error('[read-receipt DB]', e.message); }
        console.log(`[READ] ${reader} → ${messageId}`);
    });

    // ── SELF DESTRUCT ─────────────────────────────────────────────────
    socket.on('self-destruct', async ({ messageId, delay }) => {
        if (!currentRoom) return;
        setTimeout(async () => {
            io.to(currentRoom).emit('self-destruct', { messageId });
            try {
                await Message.updateOne(
                    { messageId },
                    { $set: { destroyed: true, destroyedAt: new Date() } }
                );
            } catch (e) { console.error('[self-destruct DB]', e.message); }
            console.log(`[DESTRUCT] ${messageId}`);
        }, (delay || 0) * 1000);
    });

    // ── OTP KEY CHECK (server-side enforced) ──────────────────────────
    socket.on('check-otp-key', async ({ key }) => {
        if (!currentRoom) { socket.emit('otp-result', { allowed: false }); return; }

        // In-memory fast check first
        if (!memoryOTP[currentRoom]) memoryOTP[currentRoom] = new Set();
        if (memoryOTP[currentRoom].has(key)) {
            socket.emit('otp-result', { allowed: false, reason: 'KEY_ALREADY_CONSUMED' });
            return;
        }

        try {
            const room = await Room.findOne({ roomCode: currentRoom });
            if (room && room.usedOTPKeys.includes(key)) {
                memoryOTP[currentRoom].add(key);
                socket.emit('otp-result', { allowed: false, reason: 'KEY_ALREADY_CONSUMED' });
            } else {
                memoryOTP[currentRoom].add(key);
                await Room.updateOne({ roomCode: currentRoom }, { $addToSet: { usedOTPKeys: key } });
                socket.emit('otp-result', { allowed: true });
            }
        } catch (e) {
            // DB unavailable — use memory only
            memoryOTP[currentRoom].add(key);
            socket.emit('otp-result', { allowed: true });
        }
    });

    // ── DISCONNECT ────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
        console.log(`[DISCONNECT] ${currentCallsign || socket.id}`);
        if (!currentRoom || !currentCallsign) return;

        try {
            await Room.updateOne(
                { roomCode: currentRoom, 'members.callsign': currentCallsign },
                { $set: { 'members.$.isOnline': false, 'members.$.socketId': null } }
            );
            broadcastRoomInfo(currentRoom);
        } catch (e) { console.error('[disconnect DB]', e.message); }
    });
});

// ── START ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n╔═══════════════════════════════════════╗`);
    console.log(`║  CovertOps Server  →  port ${PORT}       ║`);
    console.log(`║  DB: ${(process.env.MONGO_URI || '').substring(0, 37)}  ║`);
    console.log(`╚═══════════════════════════════════════╝\n`);
});
