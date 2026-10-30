const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const quay = { id: 'NSR:StopPlace:58180', name: 'Mannheller ferjekai', lat: 61.160443, lon: 7.336834, distance: 0 };
const startTime = Date.parse('2026-10-30T11:19:00+01:00');
function setup({ small = false, fetch = async () => { throw new Error('offline'); } } = {}) {
  let now = startTime;
  const elements = new Map();
  function element() {
    return { textContent: '', className: '', children: [], dataset: {},
      set innerHTML(value) { this.html = value; this.children = []; }, get innerHTML() { return this.html || ''; },
      appendChild(child) { this.children.push(child); }, setAttribute() {}, querySelectorAll() { return []; } };
  }
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({ Date: Clock, fetch,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element },
    localStorage: { getItem() { return null; }, setItem() {} },
    window: { matchMedia() { return { matches: small }; }, addEventListener() {} },
    setTimeout() {}, clearTimeout() {}, setInterval() {} });
  const source = fs.readFileSync(process.env.FERJE_HTML || 'ferje.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/  start\(\);\s*\}\)\(\);/, '  globalThis.app = {state, render, onPosition, refresh, selectQuay, driveTime};\n})();');
  vm.runInContext(source, context);
  Object.assign(context.app.state, { pos: { lat: quay.lat, lon: quay.lon }, quay: { ...quay }, driveSec: 0, driveSource: 'OSRM' });
  return { ...context.app, el: id => elements.get(id), advance(ms) { now += ms; } };
}
function call(minutes, extra = {}) {
  const t = new Date(startTime + minutes * 60000);
  return { t, aimed: t, realtime: true, cancelled: false, submode: 'localCarFerry', to: 'Fodnes ferjekai', line: '1047', lineName: 'Mannheller–Fodnes', ...extra };
}

test('at Mannheller, the imminent ferry is shown despite the saved four-minute buffer and stale driving time', () => {
  const a = setup(); a.state.driveSec = 1200; a.state.calls = [call(1), call(21)]; a.render();
  assert.match(a.el('verdict').innerHTML, /11:20/);
  assert.match(a.el('verdict').innerHTML, /venter 1 min/);
  assert.equal(a.el('etaNum').textContent, 0);
  assert.equal(a.state.bufferMin, 4);
});

test('on the road the buffer still applies, without rounding a missed ferry into reach', () => {
  const a = setup(); a.state.pos = { lat: quay.lat + 0.02, lon: quay.lon }; a.state.driveSec = 60;
  a.state.calls = [call(4.9), call(21)]; a.render();
  assert.match(a.el('verdict').innerHTML, /11:40/);
  assert.match(a.el('deps').children[0].className, /miss/);
});

test('clock ticks remove passed ferries and keep cancelled ferries out of the verdict', () => {
  const a = setup(); a.state.calls = [call(1), call(21, { cancelled: true }), call(41)]; a.render();
  a.advance(61000); a.render();
  assert.match(a.el('verdict').innerHTML, /12:00/);
  assert.equal(a.el('deps').children.length, 2);
});

test('the verdict finds reachable ferries beyond the first six rows on mobile', () => {
  const a = setup({ small: true }); a.state.pos = { lat: quay.lat + 0.02, lon: quay.lon }; a.state.driveSec = 62 * 60;
  a.state.calls = [1, 11, 21, 31, 41, 51, 71].map(m => call(m)); a.render();
  assert.match(a.el('verdict').innerHTML, /12:30/);
  assert.equal(a.el('deps').children.length, 7); // Six rows and the expand button.
});

test('being at the quay bypasses OSRM', async () => {
  const a = setup({ fetch: async () => assert.fail('must not request a route at the quay') });
  const dt = await a.driveTime(a.state.pos, quay); assert.equal(dt.sec, 0);
});

test('arriving at the quay immediately replaces the old drive estimate', async () => {
  const a = setup(); a.state.pos = { lat: quay.lat + 0.02, lon: quay.lon }; a.state.driveSec = 1200;
  a.state.calls = [call(1), call(21)]; await a.onPosition(quay.lat, quay.lon);
  assert.match(a.el('verdict').innerHTML, /11:20/);
  assert.equal(a.el('etaNum').textContent, 0);
  a.render(); assert.match(a.el('msg').textContent, /offline/); // Clock ticks must not hide errors.
});

test('an old response cannot overwrite a newly selected quay', async () => {
  let resolveOld;
  const response = minutes => ({ ok: true, json: async () => ({ data: { stopPlace: { estimatedCalls: [{
    aimedDepartureTime: call(minutes).t.toISOString(), expectedDepartureTime: call(minutes).t.toISOString(),
    realtime: true, cancellation: false, destinationDisplay: { frontText: 'Fodnes' }, serviceJourney: { transportSubmode: 'localCarFerry', line: {} }
  }] } } }) });
  let n = 0;
  const a = setup({ fetch: async () => ++n === 1 ? new Promise(resolve => { resolveOld = resolve; }) : response(21) });
  const old = a.refresh();
  await a.selectQuay({ ...quay, id: 'another-quay' });
  resolveOld(response(1)); await old;
  assert.equal(a.state.quay.id, 'another-quay');
  assert.equal(a.state.calls[0].t.getTime(), call(21).t.getTime());
});
