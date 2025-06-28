// public/js/camera.js
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const context = canvas.getContext('2d');
const socket = io();
const FPS = 10;

async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 }
        });
        video.srcObject = stream;
        statusEl.textContent = 'Camera is active.';
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                resolve(video);
            };
        });
    } catch (err) {
        console.error("Error accessing webcam:", err);
        statusEl.textContent = 'Error: Could not access webcam. Please check permissions.';
    }
}

function emitFrame() {
    if (video.paused || video.ended) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    // MODIFIED: Lowered JPEG quality for faster streaming. Crucial for performance.
    const data = canvas.toDataURL('image/jpeg', 0.5); 
    socket.emit('stream-frame', data);
}

async function startStreaming() {
    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
        statusEl.textContent = 'Connected to server. Starting stream...';
        socket.emit('join-as-camera');
    });
    await setupCamera();
    video.play();
    setInterval(emitFrame, 1000 / FPS);
    socket.on('disconnect', () => {
        statusEl.textContent = 'Disconnected from server.';
    });
}

startStreaming();