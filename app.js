const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const neo4j = require('neo4j-driver');
const app = express();

// Neo4j Connection
const driver = neo4j.driver('bolt://127.0.0.1:7687', neo4j.auth.basic('neo4j', 'password'));
const session = driver.session();

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
    limits: { fileSize: 1000000 }, // 1MB file limit
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

// Index route
app.get('/', (req, res) => res.render('upload'));

// Handle file upload and process XML to Neo4j
app.post('/upload', (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            res.render('upload', { msg: err });
        } else {
            if (req.file == undefined) {
                res.render('upload', { msg: 'Error: No File Selected!' });
            } else {
                const xmlFilePath = `./uploads/${req.file.filename}`;

                // Read the XML file
                fs.readFile(xmlFilePath, 'utf-8', (err, data) => {
                    if (err) {
                        console.error('Error reading XML file:', err);
                        res.render('upload', { msg: 'Error reading the XML file' });
                    } else {
                        // Parse the XML data
                        xml2js.parseString(data, (err, result) => {
                            if (err) {
                                console.error('Error parsing XML:', err);
                                res.render('upload', { msg: 'Error parsing the XML file' });
                            } else {
                                // Process the XML to Neo4j
                                createGraphFromXML(result)
                                    .then(() => {
                                        res.render('upload', {
                                            msg: 'File Uploaded and Graph Created!',
                                            file: `uploads/${req.file.filename}`
                                        });
                                    })
                                    .catch((error) => {
                                        console.error('Error creating Neo4j graph:', error);
                                        res.render('upload', { msg: 'Error creating Neo4j graph' });
                                    });
                            }
                        });
                    }
                });
            }
        }
    });
});

async function createGraphFromXML(xmlData) {
    // Start a new session for each call to avoid using a closed session
    const session = driver.session();
    const tx = session.beginTransaction();
    
    try {
        // Loop through XML elements and create nodes/relationships
        if (xmlData.items && xmlData.items.item) {
            for (let item of xmlData.items.item) {
                const name = item.name[0];
                const value = item.value[0];

                // Create a node for each item in the XML
                await tx.run(
                    'CREATE (n:Item {name: $name, value: $value}) RETURN n',
                    { name: name, value: value }
                );
            }
        }

        // Commit the transaction
        await tx.commit();
    } catch (error) {
        console.error('Error during Neo4j transaction:', error);
        await tx.rollback();
        throw error;
    } finally {
        // Close the session after the transaction completes
        await session.close();
    }
}


// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
