// Local simulated host only. No installed app, package or feed is accessed.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw Error('Provide ARTL_PLAYWRIGHT_MODULE and start npm run preview:manager.');
const engines = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const base = process.env.RASTA_MANAGER_URL || 'http://127.0.0.1:5173/';
fs.mkdirSync('dist/shadcn-preview', { recursive: true });

async function checkMenuEntry(menu, animated) {
    const motion = await menu.evaluate(el => {
        const entry = el.getAnimations().find(animation => animation instanceof CSSAnimation);
        if (!entry) return null;
        entry.pause();
        entry.currentTime = 0;
        const { left, top, width } = el.getBoundingClientRect();
        entry.currentTime = entry.effect.getComputedTiming().endTime;
        const resting = el.getBoundingClientRect();
        entry.finish();
        return { x: left - resting.left, y: top - resting.top, width: width - resting.width, side: el.dataset.side };
    });
    if (!animated) {
        assert.equal(motion, null);
        return;
    }
    assert.ok(motion, 'pointer opening animates the menu');
    assert.ok(Math.abs(motion.x) < 0.25 && Math.abs(motion.width) < 0.25, 'the menu keeps its horizontal position and width');
    assert.ok(motion.side === 'top' ? motion.y > 0 : motion.y < 0, 'the menu enters vertically from its trigger');
}

async function checkOpenCodeFontPlacement(browser) {
    const page = await browser.newPage({ viewport: { width: 342, height: 390 }, reducedMotion: 'no-preference' });
    try {
        await page.goto(new URL('panel-preview?host=opencode', base).href);
        await page.getByRole('button', { name: 'Open Rasta panel', exact: true }).click();
        await page.getByRole('button', { name: 'Typography', exact: true }).click();
        const font = page.getByRole('button', { name: 'Font', exact: true });
        await font.hover();
        const restingTrigger = await font.boundingBox();
        await font.evaluate(trigger => {
            const root = trigger.getRootNode();
            const frames = [];
            let frame;
            const sample = () => {
                const menu = root.querySelector('[data-slot=dropdown-menu-content]');
                if (menu && Number(getComputedStyle(menu).opacity) > 0) {
                    const { x, y, width } = menu.getBoundingClientRect();
                    if (y >= 0) frames.push({ x, width });
                }
                frame = requestAnimationFrame(sample);
            };
            frame = requestAnimationFrame(sample);
            window.stopFontPlacementSample = () => {
                cancelAnimationFrame(frame);
                return frames;
            };
        });
        await page.mouse.down();
        const menu = page.getByRole('menu', { name: 'Font', exact: true });
        await menu.waitFor();
        await page.waitForFunction(() => {
            const menu = document.querySelector('.artl-widget-container div')?.shadowRoot?.querySelector('[data-slot=dropdown-menu-content]');
            return menu && menu.getBoundingClientRect().top >= 0 && Number(getComputedStyle(menu).opacity) > 0.5;
        });
        await page.mouse.up();
        await page.waitForTimeout(250); // Include repositioning after release and the completed entry animation.
        const frames = await page.evaluate(() => window.stopFontPlacementSample());
        const restingMenu = frames.at(-1);
        assert.ok(frames.length > 2, 'sample visible frames before and after pointer release');
        assert.ok(Math.abs(restingMenu.x - restingTrigger.x) < 1, 'the menu aligns with its full-width trigger');
        for (const frame of frames) {
            assert.ok(Math.abs(frame.x - restingMenu.x) < 1 && Math.abs(frame.width - restingMenu.width) < 1,
                'the font menu stays horizontally aligned throughout pointer opening');
        }
    } finally { await page.close(); }
}

for (const engine of ['chromium', 'webkit']) {
    const browser = await engines[engine].launch({ headless: true });
    try {
        await checkOpenCodeFontPlacement(browser);
        for (const reducedMotion of ['no-preference', 'reduce']) {
            const context = await browser.newContext({ viewport: { width: 940, height: 780 }, reducedMotion });
            const page = await context.newPage();
            const errors = []; page.on('pageerror', e => errors.push(e.message));
            await page.goto(new URL('panel-preview', base).href);
            const trigger = page.getByRole('button', { name: 'Open Rasta panel', exact: true });
            await trigger.waitFor();
            await page.waitForFunction(() => {
                const text = document.querySelector('[data-markdown-text-style]'), style = getComputedStyle(text);
                return style.fontFamily.includes('Vazir') && style.fontSize === '16px' && Math.abs(parseFloat(style.lineHeight) - 25.6) < 0.1;
            });
            assert.equal(await trigger.getAttribute('data-active'), 'true');
            await trigger.click();
            await page.getByRole('dialog', { name: 'Rasta', exact: true }).waitFor();
            await page.evaluate(() => document.getElementById('surface').click());
            await trigger.waitFor({ state: 'hidden' });
            await page.getByRole('dialog', { name: 'Rasta', exact: true }).waitFor({ state: 'hidden' });
            await page.getByRole('searchbox', { name: 'Search settings' }).waitFor();
            await page.getByRole('button', { name: 'Show simulated chat' }).click();
            await trigger.waitFor();
            assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
            await page.mouse.move(0, 0);
            assert.equal((await trigger.boundingBox()).width, 28);
            const markColors = async mark => mark.evaluate(svg => Array.from(svg.children, shape => getComputedStyle(shape).fill));
            assert.deepEqual(await markColors(trigger.locator('svg')), ['rgb(242, 242, 242)']);
            const launcherStyle = () => trigger.evaluate(async el => {
                await Promise.all(el.getAnimations().map(animation => animation.finished));
                const style = getComputedStyle(el);
                return [style.opacity, style.borderTopWidth, style.outlineStyle, style.boxShadow, style.backgroundColor];
            });
            assert.deepEqual(await launcherStyle(), ['0.84', '0px', 'none', 'none', 'rgb(36, 36, 36)']);
            await trigger.hover();
            assert.deepEqual(await launcherStyle(), ['0.94', '0px', 'none', 'none', 'rgb(44, 44, 44)']);
            await page.mouse.move(0, 0);
            await page.evaluate(() => { window.demoReading = { isRTL: false, forceRTL: true, fixAtSign: false, fs: '18', lh: '1.8' }; });
            // Deliberately avoid a focus event: the running renderer must poll saved preferences.
            await page.waitForFunction(() => {
                const saved = JSON.parse(localStorage.getItem('rasta-config'));
                return saved && !saved.isRTL && saved.forceRTL && !saved.fixAtSign && saved.fs === '18' && saved.lh === '1.8';
            });
            assert.equal(await trigger.getAttribute('data-active'), 'false');
            await trigger.click();
            const dialog = page.getByRole('dialog', { name: 'Rasta', exact: true });
            const rtl = dialog.getByRole('switch', { name: 'Enable RTL', exact: true });
            await rtl.waitFor();
            assert.deepEqual(await markColors(dialog.locator('span.bg-primary > svg')), ['rgb(32, 32, 32)']);
            assert.deepEqual(await launcherStyle(), ['1', '0px', 'none', 'none', 'rgb(52, 52, 52)']);
            await page.mouse.move(0, 0);
            assert.deepEqual(await launcherStyle(), ['1', '0px', 'none', 'none', 'rgb(52, 52, 52)']);
            assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
            const close = dialog.getByRole('button', { name: 'Close', exact: true });
            const closeFill = () => close.evaluate(async el => {
                await Promise.all(el.getAnimations().map(animation => animation.finished));
                return getComputedStyle(el).backgroundColor;
            });
            for (const light of [false, true]) {
                await page.evaluate(light => document.documentElement.classList.toggle('dark', !light), light);
                const focusFill = light ? 'rgb(222, 222, 222)' : 'rgb(62, 62, 62)';
                const hoverFill = light ? 'rgb(232, 232, 232)' : 'rgb(48, 48, 48)';
                await close.press('Shift');
                assert.equal(await closeFill(), focusFill);
                await close.hover();
                assert.equal(await closeFill(), hoverFill, 'Close shows hover even while retaining keyboard focus');
                await page.mouse.move(0, 0);
                assert.equal(await closeFill(), focusFill, 'Close returns to its focus fill on pointer exit');
            }
            await page.evaluate(() => document.documentElement.classList.add('dark'));
            const settingsInset = control => control.evaluate(el => {
                const content = el.closest('[data-slot=accordion-transition] > div > div');
                const style = getComputedStyle(content);
                return [style.paddingInlineStart, style.paddingInlineEnd];
            });
            const readingInset = await settingsInset(rtl);
            assert.deepEqual(readingInset, ['10px', '10px']);
            assert.equal(await rtl.getAttribute('aria-checked'), 'false');
            assert.equal(await dialog.getByRole('switch').count(), 3);
            assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
            assert.equal(await dialog.getByRole('combobox').count(), 0);
            const behavior = dialog.getByRole('button', { name: 'Reading', exact: true });
            const typography = dialog.getByRole('button', { name: 'Typography', exact: true });
            assert.equal(await behavior.getAttribute('aria-expanded'), 'true');
            assert.equal(await typography.getAttribute('aria-expanded'), 'false');
            for (const heading of [behavior, typography]) {
                const offset = await heading.evaluate(button => {
                    const icon = button.querySelector(':scope > svg path').getBoundingClientRect();
                    const row = button.getBoundingClientRect();
                    return (icon.top + icon.height / 2) - (row.top + row.height / 2);
                });
                assert.ok(Math.abs(offset) < 1, 'the chevron is centered in the open or closed row');
            }
            assert.ok(Math.abs(await typography.evaluate(el => {
                const item = el.closest('[data-slot=accordion-item]');
                return el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft) - item.getBoundingClientRect().left;
            })) < 1, 'section title aligns with the divider');
            await dialog.evaluate(el => {
                window.accordionTransitions = [];
                el.addEventListener('transitionrun', event => {
                    if (event.target.matches('[data-slot="accordion-transition"]') && event.propertyName === 'grid-template-rows') {
                        window.accordionTransitions.push(event.target.parentElement.dataset.state);
                    }
                });
            });
            await typography.click();
            await close.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
            assert.equal(await close.evaluate(el => getComputedStyle(el).color), 'rgb(163, 163, 163)');
            assert.equal(await typography.getAttribute('aria-expanded'), 'true');
            assert.equal(await behavior.getAttribute('aria-expanded'), 'false');
            assert.equal(await dialog.getByRole('switch').count(), 0);
            assert.equal(await dialog.getByRole('combobox').count(), 2);
            assert.equal(await dialog.getByRole('region', { name: 'Reading preview' }).count(), 0);
            assert.equal(await dialog.getByText('Saved for Codex', { exact: true }).count(), 0);
            if (reducedMotion === 'reduce') {
                assert.deepEqual(await page.evaluate(() => window.accordionTransitions), []);
            } else {
                await page.waitForFunction(() => ['open', 'closed'].every(state => window.accordionTransitions.includes(state)));
            }
            const textSize = dialog.getByRole('combobox', { name: 'Size' });
            assert.deepEqual(await settingsInset(textSize), readingInset);
            const spacing = dialog.getByRole('combobox', { name: 'Spacing' });
            const font = dialog.getByRole('button', { name: 'Font', exact: true });
            await page.evaluate(() => {
                window.typographyWrites = [];
                for (const action of ['saveReading', 'selectFont']) {
                    const write = window.rastaNative[action];
                    window.rastaNative[action] = (...args) => {
                        window.typographyWrites.push(action);
                        return write(...args);
                    };
                }
            });
            for (const [control, role, name] of [
                [textSize, 'option', '18 px'],
                [spacing, 'option', 'Spacious'],
                [font, 'menuitemradio', 'Vazir'],
            ]) {
                await control.click();
                const selected = page.getByRole(role, { name, exact: true });
                await selected.click();
                await selected.waitFor({ state: 'hidden' });
            }
            assert.deepEqual(await page.evaluate(() => window.typographyWrites), []);
            assert.equal(await dialog.locator('[data-sonner-toast]').count(), 0);
            await textSize.click();
            const listbox = page.getByRole('listbox');
            await checkMenuEntry(listbox, reducedMotion !== 'reduce');
            assert.notEqual(await listbox.evaluate(el => getComputedStyle(el).boxShadow), 'none', 'the portaled select casts its shadow inside the panel');
            await page.getByRole('option', { name: '16 px' }).click();
            await page.waitForFunction(() => window.demoReading.fs === '16');
            await textSize.getByText('16 px').waitFor();
            await dialog.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'Saved for Codex' }).waitFor();
            await page.waitForFunction(() => document.querySelector('.artl-widget-container div')?.shadowRoot?.activeElement?.id === 'text-size');
            await textSize.press('Enter');
            await page.getByRole('option', { name: '18 px' }).waitFor();
            await checkMenuEntry(listbox, false);
            await page.keyboard.press('Escape');
            await listbox.waitFor({ state: 'hidden' });
            assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
            await font.click();
            const fontMenu = page.getByRole('menu', { name: 'Font' });
            await checkMenuEntry(fontMenu, reducedMotion !== 'reduce');
            const addFont = fontMenu.getByRole('menuitem', { name: 'Add font', exact: true });
            await page.evaluate(() => {
                // A host can restore composer focus as a font write completes.
                for (const action of ['importFont', 'removeFont']) {
                    const writeFont = window.rastaNative[action];
                    window.rastaNative[action] = async (...args) => {
                        const value = await writeFont(...args);
                        document.querySelector('#chat textarea').focus();
                        return value;
                    };
                }
            });
            const [invalidChooser] = await Promise.all([page.waitForEvent('filechooser'), addFont.click()]);
            assert.equal(await invalidChooser.element().getAttribute('accept'), '.ttf,.otf');
            await invalidChooser.setFiles({ name: 'Unsupported.woff', mimeType: 'font/woff', buffer: Buffer.from('fixture') });
            const fontErrorToast = dialog.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: 'Unsupported.woff' });
            await fontErrorToast.getByText('Unsupported.woff: Choose a valid TTF or OTF font up to 2 MB.').waitFor();
            assert.equal(await dialog.locator('[data-slot=alert]').count(), 0);
            await font.getByText('Vazir', { exact: true }).waitFor();
            await fontErrorToast.getByRole('button', { name: 'Close toast' }).click();
            await font.click();
            const [chooser] = await Promise.all([page.waitForEvent('filechooser'), addFont.click()]);
            assert.equal(await page.getByRole('dialog', { name: 'Add reading fonts' }).count(), 0);
            await chooser.setFiles('bin/assets/Vazir-Bold.ttf');
            await font.getByText('Vazir Bold', { exact: true }).waitFor();
            assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'import keeps the panel open after the host restores focus');
            await page.waitForFunction(() => document.querySelector('.artl-widget-container div')?.shadowRoot?.activeElement?.id === 'font-family');
            await font.click();
            assert.notEqual(await fontMenu.evaluate(el => getComputedStyle(el).boxShadow), 'none');
            const fontWeight = item => item.evaluate(el => getComputedStyle(el).fontWeight);
            assert.equal(await fontWeight(fontMenu.getByRole('menuitemradio', { name: 'Vazir Bold', exact: true })), '600');
            assert.equal(await fontWeight(fontMenu.getByRole('menuitemradio', { name: 'Vazir', exact: true })), '500');
            await page.getByRole('menuitemradio', { name: 'Vazir', exact: true }).click();
            await font.getByText('Vazir', { exact: true }).waitFor();
            await font.press('Enter');
            await checkMenuEntry(fontMenu, false);
            const removeFont = fontMenu.getByRole('menuitem', { name: 'Remove Vazir Bold', exact: true });
            await page.waitForFunction(() => {
                const item = document.querySelector('.artl-widget-container div')?.shadowRoot?.activeElement;
                return item?.getAttribute('role') === 'menuitemradio' && item.textContent.trim() === 'Vazir';
            });
            await fontMenu.getByRole('menuitemradio', { name: 'Vazir Bold', exact: true }).press('ArrowDown');
            await page.waitForFunction(() => document.querySelector('.artl-widget-container div')?.shadowRoot?.activeElement?.getAttribute('aria-label') === 'Remove Vazir Bold');
            await page.keyboard.press('Enter');
            const removal = page.getByRole('alertdialog', { name: 'Remove font?' });
            await removal.getByText('Vazir Bold', { exact: true }).waitFor();
            const animationName = await removal.evaluate(el => getComputedStyle(el).animationName);
            assert.equal(animationName !== 'none', reducedMotion !== 'reduce');
            for (const viewport of [{ width: 940, height: 780 }, { width: 350, height: 390 }]) {
                await page.setViewportSize(viewport);
                await page.waitForFunction(() => {
                    const shadow = document.querySelector('.artl-widget-container div')?.shadowRoot;
                    const panel = shadow?.querySelector('[data-rasta-panel]')?.getBoundingClientRect();
                    const alert = shadow?.querySelector('[role="alertdialog"]')?.getBoundingClientRect();
                    return panel && alert
                        && Math.abs((panel.left + panel.right) - (alert.left + alert.right)) < 2
                        && Math.abs((panel.top + panel.bottom) - (alert.top + alert.bottom)) < 2;
                });
            }
            await page.setViewportSize({ width: 940, height: 780 });
            await removal.getByRole('button', { name: 'Cancel' }).click();
            if (reducedMotion !== 'reduce') {
                const closing = page.locator('[data-slot="alert-dialog-content"][data-state="closed"]');
                assert.notEqual(await closing.evaluate(el => getComputedStyle(el).animationName), 'none');
            }
            await removal.waitFor({ state: 'hidden' });
            await page.waitForFunction(() => document.querySelector('.artl-widget-container div')?.shadowRoot?.activeElement?.id === 'font-family');
            await font.click();
            await page.getByRole('menuitemradio', { name: 'Vazir Bold', exact: true }).click();
            await font.getByText('Vazir Bold', { exact: true }).waitFor();
            await font.click();
            await removeFont.click();
            await removal.getByRole('button', { name: 'Remove font', exact: true }).click();
            await removal.waitFor({ state: 'hidden' });
            assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'removal keeps the panel open after the host restores focus');
            await font.getByText('Vazir', { exact: true }).waitFor();
            await page.waitForFunction(() => document.querySelector('.artl-widget-container div')?.shadowRoot?.activeElement?.id === 'font-family');
            await typography.press('Enter');
            assert.equal(await typography.getAttribute('aria-expanded'), 'false');
            assert.equal(await dialog.getByRole('combobox').count(), 0);
            assert.equal(await dialog.getByText(/accent color|beta updates|remove rasta|theme|v\d+\./i).count(), 0);
            const refresh = dialog.getByRole('button', { name: 'Refresh', exact: true });
            assert.equal(await refresh.getAttribute('data-variant'), 'outline');
            await behavior.focus();
            await page.mouse.move(0, 0);
            const headingStyle = () => typography.evaluate(async el => {
                await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished));
                const item = el.closest('[data-slot=accordion-item]');
                const button = el.getBoundingClientRect();
                const section = item.getBoundingClientRect();
                const style = getComputedStyle(el);
                const chevron = el.querySelector(':scope > svg');
                const iconBounds = chevron.getBoundingClientRect();
                const iconStyle = getComputedStyle(chevron);
                return {
                    background: style.backgroundColor,
                    color: style.color,
                    chevronBounds: [iconBounds.left - button.left, iconBounds.top - button.top, iconBounds.width, iconBounds.height],
                    chevronColor: iconStyle.color,
                    chevronOpacity: iconStyle.opacity,
                    top: button.top - section.top,
                    bottom: section.bottom - button.bottom,
                };
            });
            const idle = await headingStyle();
            await typography.hover();
            const hover = await headingStyle();
            assert.equal(idle.color, 'rgb(163, 163, 163)');
            assert.equal(hover.color, 'rgb(255, 255, 255)');
            assert.equal(hover.background, idle.background, 'hover leaves the section background transparent');
            assert.deepEqual(hover.chevronBounds, idle.chevronBounds, 'the chevron keeps its size and position during hover');
            assert.equal(hover.chevronColor, idle.chevronColor);
            assert.equal(idle.chevronOpacity, '0.65');
            assert.equal(hover.chevronOpacity, '1');
            assert.ok(hover.top >= 4, 'the trigger has a gap from the divider');
            assert.ok(Math.abs(hover.top - hover.bottom) < 1, 'the collapsed section has balanced vertical spacing');
            await page.mouse.move(0, 0);
            await behavior.press('ArrowDown');
            await typography.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
            const focus = await typography.evaluate(el => {
                const style = getComputedStyle(el);
                return [el.getRootNode().activeElement === el, style.backgroundColor, style.borderTopWidth, style.outlineStyle, style.boxShadow];
            });
            assert.deepEqual(focus, [true, 'rgb(62, 62, 62)', '0px', 'none', 'none']);
            assert.notEqual(focus[1], hover.background);
            const sectionPadding = await typography.evaluate(el => {
                const section = getComputedStyle(el.closest('[data-slot=accordion-item]'));
                return [section.paddingTop, section.paddingBottom];
            });
            assert.deepEqual(await refresh.evaluate(el => {
                const row = getComputedStyle(el.parentElement);
                return [row.paddingTop, row.paddingBottom];
            }), sectionPadding, 'the update row matches the section padding');
            await refresh.press('Enter');
            const pending = dialog.getByRole('button', { name: 'Checking…', exact: true });
            await pending.waitFor();
            assert.equal(await pending.evaluate(el => el.getRootNode().activeElement === el), true);
            assert.equal(await pending.getAttribute('aria-busy'), 'true');
            const toast = dialog.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'Rasta is up to date' });
            await toast.waitFor();
            await toast.evaluate(el => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            if (reducedMotion === 'reduce') assert.equal(await toast.evaluate(el => getComputedStyle(el).transitionProperty), 'none');
            else assert.equal(await toast.evaluate(el => getComputedStyle(el).transitionDuration), '0.22s');
            assert.equal(await refresh.evaluate(el => el.getRootNode().activeElement === el), true);
            assert.equal(await page.locator('#result').innerText(), '');
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'hidden' });
            await page.waitForFunction(() => document.activeElement === document.querySelector('.artl-widget-trigger'));
            assert.deepEqual(await launcherStyle(), ['1', '0px', 'none', 'none', 'rgb(36, 36, 36)']);
            await trigger.press('Enter');
            await dialog.waitFor();
            assert.equal(await dialog.evaluate(el => getComputedStyle(el).animationName), 'none', 'keyboard entry is immediate');
            await page.getByRole('textbox', { name: 'Message', exact: true }).click();
            await dialog.waitFor({ state: 'hidden' });
            assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).evaluate(el => document.activeElement === el), true, 'outside clicks keep focus in the host composer');
            await page.getByRole('button', { name: 'Toggle update availability' }).click();
            await page.locator('.artl-update-badge').waitFor({ state: 'visible' });
            await trigger.click();
            await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
            await page.getByRole('button', { name: 'Open Rasta', exact: true }).click();
            await page.locator('#result').filter({ hasText: 'Simulated: opened the Codex page in Rasta.' }).waitFor();
            await dialog.waitFor({ state: 'hidden' });
            await trigger.click();
            await rtl.click();
            await page.waitForFunction(() => {
                const trigger = document.querySelector('.artl-widget-trigger');
                return trigger.dataset.active === 'true' && getComputedStyle(trigger).backgroundColor === 'rgb(52, 52, 52)' && getComputedStyle(trigger).color === 'rgb(242, 242, 242)';
            });
            await dialog.getByRole('switch', { name: 'Enable RTL', exact: true, checked: true }).waitFor();
            const library = await context.newPage();
            await library.goto(base);
            await library.getByRole('button', { name: /Codex settings/ }).click();
            const libraryRTL = library.getByRole('switch', { name: 'Right-to-left reading' });
            await libraryRTL.waitFor();
            assert.equal(await libraryRTL.getAttribute('aria-checked'), 'true');
            const dependentNames = ['Enable force RTL', 'Type @ with Shift+2'];
            const dependentStates = ['true', 'false'];
            await libraryRTL.click();
            await library.waitForFunction(() => !JSON.parse(localStorage.getItem('rasta-preview-reading-codex')).isRTL);
            for (const [index, name] of dependentNames.entries()) {
                const control = library.getByRole('switch', { name, exact: true });
                assert.equal(await control.isDisabled(), true, name + ' is disabled in Library');
                assert.equal(await control.getAttribute('aria-checked'), dependentStates[index]);
            }
            await library.close();
            await page.bringToFront();
            await page.waitForFunction(() => document.querySelector('.artl-widget-trigger').dataset.active === 'false');
            await dialog.getByRole('switch', { name: 'Enable RTL', exact: true, checked: false }).waitFor();
            for (const [index, name] of dependentNames.entries()) {
                const control = dialog.getByRole('switch', { name, exact: true });
                assert.equal(await control.isDisabled(), true, name + ' is disabled in the host panel');
                assert.equal(await control.getAttribute('aria-checked'), dependentStates[index]);
                await control.locator('..').click({ position: { x: 3, y: 3 } });
            }
            const savedDependencies = () => page.evaluate(() => {
                const { forceRTL, fixAtSign } = JSON.parse(localStorage.getItem('rasta-preview-reading-codex'));
                return [forceRTL, fixAtSign];
            });
            assert.deepEqual(await savedDependencies(), [true, false], 'clicking disabled rows keeps the saved choices');
            await rtl.click();
            await dialog.getByRole('switch', { name: 'Enable RTL', exact: true, checked: true }).waitFor();
            for (const [index, name] of dependentNames.entries()) {
                const control = dialog.getByRole('switch', { name, exact: true });
                assert.equal(await control.isEnabled(), true);
                assert.equal(await control.getAttribute('aria-checked'), dependentStates[index]);
            }
            assert.deepEqual(await savedDependencies(), [true, false]);
            await dialog.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
            await page.screenshot({ path: path.resolve(`dist/shadcn-preview/connection-panel-${engine}-${reducedMotion}.png`) });
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'hidden' });
            await page.getByRole('button', { name: 'Switch appearance' }).click();
            await page.evaluate(() => { document.documentElement.style.fontSize = '12px'; });
            await trigger.click();
            await dialog.waitFor();
            await dialog.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
            assert.equal(await dialog.evaluate(el => getComputedStyle(el).getPropertyValue('--surface')), '#f7f7f7');
            assert.equal((await dialog.boundingBox()).width, 320, 'host rem size cannot resize the panel');
            await page.setViewportSize({ width: 360, height: 300 });
            await page.waitForFunction(() => {
                const host = document.querySelector('.artl-widget-container div');
                const rect = host?.shadowRoot?.querySelector('[role=dialog]')?.getBoundingClientRect();
                return rect && rect.y >= 15 && rect.bottom <= innerHeight - 55;
            });
            const bounds = await dialog.boundingBox();
            assert.ok(bounds.x >= 15 && bounds.y >= 15 && bounds.x + bounds.width <= 345 && bounds.y + bounds.height <= 245);
            assert.equal(await dialog.evaluate(el => [...el.children].some(child => getComputedStyle(child).overflowY === 'auto')), true);
            const existingToastClose = dialog.getByRole('button', { name: 'Close toast', exact: true });
            if (await existingToastClose.isVisible()) await existingToastClose.click();
            await dialog.getByRole('button', { name: 'Close', exact: true }).click();
            await page.waitForFunction(() => document.activeElement === document.querySelector('.artl-widget-trigger'));
            await page.evaluate(() => window.__rastaPro.dispose());
            assert.equal(await page.locator('.artl-widget-container').count(), 0);
            assert.deepEqual(errors, []);
            await page.setViewportSize({ width: 280, height: 330 });
            await page.goto(new URL('panel-preview?host=antigravity', base).href);
            await page.evaluate(() => { document.documentElement.style.fontSize = '18px'; });
            await trigger.click();
            await behavior.waitFor();
            assert.equal(await behavior.getAttribute('aria-expanded'), 'true');
            const scroll = () => dialog.evaluate(el => {
                const region = [...el.children].find(child => getComputedStyle(child).overflowY === 'auto');
                return { client: region.clientWidth, content: region.scrollWidth, x: getComputedStyle(region).overflowX };
            });
            let size = await scroll();
            assert.equal(size.content, size.client, 'Reading fits without horizontal scrolling');
            assert.equal(size.x, 'hidden');
            await typography.click();
            await textSize.waitFor();
            size = await scroll();
            assert.equal(size.content, size.client, 'Typography fits without horizontal scrolling');
            await textSize.click();
            await page.getByRole('option', { name: '18 px' }).click();
            await textSize.getByText('18 px').waitFor();
            await dialog.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'Saved for Antigravity' }).waitFor();
            assert.equal(await page.evaluate(() => window.demoReading.fs), '18');
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rasta-preview-reading-codex')).fs), '16');
            await page.setViewportSize({ width: 360, height: 300 });
            await page.goto(new URL('panel-preview?host=t3', base).href);
            await trigger.click();
            assert.equal(await typography.getAttribute('aria-expanded'), 'false');
            await typography.click();
            await dialog.getByRole('button', { name: 'Font', exact: true }).waitFor();
            await behavior.click();
            for (const name of ['Enable force RTL', 'Type @ with Shift+2', 'Enable RTL']) {
                const control = dialog.getByRole('switch', { name, exact: true });
                const before = await control.getAttribute('aria-checked');
                const row = control.locator('..');
                await row.hover({ position: { x: 3, y: 3 } });
                assert.equal(await row.evaluate(el => getComputedStyle(el.querySelector('[data-slot=label]')).cursor), 'pointer');
                assert.equal(await control.evaluate(el => getComputedStyle(el).cursor), 'pointer');
                await row.click({ position: { x: 3, y: 3 } });
                await dialog.getByRole('switch', { name, exact: true, checked: before !== 'true' }).waitFor();
                assert.equal(await control.evaluate(el => el.getRootNode().activeElement === el), true, 'saving keeps focus on the switch');
                assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
            }
            const state = async () => trigger.evaluate(el => ({
                color: getComputedStyle(el).color,
                background: getComputedStyle(el).backgroundColor,
            }));
            const before = await rtl.getAttribute('aria-checked');
            const launcherReading = async active => {
                await page.waitForFunction(active => document.querySelector('.artl-widget-trigger').dataset.active === active, active);
                await trigger.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
                return state();
            };
            const previousStyle = await launcherReading(before);
            await rtl.click();
            await dialog.getByRole('switch', { name: 'Enable RTL', exact: true, checked: before !== 'true' }).waitFor();
            assert.notDeepEqual(await launcherReading(String(before !== 'true')), previousStyle, 'the open shortcut reflects the saved reading state');
            await dialog.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
            const beforeRefresh = await dialog.boundingBox();
            await dialog.evaluate(el => {
                window.toastEntry = [];
                el.addEventListener('transitionrun', event => {
                    if (event.target.matches('[data-sonner-toast]') && event.propertyName === 'transform') {
                        window.toastEntry.push(new DOMMatrix(getComputedStyle(event.target).transform).m42);
                    }
                });
            });
            await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
            await toast.waitFor();
            await toast.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
            assert.equal(await toast.getAttribute('data-y-position'), 'top');
            const toastEntry = await page.evaluate(() => window.toastEntry);
            if (reducedMotion === 'reduce') assert.deepEqual(toastEntry, []);
            else assert.ok(toastEntry.some(y => y < 0), 'Sonner slides in from above its resting position');
            const toastBounds = await toast.boundingBox();
            assert.notEqual(await toast.evaluate(el => getComputedStyle(el).boxShadow), 'none', 'the toast casts a shadow inside the panel');
            const panelBounds = await dialog.boundingBox();
            assert.deepEqual(panelBounds, beforeRefresh, 'the toast never resizes or moves the panel');
            assert.ok(Math.abs(toastBounds.x - panelBounds.x - 8) < 1);
            assert.ok(Math.abs(toastBounds.y - panelBounds.y - 8) < 1, 'the toast starts near the top edge');
            assert.ok(Math.abs(toastBounds.width - panelBounds.width + 16) < 1, 'the toast spans the panel with equal side insets');
            const panelClose = dialog.locator(':scope > [data-slot=dialog-close]');
            const panelCloseBounds = await panelClose.evaluate(el => el.getBoundingClientRect().toJSON());
            const toastClose = toast.getByRole('button', { name: 'Close toast' });
            const toastCloseBounds = await toastClose.boundingBox();
            const topGap = toastCloseBounds.y - toastBounds.y;
            const bottomGap = toastBounds.y + toastBounds.height - toastCloseBounds.y - toastCloseBounds.height;
            assert.ok(Math.abs(topGap - bottomGap) < 1, 'the toast close has equal vertical clearance');
            assert.ok(Math.abs(panelCloseBounds.x - toastCloseBounds.x) < 1);
            assert.ok(Math.abs(panelCloseBounds.y - toastCloseBounds.y) < 1);
            await close.waitFor({ state: 'hidden' });
            assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
            await page.screenshot({ path: path.resolve(`dist/shadcn-preview/t3-panel-update-${engine}-${reducedMotion}.png`) });
            await toastClose.press('Enter');
            await toast.waitFor({ state: 'hidden' });
            await close.waitFor();
            assert.equal(await dialog.evaluate(el => el.contains(el.getRootNode().activeElement)), true);
            assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'dismissing the toast keeps the panel open');
            await context.close();
        }
        console.log(`PASS: ${engine} compact panel, isolated themes, live preferences, closed-panel update dot, Refresh navigation, focus, short viewport and reduced motion.`);
    } finally { await browser.close(); }
}
