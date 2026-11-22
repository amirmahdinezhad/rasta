// Serialized into the disposable Electron host fixtures.
export async function checkReadingDependency({ evaluate, setEnabled, textSelector, inputSelector, assert, pause }) {
    const direction = () => evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(textSelector)})).direction`);
    for (const enabled of [true, false, true]) {
        await setEnabled(enabled);
        const applied = () => evaluate(`(() => {
            const saved = JSON.parse(localStorage.getItem('rasta-config'));
            return saved?.isRTL === ${enabled} && saved.forceRTL && saved.fixAtSign;
        })()`);
        for (let attempt = 0; attempt < 100 && !await applied(); attempt++) await pause(25);
        assert.equal(await applied(), true, 'the host received the master switch and both saved choices');
        const expected = enabled ? 'rtl' : 'ltr';
        for (let attempt = 0; attempt < 100 && await direction() !== expected; attempt++) await pause(25);
        assert.equal(await direction(), expected, 'Force RTL follows Enable RTL');
        const shortcut = await evaluate(`(() => {
            const input = document.querySelector(${JSON.stringify(inputSelector)});
            input.focus();
            const field = input instanceof HTMLTextAreaElement;
            const read = () => field ? input.value : input.textContent;
            const before = read();
            const key = new KeyboardEvent('keydown', {
                code: 'Digit2', key: String.fromCodePoint(0x66c), shiftKey: true, bubbles: true, cancelable: true,
            });
            input.dispatchEvent(key);
            const after = read();
            if (field) input.value = before;
            else input.textContent = before;
            return { intercepted: key.defaultPrevented, insertedAtSign: after.includes('@') && after !== before };
        })()`);
        assert.deepEqual(shortcut, { intercepted: enabled, insertedAtSign: enabled }, 'Shift+2 follows Enable RTL');
    }
}
