// app.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const neo4j = require('neo4j-driver');
const { createGraphFromXML } = require('./new-converter'); // Import the function

const app = express();

// Neo4j Connection
const driver = neo4j.driver(
    'bolt://127.0.0.1:7687',
    neo4j.auth.basic('neo4j', 'password'),
    { encrypted: 'ENCRYPTION_OFF' }
);
console.log('Neo4j Connection established');

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
        const registration = req.body.registration; // Get registration from form input

        if (err) {
            console.log(err);
            res.render('upload', { msg: err });
        } else {
            if (req.file == undefined) {
                const msg = 'Error: No File Selected!';
                console.log(msg);
                res.render('upload', { msg: msg });
            } else {
                const xmlFilePath = `./uploads/${req.file.filename}`;
                console.log(`File uploaded: ${req.file.filename}`);

                // Read the XML file
                fs.readFile(xmlFilePath, 'utf-8', async (err, data) => {
                    if (err) {
                        console.log('Error reading XML file: ' + err);
                        res.render('upload', { msg: 'Error reading the XML file' });
                    } else {
                        // Process the XML to Neo4j
                        try {
                            const logs = await createGraphFromXML(data, registration, driver);
                            const msg = 'File Uploaded and Graph Created!';
                            console.log(msg);
                            res.render('upload', { msg: msg, logs: logs });
                        } catch (error) {
                            console.log('Error creating Neo4j graph: ' + error);
                            res.render('upload', { msg: 'Error creating Neo4j graph', logs: [error.toString()] });
                        }
                    }
                });
            }
        }
    });
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
