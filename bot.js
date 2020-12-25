#!/usr/bin/env node

const accessKey = process.argv[2];
const clientId = process.argv[3];
if (!accessKey) {
    console.info('Usage: node bot.js <key> <anticaptcha_client_id>');
    process.exit(1);
}

const REQUEST_TIMEOUT = 5 * 60 * 1000;
const MAX_RETRIES = 5;

const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const objectListFile = path.normalize(process.argv[4] || './list.txt');
const resultFile = `${path.dirname(objectListFile)}/result-${path.basename(objectListFile)}`;
const objectList = fs.readFileSync(objectListFile, 'utf8').trim().split('\n').map(item => item.trim());

const {Builder, By, Key, until} = require('selenium-webdriver');
const {
    AntiCaptcha,
    AntiCaptchaError,
    // ErrorTypes,
    QueueTypes,
    TaskTypes,
    ErrorCodes
} = require("anticaptcha");

const AntiCaptchaAPI = new AntiCaptcha(clientId);

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

async function writeResult(result) {
    await exec(`echo ${result} >> ${resultFile}`);
}

(async () => {
    let driver = await new Builder().forBrowser('chrome').build();

    for (let i = objectList.length; i > 0; i--) {
        const result = await start(driver, objectList[i - 1]);
        await writeResult(result);

        objectList.pop();
        fs.writeFileSync(objectListFile, objectList.join('\n'), 'utf8');
        console.log(`DONE ON ${new Date()}`);

        if (objectList.length > 0) {
            console.log('WAITING…');
            await sleep(REQUEST_TIMEOUT);
        } else {
            console.log('COMPLETED');
        }
    }

    await driver.quit();
    //process.exit(0);
})();

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function start(driver, objectId, retry = 0) {
    try {
        console.log(`PROCESSING ${objectId}`);
        await driver.manage().deleteAllCookies();

        await driver.get('https://rosreestr.gov.ru/wps/portal/p/cc_present/ir_egrn');

        await auth(driver);

        await driver.sleep(2000);

        await openSearchPage(driver);

        await driver.sleep(3000);

        await driver.wait(
            until.elementLocated(By.css('input.v-textfield-prompt')),
            5000
        ).sendKeys(objectId, Key.RETURN);

        await driver.wait(
            until.elementLocated(By.css('input.v-filterselect-input')),
            5000
        ).sendKeys('Москва', Key.RETURN);

        await selectMenu(driver);

        await driver.sleep(2000);

        await driver.wait(
            until.elementLocated(By.css('.v-button:not(.v-button-link)')),
            5000
        ).click();

        await driver.wait(
            until.elementLocated(By.css('.v-table-cell-content-cadastral_num .v-label')),
            5000
        ).click();

        await driver.wait(
            until.elementLocated(By.css('img[src*=captcha]')),
            5000
        );

        await driver.sleep(1000);

        await driver.executeScript(extractImage);

        await driver.sleep(1000);

        const captcha = (await driver.findElement(By.css('body')).getAttribute('data-img'))
            .replace(/^data:image\/png;base64,/, '');

        if (captcha.length < 600) {
            throw new Error('Captcha Image is corrupted');
        }

        const text = await solveCaptcha(captcha);

        await driver.wait(
            until.elementLocated(By.css('input.v-textfield-srv-field')),
            5000
        ).sendKeys(text, Key.RETURN);

        await driver.wait(
            until.elementLocated(By.css('.v-horizontallayout > div > div > div > div > div > div:first-child .v-button')),
            5000
        ).click();

        await driver.sleep(2000);

        const reqId = await driver.wait(
            until.elementLocated(By.css('.v-label.v-label-tipFont.tipFont.v-label-undef-w b')),
            5000
        ).getText();

        const result = `${objectId} → ${reqId}`;

        console.log(result);

        return result;
    } catch (error) {
        console.log('ERROR', error.message);

        if (retry < MAX_RETRIES) {
            let currentRetry = retry + 1;
            console.log(`RETRYING ${objectId} FOR ${currentRetry} TIME`);

            return await start(driver, objectId, currentRetry);
        }

        const result = `${objectId} → FAILED`;
        console.log(result);

        return result;
    }
}

async function auth(driver) {
    await driver.wait(
        until.elementLocated(By.css('input.v-textfield')),
        5000
    ).sendKeys(accessKey, Key.RETURN);
}

async function openSearchPage(driver) {
    await driver.wait(
        until.elementLocated(By.css('div:first-child .v-button-caption')),
        5000
    ).click();
}

async function selectMenu(driver) {
    try {
        await driver.wait(
            until.elementLocated(By.css('.gwt-MenuItem')),
            5000
        ).click()
    } catch(error) {
        console.log('No Select Menu found, go to next step');
    }
}

async function solveCaptcha(imageString) {
    try {
        // Checking the account balance before creating a task. This is a conveniance method.
        if (!(await AntiCaptchaAPI.isBalanceGreaterThan(1))) {
            // You can dispatch a warning using mailer or do whatever.
            console.warn("Take care, you're running low on money !");
        }

        // Get service stats
        // const stats = await AntiCaptchaAPI.getQueueStats(QueueTypes.IMAGE_TO_TEXT_ENGLISH);
        // console.log('STAT', JSON.stringify(stats, null, 2));

        // Creating nocaptcha proxyless task
        const taskId = await AntiCaptchaAPI.createTask({
            type: TaskTypes.IMAGE_TO_TEXT,
            body: imageString
        });
        console.log('CAPTCHA TASK ID', taskId);

        // Waiting for resolution and do something
        const response = await AntiCaptchaAPI.getTaskResult(taskId);
        console.log('CAPTCHA TEXT', response.solution.text);

        // console.log('RESPONSE', JSON.stringify(response, null, 2));

        return response.solution.text;
    } catch(error) {
        console.log('CAPTCHA ERROR', error.message);

        return '';
        // if (
        //     e instanceof AntiCaptchaError &&
        //     e.code === ErrorCodes.ERROR_IP_BLOCKED
        // ) {
        //     console.log('CAPTCHA ERROR', e.message);
        // }

        // console.log('CAPTCHA ERROR', e.message);
    }
}
