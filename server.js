// server.js

// --- IMPORTS ---
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const twilio = require('twilio');

// --- INITIALIZATION ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// --- TWILIO CLIENT SETUP ---
let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('✅ Twilio client initialized.');
} else {
    console.warn('⚠️ Twilio credentials not found. WhatsApp notifications will be disabled.');
}

// --- DATABASE CONNECTION ---
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('🔴 FATAL ERROR: MONGO_URI is not defined in your .env file.');
    process.exit(1);
}
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ MongoDB Connected Successfully!'))
    .catch(err => console.error('🔴 MongoDB Connection Error:', err));

// --- SESSION MIDDLEWARE ---
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// --- SCHEMAS and MODELS ---
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
});
const UserModel = mongoose.model('User', UserSchema);

const FaceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    descriptor: { type: [Number], required: true },
    action: { type: String, required: true, enum: ['allow', 'alert'], default: 'alert' }
});
FaceSchema.index({ userId: 1, name: 1 }, { unique: true });
const FaceModel = mongoose.model('Face', FaceSchema);

const LogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    action: { type: String, required: true, enum: ['allow', 'alert'] },
    timestamp: { type: Date, default: Date.now }
});
const LogModel = mongoose.model('Log', LogSchema);

const SettingsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    alertThreshold: { type: Number, default: 100 }
});
const SettingsModel = mongoose.model('Setting', SettingsSchema);

// --- COOLDOWN & SETTINGS MECHANISM ---
let userSettings = new Map();
let alertCooldowns = new Map();

async function loadUserSettings(userId) {
    try {
        let settings = await SettingsModel.findOne({ userId });
        if (!settings) {
            settings = await new SettingsModel({ userId }).save();
        }
        userSettings.set(userId.toString(), settings);
        console.log(`✅ Loaded settings for user ${userId}`);
    } catch (error) {
        console.error(`🔴 Error loading settings for user ${userId}:`, error);
    }
}

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
};

// --- AUTHENTICATION ROUTES ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/signup', (req, res) => res.render('signup', { error: null }));

app.post('/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        const existingUser = await UserModel.findOne({ email });
        if (existingUser) {
            return res.render('signup', { error: 'User with this email already exists.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new UserModel({ email, password: hashedPassword });
        await user.save();
        req.session.userId = user._id;
        res.redirect('/dashboard');
    } catch (error) {
        res.render('signup', { error: 'An error occurred during registration.' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await UserModel.findOne({ email });
        if (!user) {
            return res.render('login', { error: 'Invalid email or password.' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid email or password.' });
        }
        req.session.userId = user._id;
        res.redirect('/dashboard');
    } catch (error) {
        res.render('login', { error: 'An error occurred during login.' });
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.redirect('/dashboard');
        res.redirect('/login');
    });
});


// --- APPLICATION ROUTES (PROTECTED) ---
app.get('/dashboard', requireLogin, (req, res) => res.render('dashboard'));
app.get('/camera', requireLogin, (req, res) => res.render('camera'));
app.get('/monitor', requireLogin, (req, res) => res.render('monitor'));

// --- API ROUTES (USER-SCOPED) ---
app.get('/faces', requireLogin, async (req, res) => {
    try {
        const faces = await FaceModel.find({ userId: req.session.userId });
        res.json(faces);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch faces.' });
    }
});

app.post('/save', requireLogin, async (req, res) => {
    const { name, descriptor, action } = req.body;
    try {
        const newFace = new FaceModel({ name, descriptor, action, userId: req.session.userId });
        await newFace.save();
        res.status(201).json({ success: true, face: newFace });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ error: `A person named '${name}' is already registered.` });
        res.status(500).json({ error: 'Failed to save face.' });
    }
});

app.delete('/delete/:id', requireLogin, async (req, res) => {
    try {
        const result = await FaceModel.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
        if (!result) return res.status(404).json({ error: 'Face not found or you do not have permission.' });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete face.' });
    }
});

app.post('/import', requireLogin, async (req, res) => {
    const { faces } = req.body;
    if (!faces || !Array.isArray(faces)) return res.status(400).json({ error: 'Invalid data format.' });
    try {
        await FaceModel.deleteMany({ userId: req.session.userId });
        const facesWithUserId = faces.map(f => ({ ...f, userId: req.session.userId, _id: undefined }));
        await FaceModel.insertMany(facesWithUserId);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to import data.' });
    }
});

app.get('/logs', requireLogin, async (req, res) => {
    try {
        const logs = await LogModel.find({ userId: req.session.userId }).sort({ timestamp: -1 }).limit(50);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch logs.' });
    }
});

app.post('/log', requireLogin, async (req, res) => {
    const { name, action } = req.body;
    const userId = req.session.userId;
    try {
        const newLog = new LogModel({ name, action, userId });
        await newLog.save();

        if (action === 'alert' && twilioClient) {
            const settings = userSettings.get(userId.toString());
            if (!settings) {
                await loadUserSettings(userId);
            }
            const threshold = (settings && settings.alertThreshold) || 100;

            let userCooldowns = alertCooldowns.get(userId) || new Map();
            let nameCooldown = userCooldowns.get(name) || 0;
            nameCooldown++;

            if (nameCooldown >= threshold) {
                console.log(`[Twilio] Cooldown reached for ${name} (User: ${userId}). Sending WhatsApp message.`);
                await twilioClient.messages.create({
                    body: `🚨 ALERT: Person named '${name}' was detected at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}.`,
                    from: process.env.TWILIO_WHATSAPP_NUMBER,
                    to: process.env.USER_WHATSAPP_NUMBER
                });
                userCooldowns.set(name, 0);
            } else {
                userCooldowns.set(name, nameCooldown);
            }
            alertCooldowns.set(userId, userCooldowns);
        }

        res.status(201).json({ success: true, log: newLog });
    } catch (error) {
        console.error('[Log Error]', error);
        res.status(500).json({ error: 'Failed to save log.' });
    }
});

app.get('/settings', requireLogin, async (req, res) => {
    let settings = userSettings.get(req.session.userId.toString());
    if (!settings) {
        await loadUserSettings(req.session.userId);
        settings = userSettings.get(req.session.userId.toString());
    }
    res.json({ alertThreshold: settings ? settings.alertThreshold : 100 });
});

app.post('/settings', requireLogin, async (req, res) => {
    try {
        const { newThreshold } = req.body;
        const userId = req.session.userId;
        const newAlertThreshold = parseInt(newThreshold, 10);
        if (isNaN(newAlertThreshold) || newAlertThreshold < 1) {
            return res.status(400).json({ error: 'Invalid threshold value.' });
        }
        const updatedSettings = await SettingsModel.findOneAndUpdate(
            { userId },
            { alertThreshold: newAlertThreshold },
            { upsert: true, new: true }
        );
        userSettings.set(userId.toString(), updatedSettings);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update settings.' });
    }
});

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session || !session.userId) {
        console.log('Socket connection rejected: No user session.');
        return socket.disconnect(true);
    }

    const userId = session.userId;
    const roomName = `user-${userId}`;
    socket.join(roomName);

    console.log(`User ${userId} connected with socket ID ${socket.id}`);

    if (!userSettings.has(userId.toString())) {
        loadUserSettings(userId);
    }
    
    socket.on('join-as-camera', () => {
        console.log(`Socket ${socket.id} is a CAMERA for user ${userId}`);
        io.to(roomName).emit('camera-status', { status: 'online' });
    });
    
    socket.on('join-as-monitor', () => {
        console.log(`Socket ${socket.id} is a MONITOR for user ${userId}`);
    });

    socket.on('stream-frame', (data) => {
        socket.to(roomName).emit('update-stream', data);
    });

    socket.on('disconnect', () => {
        console.log(`User ${userId} with socket ID ${socket.id} disconnected`);
        io.to(roomName).emit('camera-status', { status: 'offline' });
    });
});

// --- START SERVER ---
server.listen(PORT, () => {
    console.log(`\n🚀 Server is running and listening on http://localhost:${PORT}`);
});