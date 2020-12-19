#!/usr/bin/env node

const util = require('util');
const path = require('path');
const exec = util.promisify(require('child_process').exec);

let dir = process.argv[2];
let destDir = process.argv[3] || './';
if (!dir) {
    console.info('Usage: node index.js <directory_with_archives> <destination_directory>');
    process.exit(1);
}

const findit = require('findit');
const readFile = util.promisify(require('fs').readFile);
const parser = require('fast-xml-parser');

const finder = require('findit')(dir);
const lastSlashExp = new RegExp(`${path.sep}$`);

dir = path.normalize(dir).replace(lastSlashExp, '');
destDir = path.normalize(destDir).replace(lastSlashExp, '');

findExtAndCall(dir, 'zip', (file) => {
    return processFile(file);
}).then((result) => {
    console.log('FINISHED', dir);
    console.log(`PROCESSED ${result.length} FILES`);
    // process.exit(true ? 0 : 1);
});

async function parseXml(file) {
    const xmlData = await readFile(file, 'utf8');
    const jsonObj = parser.parse(xmlData);
    console.log(`parsed ${file}`);

    console.log('DATA', jsonObj);
}

async function processFile(file) {
    const filename = path.basename(file);
    const destFilename = filename.split('.')[0];
    const destFile = `${destDir}/${destFilename}.xml`;

    await exec(`mkdir -p ${destDir}`);

    console.log(`unzip ${filename} => ${destFile}`);
    await exec(`unzip -p ${file} *.zip | funzip > ${destFile}`);
    await parseXml(destFile);

    return Promise.resolve();
}

async function findExtAndCall(directory, extension, callback) {
    const finder = findit(directory);

    return new Promise((resolve, reject) => {
        const jobs = [];

        finder.on('file', (file) => {
            if (!(new RegExp(`\\.${extension}$`, 'i').test(file))) {
                return;
            }

            jobs.push(callback(file));
        });

        finder.on('end', () => {
            resolve(Promise.all(jobs));
        });
    });
}
