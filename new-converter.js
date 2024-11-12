// new-converter.js
const neo4j = require('neo4j-driver');
const xml2js = require('xml2js');

async function createGraphFromXML(xmlData, registration, driver, logMessage, clientId) {
    // Rest of your code remains the same, but include 'clientId' in logMessage calls
    const processedNodes = new Set();
    const session = driver.session();

    const uniqueLabel = 'Batch_' + new Date().toISOString().slice(0, 10).replace(/-/g, '_');

    try {
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        const result = await parser.parseStringPromise(xmlData);

        let docNumber = 'ServiceBulletin';
        if (result && result.AirplaneSB && result.AirplaneSB.$ && result.AirplaneSB.$.docnbr) {
            docNumber = result.AirplaneSB.$.docnbr;
            logMessage(`Found docnbr: ${docNumber}`, clientId);
        } else {
            logMessage('No docnbr attribute found; defaulting to "ServiceBulletin"', clientId);
        }

        logMessage(`Creating Service Bulletin node with docnbr "${docNumber}" and label "${uniqueLabel}"`, clientId);
        await session.writeTransaction(tx => tx.run(
            `MERGE (sb:ServiceBulletin:\`${uniqueLabel}\` {name: $docnbr, content: '000', docnbr: $docnbr})`,
            { docnbr: docNumber }
        ));
        logMessage('Service Bulletin node created.', clientId);

        // Use the registration provided by the user
        logMessage(`Using registration: "${registration}"`, clientId);

        // Connect the Service Bulletin to the matching Aircraft node
        await session.writeTransaction(tx => tx.run(
            `MATCH (sb:ServiceBulletin {docnbr: $docnbr}), (ac:Aircraft {registration: $registration})
            MERGE (sb)-[:APPLIES_TO]->(ac)`,
            { docnbr: docNumber, registration: registration }
        ));
        logMessage(`Connected Service Bulletin "${docNumber}" to Aircraft with registration "${registration}".`, clientId);

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

        async function createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    if (key.toUpperCase() === 'TITLE') {
                        const titleContent = obj[key];
                        const sanitizedRelationship = sanitizeRelationship(titleContent);
                        const titleNodeLabel = formatNodeLabel(sanitizedRelationship);
                        const nodeName = titleNodeLabel;

                        logMessage(`Gathering content for "${titleNodeLabel}"`, clientId);
                        const concatenatedContent = gatherContent(obj);

                        const uniqueKey = `${nodeName}-${concatenatedContent.trim()}`;
                        if (processedNodes.has(uniqueKey)) {
                            logMessage(`Node "${titleNodeLabel}" with content already processed, skipping.`, clientId);
                            continue;
                        }

                        processedNodes.add(uniqueKey);

                        logMessage(`Creating TITLE node for "${titleNodeLabel}" with label "${uniqueLabel}"`, clientId);
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name, docnbr: $docnbr})`,
                            { name: nodeName, docnbr: docNumber }
                        ));
                        logMessage(`TITLE node "${titleNodeLabel}" created.`, clientId);

                        if (!parentTitleNode) {
                            logMessage(`Connecting TITLE "${titleNodeLabel}" to Service Bulletin`, clientId);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (sb:ServiceBulletin:\`${uniqueLabel}\` {docnbr: $sbDocNbr}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName, docnbr: $docnbr})
                                MERGE (sb)-[:HAS_${sanitizedRelationship}]->(child)`,
                                { sbDocNbr: docNumber, childName: nodeName, docnbr: docNumber }
                            ));
                            logMessage(`Connected "${titleNodeLabel}" to Service Bulletin.`, clientId);
                        } else {
                            const dynamicRelationship = `HAS_${sanitizedRelationship}`;
                            logMessage(`Connecting TITLE "${parentNodeLabel}" to child TITLE "${titleNodeLabel}" with relationship "${dynamicRelationship}"`, clientId);
                            await session.writeTransaction(tx => tx.run(
                                `MATCH (parent:\`${parentNodeLabel}\`:\`${uniqueLabel}\` {name: $parentName, docnbr: $docnbr}), (child:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $childName, docnbr: $docnbr})
                                MERGE (parent)-[:${dynamicRelationship}]->(child)`,
                                { parentName: parentNodeLabel, childName: nodeName, docnbr: docNumber }
                            ));
                            logMessage(`Connected "${parentNodeLabel}" to "${titleNodeLabel}" with "${dynamicRelationship}".`, clientId);
                        }

                        const cleanedContent = concatenatedContent.replace(/<ColSpec\s*\/>/g, '');

                        logMessage(`Content for "${titleNodeLabel}" gathered: "${cleanedContent}"`, clientId);
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (n:\`${titleNodeLabel}\`:\`${uniqueLabel}\` {name: $name, docnbr: $docnbr})
                            SET n.content = $content`,
                            { name: nodeName, content: cleanedContent, docnbr: docNumber }
                        ));
                        logMessage(`Updated content for "${titleNodeLabel}".`, clientId);

                        logMessage(`Processing nested content for "${titleNodeLabel}"...`, clientId);
                        await createTitleNodesAndRelationships(titleNodeLabel, titleNodeLabel, obj);
                    }

                    if (typeof obj[key] === 'object' && key.toUpperCase() !== 'TITLE') {
                        await createTitleNodesAndRelationships(parentTitleNode, parentNodeLabel, obj[key]);
                    }
                }
            }
        }

        logMessage('Starting graph creation process...', clientId);
        const rootKey = Object.keys(result)[0];
        const rootObj = result[rootKey];

        // Begin processing
        await createTitleNodesAndRelationships(null, null, rootObj);

        logMessage('Graph created successfully with docnbr property: ' + docNumber, clientId);

        // Emit 100% progress when done
        if (clientId && sseClients.has(clientId)) {
            const res = sseClients.get(clientId);
            res.write(`event: progress\ndata: 100\n\n`);
            res.write(`event: done\ndata: Processing complete\n\n`);
        }
    } catch (error) {
        logMessage('Error creating graph: ' + error, clientId);
        throw error;
    } finally {
        await session.close();
    }
}

module.exports = { createGraphFromXML };
