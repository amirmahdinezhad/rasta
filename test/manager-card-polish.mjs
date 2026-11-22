import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
if (!process.env.ARTL_PLAYWRIGHT_MODULE)
    throw Error(
        "Provide ARTL_PLAYWRIGHT_MODULE and start npm run preview:manager.",
    );
const { chromium } = await import(
    pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href
);
const browser = await chromium.launch({ headless: true });
const base = process.env.RASTA_MANAGER_URL || "http://127.0.0.1:5173/";
fs.mkdirSync("dist/shadcn-preview", { recursive: true });
try {
    for (const colorScheme of ["light", "dark"]) {
        const page = await browser.newPage({
            colorScheme,
            viewport: { width: 1040, height: 900 },
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(base);
        const card = page.locator("#card-codex");
        await page.waitForFunction(() =>
            document
                .querySelector('[aria-label="Rasta version"]')
                ?.textContent.includes("1.1.37"),
        );
        assert.equal(
            await card.locator("button[aria-haspopup=dialog]").count(),
            1,
            "one primary navigation target per card",
        );
        assert.equal(
            await page.getByText("MADE FOR YOUR MAC", { exact: true }).count(),
            0,
        );
        assert.equal(
            await page.getByText("Local & private", { exact: true }).count(),
            0,
        );
        assert.equal(
            await page
                .getByText(
                    "Clearer conversations, in a font that feels familiar.",
                    { exact: true },
                )
                .count(),
            0,
        );
        const before = await card.evaluate((el) => ({
            border: getComputedStyle(el).borderColor,
            shadow: getComputedStyle(el).boxShadow,
            footer: getComputedStyle(
                el.querySelector("[data-slot=card-footer]"),
            ).backgroundColor,
            logo: getComputedStyle(el.querySelector("img").parentElement)
                .backgroundColor,
        }));
        const bounds = await card.boundingBox();
        await page.mouse.move(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height - 15,
        );
        await page.waitForTimeout(200);
        const after = await card.evaluate((el) => ({
            border: getComputedStyle(el).borderColor,
            shadow: getComputedStyle(el).boxShadow,
            footer: getComputedStyle(
                el.querySelector("[data-slot=card-footer]"),
            ).backgroundColor,
            logo: getComputedStyle(el.querySelector("img").parentElement)
                .backgroundColor,
        }));
        assert.notEqual(after.border, before.border);
        assert.notEqual(after.shadow, before.shadow);
        assert.notEqual(after.footer, before.footer);
        assert.equal(
            after.logo,
            before.logo,
            "provider identity has no independent hover",
        );
        await page.screenshot({
            path: `dist/shadcn-preview/cards-${colorScheme}-hover.png`,
            fullPage: true,
        });
        await page.mouse.click(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height - 15,
        );
        const dialog = page.getByRole("dialog", { name: "Codex", exact: true });
        await dialog.waitFor();
        assert.equal(
            await dialog
                .getByText("Simulated · Your apps are untouched", {
                    exact: true,
                })
                .count(),
            0,
        );
        assert.equal(
            await dialog
                .getByText("Your reading space. Your connection.", {
                    exact: true,
                })
                .count(),
            0,
        );
        assert.equal(
            await dialog.getByText("Rasta 1.1.36", { exact: true }).count(),
            0,
        );
        const reading = page.getByRole("tab", { name: "Reading", exact: true });
        await reading.focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() =>
            document
                .querySelector("[role=tab][data-state=active]")
                ?.textContent.includes("Connection"),
        );
        assert.ok(
            await page
                .getByRole("tabpanel", { name: /Connection/ })
                .isVisible(),
        );
        await page.keyboard.press("ArrowLeft");
        await page
            .getByRole("button", { name: "Font", exact: true })
            .waitFor();
        await page.waitForTimeout(250);
        await page.screenshot({
            path: `dist/shadcn-preview/tabs-${colorScheme}.png`,
        });
        for (const width of [375, 640]) {
            await page.setViewportSize({
                width,
                height: width === 640 ? 375 : 812,
            });
            await page.waitForTimeout(100);
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                ),
            );
            const d = await dialog.boundingBox();
            assert.ok(
                d.x >= 0 &&
                    d.x + d.width <= width &&
                    d.y >= 0 &&
                    d.y + d.height <= (width === 640 ? 375 : 812),
            );
        }
        const scroll = dialog.locator("[data-slot=scroll-area-viewport]");
        await scroll.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });
        assert.ok(
            await dialog
                .getByRole("switch", {
                    name: "Type @ with Shift+2",
                    exact: true,
                })
                .evaluate(
                    (el) =>
                        el.getBoundingClientRect().bottom <=
                        el.closest("[role=dialog]").getBoundingClientRect()
                            .bottom +
                            1,
                ),
            "last action is reachable in a short popup",
        );
        await dialog
            .getByRole("button", { name: "Close", exact: true })
            .click();
        await dialog.waitFor({ state: "hidden" });
        assert.ok(
            await page.locator('[aria-label="Rasta version"]').isVisible(),
        );
        const gear = await page
            .getByRole("button", { name: "Rasta settings", exact: true })
            .locator("svg")
            .boundingBox();
        assert.ok(
            gear.width >= 20,
            "settings icon has meaningful visual weight",
        );
        await page.setViewportSize({ width: 375, height: 812 });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        );
        await page
            .getByRole("button", { name: "Rasta settings", exact: true })
            .click();
        await page
            .getByRole("dialog", { name: "Rasta settings", exact: true })
            .waitFor();
        assert.equal(
            await page
                .getByRole("dialog", { name: "Rasta settings", exact: true })
                .getByText(/Rasta 1\.1\.37/)
                .count(),
            0,
        );
        assert.deepEqual(errors, []);
        await page.close();
    }
    console.log(
        "PASS: unified card/footer hover, one navigation target, static provider identity, removed copy, main-page version, keyboard tabs, settings hierarchy and narrow/short dialogs in both themes.",
    );
} finally {
    await browser.close();
}
