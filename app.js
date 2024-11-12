// app.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const neo4j = require('neo4j-driver');
const app = express();
const { createGraphFromXML } = require('./new-converter'); // Ensure you import the function

// Map to store logs and progress for each client
const clientData = new Map();

// Function to add log messages
function logMessage(message, clientId = null) {
    console.log(message); // Logs to the terminal
    if (clientId && clientData.has(clientId)) {
        const data = clientData.get(clientId);
        data.logs.push(message);
    }
}

// Neo4j Connection
const driver = neo4j.driver(
    'bolt://127.0.0.1:7687',
    neo4j.auth.basic('neo4j', 'password')
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

// Handle file upload and process XML to Neo4j
app.post('/upload', (req, res) => {
    upload(req, res, async (err) => {
        const clientId = req.body.clientId; // Retrieve client ID from the form
        const registration = req.body.registration; // Get registration from form input

        // Initialize client data
        clientData.set(clientId, { logs: [], progress: 0 });

        if (err) {
            logMessage(err, clientId);
            res.render('upload', { msg: err });
        } else {
            if (req.file == undefined) {
                const msg = 'Error: No File Selected!';
                logMessage(msg, clientId);
                res.render('upload', { msg: msg });
            } else {
                const xmlFilePath = `./uploads/${req.file.filename}`;
                logMessage(`File uploaded: ${req.file.filename}`, clientId);

                // Read the XML file
                fs.readFile(xmlFilePath, 'utf-8', async (err, data) => {
                    if (err) {
                        logMessage('Error reading XML file: ' + err, clientId);
                        res.render('upload', { msg: 'Error reading the XML file' });
                    } else {
                        // Process the XML to Neo4j
                        try {
                            await createGraphFromXML(data, registration, driver, logMessage, clientId, clientData);
                            const msg = 'File Uploaded and Graph Created!';
                            logMessage(msg, clientId);
                            res.render('upload', { msg: msg, file: `uploads/${req.file.filename}` });
                        } catch (error) {
                            logMessage('Error creating Neo4j graph: ' + error, clientId);
                            res.render('upload', { msg: 'Error creating Neo4j graph' });
                        }
                    }
                });
            }
        }
    });
});

// Endpoint to get progress and logs for a client
app.get('/progress/:clientId', (req, res) => {
    const clientId = req.params.clientId;
    if (clientData.has(clientId)) {
        const data = clientData.get(clientId);
        res.json({
            logs: data.logs,
            progress: data.progress
        });
        // Clear logs after sending so we don't send them again
        data.logs = [];
    } else {
        res.json({ logs: [], progress: 0 });
    }
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => logMessage(`Server started on port ${PORT}`));
