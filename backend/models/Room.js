// ═══════════════════════════════════════════════
//  models/Room.js — Room + Member schema
// ═══════════════════════════════════════════════
const mongoose = require('mongoose');

const MemberSchema = new mongoose.Schema({
    callsign:  { type: String, required: true, uppercase: true, trim: true },
    role:      { type: String, enum: ['COMMANDER', 'FIELD_AGENT'], default: 'FIELD_AGENT' },
    socketId:  { type: String },
    joinedAt:  { type: Date, default: Date.now },
    isOnline:  { type: Boolean, default: true },
}, { _id: false });

const RoomSchema = new mongoose.Schema({
    roomCode:    { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    createdAt:   { type: Date, default: Date.now },
    lastActive:  { type: Date, default: Date.now },
    members:     { type: [MemberSchema], default: [] },
    usedOTPKeys: { type: [String], default: [] },
});

RoomSchema.methods.getOnlineCount = function () {
    return this.members.filter(m => m.isOnline).length;
};

module.exports = mongoose.model('Room', RoomSchema);
