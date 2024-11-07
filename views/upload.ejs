<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>XML File Upload</title>
    <style>
        /* Styles for layout, upload form, and progress */
        /* ... Your CSS styles as defined in the previous code */
    </style>
</head>
<body>
    <div class="main-container">
        <!-- Upload Form Container -->
        <div class="upload-container">
            <h1>Upload your XML File</h1>
            <% if (typeof msg !== 'undefined') { %>
                <p class="flash-message"><%= msg %></p>
            <% } %>
            <form id="uploadForm" action="/upload" method="POST" enctype="multipart/form-data">
                <input type="hidden" name="socketId" id="socketId"> <!-- Hidden input for socket ID -->
                <input type="file" name="file" id="fileInput" class="file-input" accept=".xml">
                <div class="upload-area" id="uploadArea">
                    <p>Drag & drop your file here or click to browse</p>
                </div>
                <div id="fileName" class="file-name"></div>

                <!-- Registration Input Field -->
                <div class="input-field">
                    <label for="registration">Aircraft Registration:</label>
                    <input type="text" name="registration" id="registration" required placeholder="Enter registration">
                </div>

                <button type="submit" class="submit-btn">Upload</button>
            </form>

            <div class="progress-container" style="display: none;">
                <progress id="progressBar" value="0" max="100"></progress>
                <p id="progressText" class="progress-text">Processing: 0%</p>
            </div>

            <div class="preview-box" id="previewBox" style="display: none;">
                <h4>File Preview:</h4>
                <pre id="filePreview"></pre>
            </div>
        </div>

        <!-- Log Messages Container -->
        <div class="log-container">
            <h1>Log Messages</h1>
            <div id="logMessages" class="log-messages"></div>
        </div>
    </div>

    <!-- Include Socket.IO client library -->
    <script src="/socket.io/socket.io.js"></script>
    <script>
        // JavaScript code
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const fileNameDiv = document.getElementById('fileName');
        const previewBox = document.getElementById('previewBox');
        const filePreview = document.getElementById('filePreview');
        const logMessagesDiv = document.getElementById('logMessages');
        const progressContainer = document.querySelector('.progress-container');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const uploadForm = document.getElementById('uploadForm');
        const socketIdInput = document.getElementById('socketId');

        // Establish Socket.IO connection
        const socket = io();

        socket.on('connect', () => {
            console.log('Connected with socket ID:', socket.id);
            socketIdInput.value = socket.id; // Set socket ID in the hidden input
        });

        socket.on('progress', (data) => {
            const progress = data.progress;
            progressBar.value = progress;
            progressText.textContent = `Processing: ${progress}%`;

            if (progress >= 100) {
                progressText.textContent = `Processing complete!`;
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                }, 2000);
            }
        });

        socket.on('log', (message) => {
            const p = document.createElement('p');
            p.textContent = message;
            logMessagesDiv.appendChild(p);
            logMessagesDiv.scrollTop = logMessagesDiv.scrollHeight; // Auto-scroll to the bottom
        });

        uploadArea.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            const fileName = file.name;
            fileNameDiv.textContent = `Selected file: ${fileName}`;

            if (file && file.type === "text/xml") {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const fileContent = e.target.result;
                    filePreview.textContent = fileContent;
                    previewBox.style.display = 'block';
                };
                reader.readAsText(file);
            } else {
                previewBox.style.display = 'none';
            }
        });

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragging');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragging');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragging');
            const files = e.dataTransfer.files;
            fileInput.files = files;
            const file = files[0];
            const fileName = file.name;
            fileNameDiv.textContent = `Selected file: ${fileName}`;

            if (file && file.type === "text/xml") {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const fileContent = e.target.result;
                    filePreview.textContent = fileContent;
                    previewBox.style.display = 'block';
                };
                reader.readAsText(file);
            } else {
                previewBox.style.display = 'none';
            }
        });

        uploadForm.addEventListener('submit', (e) => {
            progressContainer.style.display = 'block';
            progressBar.value = 0;
            progressText.textContent = 'Processing: 0%';
            logMessagesDiv.innerHTML = ''; // Clear previous log messages
        });
    </script>
</body>
</html>
