#!/usr/bin/env node

const accessKey = process.argv[2];
const clientId = process.argv[3];
if (!accessKey) {
    console.info('Usage: node bot.js <key>');
    process.exit(1);
}

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
    let driver = await new Builder().forBrowser('chrome').build();
    await start(driver);

    //process.exit(0);
})();

async function solveCaptcha(imageString) {
    try {
        // Checking the account balance before creating a task. This is a conveniance method.
        if (!(await AntiCaptchaAPI.isBalanceGreaterThan(10))) {
          // You can dispatch a warning using mailer or do whatever.
          console.warn("Take care, you're running low on money !");
        }
    
        // Get service stats
        const stats = await AntiCaptchaAPI.getQueueStats(QueueTypes.IMAGE_TO_TEXT_ENGLISH);
        console.log('STAT', stats);
    
        // Creating nocaptcha proxyless task
        const taskId = await AntiCaptchaAPI.createTask({
            type: TaskTypes.IMAGE_TO_TEXT,
            body: imageString
        });
        console.log('TASK ID', taskId);
    
        // Waiting for resolution and do something
        const response = await AntiCaptchaAPI.getTaskResult(taskId);
    
        console.log('RESPONSE', response);
        return response.solution.text;
    } catch(e) {
        console.log('CAPTCHA ERROR', e.message);
        if (
            e instanceof AntiCaptchaError &&
            e.code === ErrorCodes.ERROR_IP_BLOCKED
        ) {
            console.log('CAPTCHA ERROR', e.message);
        }
    }
}

async function start(driver) {
    try {
        await driver.get('https://rosreestr.gov.ru/wps/portal/p/cc_present/ir_egrn');

        await auth(driver);

        await driver.wait(
            until.elementLocated(By.css('div:first-child .v-button-caption')),
            5000
        ).click();
        console.log('buttonCaption');

        await driver.sleep(3000);

        await driver.wait(
            until.elementLocated(By.css('input.v-textfield-prompt')),
            5000
        // TODO: брать из списка
        ).sendKeys('', Key.RETURN);

        await driver.wait(
            until.elementLocated(By.css('input.v-filterselect-input')),
            5000
        ).sendKeys('Москва', Key.RETURN);

        await selectMenu(driver);

        await driver.wait(
            until.elementLocated(By.css('.v-button:not(.v-button-link)')),
            5000
        ).click();

        try {
            await driver.wait(
                until.elementLocated(By.css('.v-table-cell-content-cadastral_num .v-label')),
                5000
            ).click();
        } catch(e) {
            console.log(e.message);
        }

        await driver.wait(
            until.elementLocated(By.css('img[src*=captcha]')),
            5000
        );

        await driver.executeScript(extractImage);
        const captcha = await driver.findElement(By.css('body')).getAttribute('data-img');
        console.log('IMG', captcha.replace(/^data:image\/png;base64,/, ''));

        const text = await solveCaptcha(captcha.replace(/^data:image\/png;base64,/, ''));

        await driver.wait(
            until.elementLocated(By.css('input.v-textfield-srv-field')),
            5000
        ).sendKeys(text, Key.RETURN);

        await driver.wait(
            until.elementLocated(By.css('.v-horizontallayout > div > div > div > div > div > div:first-child .v-button')),
            5000
        ).click();

        // Поле с номером запроса '.v-label.v-label-tipFont.tipFont.v-label-undef-w b'

        console.log('SLEEP');
        await driver.sleep(1000000);

    } finally {
        console.log('FINALLY');
        await driver.quit();
    }
}

async function auth(driver) {
    await driver.wait(
        until.elementLocated(By.css('input.v-textfield')),
        5000
    ).sendKeys(accessKey, Key.RETURN);
    console.log('accessKey');
    await driver.sleep(1000);

    try {
        await driver.wait(
            until.elementLocated(By.css('.normalButton')),
            2000
        ).click();
    } catch(error) {
        console.log('No Enter Button found, go to next step');
    }
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
