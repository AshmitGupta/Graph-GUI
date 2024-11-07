const neo4j = require('neo4j-driver');
const xml2js = require('xml2js');

async function createGraphFromXML(xmlData, registration, driver, logCallback) {
    const session = driver.session();
    const uniqueLabel = 'Batch_' + new Date().toISOString().slice(0, 10).replace(/-/g, '_');

    try {
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        const result = await parser.parseStringPromise(xmlData);

        let docNumber = result.AirplaneSB?.$?.docnbr || 'ServiceBulletin';
        logCallback(`Found docnbr: ${docNumber}`);

        // Create Service Bulletin node
        logCallback(`Creating Service Bulletin node with docnbr "${docNumber}"`);
        await session.writeTransaction(tx => tx.run(
            `MERGE (sb:ServiceBulletin:\`${uniqueLabel}\` {name: $docnbr, content: '000', docnbr: $docnbr})`,
            { docnbr: docNumber }
        ));
        logCallback('Service Bulletin node created.');

        // Connect to Aircraft node based on registration
        logCallback(`Using registration: "${registration}"`);
        await session.writeTransaction(tx => tx.run(
            `MATCH (sb:ServiceBulletin {docnbr: $docnbr}), (ac:Aircraft {registration: $registration})
            MERGE (sb)-[:APPLIES_TO]->(ac)`,
            { docnbr: docNumber, registration: registration }
        ));
        logCallback(`Connected Service Bulletin "${docNumber}" to Aircraft with registration "${registration}".`);

        // Additional logic for parsing XML and creating other nodes
        logCallback('Graph created successfully with docnbr property: ' + docNumber);
    } catch (error) {
        logCallback('Error creating graph: ' + error);
        throw error;
    } finally {
        await session.close();
    }
}

module.exports = { createGraphFromXML };
