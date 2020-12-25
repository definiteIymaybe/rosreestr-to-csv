#!/usr/bin/env node

const accessKey = process.argv[2];
const clientId = process.argv[3];
if (!accessKey || !clientId) {
    console.info('Usage: node bot.js <reestr_access_key> <anticaptcha_client_id>[ <list_file>]');
    if (!accessKey) {
        console.info('Get access key at https://lk.rosreestr.ru/#/my_keys');
    }
    if (!clientId) {
        console.info('Get anticaptcha client id at https://anti-captcha.com');
    }
    process.exit(1);
}

const REGION = 'Москва'; // Type your Region here
const DEFAULT_LIST_FILE = 'list.txt';
const REQUEST_TIMEOUT = 5 * 60 * 1000;
const MAX_RETRIES = 5;

const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const objectListFile = path.normalize(process.argv[4] || DEFAULT_LIST_FILE);
const resultFile = `${path.dirname(objectListFile)}/result-${path.basename(objectListFile)}`;
const objectList = fs.readFileSync(objectListFile, 'utf8').trim().split('\n').map(item => item.trim());

const { Builder, By, Key, until } = require('selenium-webdriver');
const { AntiCaptcha, TaskTypes,/* QueueTypes*/ } = require('anticaptcha');

// RUN
(async () => {
    console.log(`STARTED ON ${new Date()}`);
    let driver = await new Builder().forBrowser('chrome').build();

    for (let i = objectList.length; i > 0; i--) {
        const objectId = objectList[i - 1];
        console.log(`PROCESSING ${objectId}`);

        const reqId = await start(driver, objectId);
        const result = `${objectId} → ${reqId || 'FAILED'}`;
        console.log(result);
        await writeResult(result);

        objectList.pop();
        fs.writeFileSync(objectListFile, objectList.join('\n'), 'utf8');
        console.log(`DONE ON ${new Date()}`);

        if (objectList.length > 0) {
            console.log('WAITING…');
            await sleep(REQUEST_TIMEOUT);
        }
    }

    console.log('COMPLETED');
    await driver.quit();
    process.exit(0);
})();

async function writeResult(result) {
    await exec(`echo ${result} >> ${resultFile}`);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function start(driver, objectId, retry = 0) {
    try {
        // Prepare Session
        await driver.manage().deleteAllCookies();

        await driver.get('https://rosreestr.gov.ru/wps/portal/p/cc_present/ir_egrn');

        await authorize(driver);

        await openSearchPage(driver);

        await inserObjectId(driver, objectId);

        await insertRegion(driver);

        await search(driver);

        await selectSearchResult(driver);

        const image = await getCaptchaImage(driver);
        const text = await solveCaptcha(image);

        await insertCaptchaText(driver, text);

        await commitRequest(driver);

        return await getRequestId(driver);
    } catch (error) {
        console.error('Error:', error.message);

        if (retry < MAX_RETRIES) {
            let currentRetry = retry + 1;
            console.log(`RETRYING ${objectId} FOR ${currentRetry} TIME`);

            await driver.sleep(5000);

            return await start(driver, objectId, currentRetry);
        }
    }
}

async function authorize(driver) {
    try {
        await driver.wait(
            until.elementLocated(By.css('input.v-textfield')),
            10000
        ).sendKeys(accessKey, Key.RETURN);
    } catch (error) {
        throw new Error('Authorization failed');
    }
}

async function openSearchPage(driver) {
    await driver.sleep(2000);

    try {
        await driver.wait(
            until.elementLocated(By.css('div:first-child .v-button-caption')),
            5000
        ).click();
    } catch (error) {
        throw new Error('Search Page button not found');
    }
}

async function inserObjectId(driver, objectId) {
    await driver.sleep(3000);

    try {
        await driver.wait(
            until.elementLocated(By.css('input.v-textfield-prompt')),
            5000
        ).sendKeys(objectId, Key.RETURN);
    } catch (error) {
        throw new Error('Input Field not found');
    }
}

async function insertRegion(driver) {
    try {
        await driver.wait(
            until.elementLocated(By.css('input.v-filterselect-input')),
            5000
        ).sendKeys(REGION, Key.RETURN);
    } catch (error) {
        throw new Error('Region Input not found');
    }

    try {
        await driver.wait(
            until.elementLocated(By.css('.gwt-MenuItem')),
            5000
        ).click()
    } catch (error) {
        throw new Error('Region Menu Item not found');
    }

}

async function search(driver) {
    await driver.sleep(2000);

    try {
        await driver.wait(
            until.elementLocated(By.css('.v-button:not(.v-button-link)')),
            5000
        ).click();
    } catch (error) {
        throw new Error('Search Button not found');
    }
}

async function selectSearchResult(driver) {
    try {
        await driver.wait(
            until.elementLocated(By.css('.v-table-cell-content-cadastral_num .v-label')),
            5000
        ).click();
    } catch (error) {
        throw new Error('Search Result Item not found');
    }
}

const extractImage = `
const sourceImg = document.querySelector('img[src*=captcha]');
const img = new Image();
const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    context.drawImage(img, 0, 0, img.width, img.height);
    document.body.setAttribute('data-img', canvas.toDataURL('image/png'));
};
img.src = sourceImg.src;
`;
async function getCaptchaImage(driver) {
    try {
        await driver.wait(
            until.elementLocated(By.css('img[src*=captcha]')),
            5000
        );

        await driver.executeScript(extractImage);

        await driver.sleep(1000);

        const image = (await driver.findElement(By.css('body')).getAttribute('data-img'))
            .replace(/^data:image\/png;base64,/, '');

        if (image.length < 600) {
            throw new Error('Captcha Image is corrupted');
        }

        return image;
    } catch (error) {
        throw new Error('Can not extract Captcha Image');
    }
}

const AntiCaptchaAPI = new AntiCaptcha(clientId);
async function solveCaptcha(imageString) {
    try {
        // Checking the account balance before creating a task. This is a conveniance method.
        if (!(await AntiCaptchaAPI.isBalanceGreaterThan(1))) {
            // You can dispatch a warning using mailer or do whatever.
            console.warn('ANTICAPTCHA: Take care, you\'re running low on money!');
        }

        // Get service stats
        // const stats = await AntiCaptchaAPI.getQueueStats(QueueTypes.IMAGE_TO_TEXT_ENGLISH);
        // console.log('STAT', JSON.stringify(stats, null, 2));

        // Creating nocaptcha proxyless task
        const taskId = await AntiCaptchaAPI.createTask({
            type: TaskTypes.IMAGE_TO_TEXT,
            body: imageString
        });
        console.log('ANTICAPTCHA TASK ID', taskId);

        // Waiting for resolution and do something
        const response = await AntiCaptchaAPI.getTaskResult(taskId);
        console.log('CAPTCHA TEXT', response.solution.text);

        // console.log('RESPONSE', JSON.stringify(response, null, 2));

        return response.solution.text;
    } catch (error) {
        throw new Error('Anticaptcha Error:', error.message);
    }
}

async function insertCaptchaText(driver, text) {
    try {
        await driver.wait(
            until.elementLocated(By.css('input.v-textfield-srv-field')),
            5000
        ).sendKeys(text, Key.RETURN);
    } catch (error) {
        throw new Error('Can not insert captcha text — no input field found');
    }
}

async function commitRequest(driver) {
    try {
        await driver.wait(
            until.elementLocated(By.css('.v-horizontallayout > div > div > div > div > div > div:first-child .v-button')),
            5000
        ).click();
    } catch (error) {
        throw new Error('Commit Button not found');
    }
}

async function getRequestId(driver) {
    await driver.sleep(2000);

    try {
        return await driver.wait(
            until.elementLocated(By.css('.v-label.v-label-tipFont.tipFont.v-label-undef-w b')),
            5000
        ).getText();
    } catch (error) {
        throw new Error('Request ID not found');
    }
}
