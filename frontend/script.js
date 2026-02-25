// ═══════════════════════════════════════════════════════════════
//  CovertOps — Full Feature Script
//  Features: Login/Roles, Rooms, Multi-Cipher, Key Strength,
//  Self-Destruct, Read Receipt, Freq Analysis, Benchmark,
//  Hamming Distance, Brute-Force Sim, OTP, Message History
// ═══════════════════════════════════════════════════════════════

const socket = io();

// ── STATE ────────────────────────────────────────────────────────
let currentCallsign = '';
let currentRole     = '';
let currentRoom     = '';
let currentAlgo     = 'XOR';
let lastReceivedKey   = null;
let lastReceivedAlgo  = 'XOR';
let lastReceivedMsgId = null;
let otpMode    = false;
let usedOTPKeys = new Set();
let bfInterval = null;
let historyCount = 0;
let logCount     = 0;
const startTime  = Date.now();
const SESSION_ID = 'SIG-' + Math.random().toString(36).substr(2,6).toUpperCase() + '-' + Date.now().toString().slice(-4);

// ── DOM REFERENCES ───────────────────────────────────────────────
const loginModal        = document.getElementById('login-modal');
const mainApp           = document.getElementById('main-app');
const loginCallsign     = document.getElementById('login-callsign');
const loginRoom         = document.getElementById('login-room');
const loginBtn          = document.getElementById('login-btn');
const roomDisplay       = document.getElementById('room-display');
const userCountEl       = document.getElementById('user-count');
const roleBadge         = document.getElementById('role-badge');
const roleLockNotice    = document.getElementById('role-lock-notice');
const micBtn            = document.getElementById('mic-btn');
const micStatus         = document.getElementById('mic-status');
const plaintextInput    = document.getElementById('plaintext-input');
const encryptBtn        = document.getElementById('encrypt-btn');
const generatedKeyEl    = document.getElementById('generated-key');
const outgoingCipherEl  = document.getElementById('outgoing-cipher');
const incomingCipherEl  = document.getElementById('incoming-cipher');
const decryptionKeyInput= document.getElementById('decryption-key-input');
const decryptBtn        = document.getElementById('decrypt-btn');
const decryptedOutputEl = document.getElementById('decrypted-output');
const clockDisplay      = document.getElementById('clock');
const connectionStatus  = document.getElementById('connection-status');
const scheduleInput     = document.getElementById('schedule-input');
const timeLockInput     = document.getElementById('time-lock-input');
const incomingKeyDisplay= document.getElementById('incoming-key-display');
const signalBar         = document.getElementById('signal-bar');
const glitchLayer       = document.getElementById('glitch-layer');
const sessionIdEl       = document.getElementById('session-id');
const uptimeEl          = document.getElementById('uptime-display');
const logCountEl        = document.getElementById('log-count');
const messageLogEl      = document.getElementById('message-log');
const autofillBtn       = document.getElementById('autofill-btn');
const clearBtn          = document.getElementById('clear-btn');
const copyCipherBtn     = document.getElementById('copy-cipher-btn');
const otpToggle         = document.getElementById('otp-toggle');
const otpStatusEl       = document.getElementById('otp-status');
const destructToggle    = document.getElementById('destruct-toggle');
const destructTimerGroup= document.getElementById('destruct-timer-group');
const destructSeconds   = document.getElementById('destruct-seconds');
const destructCountdown = document.getElementById('destruct-countdown');
const destructTimerDisp = document.getElementById('destruct-timer-display');
const senderInfoEl      = document.getElementById('sender-info');
const senderCallsignEl  = document.getElementById('sender-callsign');
const rxAlgoEl          = document.getElementById('rx-algo');
const readReceiptStatusEl=document.getElementById('read-receipt-status');
const benchEncEl        = document.getElementById('bench-enc');
const benchDecEl        = document.getElementById('bench-dec');
const hammingDistEl     = document.getElementById('hamming-dist');
const keyStrengthFill   = document.getElementById('key-strength-fill');
const keyStrengthLabel  = document.getElementById('key-strength-label');
const historyTbody      = document.getElementById('history-tbody');
const historyCountEl    = document.getElementById('history-count');
const compareToggle     = document.getElementById('compare-toggle');
const comparePanel      = document.getElementById('compare-panel');
const freqToggle        = document.getElementById('freq-toggle');
const freqPanel         = document.getElementById('freq-panel');
const historyToggle     = document.getElementById('history-toggle');
const historyPanelBody  = document.getElementById('history-panel-body');
const bfToggle          = document.getElementById('bf-toggle');
const bfPanel           = document.getElementById('bf-panel');
const bfConsole         = document.getElementById('bf-console');
const bfStartBtn        = document.getElementById('bf-start-btn');
const bfStopBtn         = document.getElementById('bf-stop-btn');
const evGrid            = document.getElementById('ev-grid');
const freqCanvas        = document.getElementById('freq-canvas');
const wfCanvas          = document.getElementById('waveform-canvas');

sessionIdEl.textContent = `SESSION: ${SESSION_ID}`;

// ── LOGIN ────────────────────────────────────────────────────────
loginBtn.addEventListener('click', () => {
    const callsign = loginCallsign.value.trim().toUpperCase();
    const room     = loginRoom.value.trim().toUpperCase() || 'ALPHA-1';
    const role     = document.querySelector('input[name="role"]:checked').value;
    if (!callsign) { loginCallsign.style.borderColor = 'var(--danger)'; return; }

    currentCallsign = callsign;
    currentRoom     = room;
    currentRole     = role;

    socket.emit('join-room', { roomCode: room, callsign, role });

    loginModal.style.display   = 'none';
    mainApp.style.display      = 'flex';

    roomDisplay.textContent = room;
    roleBadge.textContent   = role;
    roleBadge.className     = role;
    addLog(`AUTH: ${callsign} (${role}) JOINED ROOM ${room}`);

    // Role-based UI restriction
    if (role === 'FIELD_AGENT') {
        roleLockNotice.style.display = 'block';
        encryptBtn.disabled = true;
        micBtn.disabled     = true;
    }
    updateTimezoneClocks();
});

// ── SOCKET ROOM EVENTS ───────────────────────────────────────────
socket.on('join-ack', ({ roomCode, userCount, members }) => {
    userCountEl.textContent = userCount;
    renderMemberRoster(members || []);
    addLog(`ROOM ${roomCode}: JOINED. USERS: ${userCount}`);
});

socket.on('room-info', ({ userCount, members }) => {
    userCountEl.textContent = userCount;
    if (members) renderMemberRoster(members);
});

// ── MESSAGE HISTORY REPLAY (from DB on join) ──────────────────────
socket.on('message-history', (messages) => {
    if (!messages || messages.length === 0) return;
    addLog(`DB_RESTORE: ${messages.length} MESSAGES LOADED FROM VAULT`);
    messages.forEach(msg => {
        addToHistory({
            from:   msg.sender,
            algo:   msg.algo,
            key:    msg.key,
            cipher: msg.cipher,
            status: msg.destroyed ? 'destroyed' : msg.readBy && msg.readBy.length > 0 ? 'decrypted' : 'received',
            msgId:  msg.messageId,
        });
    });
});

// ── MEMBER ROSTER RENDERER ────────────────────────────────────────
function renderMemberRoster(members) {
    const roster = document.getElementById('member-roster');
    if (!roster) return;
    roster.innerHTML = '';
    members.forEach(m => {
        const pill = document.createElement('span');
        pill.className = `member-pill ${m.isOnline ? 'online' : 'offline'} ${m.role === 'COMMANDER' ? 'cmd' : ''}`;
        pill.textContent = `${m.isOnline ? '●' : '○'} ${m.callsign} [${m.role === 'COMMANDER' ? 'CMD' : 'AGT'}]`;
        pill.title = `Role: ${m.role}\nStatus: ${m.isOnline ? 'ONLINE' : 'OFFLINE'}`;
        roster.appendChild(pill);
    });
}

// ── ALGORITHM SELECTOR ───────────────────────────────────────────
document.querySelectorAll('.algo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.algo-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentAlgo = btn.dataset.algo;
        addLog(`ALGO_SWITCH: ${currentAlgo} SELECTED`);
    });
});

// ── OTP & SELF-DESTRUCT TOGGLES ───────────────────────────────────
otpToggle.addEventListener('change', () => {
    otpMode = otpToggle.checked;
    otpStatusEl.textContent = otpMode ? 'ACTIVE' : 'INACTIVE';
    otpStatusEl.className   = otpMode ? 'active' : '';
    addLog(`OTP_MODE: ${otpMode ? 'ENABLED' : 'DISABLED'}`);
});

destructToggle.addEventListener('change', () => {
    destructTimerGroup.style.display = destructToggle.checked ? 'flex' : 'none';
});

// ── COLLAPSIBLE SECTIONS ─────────────────────────────────────────
function setupToggle(btn, panel) {
    btn.addEventListener('click', () => {
        const open = panel.style.display !== 'none';
        panel.style.display = open ? 'none' : 'block';
        btn.classList.toggle('open', !open);
    });
}
setupToggle(compareToggle, comparePanel);
setupToggle(freqToggle, freqPanel);
setupToggle(historyToggle, historyPanelBody);
setupToggle(bfToggle, bfPanel);

// ── CIPHER ALGORITHMS ─────────────────────────────────────────────
function encryptXOR(text, key) {
    let res = [];
    for (let i = 0; i < text.length; i++) res.push(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    return btoa(String.fromCharCode(...res));
}
function decryptXOR(cipher, key) {
    try {
        const d = atob(cipher); let r = '';
        for (let i = 0; i < d.length; i++) r += String.fromCharCode(d.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        return r;
    } catch { return 'ERROR: BAD_CIPHER_OR_KEY'; }
}

function encryptCaesar(text, shift) {
    shift = parseInt(shift.slice(-2) || '3') % 26 || 3;
    return text.split('').map(c => {
        if (c >= 'A' && c <= 'Z') return String.fromCharCode((c.charCodeAt(0) - 65 + shift) % 26 + 65);
        if (c >= 'a' && c <= 'z') return String.fromCharCode((c.charCodeAt(0) - 97 + shift) % 26 + 97);
        return c;
    }).join('');
}
function decryptCaesar(text, shift) {
    shift = parseInt(shift.slice(-2) || '3') % 26 || 3;
    return encryptCaesar(text, 26 - shift);
}

function encryptVigenere(text, key) {
    let res = '', ki = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        const k = key.charCodeAt(ki % key.length) % 26;
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
            const base = c < 97 ? 65 : 97;
            res += String.fromCharCode((c - base + k) % 26 + base);
            ki++;
        } else { res += text[i]; }
    }
    return res;
}
function decryptVigenere(text, key) {
    let res = '', ki = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        const k = key.charCodeAt(ki % key.length) % 26;
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
            const base = c < 97 ? 65 : 97;
            res += String.fromCharCode((c - base - k + 26) % 26 + base);
            ki++;
        } else { res += text[i]; }
    }
    return res;
}

function encryptAES(text, key) {
    return CryptoJS.AES.encrypt(text, key).toString();
}
function decryptAES(cipher, key) {
    try {
        const bytes = CryptoJS.AES.decrypt(cipher, key);
        return bytes.toString(CryptoJS.enc.Utf8) || 'ERROR: BAD_CIPHER_OR_KEY';
    } catch { return 'ERROR: BAD_CIPHER_OR_KEY'; }
}

function encryptWith(text, key, algo) {
    switch(algo) {
        case 'CAESAR':   return encryptCaesar(text, key);
        case 'VIGENERE': return encryptVigenere(text, key);
        case 'AES':      return encryptAES(text, key);
        default:         return encryptXOR(text, key);
    }
}
function decryptWith(cipher, key, algo) {
    switch(algo) {
        case 'CAESAR':   return decryptCaesar(cipher, key);
        case 'VIGENERE': return decryptVigenere(cipher, key);
        case 'AES':      return decryptAES(cipher, key);
        default:         return decryptXOR(cipher, key);
    }
}

// ── KEY TOOLS ─────────────────────────────────────────────────────
function generateKey() { return Date.now().toString(); }

function scoreKeyStrength(key) {
    let score = 0;
    if (key.length >= 8)  score += 30;
    if (key.length >= 13) score += 20;
    if (/\d/.test(key))  score += 20;
    if (/[a-z]/.test(key)) score += 15;
    if (/[A-Z]/.test(key)) score += 15;
    const unique = new Set(key).size;
    score += Math.min(unique * 2, 20);
    return Math.min(score, 100);
}

function updateKeyStrength(key) {
    const score = scoreKeyStrength(key);
    keyStrengthFill.style.width = score + '%';
    if (score < 40) {
        keyStrengthFill.className = 'key-strength-fill weak';
        keyStrengthLabel.textContent = 'WEAK';
    } else if (score < 70) {
        keyStrengthFill.className = 'key-strength-fill medium';
        keyStrengthLabel.textContent = 'MODERATE';
    } else {
        keyStrengthFill.className = 'key-strength-fill strong';
        keyStrengthLabel.textContent = 'STRONG';
    }
}

// ── HAMMING DISTANCE ──────────────────────────────────────────────
function hammingDistance(str1, str2) {
    let bits = 0;
    const len = Math.min(str1.length, str2.length);
    for (let i = 0; i < len; i++) {
        let xor = str1.charCodeAt(i) ^ str2.charCodeAt(i);
        while (xor) { bits += xor & 1; xor >>= 1; }
    }
    return bits;
}

// ── FREQUENCY ANALYSIS CHART ──────────────────────────────────────
function drawFreqChart(text) {
    const ctx = freqCanvas.getContext('2d');
    const W = freqCanvas.width, H = freqCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,5,0,0.8)';
    ctx.fillRect(0, 0, W, H);

    const freq = {};
    for (const c of text) freq[c] = (freq[c] || 0) + 1;
    const entries = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,40);
    const maxFreq = entries[0] ? entries[0][1] : 1;

    const barW = Math.floor(W / entries.length) - 1;
    entries.forEach(([ch, count], i) => {
        const barH = Math.floor((count / maxFreq) * (H - 16));
        const x = i * (barW + 1);
        const grad = ctx.createLinearGradient(x, H - barH, x, H);
        grad.addColorStop(0, '#00ff41');
        grad.addColorStop(1, '#003300');
        ctx.fillStyle = grad;
        ctx.fillRect(x, H - barH - 1, barW, barH);
        ctx.fillStyle = 'rgba(0,255,65,0.5)';
        ctx.font = '7px Courier New';
        if (barW > 6) {
            ctx.fillText(ch === ' ' ? '·' : ch, x + 1, H - 2);
        }
    });

    // Axis line
    ctx.strokeStyle = '#003300';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H-10); ctx.lineTo(W, H-10); ctx.stroke();
}

// ── CIPHER COMPARISON MATRIX ──────────────────────────────────────
function updateCipherComparison(text, key) {
    if (!text) return;
    document.getElementById('cmp-xor').textContent    = encryptXOR(text, key).slice(0, 60) + (text.length > 20 ? '...' : '');
    document.getElementById('cmp-caesar').textContent  = encryptCaesar(text, key).slice(0, 60) + '...';
    document.getElementById('cmp-vig').textContent     = encryptVigenere(text, key).slice(0, 60) + '...';
}

// ── BRUTE FORCE SIMULATION ────────────────────────────────────────
function runBruteForce() {
    const cipher = outgoingCipherEl.textContent;
    if (!cipher || currentAlgo !== 'CAESAR') {
        bfConsole.innerHTML = '<div class="bf-line">[ERROR] SELECT CAESAR ALGO AND ENCRYPT A MESSAGE FIRST</div>';
        return;
    }
    bfConsole.innerHTML = '';
    let shift = 0;
    bfStartBtn.disabled = true;
    bfStopBtn.disabled  = false;
    addLog('ATTACK_SIM: CAESAR BRUTE-FORCE INITIATED');

    bfInterval = setInterval(() => {
        if (shift >= 26) {
            clearInterval(bfInterval);
            bfStartBtn.disabled = false;
            bfStopBtn.disabled  = true;
            const line = document.createElement('div');
            line.className = 'bf-line';
            line.textContent = '[RESULT] EXHAUSTED 26 KEY SPACE — CIPHER UNBROKEN';
            bfConsole.appendChild(line);
            addLog('ATTACK_SIM: BRUTE-FORCE EXHAUSTED — CIPHER HELD');
            return;
        }
        const attempt = decryptCaesar(cipher, String(shift).padStart(13, '0'));
        const isReadable = /^[a-zA-Z\s.,!?'"-]{5,}$/.test(attempt);
        const line = document.createElement('div');
        line.className = isReadable ? 'bf-line success' : 'bf-line';
        line.textContent = `[SHIFT ${String(shift).padStart(2,'0')}] ${attempt.slice(0, 50)}${isReadable ? ' ← POSSIBLE MATCH' : ''}`;
        bfConsole.appendChild(line);
        bfConsole.scrollTop = bfConsole.scrollHeight;
        shift++;
    }, 180);
}
bfStartBtn.addEventListener('click', runBruteForce);
bfStopBtn.addEventListener('click', () => {
    clearInterval(bfInterval); bfStartBtn.disabled = false; bfStopBtn.disabled = true;
    addLog('ATTACK_SIM: ABORTED BY OPERATOR');
});

// ── ENCRYPT & TRANSMIT ─────────────────────────────────────────────
encryptBtn.addEventListener('click', () => {
    const text = plaintextInput.value.trim();
    if (!text) { alert('ERROR: EMPTY_BUFFER'); return; }
    if (!currentRoom) { alert('ERROR: NOT_IN_A_ROOM'); return; }

    const key = generateKey();
    const t0  = performance.now();
    const cipher = encryptWith(text, key, currentAlgo);
    const t1  = performance.now();
    const encUs = ((t1 - t0) * 1000).toFixed(1);

    const hamming = hammingDistance(text, cipher);

    generatedKeyEl.textContent = key;
    outgoingCipherEl.textContent = cipher;
    benchEncEl.textContent = encUs;
    hammingDistEl.textContent = hamming;
    updateKeyStrength(key);
    updateCipherComparison(text, key);
    drawFreqChart(cipher);
    triggerGlitch();
    wfActive = true; setTimeout(() => { wfActive = false; }, 1500);

    const scheduledTime = scheduleInput.value ? new Date(scheduleInput.value).toISOString() : null;
    const effectiveTime = scheduledTime ? new Date(scheduledTime).getTime() : Date.now();
    const lockSec = parseInt(timeLockInput.value) || 0;
    const releaseTime = effectiveTime + lockSec * 1000;
    const msgId = `TX-${Date.now()}`;

    socket.emit('encrypted-message', {
        cipher, key, algo: currentAlgo,
        scheduledTime, releaseTime, messageId: msgId
    });

    if (destructToggle.checked) {
        socket.emit('self-destruct', { messageId: msgId, delay: parseInt(destructSeconds.value) || 10 });
    }

    addLog(`TX: ENCRYPTED (${currentAlgo}) | KEY=${key.slice(-6)} | ENC=${encUs}µs | HAMMING=${hamming}`);
    addToHistory({ from: currentCallsign, algo: currentAlgo, key, cipher, status: 'sent', msgId });
});

// ── DECRYPT ───────────────────────────────────────────────────────
decryptBtn.addEventListener('click', () => {
    const cipher = incomingCipherEl.textContent;
    const key    = decryptionKeyInput.value;
    if (!cipher || cipher === '...Waiting for transmission...') { alert('ERROR: NO_DATA'); return; }
    if (!key) { alert('ERROR: MISSING_KEY'); return; }

    // OTP enforcement
    if (otpMode) {
        if (usedOTPKeys.has(key)) {
            decryptedOutputEl.textContent = '⛔ OTP_VIOLATION: KEY ALREADY CONSUMED — ACCESS DENIED';
            otpStatusEl.textContent = 'BURNED';
            otpStatusEl.className   = 'used';
            addLog('OTP_VIOLATION: REUSE ATTEMPT BLOCKED');
            return;
        }
        usedOTPKeys.add(key);
        otpStatusEl.textContent = 'KEY BURNED';
        otpStatusEl.className   = 'used';
    }

    const t0 = performance.now();
    const plain = decryptWith(cipher, key, lastReceivedAlgo || 'XOR');
    const t1 = performance.now();
    const decUs = ((t1 - t0) * 1000).toFixed(1);

    decryptedOutputEl.textContent = plain;
    benchDecEl.textContent = decUs;
    drawFreqChart(cipher);
    triggerGlitch();

    // Read receipt
    if (lastReceivedMsgId) {
        socket.emit('message-read', { messageId: lastReceivedMsgId, reader: currentCallsign });
    }

    addLog(`RX: DECRYPTED (${lastReceivedAlgo}) | DEC=${decUs}µs | LEN=${plain.length}`);

    // Update history status
    if (lastReceivedMsgId) {
        updateHistoryStatus(lastReceivedMsgId, 'decrypted');
    }
});

// ── SOCKET: RECEIVE MESSAGE ───────────────────────────────────────
socket.on('encrypted-message', (data) => {
    incomingCipherEl.textContent = data.cipher;
    incomingCipherEl.classList.remove('empty');
    lastReceivedAlgo  = data.algo || 'XOR';
    lastReceivedMsgId = data.messageId;

    senderInfoEl.style.display  = 'flex';
    senderCallsignEl.textContent = data.sender || 'UNKNOWN';
    rxAlgoEl.textContent         = lastReceivedAlgo;
    readReceiptStatusEl.textContent = 'STATUS: RECEIVED';

    wfActive = true; setTimeout(() => { wfActive = false; }, 2000);
    triggerGlitch();
    drawFreqChart(data.cipher);

    const now = Date.now();
    const remaining = data.releaseTime - now;
    if (remaining <= 0) {
        revealKey(data.key);
    } else {
        incomingKeyDisplay.textContent = `[LOCKED] — RELEASING IN ${Math.ceil(remaining/1000)}s`;
        incomingKeyDisplay.style.color = 'var(--warning)';
        incomingKeyDisplay.classList.remove('empty');
        let cd = Math.ceil(remaining/1000);
        const iv = setInterval(() => {
            cd--;
            if (cd <= 0) { clearInterval(iv); revealKey(data.key); }
            else incomingKeyDisplay.textContent = `[LOCKED] — RELEASING IN ${cd}s`;
        }, 1000);
    }

    incomingCipherEl.style.borderColor = '#fff';
    setTimeout(() => { incomingCipherEl.style.borderColor = '#003300'; }, 500);

    addLog(`INCOMING: FROM=${data.sender} | ALGO=${lastReceivedAlgo} | ID=${data.messageId}`);
    addToHistory({ from: data.sender || 'UNKNOWN', algo: lastReceivedAlgo, key: data.key, cipher: data.cipher, status: 'received', msgId: data.messageId });
});

// ── SOCKET: READ RECEIPT ──────────────────────────────────────────
socket.on('message-read', ({ messageId, reader }) => {
    readReceiptStatusEl.textContent = `✔ CONFIRMED: READ BY ${reader}`;
    readReceiptStatusEl.style.color = 'var(--primary)';
    senderInfoEl.style.display = 'flex';
    addLog(`READ_RECEIPT: ${reader} DECRYPTED MSG ${messageId}`);
    updateHistoryStatus(messageId, 'decrypted');
});

// ── SOCKET: SELF-DESTRUCT ─────────────────────────────────────────
socket.on('self-destruct', ({ messageId }) => {
    if (messageId !== lastReceivedMsgId) return;
    let secs = parseInt(destructSeconds.value) || 10;
    destructCountdown.style.display = 'block';
    destructTimerDisp.textContent   = secs;
    addLog(`SELF_DESTRUCT: COUNTDOWN INITIATED — ${secs}s`);

    const iv = setInterval(() => {
        secs--;
        destructTimerDisp.textContent = secs;
        if (secs <= 0) {
            clearInterval(iv);
            incomingCipherEl.textContent = '[MESSAGE DESTROYED]';
            incomingCipherEl.classList.add('empty');
            decryptedOutputEl.textContent = '';
            incomingKeyDisplay.textContent = '[KEY DESTROYED]';
            incomingKeyDisplay.classList.add('empty');
            destructCountdown.style.display = 'none';
            triggerGlitch();
            addLog('SELF_DESTRUCT: MESSAGE WIPED FROM TERMINAL');
            updateHistoryStatus(messageId, 'destroyed');
        }
    }, 1000);
});

// ── SOCKET: CONNECTION ────────────────────────────────────────────
socket.on('connect', () => {
    connectionStatus.textContent = 'STATUS: SECURE_LINK_ACTIVE';
    connectionStatus.style.color = '#0f0';
    addLog('SOCKET: SECURE_LINK ESTABLISHED');
    if (currentRoom) socket.emit('join-room', { roomCode: currentRoom, callsign: currentCallsign, role: currentRole });
});
socket.on('disconnect', () => {
    connectionStatus.textContent = 'STATUS: LINK_SEVERED';
    connectionStatus.style.color = 'red';
    addLog('SOCKET: LINK SEVERED');
});

// ── UTILITY BUTTONS ───────────────────────────────────────────────
function revealKey(key) {
    lastReceivedKey = key;
    incomingKeyDisplay.textContent = `KEY_RECEIVED: ${key}`;
    incomingKeyDisplay.style.color = 'var(--primary)';
    incomingKeyDisplay.classList.remove('empty');
    addLog(`KEY UNLOCKED: ${key.slice(-8)}...`);
}

autofillBtn.addEventListener('click', () => {
    if (lastReceivedKey) { decryptionKeyInput.value = lastReceivedKey; addLog('AUTO_FILL: KEY INJECTED'); }
    else alert('ERROR: NO_KEY_IN_BUFFER');
});
clearBtn.addEventListener('click', () => {
    incomingCipherEl.textContent = '...Waiting for transmission...';
    incomingCipherEl.classList.add('empty');
    incomingKeyDisplay.textContent = '...Waiting for key...';
    incomingKeyDisplay.classList.add('empty');
    decryptedOutputEl.textContent = '';
    decryptionKeyInput.value = '';
    lastReceivedKey = null;
    senderInfoEl.style.display = 'none';
    destructCountdown.style.display = 'none';
    addLog('TERMINAL: CLEARED');
});
copyCipherBtn.addEventListener('click', () => {
    const c = incomingCipherEl.textContent;
    if (c && c !== '...Waiting for transmission...') {
        navigator.clipboard.writeText(c);
        addLog('CIPHER: COPIED TO CLIPBOARD');
    } else alert('ERROR: NOTHING TO COPY');
});

// ── HISTORY TABLE ─────────────────────────────────────────────────
function addToHistory({ from, algo, key, cipher, status, msgId }) {
    historyCount++;
    historyCountEl.textContent = historyCount;
    const now  = new Date();
    const ts   = now.toLocaleTimeString('en-US', { hour12: false });
    const row  = document.createElement('tr');
    row.dataset.msgId = msgId;
    row.innerHTML = `
        <td>${ts}</td>
        <td>${from}</td>
        <td>${algo}</td>
        <td style="font-size:0.58rem">${key.slice(0,8)}...</td>
        <td style="font-size:0.58rem">${cipher.slice(0,30)}...</td>
        <td><span class="status-badge ${status}" id="hstatus-${msgId}">${status.toUpperCase()}</span></td>`;
    historyTbody.insertBefore(row, historyTbody.firstChild);
    if (historyTbody.children.length > 30) historyTbody.removeChild(historyTbody.lastChild);
}
function updateHistoryStatus(msgId, status) {
    const el = document.getElementById(`hstatus-${msgId}`);
    if (el) { el.textContent = status.toUpperCase(); el.className = `status-badge ${status}`; }
}

// ── LOG ───────────────────────────────────────────────────────────
function addLog(text) {
    logCount++;
    logCountEl.textContent = logCount;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const entry = document.createElement('div');
    entry.classList.add('msg-log-entry');
    entry.innerHTML = `<span class="log-time">[${ts}]</span><span>${text}</span>`;
    messageLogEl.insertBefore(entry, messageLogEl.firstChild);
    if (messageLogEl.children.length > 30) messageLogEl.removeChild(messageLogEl.lastChild);
}

// ── MASTER CLOCK ──────────────────────────────────────────────────
setInterval(() => {
    const now = new Date();
    clockDisplay.textContent =
        String(now.getHours()).padStart(2,'0') + ':' +
        String(now.getMinutes()).padStart(2,'0') + ':' +
        String(now.getSeconds()).padStart(2,'0');
    const e = Math.floor((Date.now()-startTime)/1000);
    uptimeEl.textContent = `UPTIME: ${String(Math.floor(e/3600)).padStart(2,'0')}:${String(Math.floor((e%3600)/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`;
    updateTimezoneClocks();
}, 1000);

// ── TIMEZONE CLOCKS ───────────────────────────────────────────────
const TIMEZONES = [
    { tz:'America/New_York', canvasId:'clock-usa',    timeId:'time-usa'    },
    { tz:'Europe/London',    canvasId:'clock-uk',     timeId:'time-uk'     },
    { tz:'Europe/Moscow',    canvasId:'clock-russia', timeId:'time-russia' },
    { tz:'Asia/Kolkata',     canvasId:'clock-india',  timeId:'time-india'  },
    { tz:'Asia/Tokyo',       canvasId:'clock-japan',  timeId:'time-japan'  },
];
function drawAnalogClock(canvas, date, tz) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, cx = W/2, cy = H/2, r = W/2 - 4;
    const t = date.toLocaleTimeString('en-US', { timeZone: tz, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
    const [hh,mm,ss] = t.split(':').map(Number);
    const SA = (ss/60)*2*Math.PI - Math.PI/2;
    const MA = ((mm+ss/60)/60)*2*Math.PI - Math.PI/2;
    const HA = (((hh%12)+mm/60)/12)*2*Math.PI - Math.PI/2;
    ctx.clearRect(0,0,W,H);
    ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI); ctx.fillStyle='rgba(0,10,0,0.95)'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI); ctx.strokeStyle='#003300'; ctx.lineWidth=1.5; ctx.stroke();
    for (let i=0;i<12;i++) { const a=(i/12)*2*Math.PI-Math.PI/2; ctx.beginPath(); ctx.moveTo(cx+(r-4)*Math.cos(a),cy+(r-4)*Math.sin(a)); ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a)); ctx.strokeStyle='#00ff41'; ctx.lineWidth=1; ctx.stroke(); }
    [[HA,r*0.5,'#00ff41',2.5],[MA,r*0.72,'#00ff41',1.5],[SA,r*0.85,'#ff9900',1]].forEach(([a,len,c,lw]) => { ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+len*Math.cos(a),cy+len*Math.sin(a)); ctx.strokeStyle=c; ctx.lineWidth=lw; ctx.lineCap='round'; ctx.stroke(); });
    ctx.beginPath(); ctx.arc(cx,cy,2.5,0,2*Math.PI); ctx.fillStyle='#00ff41'; ctx.fill();
}
function updateTimezoneClocks() {
    const now = new Date();
    TIMEZONES.forEach(tz => {
        document.getElementById(tz.timeId).textContent = now.toLocaleTimeString('en-US', { timeZone:tz.tz, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
        drawAnalogClock(document.getElementById(tz.canvasId), now, tz.tz);
    });
}
updateTimezoneClocks();

// ── SIGNAL BAR ────────────────────────────────────────────────────
const sigPatterns = ['▮▮▮▮▮','▮▮▮▮▯','▮▮▮▯▯','▮▮▯▯▯','▮▯▯▯▯','▮▮▮▮▯'];
let sigIdx = 0;
setInterval(() => { signalBar.textContent = sigPatterns[sigIdx++ % sigPatterns.length]; }, 800);

// ── THREAT LEVEL ──────────────────────────────────────────────────
const THREATS  = [{l:'ALPHA',c:'#00ff41'},{l:'BRAVO',c:'#ffff00'},{l:'CHARLIE',c:'#ff9900'},{l:'DELTA',c:'#ff4400'},{l:'ECHO',c:'#ff0000'}];
const threatEl = document.getElementById('threat-value');
let tidx = 0;
setInterval(() => { tidx=(tidx+1)%THREATS.length; threatEl.textContent=THREATS[tidx].l; threatEl.style.color=THREATS[tidx].c; }, 7000);

// ── VITALS ────────────────────────────────────────────────────────
setInterval(() => {
    const e = (Math.random()*29+70).toFixed(1); document.getElementById('entropy-bar').style.width=e+'%'; document.getElementById('entropy-val').textContent=e+'%';
    const l = (Math.random()*75+5).toFixed(0);  document.getElementById('latency-bar').style.width=(l/200*100)+'%'; document.getElementById('latency-val').textContent=l+'ms';
    const p = (Math.random()*2+98).toFixed(1);  document.getElementById('packet-bar').style.width=p+'%'; document.getElementById('packet-val').textContent=p+'%';
}, 2000);

// ── ENTROPY VISUALIZER ────────────────────────────────────────────
for (let i=0;i<50;i++) { const c=document.createElement('div'); c.classList.add('ev-cell'); c.style.height=(Math.random()*14+3)+'px'; evGrid.appendChild(c); }
setInterval(() => {
    evGrid.querySelectorAll('.ev-cell').forEach(c => {
        c.style.height=(Math.random()*14+3)+'px';
        const r=Math.random(); c.style.background=r>0.85?'#ff9900':r>0.7?'#00cfff':'#00ff41';
    });
}, 200);

// ── SIGNAL WAVEFORM ───────────────────────────────────────────────
const wfCtx = wfCanvas.getContext('2d');
let wfPhase = 0, wfActive = false;
function drawWaveform() {
    const W=wfCanvas.width, H=wfCanvas.height;
    wfCtx.clearRect(0,0,W,H);
    wfCtx.beginPath(); wfCtx.strokeStyle='#00ff41'; wfCtx.lineWidth=1.5; wfCtx.shadowBlur=4; wfCtx.shadowColor='#00ff41';
    for (let x=0;x<W;x++) {
        const amp = wfActive ? (8+6*Math.sin(x*0.3)) : 3;
        const y = H/2 + amp*Math.sin((x*0.05)+wfPhase) + (Math.random()-0.5)*(wfActive?6:2);
        x===0 ? wfCtx.moveTo(x,y) : wfCtx.lineTo(x,y);
    }
    wfCtx.stroke(); wfCtx.shadowBlur=0;
    wfPhase += wfActive ? 0.2 : 0.05;
}
setInterval(drawWaveform, 50);

// ── GLITCH ────────────────────────────────────────────────────────
function triggerGlitch() { glitchLayer.classList.add('active'); setTimeout(()=>glitchLayer.classList.remove('active'),200); }
setInterval(() => { if(Math.random()<0.08) triggerGlitch(); }, 3500);

// ── SPEECH ────────────────────────────────────────────────────────
let recognition;
if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false; recognition.lang = 'en-US';
    recognition.onstart = () => { micStatus.textContent='MIC: RECORDING...'; micStatus.classList.add('recording'); micBtn.disabled=true; wfActive=true; };
    recognition.onend   = () => { micStatus.textContent='MIC: OFF'; micStatus.classList.remove('recording'); micBtn.disabled=false; wfActive=false; };
    recognition.onresult = (e) => { plaintextInput.value=e.results[0][0].transcript; addLog(`VOICE: "${e.results[0][0].transcript.slice(0,30)}"`); };
    micBtn.addEventListener('click', () => recognition.start());
} else {
    micBtn.disabled=true; micStatus.textContent='MIC: NOT_SUPPORTED';
}
