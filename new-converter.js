const neo4j = require('neo4j-driver');
const xml2js = require('xml2js');

async function createGraphFromXML(xmlData, registration, driver, logCallback, progressCallback) {
    const session = driver.session();
    const uniqueLabel = 'Batch_' + new Date().toISOString().slice(0, 10).replace(/-/g, '_');
    const processedNodes = new Set();

    try {
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        const result = await parser.parseStringPromise(xmlData);

        let docNumber = result.AirplaneSB?.$?.docnbr || 'ServiceBulletin';
        logCallback(`Found docnbr: ${docNumber}`);

        // Initial progress
        progressCallback(0);

        // Create Service Bulletin node
        logCallback(`Creating Service Bulletin node with docnbr "${docNumber}"`);
        await session.writeTransaction(tx => tx.run(
            `MERGE (sb:ServiceBulletin:\`${uniqueLabel}\` {name: $docnbr, content: '000', docnbr: $docnbr})`,
            { docnbr: docNumber }
        ));
        logCallback('Service Bulletin node created.');

        // Use the registration provided by the user
        logCallback(`Using registration: "${registration}"`);

        // Connect the Service Bulletin to the matching Aircraft node
        await session.writeTransaction(tx => tx.run(
            `MATCH (sb:ServiceBulletin {docnbr: $docnbr}), (ac:Aircraft {registration: $registration})
            MERGE (sb)-[:APPLIES_TO]->(ac)`,
            { docnbr: docNumber, registration: registration }
        ));
        logCallback(`Connected Service Bulletin "${docNumber}" to Aircraft with registration "${registration}".`);

        // Helper functions
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

        async function createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    if (key.toUpperCase() === 'TITLE') {
                        const titleContent = obj[key];
                        const sanitizedRelationship = sanitizeRelationship(titleContent);
                        const titleNodeLabel = formatNodeLabel(sanitizedRelationship);
                        const nodeName = titleNodeLabel;

                        logCallback(`Gathering content for "${titleNodeLabel}"`);
                        const concatenatedContent = gatherContent(obj);

                        const uniqueKey = `${nodeName}-${concatenatedContent.trim()}`;
                        if (processedNodes.has(uniqueKey)) {
                            logCallback(`Node "${titleNodeLabel}" with content already processed, skipping.`);
                            continue;
                        }

                        processedNodes.add(uniqueKey);

                        logCallback(`Creating TITLE node for "${titleNodeLabel}" with label "${uniqueLabel}"`);
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name, docnbr: $docnbr})`,
                            { name: nodeName, docnbr: docNumber }
                        ));
                        logCallback(`TITLE node "${titleNodeLabel}" created.`);

                        if (!parentTitleNode) {
                            logCallback(`Connecting TITLE "${titleNodeLabel}" to Service Bulletin`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (sb:ServiceBulletin:\`${uniqueLabel}\` {docnbr: $sbDocNbr}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName, docnbr: $docnbr})
                                MERGE (sb)-[:HAS_${sanitizedRelationship}]->(child)`,
                                { sbDocNbr: docNumber, childName: nodeName, docnbr: docNumber }
                            ));
                            logCallback(`Connected "${titleNodeLabel}" to Service Bulletin.`);
                        } else {
                            const dynamicRelationship = `HAS_${sanitizedRelationship}`;
                            logCallback(`Connecting TITLE "${parentNodeLabel}" to child TITLE "${titleNodeLabel}" with relationship "${dynamicRelationship}"`);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (parent:\`${parentNodeLabel}\`:\`${uniqueLabel}\` {name: $parentName, docnbr: $docnbr}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName, docnbr: $docnbr})
                                MERGE (parent)-[:${dynamicRelationship}]->(child)`,
                                { parentName: parentNodeLabel, childName: nodeName, docnbr: docNumber }
                            ));
                            logCallback(`Connected "${parentNodeLabel}" to "${titleNodeLabel}" with "${dynamicRelationship}".`);
                        }

                        const cleanedContent = concatenatedContent.replace(/<ColSpec\s*\/>/g, '');

                        logCallback(`Content for "${titleNodeLabel}" gathered: "${cleanedContent}"`);
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name, docnbr: $docnbr})
                            SET n.content = $content`,
                            { name: nodeName, content: cleanedContent, docnbr: docNumber }
                        ));
                        logCallback(`Updated content for "${titleNodeLabel}".`);

                        // Update processed nodes count and emit progress
                        processedNodesCount += 1;
                        const progress = Math.round((processedNodesCount / totalNodes) * 100);
                        progressCallback(progress);

                        logCallback(`Processing nested content for "${titleNodeLabel}"...`);
                        await createTitleNodesAndRelationships(titleNodeLabel, titleNodeLabel, obj);
                    }

                    if (typeof obj[key] === 'object' && key.toUpperCase() !== 'TITLE') {
                        await createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj[key]);
                    }
                }
            }
        }

        logCallback('Starting graph creation process...');
        const rootKey = Object.keys(result)[0];
        const rootObj = result[rootKey];

        // Begin processing
        await createTitleNodesAndRelationships(null, null, rootObj);

        logCallback('Graph created successfully with docnbr property: ' + docNumber);

        // Emit 100% progress when done
        progressCallback(100);
    } catch (error) {
        logCallback('Error creating graph: ' + error);
        throw error;
    } finally {
        await session.close();
    }
}

module.exports = { createGraphFromXML };
