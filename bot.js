#!/usr/bin/env node

const accessKey = process.argv[2];
const clientId = process.argv[3];
if (!accessKey) {
    console.info('Usage: node bot.js <key> <anticaptcha_client_id>');
    process.exit(1);
}

const REQUEST_TIMEOUT = 5 * 60 * 1000;
const objectList = [
    // Object IDs goes here
];

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
const img = document.querySelector('img[src*=captcha]');
const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
canvas.width = img.width;
canvas.height = img.height;
context.drawImage(img, 0, 0, img.width, img.height);
document.body.setAttribute('data-img', canvas.toDataURL('image/png'));
`;


(async () => {
    for (let i = objectList.length; i > 0; i--) {
        const objectId = objectList[i - 1];
        console.log(`PROCESSING ${objectId}`);

        const reqId = await start(objectId);

        console.log(`${objectId} → ${reqId}`);
        console.log(`DONE ON ${new Date()}`);
        console.log('WAITING…');
        await sleep(REQUEST_TIMEOUT);
    }

    //process.exit(0);
})();

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function start(objectId) {
    let driver = await new Builder().forBrowser('chrome').build();

    try {
        await driver.get('https://rosreestr.gov.ru/wps/portal/p/cc_present/ir_egrn');

        await auth(driver);

        await driver.wait(
            until.elementLocated(By.css('div:first-child .v-button-caption')),
            5000
        ).click();

        await driver.sleep(2000);

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
            console.error('IMAGE IS TOO SMALL', captcha);
            return;
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

        return reqId;
    } finally {
        await driver.quit();
    }
}

async function auth(driver) {
    await driver.wait(
        until.elementLocated(By.css('input.v-textfield')),
        5000
    ).sendKeys(accessKey, Key.RETURN);

    console.log('AUTHORIZED');

    await driver.sleep(1000);
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
        const stats = await AntiCaptchaAPI.getQueueStats(QueueTypes.IMAGE_TO_TEXT_ENGLISH);
        console.log('STAT', JSON.stringify(stats, null, 2));

        // Creating nocaptcha proxyless task
        const taskId = await AntiCaptchaAPI.createTask({
            type: TaskTypes.IMAGE_TO_TEXT,
            body: imageString
        });
        console.log('TASK ID', taskId);

        // Waiting for resolution and do something
        const response = await AntiCaptchaAPI.getTaskResult(taskId);

        console.log('RESPONSE', JSON.stringify(response, null, 2));

        return response.solution.text;
    } catch(e) {
        if (
            e instanceof AntiCaptchaError &&
            e.code === ErrorCodes.ERROR_IP_BLOCKED
        ) {
            console.log('CAPTCHA ERROR', e.message);
        }

        console.log('CAPTCHA ERROR', e.message);
    }
}
