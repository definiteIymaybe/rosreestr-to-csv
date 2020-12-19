#!/usr/bin/env node

const util = require('util');
const path = require('path');

let dir = process.argv[2];
if (!dir) {
    console.info('Usage: node index.js <directory_with_archives>');
    process.exit(1);
}

const finder = require('findit')(dir);
const lastSlashExp = new RegExp(`${path.sep}$`);

dir = path.normalize(dir).replace(lastSlashExp, '');

finder.on('file', function(file) {
    if (!/(\.xml|\.zip)$/.test(file)) {
        return;
    }

    console.log('FILE =>', file);
});

finder.on('end', function() {
    console.log('FINISHED', dir);

    process.exit(true ? 0 : 1);
});
