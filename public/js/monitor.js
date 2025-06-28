// --- DOM Elements ---
const loader = document.getElementById('loader');
const monitorContainer = document.querySelector('.monitor-container');
const liveFeed = document.getElementById('liveFeed');
const canvas = document.getElementById('canvas');
const showPointsToggle = document.getElementById('showPointsToggle');
const logPanel = document.getElementById('log-panel');
const faceList = document.getElementById('faceList');
const downloadDataBtn = document.getElementById('downloadDataBtn');
const importDataInput = document.getElementById('importDataInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const alertThresholdInput = document.getElementById('alertThresholdInput');
const cameraStatusIndicator = document.getElementById('cameraStatusIndicator');

// --- Registration Elements ---
const openCameraBtn = document.getElementById('openCameraBtn');
const imageUpload = document.getElementById('imageUpload');
const cameraModal = document.getElementById('cameraModal');
const modalVideo = document.getElementById('modal-video');
const modalCanvas = document.getElementById('modal-canvas');
const snapBtn = document.getElementById('snapBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const analysisContainer = document.getElementById('analysis-container');
const imagePreview = document.getElementById('imagePreview');
const analysisCanvas = document.getElementById('analysisCanvas');
const registrationForm = document.getElementById('registration-form');
const nameInput = document.getElementById('nameInput');
const saveButton = document.getElementById('saveButton');
const cancelButton = document.getElementById('cancelButton');

// *** NEW: Elements for recording and unknown alerts ***
const startRecordingBtn = document.getElementById('startRecordingBtn');
const stopRecordingBtn = document.getElementById('stopRecordingBtn');
const alertUnknownToggle = document.getElementById('alertUnknownToggle');


// --- State Variables ---
let faceDataMap = new Map();
const notifiedNames = new Set();
let faceDescriptorForRegistration = null;
let detectionInterval;
const socket = io();

// *** NEW: State variables for new features ***
let mediaRecorder;
let recordedChunks = [];
let unknownFaceNotified = false;
const recordingCanvas = document.createElement('canvas');
const recordingCtx = recordingCanvas.getContext('2d');


// --- Socket.IO Communication ---
function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server as a monitor.');
        socket.emit('join-as-monitor');
    });

    socket.on('update-stream', (data) => {
        liveFeed.src = data;
        cameraStatusIndicator.classList.remove('status-indicator-off');
        cameraStatusIndicator.classList.add('status-indicator-on');
        cameraStatusIndicator.textContent = 'ONLINE';

        if (mediaRecorder && mediaRecorder.state === 'recording') {
            const image = new Image();
            image.onload = () => {
                if (recordingCanvas.width !== image.naturalWidth || recordingCanvas.height !== image.naturalHeight) {
                    recordingCanvas.width = image.naturalWidth;
                    recordingCanvas.height = image.naturalHeight;
                }
                recordingCtx.drawImage(image, 0, 0);
            };
            image.src = data;
        }
    });
    
    socket.on('camera-status', (data) => {
        if (data.status === 'offline') {
            cameraStatusIndicator.classList.remove('status-indicator-on');
            cameraStatusIndicator.classList.add('status-indicator-off');
            cameraStatusIndicator.textContent = 'OFFLINE';
        }
    });

    socket.on('disconnect', () => {
        cameraStatusIndicator.classList.remove('status-indicator-on');
        cameraStatusIndicator.classList.add('status-indicator-off');
        cameraStatusIndicator.textContent = 'OFFLINE';
    });
}

// --- Face Analysis for Registration ---
async function analyzeAndDisplayFace(imageElement) {
    analysisContainer.style.display = 'block';
    loader.innerText = 'Analyzing face...';
    loader.style.display = 'block';

    // This promise correctly waits for the image to be ready, which is crucial.
    await new Promise(resolve => {
        if (imageElement.complete && imageElement.naturalHeight !== 0) resolve();
        else imageElement.onload = resolve;
    });

    const displaySize = { width: imageElement.width, height: imageElement.height };
    faceapi.matchDimensions(analysisCanvas, displaySize);

    const detection = await faceapi.detectSingleFace(imageElement, new faceapi.SsdMobilenetv1Options()).withFaceLandmarks().withFaceDescriptor();
    
    loader.style.display = 'none';

    if (detection) {
        const resizedDetection = faceapi.resizeResults(detection, displaySize);
        analysisCanvas.getContext('2d').clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
        faceapi.draw.drawDetections(analysisCanvas, resizedDetection);
        faceapi.draw.drawFaceLandmarks(analysisCanvas, resizedDetection);
        
        faceDescriptorForRegistration = detection.descriptor;
        registrationForm.style.display = 'block';
    } else {
        alert('No face detected or face is unclear. Please try another image.');
        resetRegistrationForm();
    }
}

// --- UI & Event Handlers ---
imageUpload.addEventListener('change', async (event) => {
    if (!event.target.files || event.target.files.length === 0) return;
    const file = event.target.files[0];
    const imageUrl = URL.createObjectURL(file);
    imagePreview.src = imageUrl;
    await analyzeAndDisplayFace(imagePreview);
});

async function setupRegistrationCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        modalVideo.srcObject = stream;
        await new Promise(resolve => modalVideo.onloadedmetadata = resolve);
        return stream;
    } catch (err) {
        alert('Could not access camera. Please check permissions.');
        return null;
    }
}
openCameraBtn.addEventListener('click', async () => {
    resetRegistrationForm();
    cameraModal.style.display = 'flex';
    const stream = await setupRegistrationCamera();
    if (!stream) cameraModal.style.display = 'none';
});

closeModalBtn.addEventListener('click', () => {
    const stream = modalVideo.srcObject;
    if (stream) stream.getTracks().forEach(track => track.stop());
    modalVideo.srcObject = null;
    cameraModal.style.display = 'none';
    if(modalCanvas) modalCanvas.getContext('2d').clearRect(0, 0, modalCanvas.width, modalCanvas.height);
});

// *** THIS IS THE FIX ***
snapBtn.addEventListener('click', async () => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = modalVideo.videoWidth;
    tempCanvas.height = modalVideo.videoHeight;
    tempCanvas.getContext('2d').drawImage(modalVideo, 0, 0);
    
    imagePreview.src = tempCanvas.toDataURL('image/jpeg');
    
    closeModalBtn.click();
    
    // THE FIX: We explicitly wait here for the image to finish loading in the browser.
    await new Promise(resolve => imagePreview.onload = resolve);
    
    // NOW it is safe to analyze the fully loaded image.
    await analyzeAndDisplayFace(imagePreview);
});

function resetRegistrationForm() {
    analysisContainer.style.display = 'none';
    registrationForm.style.display = 'none';
    imagePreview.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    if(analysisCanvas) analysisCanvas.getContext('2d').clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
    nameInput.value = '';
    imageUpload.value = '';
    faceDescriptorForRegistration = null;
}
cancelButton.addEventListener('click', resetRegistrationForm);

saveButton.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const action = document.querySelector('input[name="action"]:checked').value;
    if (!name || !faceDescriptorForRegistration) {
        alert('Please provide a name and a detected face.');
        return;
    }
    try {
        const response = await fetch('/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, descriptor: Array.from(faceDescriptorForRegistration), action })
        });
        const result = await response.json();
        if (response.ok) {
            alert('Person saved successfully!');
            resetRegistrationForm();
            await fetchAndDisplayFaces();
            await startDetection();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        console.error('Error saving face:', error);
    }
});

// *** Recording Logic Event Listeners ***
function startRecording() {
    if (!liveFeed.src || liveFeed.src.endsWith('/monitor') || liveFeed.naturalWidth === 0) {
        alert('Camera feed is not active. Cannot start recording.');
        return;
    }
    
    const stream = recordingCanvas.captureStream(25);
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

    recordedChunks = [];

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        document.body.appendChild(a);
        a.style = 'display: none';
        a.href = url;
        a.download = `recording-${new Date().toISOString()}.webm`;
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    mediaRecorder.start();
    startRecordingBtn.style.display = 'none';
    stopRecordingBtn.style.display = 'inline-block';
}

function stopRecording() {
    if (mediaRecorder) {
        mediaRecorder.stop();
    }
    startRecordingBtn.style.display = 'inline-block';
    stopRecordingBtn.style.display = 'none';
}

startRecordingBtn.addEventListener('click', startRecording);
stopRecordingBtn.addEventListener('click', stopRecording);


// --- Core Logic & Data Display Functions ---
async function loadModels() {
    const MODEL_URL = '/models';
    loader.innerText = 'Loading Core Models...';
    await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
    ]);
}

async function getLabeledFaceDescriptions() {
    try {
        const response = await fetch('/faces');
        const faces = await response.json();
        if (faces.length === 0) return null;
        faceDataMap = new Map(faces.map(f => [f.name, f]));
        return faces.map(face => new faceapi.LabeledFaceDescriptors(face.name, [new Float32Array(face.descriptor)]));
    } catch (error) {
        console.error("Could not fetch faces:", error);
        return null;
    }
}

async function runDetection(faceMatcher) {
    if (!liveFeed.src || liveFeed.src.endsWith('/monitor') || liveFeed.naturalWidth === 0) return;
    
    const displaySize = { width: liveFeed.width, height: liveFeed.height };
    faceapi.matchDimensions(canvas, displaySize);

    const detections = await faceapi.detectAllFaces(liveFeed, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptors();
    const resizedDetections = faceapi.resizeResults(detections, displaySize);
    
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    const currentFacesOnScreen = new Set();
    let anUnknownFaceWasFound = false;
    
    resizedDetections.forEach(d => {
        const match = faceMatcher.findBestMatch(d.descriptor);
        const personName = match.label;
        
        if (personName === 'unknown') {
            anUnknownFaceWasFound = true;
            if (alertUnknownToggle.checked && !unknownFaceNotified) {
                addLogEntry({ name: 'Unknown', action: 'alert' });
                unknownFaceNotified = true;
            }
        } else {
            currentFacesOnScreen.add(personName);
        }
        
        const drawBox = new faceapi.draw.DrawBox(d.detection.box, { label: personName });
        drawBox.draw(canvas);
        if (showPointsToggle.checked) faceapi.draw.drawFaceLandmarks(canvas, d);
        
        if (personName !== 'unknown' && !notifiedNames.has(personName)) {
            const personData = faceDataMap.get(personName);
            if (personData) {
                addLogEntry({ name: personName, action: personData.action });
                notifiedNames.add(personName);
            }
        }
    });

    if (!anUnknownFaceWasFound) {
        unknownFaceNotified = false;
    }

    notifiedNames.forEach(name => {
        if (!currentFacesOnScreen.has(name)) notifiedNames.delete(name);
    });
}

async function fetchAndDisplayFaces() {
    try {
        const response = await fetch('/faces');
        const faces = await response.json();
        faceList.innerHTML = '';
        if (faces.length === 0) {
            faceList.innerHTML = '<p class="text-secondary" style="text-align: center; margin-top: 1rem;">No people registered yet.</p>';
        } else {
            const placeholderIcon = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="%238b949e" class="bi bi-person" viewBox="0 0 16 16"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg>`;
            faces.forEach(face => {
                const faceCard = document.createElement('div');
                faceCard.className = 'known-face-card';
                const actionDisplay = face.action.charAt(0).toUpperCase() + face.action.slice(1);
                faceCard.innerHTML = `
                    <img src="${placeholderIcon}
                    <div class="known-face-details">
                        <h5>${face.name}</h5>
                        <p class="text-secondary" style="font-size: 0.8rem; margin: 0;">Action: ${actionDisplay}</p>
                    </div>
                    <button class="delete-btn" data-id="${face._id}">Delete</button>
                `;
                faceList.appendChild(faceCard);
            });
        }
    } catch (error) {
        console.error('Error fetching faces:', error);
        faceList.innerHTML = '<p class="text-danger" style="text-align: center; margin-top: 1rem;">Error loading faces.</p>';
    }
}

faceList.addEventListener('click', async (event) => {
    if (event.target.classList.contains('delete-btn')) {
        const faceId = event.target.getAttribute('data-id');
        if (confirm('Are you sure you want to delete this person?')) {
            try {
                await fetch(`/delete/${faceId}`, { method: 'DELETE' });
                await fetchAndDisplayFaces();
                await startDetection();
            } catch (error) {
                console.error('Error deleting face:', error);
            }
        }
    }
});

function addLogEntry(logData, sendToServer = true) {
    const logEntry = document.createElement('div');
    const actionClass = logData.action === 'alert' ? 'log-alert' : 'log-allow';
    logEntry.classList.add('log-entry', actionClass);
    
    const timestamp = new Date(logData.timestamp || Date.now());
    const istTime = timestamp.toLocaleString('en-IN', { timeStyle: 'medium', hour12: false, timeZone: 'Asia/Kolkata' });
    
    logEntry.innerHTML = `<strong>${logData.name}</strong> detected. Action: [${logData.action.toUpperCase()}]<br><small>${istTime}</small>`;
    
    logPanel.appendChild(logEntry);
    logPanel.scrollTop = logPanel.scrollHeight;

    if (sendToServer) {
        fetch('/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: logData.name, action: logData.action })
        }).catch(err => console.error('Failed to send log to server:', err));
    }
}

async function loadInitialLogs() {
    try {
        const response = await fetch('/logs');
        const logs = await response.json();
        logPanel.innerHTML = '';
        logs.forEach(log => addLogEntry(log, false));
    } catch (error) {
        console.error('Failed to load initial logs:', error);
    }
}

async function fetchAndDisplaySettings() {
    try {
        const response = await fetch('/settings');
        const settings = await response.json();
        alertThresholdInput.value = settings.alertThreshold;
    } catch (error) {
        console.error('Error fetching settings:', error);
    }
}

saveSettingsBtn.addEventListener('click', async () => {
    const newThreshold = alertThresholdInput.value;
    await fetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newThreshold })
    });
    alert('Settings saved!');
});

downloadDataBtn.addEventListener('click', async () => {
    const response = await fetch('/faces');
    const faces = await response.json();
    const dataStr = JSON.stringify(faces.map(f => ({ name: f.name, descriptor: f.descriptor, action: f.action })), null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([dataStr], { type: 'application/json' }));
    link.download = 'face_data_export.json';
    link.click();
    URL.revokeObjectURL(link.href);
});

importDataInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        if (!confirm('This will replace all current data. Are you sure?')) {
            importDataInput.value = '';
            return;
        }
        try {
            const faces = JSON.parse(e.target.result);
            await fetch('/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faces })
            });
            alert('Data imported!');
            await fetchAndDisplayFaces();
            await startDetection();
        } catch {
            alert('Invalid JSON file or import error.');
        } finally {
            importDataInput.value = '';
        }
    };
    reader.readAsText(file);
});


async function startDetection() {
    if (detectionInterval) clearInterval(detectionInterval);
    loader.innerText = 'Loading Registered Faces...';
    loader.style.display = 'block';

    const labeledFaceDescriptors = await getLabeledFaceDescriptions();
    
    if (!labeledFaceDescriptors) {
        loader.innerText = 'No faces registered. Please register a face.';
        setTimeout(() => {
            if (loader.innerText === 'No faces registered. Please register a face.') {
                loader.style.display = 'none';
            }
        }, 3000);
        return;
    }

    const faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.55);
    loader.style.display = 'none';
    
    detectionInterval = setInterval(() => runDetection(faceMatcher), 500);
}

async function initialize() {
    try {
        await loadModels();
        setupSocketListeners();
        monitorContainer.style.display = 'block';
        
        await Promise.all([
            fetchAndDisplayFaces(),
            loadInitialLogs(),
            fetchAndDisplaySettings()
        ]);
        
        await startDetection();
    } catch (error) {
        console.error("Initialization failed:", error);
        loader.innerText = "Error during startup. Please refresh.";
    }
}

initialize();