import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
const output = path.resolve("dist/shadcn-preview");
fs.mkdirSync(output, { recursive: true });
try {
    const page = await browser.newPage({
        viewport: { width: 940, height: 780 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page
        .getByRole("button", { name: "Open Codex settings", exact: true })
        .waitFor();
    const card = page.locator("#card-codex");
    const remove = page.getByRole("button", { name: "Remove Rasta from Codex" });
    assert.equal(await card.getByRole("switch").count(), 0);
    const tooltip = page.getByRole("tooltip", { name: "Remove Rasta from Codex" });
    await remove.hover();
    await tooltip.waitFor();
    await tooltip.evaluate((el) =>
        Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
    const cardBounds = await card.boundingBox();
    const tooltipBounds = await tooltip.boundingBox();
    const overlapTop = Math.max(cardBounds.y, tooltipBounds.y);
    const overlapBottom = Math.min(
        cardBounds.y + cardBounds.height,
        tooltipBounds.y + tooltipBounds.height,
    );
    assert.ok(overlapBottom > overlapTop, "the tooltip overlaps the card edge");
    await page.mouse.move(
        tooltipBounds.x + tooltipBounds.width / 2,
        (overlapTop + overlapBottom) / 2,
        { steps: 8 },
    );
    assert.ok(await tooltip.isVisible(), "the removal hint stays readable");
    assert.ok(
        await card.evaluate((el) => el.matches(":hover")),
        "the card keeps hover through the overlapping tooltip",
    );
    await page.keyboard.press("Escape");
    await tooltip.waitFor({ state: "hidden" });
    const allApps = page.getByRole("tab", { name: /^All apps/ });
    const connectedApps = page.getByRole("tab", { name: /^Rasta installed/ });
    await connectedApps.click();
    const libraryIndicator = page.locator('[data-slot="tabs-indicator"]');
    assert.ok(
        await libraryIndicator.evaluate((el) =>
            el
                .getAnimations()
                .some((animation) => animation.playState === "running"),
        ),
        "pointer selection moves the indicator",
    );
    assert.equal(await page.locator('[id^="card-"]').count(), 1);
    assert.equal(await page.locator("#card-codex").count(), 1);
    assert.ok(
        await connectedApps.evaluate((el) => {
            const style = getComputedStyle(el);
            return style.outlineStyle === "none" && style.boxShadow === "none";
        }),
        "pointer selection does not add a focus outline or ring",
    );
    await connectedApps.press("ArrowLeft");
    await page
        .getByRole("tab", { name: /^All apps/, selected: true })
        .waitFor();
    assert.equal(await allApps.getAttribute("aria-selected"), "true");
    assert.equal(
        await allApps.evaluate((el) => getComputedStyle(el).outlineStyle),
        "solid",
        "keyboard tab navigation shows focus",
    );
    assert.equal(
        await libraryIndicator.evaluate((el) => el.getAnimations().length),
        0,
        "keyboard navigation interrupts marker motion",
    );
    assert.equal(await page.locator('[id^="card-"]').count(), 8);
    await page.waitForTimeout(200);
    await page.screenshot({
        path: path.join(output, "library.png"),
        fullPage: true,
    });
    await page
        .getByRole("button", { name: "Open Codex settings", exact: true })
        .click();
    const dialog = page.getByRole("dialog", { name: "Codex", exact: true });
    await page
        .getByRole("button", { name: "Font", exact: true })
        .waitFor();
    await page.setViewportSize({ width: 663, height: 820 });
    const inset = await dialog.boundingBox();
    assert.ok(
        inset.x >= 15 && inset.x + inset.width <= 648,
        "dialog keeps its safety inset above the small breakpoint",
    );
    await page.setViewportSize({ width: 940, height: 780 });
    assert.equal(
        await page
            .locator("dialog, select:visible, input[type=file]:visible, details")
            .count(),
        0,
        "manager uses custom shadcn surfaces",
    );
    await page
        .getByRole("combobox", { name: "Size", exact: true })
        .click();
    await page.getByRole("option", { name: "18 px", exact: true }).click();
    await page.waitForFunction(
        () =>
            getComputedStyle(document.getElementById("reading-sample"))
                .fontSize === "18px",
    );
    await page
        .getByRole("combobox", { name: "Size", exact: true })
        .focus();
    await page.waitForTimeout(1100);
    assert.equal(
        await page
            .getByRole("combobox", { name: "Size", exact: true })
            .evaluate((el) => document.activeElement === el),
        true,
        "status polling preserves focus",
    );
    await page
        .getByRole("combobox", { name: "Spacing", exact: true })
        .click();
    await page.keyboard.press("Escape");
    assert.equal(
        await dialog.count(),
        1,
        "Escape dismisses Select before Dialog",
    );
    const readingViewport = dialog.locator(
        '[data-slot="scroll-area-viewport"]',
    );
    assert.equal(
        await readingViewport.evaluate(
            (el) => el.scrollHeight <= el.clientHeight + 1,
        ),
        true,
        "default reading preferences fit without scrolling",
    );
    const bytes = fs.readFileSync("bin/assets/Vazir-Bold.ttf");
    const readingFont = page.getByRole("button", { name: "Font", exact: true });
    const fontMenu = page.getByRole("menu", { name: "Font" });
    const chooseFonts = async () => {
        await readingFont.click();
        const [chooser] = await Promise.all([
            page.waitForEvent("filechooser"),
            fontMenu.getByRole("menuitem", { name: "Add font", exact: true }).click(),
        ]);
        assert.equal(chooser.isMultiple(), true);
        assert.equal(await page.getByRole("dialog", { name: "Add reading fonts" }).count(), 0);
        return chooser;
    };
    const bundledFonts = ["bin/assets/Vazir-Bold.ttf", "bin/assets/Vazir-Regular.ttf"];
    await (await chooseFonts()).setFiles(bundledFonts);
    await page.waitForFunction(() =>
        getComputedStyle(
            document.getElementById("reading-sample"),
        ).fontFamily.includes("Custom_"),
    );
    await page
        .locator('[data-sonner-toast][data-type="success"]')
        .filter({ hasText: "2 fonts added." })
        .locator("[data-icon] [data-slot=toast-success-icon]")
        .waitFor();
    await readingFont.click();
    await fontMenu.getByRole("menuitem", { name: "Remove Vazir Bold", exact: true }).click();
    const fontRemoval = page.getByRole("alertdialog", { name: "Remove font?" });
    await page.evaluate(() => {
        const request = window.rastaPreview;
        window.rastaPreview = async (input) => {
            if (input.action === "font-remove") {
                window.rastaPreview = request;
                throw Error("The font could not be removed. Try again.");
            }
            return request(input);
        };
    });
    await fontRemoval.getByRole("button", { name: "Remove font", exact: true }).click();
    await fontRemoval.getByRole("alert").getByText("The font could not be removed. Try again.").waitFor();
    await fontRemoval.getByText("Vazir Bold", { exact: true }).waitFor();
    await fontRemoval.getByRole("button", { name: "Remove font", exact: true }).click();
    await fontRemoval.waitFor({ state: "hidden" });
    await readingFont.getByText("Vazir Regular").waitFor();
    await readingFont.click();
    assert.equal(await fontMenu.getByRole("menuitem", { name: "Remove Vazir Bold", exact: true }).count(), 0);
    assert.equal(await fontMenu.getByRole("menuitem", { name: "Remove Vazir", exact: true }).count(), 1);
    await fontMenu.getByRole("menuitem", { name: "Remove Vazir Regular", exact: true }).click();
    await fontRemoval.getByText("Vazir will become the reading font.", { exact: false }).waitFor();
    await fontRemoval.getByRole("button", { name: "Remove font", exact: true }).click();
    await fontRemoval.waitFor({ state: "hidden" });
    await readingFont.getByText("Vazir", { exact: true }).waitFor();
    await (await chooseFonts()).setFiles(bundledFonts);
    await readingFont.getByText("Vazir Regular", { exact: true }).waitFor();
    await (await chooseFonts()).setFiles([
        { name: "Accepted Font.ttf", mimeType: "font/ttf", buffer: bytes },
        { name: "Invalid Font.ttf", mimeType: "font/ttf", buffer: Buffer.from("not a font") },
    ]);
    await page
        .locator('[data-sonner-toast][data-type="warning"]')
        .filter({ hasText: "1 font could not be added." })
        .locator("[data-icon] [data-slot=toast-warning-icon]")
        .waitFor();
    await dialog.getByText(/Invalid Font.ttf/).waitFor();
    const fontChoice = page.getByRole("button", {
        name: "Font",
        exact: true,
    });
    await fontChoice.click();
    await page.getByRole("menuitemradio", { name: "Vazir Regular", exact: true }).waitFor();
    const priorFace = await page.locator("#reading-sample").evaluate((el) => getComputedStyle(el).fontFamily);
    await page.getByRole("menuitemradio", { name: "Vazir Regular", exact: true }).click();
    await fontChoice.getByText("Vazir Regular", { exact: true }).waitFor();
    await page.waitForFunction((prior) => {
        const font = getComputedStyle(document.getElementById("reading-sample")).fontFamily;
        return font.includes("Custom_") && font !== prior;
    }, priorFace);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForFunction(
        () => document.activeElement?.id === "tab-codex",
    );
    await page
        .getByRole("switch", { name: "Rasta for T3 Code", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Simulate Launch", exact: true })
        .waitFor();
    assert.equal(await page.getByRole("progressbar").count(), 0);
    assert.match(
        await page.locator("[aria-current=step]").textContent(),
        /Prepare/,
    );
    assert.equal(
        await page
            .getByRole("tab", { name: "Reading", exact: true })
            .isDisabled(),
        true,
    );
    await page
        .getByRole("dialog", { name: "T3 Code", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Open T3 Code settings", exact: true })
        .click();
    await page.getByRole("tab", { name: "Installation", exact: true }).click();
    await page
        .getByRole("button", { name: "Simulate Launch", exact: true })
        .click();
    await page.getByRole("heading", { name: "Rasta is installed in T3 Code", exact: true }).waitFor();
    assert.equal(await page.getByRole("progressbar").count(), 0);
    const t3Card = page.locator("#card-t3");
    const t3Switch = t3Card.getByRole("switch", { includeHidden: true });
    await t3Switch.waitFor({ state: "detached" });
    await page.getByRole("tab", { name: "Reading", exact: true }).click();
    await page.getByRole("button", { name: "Font", exact: true }).getByText("Vazir", { exact: true }).waitFor();
    await page.getByRole("combobox", { name: "Size", exact: true }).getByText("16 px", { exact: true }).waitFor();
    await page.getByRole("combobox", { name: "Spacing", exact: true }).getByText("Comfortable", { exact: true }).waitFor();
    await page.getByRole("switch", { name: "Right-to-left reading", exact: true, checked: true }).waitFor();
    await page.getByRole("switch", { name: "Enable force RTL", exact: true, checked: false }).waitFor();
    await page
        .getByRole("combobox", { name: "Size", exact: true })
        .click();
    await page.getByRole("option", { name: "14 px", exact: true }).click();
    await page.waitForFunction(
        () =>
            getComputedStyle(document.getElementById("reading-sample"))
                .fontSize === "14px",
    );
    await page
        .getByRole("dialog", { name: "T3 Code", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Open Codex settings", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Font", exact: true })
        .waitFor();
    assert.equal(
        await page
            .locator("#reading-sample")
            .evaluate((el) => getComputedStyle(el).fontSize),
        "18px",
        "preferences are target-specific",
    );
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, "reading-light.png") });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(200);
    assert.ok(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    );
    const box = await dialog.boundingBox();
    assert.ok(
        box.x >= 0 &&
            box.x + box.width <= 375 &&
            box.y >= 0 &&
            box.y + box.height <= 812,
        "popup fits narrow viewport",
    );
    await page.screenshot({ path: path.join(output, "reading-narrow.png") });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 1040, height: 900 });
    const removeT3 = t3Card.getByRole("button", { name: "Remove Rasta from T3 Code", exact: true });
    await removeT3.click();
    const confirmation = page.getByRole("alertdialog", { name: "Remove Rasta from T3 Code?" });
    await confirmation.getByText("This simulation restores T3 Code in the demo and leaves it closed.", { exact: true }).waitFor();
    await page
        .getByRole("button", { name: "Keep Rasta installed", exact: true })
        .click();
    await removeT3.waitFor();
    assert.equal(await t3Switch.count(), 0);
    await removeT3.click();
    await page
        .getByRole("button", { name: "Remove Rasta", exact: true })
        .click();
    await t3Card.getByText("Removing Rasta", { exact: true }).waitFor();
    await t3Switch.waitFor();
    assert.equal(await t3Switch.getAttribute("aria-checked"), "false");
    assert.ok(await remove.isVisible(), "Codex remains installed");
    assert.equal(await card.getByRole("switch").count(), 0);
    const removalToast = page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Rasta removed from T3 Code." });
    await removalToast.waitFor();
    await removalToast.locator("[data-icon] [data-slot=toast-success-icon]").waitFor();
    assert.equal(await removalToast.getAttribute("data-y-position"), "top");
    assert.equal(await removalToast.getAttribute("data-x-position"), "center");
    const settings = page.getByRole("dialog", {
        name: "Rasta settings",
        exact: true,
    });
    await page.evaluate(() => window.rastaPreviewControl.setFailure(true));
    await page
        .getByRole("switch", { name: "Rasta for Antigravity", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Retry download", exact: true })
        .waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, "connection-error.png") });
    await page
        .getByRole("dialog", { name: "Antigravity", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();
    await page.evaluate(() => window.rastaPreviewControl.setFailure(false));
    await page
        .getByRole("button", { name: "Open Antigravity settings", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Retry download", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Simulate Launch", exact: true })
        .waitFor();
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, "connection-dark.png") });
    assert.ok(
        await page
            .getByRole("dialog", { name: "Antigravity", exact: true })
            .evaluate((el) => el.getAnimations().length === 0),
    );
    assert.equal(await page.getByRole("button", { name: "Versions, repair & details" }).count(), 0);
    await page
        .getByRole("button", { name: "Cancel installation", exact: true })
        .click();
    await page
        .getByRole("heading", { name: "Installation preparation cancelled", exact: true })
        .waitFor();
    await page
        .getByRole("dialog", { name: "Antigravity", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Rasta settings", exact: true })
        .click();
    assert.equal(
        await page
            .getByRole("switch", { name: "Private Beta feed", exact: true })
            .count(),
        0,
        "public settings hide private Beta",
    );
    assert.equal(await settings.getByRole("heading", { name: "Update channel" }).count(), 0);
    const appearance = settings.getByRole("group", { name: "Appearance" });
    const systemAppearance = appearance.getByRole("button", { name: "System", pressed: true });
    await systemAppearance.click();
    await systemAppearance.press("Enter");
    assert.equal(await page.evaluate(() => localStorage.getItem("rasta.appearance")), null);
    const updateCard = settings.getByRole("region", { name: "Rasta app updates" });
    const updateButton = updateCard.getByRole("button");
    const removalButton = settings.getByRole("button", { name: "Review removal", exact: true });
    const updateBounds = await updateButton.boundingBox();
    const removalBounds = await removalButton.boundingBox();
    assert.equal(updateBounds.height, removalBounds.height);
    assert.equal(updateBounds.y, removalBounds.y);
    const idleIcon = await updateButton.locator("svg").innerHTML();
    await updateButton.click();
    await page
        .locator('[data-sonner-toast][data-type="success"]')
        .filter({ hasText: "Rasta is up to date." })
        .locator("[data-icon] [data-slot=toast-success-icon]")
        .waitFor();
    await updateCard.getByRole("button", { name: "Check for update", exact: true }).waitFor();
    assert.equal(await updateButton.locator("svg").innerHTML(), idleIcon);
    await page.evaluate(() => {
        window.rastaPreviewControl.setCoreOffer(true);
        window.rastaPreviewControl.setFailure(true);
    });
    const coreOffer = page.getByRole("alertdialog", { name: "Download Rasta 1.1.38?" });
    const coreProgress = updateCard.locator('[data-slot="circular-progress"]');
    await updateButton.press("Enter");
    await coreOffer.getByRole("button", { name: "Simulate download" }).click();
    await coreProgress.waitFor();
    const retryUpdate = updateCard.getByRole("button", { name: "Update failed · Retry" });
    await retryUpdate.waitFor();
    assert.equal(await coreProgress.count(), 0);
    await page.evaluate(() => window.rastaPreviewControl.setFailure(false));
    await retryUpdate.press("Enter");
    await coreOffer.getByRole("button", { name: "Simulate download" }).click();
    await page.waitForFunction(() => {
        const ring = document.querySelector('[data-slot="circular-progress"]');
        const value = Number(ring?.getAttribute("aria-valuenow"));
        return value > 0 && value < 100 && getComputedStyle(ring).maskImage !== "none";
    });
    await page.screenshot({ path: path.join(output, "settings-update-download.png") });
    const restart = settings.getByRole("button", { name: "Simulate restart and update" });
    await restart.waitFor();
    assert.equal(await coreProgress.count(), 0);
    await page.waitForFunction(() => document.activeElement?.textContent === "Simulate restart and update");
    await restart.press("Enter");
    const checkForUpdate = updateCard.getByRole("button", { name: "Check for update", exact: true });
    await checkForUpdate.waitFor();
    assert.equal(await page.getByLabel("Rasta version").textContent(), "1.1.38");
    await appearance
        .getByRole("button", { name: "Light", exact: true })
        .click();
    assert.equal(
        await page
            .locator("html")
            .evaluate((el) => el.classList.contains("dark")),
        false,
    );
    await page.reload();
    await page
        .getByRole("button", { name: "Rasta settings", exact: true })
        .click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Rasta version"]')?.textContent === "1.1.38");
    await checkForUpdate.waitFor();
    assert.equal(await checkForUpdate.locator("svg").innerHTML(), idleIcon);
    assert.equal(
        await appearance
            .getByRole("button", { name: "Light", exact: true })
            .getAttribute("aria-pressed"),
        "true",
    );
    await appearance
        .getByRole("button", { name: "System", exact: true })
        .click();
    assert.equal(
        await page
            .locator("html")
            .evaluate((el) => el.classList.contains("dark")),
        true,
    );
    assert.deepEqual(errors, []);
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("tab", { name: /^Rasta installed/ }).click();
    await page
        .getByRole("button", { name: "Remove Rasta from Codex", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Remove Rasta", exact: true })
        .click();
    await page
        .getByRole("heading", { name: "Rasta isn’t installed in any apps yet", exact: true })
        .waitFor();
    assert.equal(await page.locator('[id^="card-"]').count(), 0);
    await page.waitForFunction(
        () => document.activeElement?.getAttribute("role") === "tab",
    );
    await page
        .getByRole("button", { name: "Browse apps", exact: true })
        .click();
    assert.equal(await page.locator('[id^="card-"]').count(), 8);
    await page.evaluate(() => {
        window.rastaPreviewControl.setScenario("host-recovery");
        window.dispatchEvent(new Event("focus"));
    });
    await page.getByRole("button", { name: "Open T3 Code settings", exact: true }).click();
    const recovery = page.getByRole("dialog", { name: "T3 Code", exact: true });
    const launchRecovery = recovery.getByRole("button", { name: "Simulate Launch", exact: true });
    await launchRecovery.waitFor();
    assert.equal(await page.getByRole("switch", { name: "Rasta for T3 Code", exact: true, includeHidden: true }).getAttribute("aria-checked"), "false");
    await launchRecovery.click();
    await recovery.getByRole("heading", { name: "Rasta is installed in T3 Code", exact: true }).waitFor();
    await recovery.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Rasta settings", exact: true }).click();
    await settings.getByRole("button", { name: "Review removal", exact: true }).click();
    const removal = page.getByRole("alertdialog");
    await removal.getByRole("list", { name: "Removal by app" }).getByText("T3 Code", { exact: true }).waitFor();
    assert.equal(await removal.getByRole("list", { name: "Removal by app" }).locator("img").evaluate(el => getComputedStyle(el).width), "32px");
    await removal.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: path.join(output, "removal-confirmation.png") });
    await removal.getByRole("button", { name: "Simulate removing all connections", exact: true }).click();
    await removal.getByRole("heading", { name: "Removing Rasta from apps", exact: true }).waitFor();
    await removal.getByRole("heading", { name: "Connections removed", exact: true }).waitFor();
    await removal.getByRole("list", { name: "Removal by app" }).getByText("T3 Code", { exact: true }).waitFor();
    await removal.getByText("Removed", { exact: true }).waitFor();
    assert.equal(await removal.getByRole("progressbar").count(), 0);
    assert.equal(await removal.getByRole("button", { name: "Simulate removing all connections" }).count(), 0);
    await page.screenshot({ path: path.join(output, "removal-complete.png") });
    await removal.getByRole("button", { name: "Close", exact: true }).click();
    await settings.getByRole("heading", { name: "Remove Rasta", exact: true }).waitFor({ state: "hidden" });

    const localTestURL = new URL(base);
    localTestURL.searchParams.set("preview", "local-test");
    await page.goto(localTestURL.href);
    const openClaudeInstallation = async () => {
        await page.getByRole("button", { name: "Open Claude settings", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Claude", exact: true });
        await dialog.getByRole("tab", { name: "Installation", exact: true }).click();
        return dialog;
    };
    const claude = await openClaudeInstallation();
    const prepareTest = claude.getByRole("button", { name: "Prepare test build", exact: true });
    await prepareTest.click();
    await claude.getByRole("button", { name: "Simulate Launch", exact: true }).click();
    const installedClaude = claude.getByRole("heading", { name: "Rasta is installed in Claude", exact: true });
    await installedClaude.waitFor();
    assert.equal(await prepareTest.count(), 0);
    await page.reload();
    await openClaudeInstallation();
    await installedClaude.waitFor();
    assert.equal(await prepareTest.count(), 0);
    console.log(
        "PASS: actual shadcn popup, custom Select, multi-font file chooser and Sonner feedback, focus, target isolation, explicit Launch, cancellation/removal, error/retry, responsive dialog, dark mode, reduced motion and local test build completion.",
    );
} finally {
    await browser.close();
}
