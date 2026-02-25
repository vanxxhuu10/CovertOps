# CovertOps: Secure Covert Messaging System

A secure, real-time web application allowing two users to communicate via encrypted messages. Designed for military-grade covert operations, it utilizes a time-based symmetric encryption algorithm to ensure message uniqueness and security.

## 1. Project Objective
This project demonstrates practical cryptography concepts in a web environment. The core goal is to simulate a secure channel where:
- Speech is successfully converted to text.
- Messages are encrypted using a non-static, time-dependent key.
- Communication implies "Stateless Transmission" to avoid logging.

## 2. Cryptography Concept: Time-Based Symmetric Encryption

### Why Time-Based Keys?
In standard encryption, using the same key repeatedly can lead to pattern analysis attacks. By deriving the key from the exact millisecond (`Date.now()`) of the encryption event:
1.  **Uniqueness**: Every message has a different key, even if the content is identical.
2.  **Anti-Replay**: Old keys cannot be reused for new messages without detection (in a stricter implementation).
3.  **Covert Nature**: The key is ephemeral.

### Encryption Flow
1.  **Input**: Plaintext (e.g., "Attack at dawn").
2.  **Key Generation**: `Key = 1709428501234` (Current Timestamp).
3.  **Process (Symmetric XOR)**:
    - Each character of the Plaintext is XORed with a corresponding character from the Key (rotated if key is shorter).
4.  **Encoding**: The resulting byte stream is encoded in **Base64** to make it transmission-safe.
5.  **Output**: Ciphertext (e.g., `NWYxNz...`).

### Decryption Flow
1.  **Input**: Ciphertext + Key.
2.  **Process**: Base64 Decode -> Reverse XOR using the same Key.
3.  **Output**: Original Plaintext.

## 3. How to Run

### Prerequisites
- Node.js installed.

### Steps
1.  **Navigate to the backend directory**:
    ```bash
    cd backend
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Start the server**:
    ```bash
    node server.js
    ```
4.  **Open the application**:
    - Open your browser and go to `http://localhost:3000`.
    - Open a **second tab** or window to `http://localhost:3000` to simulate the receiver.

### Usage
1.  **Transmitter (User A)**:
    - Click **INIT_VOICE_CAPTURE** and speak, or type into the "PLAINTEXT_BUFFER".
    - Click **ENCRYPT_AND_TRANSMIT**.
    - The "SESSION_KEY" and "OUTGOING_CIPHERTEXT" will appear.
2.  **Receiver (User B)**:
    - The "INCOMING_CIPHERTEXT" will appear automatically via the secure socket link.
    - Copy the **SESSION_KEY** from User A's screen (in a real scenario, this is sent via a separate secure channel).
    - Paste it into **DECRYPTION_KEY**.
    - Click **DECRYPT_MESSAGE**.
    - Read the "DECRYPTED_PAYLOAD".

## 4. Military Relevance
- **High Interception Risk**: Variable keys make intercepted messages harder to crack without the precise timestamp.
- **Speed**: Symmetric encryption (XOR) is computationally inexpensive/fast for real-time tactical use.
- **No Logging**: The server acts only as a relay; no database stores the chats.

---
**SECURITY LEVEL: TOP SECRET // EDUCATIONAL USE ONLY**
