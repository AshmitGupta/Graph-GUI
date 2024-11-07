// app.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const neo4j = require('neo4j-driver');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

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
                            await createGraphFromXML(data, registration, socket);
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

// CreateGraphFromXML function
async function createGraphFromXML(xmlData, registration, socket) {
    const session = driver.session();

    const uniqueLabel = 'Batch_' + new Date().toISOString().slice(0, 10).replace(/-/g, '_');

    try {
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        const result = await parser.parseStringPromise(xmlData);

        let docNumber = 'ServiceBulletin';
        if (result && result.AirplaneSB && result.AirplaneSB.$ && result.AirplaneSB.$.docnbr) {
            docNumber = result.AirplaneSB.$.docnbr;
            logMessage(`Found docnbr: ${docNumber}`, socket);
        } else {
            logMessage('No docnbr attribute found; defaulting to "ServiceBulletin"', socket);
        }

        logMessage(`Creating Service Bulletin node with docnbr "${docNumber}" and label "${uniqueLabel}"`, socket);
        await session.writeTransaction(tx => tx.run(
            `MERGE (sb:ServiceBulletin:\`${uniqueLabel}\` {name: $docnbr, content: '000', docnbr: $docnbr})`,
            { docnbr: docNumber }
        ));
        logMessage('Service Bulletin node created.', socket);

        // Use the registration provided by the user
        logMessage(`Using registration: "${registration}"`, socket);

        // Connect the Service Bulletin to the matching Aircraft node
        await session.writeTransaction(tx => tx.run(
            `MATCH (sb:ServiceBulletin {docnbr: $docnbr}), (ac:Aircraft {registration: $registration})
            MERGE (sb)-[:APPLIES_TO]->(ac)`,
            { docnbr: docNumber, registration: registration }
        ));
        logMessage(`Connected Service Bulletin "${docNumber}" to Aircraft with registration "${registration}".`, socket);

        function sanitizeRelationship(label) {
            return label.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        }

        function formatNodeLabel(label) {
            return label
                .replace(/^HAS_/, '')
                .toLowerCase()
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join('_');
        }

        function gatherContent(node) {
            let content = '';

            function handleTableNode(tableNode) {
                const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false }, xmldec: { version: '1.0', encoding: 'UTF-8' } });

                const sanitizedTable = JSON.parse(JSON.stringify(tableNode, (key, value) => (key.startsWith('$') ? undefined : value)));

                if (sanitizedTable.TABLE && Array.isArray(sanitizedTable.TABLE.ColSpec)) {
                    delete sanitizedTable.TABLE.ColSpec;
                }

                return builder.buildObject({ TABLE: sanitizedTable.TABLE }).trim();
            }

            for (const key in node) {
                if (node.hasOwnProperty(key)) {
                    if (key.toUpperCase() === 'TABLE') {
                        content += handleTableNode({ TABLE: node[key] });
                    } else if (typeof node[key] === 'string' && !key.startsWith('$')) {
                        content += node[key] + ' ';
                    } else if (typeof node[key] === 'object' && !key.startsWith('$')) {
                        content += gatherContent(node[key]);
                    }
                }
            }

            return content.trim();
        }

        // Variables for progress tracking
        let totalNodes = 0;
        let processedNodesCount = 0;

        // Function to count total nodes to process
        function countTotalNodes(obj) {
            let count = 0;
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    if (key.toUpperCase() === 'TITLE') {
                        count += 1;
                    }
                    if (typeof obj[key] === 'object') {
                        count += countTotalNodes(obj[key]);
                    }
                }
            }
            return count;
        }

        // Count total nodes before processing
        totalNodes = countTotalNodes(result);
        if (totalNodes === 0) {
            totalNodes = 1; // Prevent division by zero
        }

        const processedNodes = new Set();

        async function createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    if (key.toUpperCase() === 'TITLE') {
                        const titleContent = obj[key];
                        const sanitizedRelationship = sanitizeRelationship(titleContent);
                        const titleNodeLabel = formatNodeLabel(sanitizedRelationship);
                        const nodeName = titleNodeLabel;

                        logMessage(`Gathering content for "${titleNodeLabel}"`, socket);
                        const concatenatedContent = gatherContent(obj);

                        const uniqueKey = `${nodeName}-${concatenatedContent.trim()}`;
                        if (processedNodes.has(uniqueKey)) {
                            logMessage(`Node "${titleNodeLabel}" with content already processed, skipping.`, socket);
                            continue;
                        }

                        processedNodes.add(uniqueKey);

                        logMessage(`Creating TITLE node for "${titleNodeLabel}" with label "${uniqueLabel}"`, socket);
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name, docnbr: $docnbr})`,
                            { name: nodeName, docnbr: docNumber }
                        ));
                        logMessage(`TITLE node "${titleNodeLabel}" created.`, socket);

                        if (!parentTitleNode) {
                            logMessage(`Connecting TITLE "${titleNodeLabel}" to Service Bulletin`, socket);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (sb:ServiceBulletin:\`${uniqueLabel}\` {docnbr: $sbDocNbr}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName, docnbr: $docnbr})
                                MERGE (sb)-[:HAS_${sanitizedRelationship}]->(child)`,
                                { sbDocNbr: docNumber, childName: nodeName, docnbr: docNumber }
                            ));
                            logMessage(`Connected "${titleNodeLabel}" to Service Bulletin.`, socket);
                        } else {
                            const dynamicRelationship = `HAS_${sanitizedRelationship}`;
                            logMessage(`Connecting TITLE "${parentNodeLabel}" to child TITLE "${titleNodeLabel}" with relationship "${dynamicRelationship}"`, socket);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (parent:\`${parentNodeLabel}\`:\`${uniqueLabel}\` {name: $parentName, docnbr: $docnbr}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName, docnbr: $docnbr})
                                MERGE (parent)-[:${dynamicRelationship}]->(child)`,
                                { parentName: parentNodeLabel, childName: nodeName, docnbr: docNumber }
                            ));
                            logMessage(`Connected "${parentNodeLabel}" to "${titleNodeLabel}" with "${dynamicRelationship}".`, socket);
                        }

                        const cleanedContent = concatenatedContent.replace(/<ColSpec\s*\/>/g, '');

                        logMessage(`Content for "${titleNodeLabel}" gathered: "${cleanedContent}"`, socket);
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name, docnbr: $docnbr})
                            SET n.content = $content`,
                            { name: nodeName, content: cleanedContent, docnbr: docNumber }
                        ));
                        logMessage(`Updated content for "${titleNodeLabel}".`, socket);

                        // Update processed nodes count and emit progress
                        processedNodesCount += 1;
                        const progress = Math.round((processedNodesCount / totalNodes) * 100);
                        socket.emit('progress', { progress });

                        logMessage(`Processing nested content for "${titleNodeLabel}"...`, socket);
                        await createTitleNodesAndRelationships(titleNodeLabel, titleNodeLabel, obj);
                    }

                    if (typeof obj[key] === 'object' && key.toUpperCase() !== 'TITLE') {
                        await createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj[key]);
                    }
                }
            }
        }

        logMessage('Starting graph creation process...', socket);
        const rootKey = Object.keys(result)[0];
        const rootObj = result[rootKey];

        // Begin processing
        await createTitleNodesAndRelationships(null, null, rootObj);

        logMessage('Graph created successfully with docnbr property: ' + docNumber, socket);

        // Emit 100% progress when done
        socket.emit('progress', { progress: 100 });
    } catch (error) {
        logMessage('Error creating graph: ' + error, socket);
        throw error;
    } finally {
        await session.close();
    }
}

// Start server
const PORT = process.env.PORT || 5001;
http.listen(PORT, () => logMessage(`Server started on port ${PORT}`));
