// ═══════════════════════════════════════════════
//  models/Message.js — Persisted message log
// ═══════════════════════════════════════════════
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    messageId:  { type: String, required: true, unique: true, index: true },
    roomCode:   { type: String, required: true, uppercase: true, index: true },
    sender:     { type: String, required: true },
    senderRole: { type: String },
    algo:       { type: String, default: 'XOR' },
    cipher:     { type: String, required: true },
    key:        { type: String, required: true },
    releaseTime:{ type: Number },
    scheduledAt:{ type: Date },
    sentAt:     { type: Date, default: Date.now },
    readBy:     { type: [String], default: [] },
    destroyed:  { type: Boolean, default: false },
    destroyedAt:{ type: Date },
    selfDestruct:      { type: Boolean, default: false },
    selfDestructDelay: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Message', MessageSchema);
