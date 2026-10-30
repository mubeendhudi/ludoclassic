/* ===== Config ===== */
const NAMES = ['Blue', 'Yellow', 'Green', 'Red'];
const HEX = ['#2563eb', '#eab308', '#16a34a', '#dc2626'];
const S = [0, 13, 26, 39];                                   // start index of each colour on the 52-cell track
const YO = [[0, 0], [9, 0], [9, 9], [0, 9]];                     // yard origins
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);           // start squares + stars

/* 52-cell main track (clockwise, starting at Blue's start cell) */
const P = [], add = (x, y) => P.push([x, y]);
for (let x = 1; x <= 5; x++)add(x, 6); for (let y = 5; y >= 0; y--)add(6, y); add(7, 0); add(8, 0);
for (let y = 1; y <= 5; y++)add(8, y); for (let x = 9; x <= 14; x++)add(x, 6); add(14, 7); add(14, 8);
for (let x = 13; x >= 9; x--)add(x, 8); for (let y = 9; y <= 14; y++)add(8, y); add(7, 14); add(6, 14);
for (let y = 13; y >= 9; y--)add(6, y); for (let x = 5; x >= 0; x--)add(x, 8); add(0, 7); add(0, 6);
/* home columns (5 cells each) */
const HC = [
    [1, 2, 3, 4, 5].map(x => [x, 7]),
    [1, 2, 3, 4, 5].map(y => [7, y]),
    [13, 12, 11, 10, 9].map(x => [x, 7]),
    [13, 12, 11, 10, 9].map(y => [7, y])
];

/* ===== State ===== */
const $ = s => document.querySelector(s);
let mode = ['human', 'cpu', 'cpu', 'cpu'];   // 'off' | 'human' | 'cpu'
let pcs = [0, 1, 2, 3].map(() => [-1, -1, -1, -1]); // -1 yard, 0..50 track, 51..55 home column, 56 finished
let cur = 0, v = 0, sixes = 0, phase = 'idle', gid = 0, snd = true, ac;
const tk = [[], [], [], []];

const setPhase = p => { phase = p; ui() };
const sleep = ms => new Promise((r, j) => { const g = gid; setTimeout(() => g === gid ? r() : j('x'), ms) });
const say = t => $('#msg').textContent = t;
const absOf = (c, p) => (S[c] + p) % 52;
const guard = f => (...a) => f(...a).catch(e => { if (e !== 'x') console.error(e) });

function beep(f, d = .08, t = 'sine') {
    if (!snd) return;
    try {
        ac = ac || new AudioContext();
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = t; o.frequency.value = f; g.gain.value = .05;
        o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
    } catch (e) { }
}

/* ===== Build board ===== */
(function build() {
    const g = $('#grid'), map = {};
    P.forEach(([x, y]) => map[x + ',' + y] = {});
    HC.forEach((h, c) => h.forEach(([x, y]) => map[x + ',' + y] = { c }));
    S.forEach((s, c) => map[P[s][0] + ',' + P[s][1]] = { c, s: 1 });
    [8, 21, 34, 47].forEach(i => map[P[i][0] + ',' + P[i][1]].star = 1);

    YO.forEach((o, c) => {
        const d = document.createElement('div');
        d.className = 'yard c' + c;
        d.style.gridArea = `${o[1] + 1}/${o[0] + 1}/${o[1] + 7}/${o[0] + 7}`;
        d.innerHTML = '<i></i>' + [0, 1, 2, 3].map(i => `<b style="left:${[33.3, 66.7][i % 2]}%;top:${[33.3, 66.7][i >> 1]}%"></b>`).join('');
        g.appendChild(d);
    });

    for (const k in map) {
        const [x, y] = k.split(',').map(Number), m = map[k], d = document.createElement('div');
        d.className = 'cell' + (m.c !== undefined ? ' c' + m.c : '');
        d.style.gridArea = `${y + 1}/${x + 1}`;
        if (m.star || m.s) d.textContent = '★';
        g.appendChild(d);
    }

    const ct = document.createElement('div'); ct.id = 'ctr';
    const tri = ['polygon(0 0,0 100%,50% 50%)', 'polygon(0 0,100% 0,50% 50%)', 'polygon(100% 0,100% 100%,50% 50%)', 'polygon(0 100%,100% 100%,50% 50%)'];
    [0, 1, 2, 3].forEach(c => {
        const d = document.createElement('div');
        d.style.cssText = `background:${HEX[c]};clip-path:${tri[c]}`;
        ct.appendChild(d);
    });
    g.appendChild(ct);

    /* tokens */
    const T = $('#tokens');
    for (let c = 0; c < 4; c++)for (let i = 0; i < 4; i++) {
        const e = document.createElement('div');
        e.className = 'tk'; e.style.setProperty('--tc', HEX[c]);
        e.onclick = () => { if (phase === 'move' && c === cur && e.classList.contains('can')) doMove(i) };
        T.appendChild(e); tk[c][i] = e;
    }

    /* one dice per player */
    for (let c = 0; c < 4; c++) {
        const d = $('#d' + c);
        d.innerHTML = '<u></u>'.repeat(9);
        d.onclick = () => { if (c === cur && mode[c] === 'human' && phase === 'roll') roll() };
        face(c, c + 3);
    }
})();

const FACES = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
function face(c, n) { [...$('#d' + c).children].forEach((u, i) => u.className = FACES[n - 1].includes(i) ? 'd' : '') }

/* ===== Rendering ===== */
function xy(c, i) {
    const p = pcs[c][i];
    if (p < 0) { const o = YO[c]; return [o[0] + [2, 4][i % 2], o[1] + [2, 4][i >> 1]] }
    if (p <= 50) { const q = P[absOf(c, p)]; return [q[0] + .5, q[1] + .5] }
    if (p < 56) { const q = HC[c][p - 51]; return [q[0] + .5, q[1] + .5] }
    const d = [[-.75, 0], [0, -.75], [.75, 0], [0, .75]][c], s = (i - 1.5) * .22;
    return [7.5 + d[0] + (d[0] ? 0 : s), 7.5 + d[1] + (d[1] ? 0 : s)];
}

function render() {
    const g = {};
    for (let c = 0; c < 4; c++) {
        if (mode[c] === 'off') { tk[c].forEach(e => e.style.display = 'none'); continue }
        for (let i = 0; i < 4; i++) {
            tk[c][i].style.display = '';
            const [x, y] = xy(c, i);
            (g[x + ',' + y] = g[x + ',' + y] || []).push([c, i, x, y]);
        }
    }
    for (const k in g) {
        const a = g[k], n = a.length;
        a.forEach(([c, i, x, y], j) => {
            const e = tk[c][i];
            e.style.left = (x + (n > 1 ? (j - (n - 1) / 2) * .32 : 0)) / 15 * 100 + '%';
            e.style.top = (y + (n > 1 ? (j - (n - 1) / 2) * .1 : 0)) / 15 * 100 + '%';
            e.style.setProperty('--s', n > 1 ? .78 : 1);
        });
    }
}

/* Player boxes: only the current player's dice is active */
function ui() {
    for (let c = 0; c < 4; c++) {
        const box = $('#p' + c), dice = $('#d' + c);
        const act = mode[c] !== 'off';
        const on = act && c === cur && phase !== 'idle' && phase !== 'over';
        const ready = on && mode[c] === 'human' && phase === 'roll';
        box.classList.toggle('off', !act);
        box.classList.toggle('on', on);
        box.classList.toggle('ready', ready);
        dice.disabled = !ready;
        box.querySelector('.pmode').textContent = mode[c] === 'cpu' ? 'Computer' : 'Player';
        box.querySelector('.pstat').textContent = ready ? 'Tap dice to roll' : (on && mode[c] === 'cpu' ? 'Playing…' : '');
        const f = pcs[c].filter(p => p === 56).length;
        box.querySelector('.pips').innerHTML = [0, 1, 2, 3].map(i => `<u class="${i < f ? 'f' : ''}"></u>`).join('');
    }
}

/* ===== Rules ===== */
function movable(c, d) {
    const r = []; let yard = false;
    pcs[c].forEach((p, i) => {
        if (p < 0) { if (d === 6 && !yard) { r.push(i); yard = true } }   // identical yard tokens count once
        else if (p + d <= 56) r.push(i);
    });
    return r;
}
function danger(c, a) {
    for (let o = 0; o < 4; o++) {
        if (o === c || mode[o] === 'off') continue;
        for (const q of pcs[o]) if (q >= 0 && q <= 50) {
            const k = (a - absOf(o, q) + 52) % 52;
            if (k >= 1 && k <= 6) return true;
        }
    }
    return false;
}
function choose(mv) {
    let best = mv[0], bs = -1e9;
    for (const i of mv) {
        const p = pcs[cur][i], np = p < 0 ? 0 : p + v;
        let s = np * .6 + Math.random();
        if (np === 56) s += 100;
        if (p < 0) s += 55;
        if (np > 50 && np < 56) s += 45;
        if (np <= 50) {
            const a = absOf(cur, np);
            if (SAFE.has(a)) s += 28;
            else {
                for (let o = 0; o < 4; o++)if (o !== cur && mode[o] !== 'off')
                    for (const q of pcs[o]) if (q >= 0 && q <= 50 && absOf(o, q) === a) s += 85;
                if (danger(cur, a)) s -= 30;
            }
            if (p >= 0 && !SAFE.has(absOf(cur, p)) && danger(cur, absOf(cur, p))) s += 22;
        }
        if (s > bs) { bs = s; best = i }
    }
    return best;
}

/* ===== Game flow ===== */
function nextTurn(extra) {
    if (!extra) {
        sixes = 0;
        do cur = (cur + 1) % 4; while (mode[cur] === 'off');
    }
    setPhase('roll');
    const cpu = mode[cur] === 'cpu', g = gid;
    say(extra ? `${NAMES[cur]} rolls again!` : `${NAMES[cur]}’s turn` + (cpu ? '' : ' — tap your dice'));
    if (cpu) setTimeout(() => { if (g === gid) roll() }, 850);
}

const roll = guard(async function () {
    if (phase !== 'roll') return;
    setPhase('rolling');
    const c = cur, d = $('#d' + c);
    d.classList.add('roll');
    const iv = setInterval(() => { face(c, 1 + Math.random() * 6 | 0); beep(260 + Math.random() * 200, .03) }, 85);
    try { await sleep(650) } finally { clearInterval(iv); d.classList.remove('roll') }

    v = 1 + Math.random() * 6 | 0; face(c, v); beep(660, .1, 'triangle');
    if (v === 6) sixes++; else sixes = 0;

    if (sixes === 3) {
        say(`${NAMES[c]} rolled three 6s — turn lost!`);
        await sleep(1300); return nextTurn(false);
    }
    const mv = movable(c, v);
    if (!mv.length) {
        say(`${NAMES[c]} rolled ${v} — no move possible`);
        await sleep(1000); return nextTurn(false);
    }
    if (mode[c] === 'cpu') { await sleep(500); return doMove(choose(mv)) }
    if (mv.length === 1) { say(`You rolled ${v}`); await sleep(400); return doMove(mv[0]) }
    setPhase('move');
    mv.forEach(i => tk[c][i].classList.add('can'));
    say(`${NAMES[c]} rolled ${v} — tap a glowing token`);
});

const doMove = guard(async function (i) {
    setPhase('anim');
    const c = cur, e = tk[c][i];
    tk[c].forEach(t => t.classList.remove('can'));
    e.classList.add('mv');
    let cap = false, home = false;

    if (pcs[c][i] < 0) { pcs[c][i] = 0; render(); beep(520, .15); await sleep(280) }
    else for (let k = 0; k < v; k++) { pcs[c][i]++; render(); beep(380 + pcs[c][i] * 5, .05); await sleep(175) }

    const np = pcs[c][i];
    if (np <= 50 && !SAFE.has(absOf(c, np))) {
        for (let o = 0; o < 4; o++)if (o !== c && mode[o] !== 'off')
            pcs[o].forEach((q, j) => {
                if (q >= 0 && q <= 50 && absOf(o, q) === absOf(c, np)) { pcs[o][j] = -1; cap = true }
            });
    }
    if (cap) { render(); beep(170, .3, 'sawtooth'); say(`${NAMES[c]} captured a token!`) }
    if (np === 56) { home = true; beep(880, .35, 'triangle'); say(`${NAMES[c]} reached home!`) }
    e.classList.remove('mv'); ui();

    if (pcs[c].every(p => p === 56)) {
        setPhase('over');
        [523, 659, 784, 1046].forEach((f, k) => setTimeout(() => beep(f, .25, 'triangle'), k * 180));
        $('#wt').textContent = `🏆 ${NAMES[c]} wins!`;
        $('#wp').textContent = 'All four tokens made it home. Great game!';
        $('#win').classList.remove('hide');
        return;
    }
    await sleep(cap || home ? 650 : 200);
    nextTurn(v === 6 || cap || home);
});

/* ===== Setup / start ===== */
const ORDER = ['off', 'human', 'cpu'], LBL = { off: 'Off', human: 'Player', cpu: 'Computer' };

function drawSetup() {
    $('#setup').innerHTML = [0, 1, 2, 3].map(c =>
        `<div class="row" style="--rc:${HEX[c]}"><i></i><span>${NAMES[c]}</span><button data-c="${c}">${LBL[mode[c]]}</button></div>`
    ).join('');
    $('#setup').querySelectorAll('button').forEach(b => b.onclick = () => {
        const c = +b.dataset.c;
        mode[c] = ORDER[(ORDER.indexOf(mode[c]) + 1) % 3];
        drawSetup();
    });
}

function startGame() {
    const active = mode.filter(m => m !== 'off').length, humans = mode.filter(m => m === 'human').length;
    if (active < 2) { $('#err').textContent = 'Pick at least 2 players.'; return }
    if (humans < 1) { $('#err').textContent = 'At least one colour must be a human Player (not all Computer).'; return }
    $('#err').textContent = '';
    gid++;
    $('#ov').classList.add('hide'); $('#win').classList.add('hide');
    pcs = [0, 1, 2, 3].map(() => [-1, -1, -1, -1]);
    cur = mode.findIndex(m => m !== 'off'); sixes = 0;
    tk.flat().forEach(e => e.classList.remove('can', 'mv'));
    for (let c = 0; c < 4; c++)face(c, c + 3);
    render(); nextTurn(true);
    say(`${NAMES[cur]} starts!` + (mode[cur] === 'cpu' ? '' : ' Tap your dice.'));
}

function openSetup() {
    gid++; phase = 'idle'; ui();
    drawSetup();
    $('#ov').classList.remove('hide'); $('#win').classList.add('hide');
}

$('#start').onclick = startGame;
$('#newg').onclick = openSetup;
$('#again').onclick = openSetup;
$('#snd').onclick = () => { snd = !snd; $('#snd').textContent = snd ? '🔊' : '🔇' };
document.addEventListener('keydown', e => {
    if (e.code === 'Space' && phase === 'roll' && mode[cur] === 'human' && $('#ov').classList.contains('hide')) {
        e.preventDefault(); roll();
    }
});

/* ===== Init ===== */
render(); ui(); drawSetup();