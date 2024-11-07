// app.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const neo4j = require('neo4j-driver');
const { createGraphFromXML } = require('./new-converter'); // Import the function

// Map to store socket IDs associated with clients
const clientSockets = new Map();

// Function to add log messages
function logMessage(message, socket = null) {
    console.log(message); // Logs to the terminal
    if (socket) {
        socket.emit('log', message); // Emit log message to the client
    }
}

// Neo4j Connection
const driver = neo4j.driver(
    'bolt://127.0.0.1:7687',
    neo4j.auth.basic('neo4j', 'password'),
    { encrypted: 'ENCRYPTION_OFF' }
);
logMessage('Neo4j Connection established');

// Set storage engine for file uploads
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

// Initialize upload
const upload = multer({
    storage: storage,
    limits: { fileSize: 100000000 }, // Increased file limit to 100MB for large XML files
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
}).single('file');

// Check file type
function checkFileType(file, cb) {
    const filetypes = /xml/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb('Error: XML Files Only!');
    }
}

// Set view engine
app.set('view engine', 'ejs');

// Serve static files
app.use(express.static('./public'));
app.use(express.urlencoded({ extended: true })); // To parse form data

// Index route
app.get('/', (req, res) => res.render('upload'));

// Socket.IO connection
io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // Store the socket in the map
    clientSockets.set(socket.id, socket);

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        clientSockets.delete(socket.id);
    });
});

// Handle file upload and process XML to Neo4j
app.post('/upload', (req, res) => {
    upload(req, res, async (err) => {
        const socketId = req.body.socketId; // Retrieve socket ID from the form
        const socket = clientSockets.get(socketId); // Get the socket instance
        const registration = req.body.registration; // Get registration from form input

        if (err) {
            logMessage(err, socket);
            res.render('upload', { msg: err });
        } else {
            if (req.file == undefined) {
                const msg = 'Error: No File Selected!';
                logMessage(msg, socket);
                res.render('upload', { msg: msg });
            } else {
                const xmlFilePath = `./uploads/${req.file.filename}`;
                logMessage(`File uploaded: ${req.file.filename}`, socket);

                // Read the XML file
                fs.readFile(xmlFilePath, 'utf-8', async (err, data) => {
                    if (err) {
                        logMessage('Error reading XML file: ' + err, socket);
                        res.render('upload', { msg: 'Error reading the XML file' });
                    } else {
                        // Process the XML to Neo4j
                        try {
                            await createGraphFromXML(
                                data,
                                registration,
                                driver,
                                (message) => { // logCallback
                                    logMessage(message, socket);
                                },
                                (progress) => { // progressCallback
                                    if (socket) {
                                        socket.emit('progress', { progress });
                                    }
                                }
                            );
                            const msg = 'File Uploaded and Graph Created!';
                            logMessage(msg, socket);
                            res.render('upload', { msg: msg, file: `uploads/${req.file.filename}` });
                        } catch (error) {
                            logMessage('Error creating Neo4j graph: ' + error, socket);
                            res.render('upload', { msg: 'Error creating Neo4j graph' });
                        }
                    }
                });
            }
        }
    });
});

// Start server
const PORT = process.env.PORT || 5001;
http.listen(PORT, () => logMessage(`Server started on port ${PORT}`));
