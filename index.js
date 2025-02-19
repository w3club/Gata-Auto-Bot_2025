const fs = require('fs');
const { chromium } = require('playwright');
const path = require('path');
const banner = fs.readFileSync('banner.js', 'utf8');
const configs = JSON.parse(fs.readFileSync('configs.json', 'utf8'));

// Configuration
const BASE_URL = 'https://app.gata.xyz/dataAgent';
const ACTIVITY_INTERVAL = 120000; // 2 minutes in milliseconds
const ACTIVE_SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
const PAGE_TIMEOUT = 120000; // 2 minutes timeout for loading operations
const SCREENSHOT_PATH = 'current_screenshot.png';

console.log('\x1b[32m%s\x1b[0m', banner); 
console.log('\nStarting DVA automation...\n');

function cleanupScreenshots() {
    const directory = './';
    fs.readdirSync(directory).forEach(file => {
        if (file.startsWith('screenshot-') || 
            file.startsWith('debug-') || 
            file.startsWith('error-') || 
            file.startsWith('verification-')) {
            try {
                fs.unlinkSync(path.join(directory, file));
            } catch (err) {
                console.error(`Error deleting file ${file}:`, err);
            }
        }
    });
}

async function takeScreenshot(page, description = '') {
    try {
        if (fs.existsSync(SCREENSHOT_PATH)) {
            fs.unlinkSync(SCREENSHOT_PATH);
        }
        
        await page.screenshot({ path: SCREENSHOT_PATH });
        console.log(`Screenshot taken: ${description}`);
    } catch (error) {
        console.error('Error taking screenshot:', error.message);
    }
}

async function setRequiredLocalStorage(page) {
    await page.evaluate((configs) => {
        localStorage.setItem(configs.address, configs.bearer);
        localStorage.setItem('AGG_USER_IS_LOGIN', '1');
        localStorage.setItem('Gata_Chat_GotIt', '1');
        localStorage.setItem('aggr_current_address', configs.address);
        localStorage.setItem(`aggr_llm_token_${configs.address}`, configs.llm_token);
        localStorage.setItem(`aggr_task_token_${configs.address}`, configs.task_token);
        localStorage.setItem(`invite_code_${configs.address}`, configs.invite_code);
        localStorage.setItem('wagmi.recentConnectorId', '"metaMask"');
        localStorage.setItem('wagmi.store', JSON.stringify({
            state: {
                connections: {
                    __type: "Map",
                    value: [[
                        "e52bdc16f63",
                        {
                            accounts: [configs.address],
                            chainId: 1017,
                            connector: {
                                id: "metaMask",
                                name: "MetaMask",
                                type: "injected",
                                uid: "e52bdc16f63"
                            }
                        }
                    ]]
                },
                chainId: 1017,
                current: "e52bdc16f63"
            },
            version: 2
        }));
    }, configs);
    console.log('LocalStorage items set successfully');
}

async function waitForPageLoad(page) {
    try {
        await Promise.race([
            page.waitForLoadState('domcontentloaded', { timeout: PAGE_TIMEOUT }),
            page.waitForLoadState('load', { timeout: PAGE_TIMEOUT })
        ]);
        await page.waitForTimeout(5000);
        return true;
    } catch (error) {
        console.log('Page load timeout, but continuing execution...');
        return false;
    }
}

async function simulateActivity(page) {
    try {
        await page.evaluate(() => {
            window.scrollTo(0, 500);
            setTimeout(() => window.scrollTo(0, 0), 1000);
        });
        console.log(`Activity simulated at ${new Date().toLocaleTimeString()}`);
        await takeScreenshot(page, 'Activity simulation');
    } catch (error) {
        console.error('Error during activity simulation:', error.message);
    }
}

async function findAndClickStartButton(page) {
    console.log('Looking for Start button on DVA page...');
    
    try {
        await takeScreenshot(page, 'Before finding Start button');
        
        const currentUrl = page.url();
        if (!currentUrl.includes('/dataAgent')) {
            console.log('Not on DVA page, navigating...');
            await page.goto(BASE_URL);
            await waitForPageLoad(page);
        }

        await page.waitForTimeout(5000);

        const buttonFound = await page.evaluate(() => {
            const isVisible = (elem) => {
                if (!elem) return false;
                const style = window.getComputedStyle(elem);
                return style.display !== 'none' && 
                       style.visibility !== 'hidden' && 
                       style.opacity !== '0' &&
                       elem.offsetParent !== null;
            };

            const relevantTexts = ['start', 'begin', 'launch', 'dva', 'verify'];
            const elements = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], div[class*="button"]'));
            
            for (const element of elements) {
                const text = element.innerText.toLowerCase().trim();
                if (isVisible(element) && relevantTexts.some(t => text.includes(t))) {
                    element.click();
                    return true;
                }
            }

            const buttonSelectors = [
                '[class*="start"]',
                '[class*="begin"]',
                '[class*="launch"]',
                '[class*="verify"]',
                '[class*="dva"]'
            ];

            for (const selector of buttonSelectors) {
                const elements = Array.from(document.querySelectorAll(selector))
                    .filter(el => isVisible(el));
                
                if (elements.length > 0) {
                    elements[0].click();
                    return true;
                }
            }

            return false;
        });

        if (buttonFound) {
            console.log('Successfully clicked Start button');
            await takeScreenshot(page, 'After clicking Start button');
            return true;
        }

        console.log('Start button not found. Saving page content...');
        const pageContent = await page.content();
        fs.writeFileSync('dva-page-content.html', pageContent);
        return false;

    } catch (error) {
        console.error('Error finding Start button:', error);
        await takeScreenshot(page, 'Error state');
        return false;
    }
}

async function keepSessionActive(page) {
    const startTime = Date.now();
    
    const activityInterval = setInterval(async () => {
        if (Date.now() - startTime > ACTIVE_SESSION_DURATION) {
            clearInterval(activityInterval);
            console.log('Session duration limit reached. Stopping activity.');
            return;
        }
        await simulateActivity(page);
    }, ACTIVITY_INTERVAL);
    
    return activityInterval;
}

async function main() {
    cleanupScreenshots();

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    try {
        console.log('Navigating to DVA page...');
        await page.goto(BASE_URL);
        await waitForPageLoad(page);
        
        await setRequiredLocalStorage(page);
        console.log('Reloading page...');
        
        await Promise.all([
            page.reload(),
            waitForPageLoad(page)
        ]);
        
        await page.waitForTimeout(5000);
        
        const buttonClicked = await findAndClickStartButton(page);
        
        if (buttonClicked) {
            console.log('DVA Start button clicked successfully. Starting activity simulation...');
            const intervalId = await keepSessionActive(page);
            
            process.on('SIGINT', async () => {
                clearInterval(intervalId);
                console.log('Received SIGINT. Closing browser...');
                await browser.close();
                process.exit(0);
            });
        } else {
            console.error('Could not find DVA Start button. Check screenshots and page content for debugging.');
            await browser.close();
            process.exit(1);
        }
        
    } catch (error) {
        console.error('Error during execution:', error);
        await takeScreenshot(page, 'Fatal error');
        await browser.close();
        process.exit(1);
    }
}

main();
