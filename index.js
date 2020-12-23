#!/usr/bin/env node

let dir = process.argv[2];
let destDir = process.argv[3] || './';
if (!dir) {
    console.info('Usage: node index.js <directory_with_archives> <destination_directory>');
    process.exit(1);
}

const util = require('util');
const exec = util.promisify(require('child_process').exec);
const findit = require('findit');
const readFile = util.promisify(require('fs').readFile);
const parser = require('fast-xml-parser');
const ObjectsToCsv = require('objects-to-csv');
const { select } = require("easy-object-selector");

const path = require('path');
const lastSlashExp = new RegExp(`${path.sep}$`);
dir = path.normalize(dir).replace(lastSlashExp, '');
destDir = path.normalize(destDir).replace(lastSlashExp, '');

/**
 * Итоговая таблица с данными
 * Поля:
 *  - floor — Этаж
 *  - number — номер помещения
 *  - cadastralNumber — кадастровый номер
 *  - type
 *  - area — площадь
 *  - fio
 *  - rightName
 *  - partSize
 *  - regNumber
 *  - regDate
 *  - encumbrance
 *  - cadastralCost
 *  - requeryNumber
 */
const resultData = [];

const FN = {
    FLOOR: 'Этаж',
    NUMBER: '№ пом.',
    CADASTRAL_NUMBER: 'Кадастровый номер',
    TYPE: 'Тип объекта',
    AREA: 'Площадь\nм²',
    FIO: 'ФИО правообладателей',
    RIGHT_NAME: 'Вид права',
    PART_SIZE: 'Размер доли',
    REG_NUMBER: 'Номер записи\nв кадастре',
    REG_DATE: 'Дата записи\nв кадастре',
    ENCUMBRANCE: 'Обременения',
    CADASTRAL_COST: 'Кадастровая стоимость\n₽',
    REQUERY_NUMBER: 'Номер запроса',
};

findExtAndCall(dir, 'zip', processFile)
    .then(async (result) => {
        console.log('FINISHED', dir);
        console.log(`PROCESSED ${result.length} FILES`);

        await writeData();

        process.exit(true ? 0 : 1);
    });

async function writeData() {
    resultData.sort((a, b) => {
        const aN = Number(a[FN.NUMBER]);
        const bN = Number(b[FN.NUMBER]);

        if (Number.isInteger(aN) && Number.isInteger(bN)) {
            return aN - bN;
        }

        if (!Number.isInteger(aN)) {
            return 1;
        }

        if (!Number.isInteger(bN)) {
            return -1;
        }

        return 0;
    });
    // console.log('TABLE', resultData);

    await new ObjectsToCsv(resultData).toDisk(`${destDir}/result.csv`);
}

async function parseXml(file) {
    const xmlData = await readFile(file, 'utf8');
    const jsonObj = parser.parse(xmlData, {
        ignoreAttributes: false
    });
    console.log(`parsed ${file}`);

    return jsonObj;
}

function extractData(dataObj) {
    const info = dataObj.KPOKS;
    const flat = info.Realty.Flat;
    const rights = select(flat, 'Rights.Right');
    const objRight = select(info, 'ReestrExtract.ExtractObjectRight.ExtractObject.ObjectRight.Right');
    const owners = selectOwners(rights);

    let fio;
    if (owners) {
        fio = owners.map((owner) => {
            return owner.Person && getFio(owner.Person)
                || owner.Organization && owner.Organization.Name;
        }).join('\n').replace(/&quot;/g, '"');
    }

    return {
        [FN.FLOOR]: selectFloor(select(flat, 'PositionInObject.Levels.Level')),
        [FN.NUMBER]: select(flat, 'PositionInObject.Levels.Level.Position.@_NumberOnPlan', 'нет'),
        [FN.CADASTRAL_NUMBER]: select(flat, '@_CadastralNumber'),
        [FN.TYPE]: selectType(select(flat, 'Assignation.flat:AssignationCode')),
        [FN.AREA]: flat.Area,
        [FN.FIO]: fio,
        [FN.RIGHT_NAME]: selectRights(rights, 'Name'),
        [FN.PART_SIZE]: selectPart(rights),
        [FN.REG_NUMBER]: selectRights(rights, 'Registration.RegNumber', '$$Данные отсутствуют$$'),
        [FN.REG_DATE]: selectRights(rights, 'Registration.RegDate'),
        [FN.ENCUMBRANCE]: selectEncumbrance(objRight),
        [FN.CADASTRAL_COST]: select(flat, 'CadastralCost.@_Value'),
        [FN.REQUERY_NUMBER]: select(info, 'ReestrExtract.DeclarAttribute.@_RequeryNumber'),
    };
}

function selectFloor(levels) {
    if (Array.isArray(levels)) {
        return levels.map(l => select(l, '@_Number')).join(',');
    }

    const level = levels['@_Number'];

    return {'0': 'Цокольный'}[level] || level;
}

function selectPart(rights) {
    if (typeof rights === 'undefined') {
        return;
    }

    if (Array.isArray(rights)) {
        const share = rights.map((right) => [
            select(right, 'Share.@_Numerator', '1'),
            '/',
            select(right, 'Share.@_Denominator', rights.length),
        ].join(''));

        return share.join('\n');
    }

    const owners = select(rights, 'Owners.Owner');
    if (Array.isArray(owners)) {
        return owners.map(o => [1, '/', owners.length].join('')).join('\n');
    }

    return '1';
}

function selectEncumbrance(right) {
    const defValue = 'нет информации';

    if (!right) {
        return defValue;
    }

    if (Array.isArray(right)) {
        return right.map((r) => select(r, 'Encumbrance.Name')
            || select(r, 'NoEncumbrance', defValue)).join('\n');
    }

    return select(right, 'Encumbrance.Name')
        || select(right, 'NoEncumbrance');
}

function selectOwners(rights) {
    if (typeof rights === 'undefined') {
        return;
    }

    if (Array.isArray(rights)) {
        return rights.map((right) => select(right, 'Owners.Owner'));
    }

    return [select(rights, 'Owners.Owner')].flat();
}

function selectRights(rights, selector, defValue) {
    if (typeof rights === 'undefined') {
        return defValue;
    }

    if (Array.isArray(rights)) {
        return rights.map((right) => select(right, selector)).join('\n');
    }

    return select(rights, selector);
}

function selectType(type) {
    return {
        '206001000000': 'Нежилое помещение',
        '206002000000': 'Помещение (Квартира)',
    }[type] || type;
}

function getFio(person) {
    return [
        person.FamilyName,
        person.FirstName,
        person.Patronymic,
    ].join(' ');
}

async function processFile(file) {
    const destFile = await unarchive(file);
    const parsedData = await parseXml(destFile);

    try {
        resultData.push(extractData(parsedData));
    } catch (err) {
        console.log('Extract Data Error', err.message);
        console.log('Parsed Data', parsedData);
    }

    return Promise.resolve();
}

async function unarchive(file) {
    const filename = path.basename(file);
    const destFilename = filename.split('.')[0];
    const destFile = `${destDir}/${destFilename}.xml`;

    await exec(`mkdir -p ${destDir}`);

    console.log(`unzip ${filename} => ${destFile}`);
    await exec(`unzip -p ${file} *.zip | funzip > ${destFile}`);

    return destFile;
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
