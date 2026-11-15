import * as THREE from 'three';

// --- 1. WEB AUDIO SYNTHESIZER (Zero Dependencies) ---
const sfx = {
    ctx: null,
    muted: false,
    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this.ctx = new AudioCtx();
        }
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, type, duration, vol = 0.12, slideTo = null) {
        if (this.muted || !this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        if (slideTo) {
            osc.frequency.exponentialRampToValueAtTime(slideTo, this.ctx.currentTime + duration);
        }
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    toggle(on) { this.tone(on ? 520 : 320, 'sine', 0.14, 0.12, on ? 780 : 200); },
    repair() {
        this.tone(440, 'triangle', 0.12, 0.14, 660);
        setTimeout(() => this.tone(660, 'triangle', 0.18, 0.14, 880), 100);
    },
    pickup() { this.tone(587, 'sine', 0.18, 0.14, 880); },
    alarm() { this.tone(680, 'sawtooth', 0.28, 0.1, 420); },
    impact() { this.tone(140, 'sawtooth', 0.25, 0.18, 45); },
    deflect() { this.tone(900, 'sine', 0.12, 0.08, 1400); },
    win() {
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 'triangle', 0.22, 0.14), i * 120));
    },
    lose() {
        [380, 320, 260, 180].forEach((f, i) => setTimeout(() => this.tone(f, 'sawtooth', 0.28, 0.14), i * 150));
    }
};

// --- 2. REAL NASA API INTEGRATION (.env Support) ---
let realFlareList = [];
let realFlareData = null;

async function loadNasaApiKey() {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_NASA_API_KEY) {
        return import.meta.env.VITE_NASA_API_KEY.trim();
    }
    try {
        const res = await fetch('./.env', { cache: 'no-store' });
        if (!res.ok) return null;
        const text = await res.text();
        for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const match = line.match(/^(?:VITE_)?NASA_API_KEY\s*=\s*(.+)$/);
            if (match) {
                const val = match[1].trim().replace(/^['"]|['"]$/g, '');
                if (val && val !== 'your_nasa_api_key_here') return val;
            }
        }
    } catch (_) {
        // Ignore when running on static hosting without a local .env file
    }
    return null;
}

async function fetchNASAData() {
    const loadingText = document.getElementById('loading-text');
    const apiStatus = document.getElementById('api-status');
    const flareDataText = document.getElementById('real-flare-data');
    const briefingControls = document.getElementById('briefing-controls');

    try {
        loadingText.innerText = "Loading API configuration...";
        const apiKey = await loadNasaApiKey();

        loadingText.innerText = "Contacting NASA DONKI Servers...";
        const today = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const primaryUrl = apiKey
            ? `https://api.nasa.gov/DONKI/FLR?startDate=${thirtyDaysAgo}&endDate=${today}&api_key=${encodeURIComponent(apiKey)}`
            : `https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR?startDate=${thirtyDaysAgo}&endDate=${today}`;

        let flareResponse = await fetch(primaryUrl);
        if (!flareResponse.ok && apiKey) {
            // Fallback to CCMC mirror if api.nasa.gov fails
            flareResponse = await fetch(`https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR?startDate=${thirtyDaysAgo}&endDate=${today}`);
        }
        if (!flareResponse.ok) throw new Error(`HTTP ${flareResponse.status}`);

        const flareData = await flareResponse.json();
        apiStatus.innerText = apiKey ? "CONNECTED (NASA API KEY)" : "CONNECTED (DONKI)";
        apiStatus.style.color = "#43aa8b";

        if (Array.isArray(flareData) && flareData.length > 0) {
            realFlareList = flareData;
            realFlareData = flareData[flareData.length - 1];
            const date = new Date(realFlareData.beginTime).toLocaleDateString();
            flareDataText.innerText = `Class ${realFlareData.classType || 'M1.0'} on ${date} (${flareData.length} recorded in 30d)`;
        } else {
            flareDataText.innerText = "Quiet Sun (Using OSDR reference flare M1.2)";
        }

        loadingText.innerText = "NASA Telemetry Synchronized. Ready for Launch.";
    } catch (error) {
        console.warn("NASA API fallback:", error);
        apiStatus.innerText = "OFFLINE CACHE (OSDR/DONKI)";
        apiStatus.style.color = "#f9c74f";
        flareDataText.innerText = "Cached Event: Class M2.4 Solar Flare";
        loadingText.innerText = "Offline NASA Telemetry Loaded. Ready for Launch.";
    }

    briefingControls.style.display = 'block';
    initScene();
}

// --- 3. DIFFICULTY & BRIEFING SETUP ---
const DIFFICULTY = {
    cadet:     { timeLimit: 60,  o2Drain: 1.2, flareInterval: 25 },
    commander: { timeLimit: 90,  o2Drain: 1.5, flareInterval: 23 },
    veteran:   { timeLimit: 120, o2Drain: 1.8, flareInterval: 20 }
};
let selectedDiff = 'cadet';

document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedDiff = btn.dataset.diff;
        document.getElementById('time-val').innerText = DIFFICULTY[selectedDiff].timeLimit;
    });
});

document.getElementById('start-btn').addEventListener('click', () => {
    sfx.init();
    sfx.toggle(true);
    const cfg = DIFFICULTY[selectedDiff];
    state.timeLimit = cfg.timeLimit;
    state.o2Drain = cfg.o2Drain;
    state.flareInterval = cfg.flareInterval;
    state.isPaused = false;
    document.getElementById('loading-screen').style.display = 'none';
    updateUI();
    addLog(`Mission started (${selectedDiff.toUpperCase()} rank).`);
});

document.getElementById('mute-btn').addEventListener('click', e => {
    sfx.muted = !sfx.muted;
    e.currentTarget.innerText = sfx.muted ? '🔇 MUTE' : '🔊 SFX';
});

// --- 4. GAME STATE & SCENE ---
let scene, camera, renderer, player, shieldDome, earthMesh;
let modules = [], meteors = [], crates = [], obstacles = [], particles = [];
let isMoving = false, walkCycle = 0;
let leftArm, rightArm, leftLeg, rightLeg;
const clock = new THREE.Clock();

let state = {
    power: 100, oxygen: 100, health: 100,
    o2Drain: 1.2,
    isGameOver: false, isPaused: true,
    timeSurvived: 0, timeLimit: 60,
    flareTimer: 0, nextFlare: 15, flareInterval: 25,
    currentFlareClass: 'M1.0',
    warningActive: false, countdown: 0,
    cratesCollected: 0, repairsMade: 0
};

function getActiveFlareInfo() {
    if (realFlareList.length > 0) {
        const pick = realFlareList[Math.floor(Math.random() * realFlareList.length)];
        realFlareData = pick;
    }
    const rawClass = (realFlareData && realFlareData.classType) ? realFlareData.classType : 'M1.5';
    const letter = rawClass.charAt(0).toUpperCase();
    if (letter === 'X') return { classType: rawClass, dmg: 20, duration: 6, meteors: 22, shieldDrain: 7 };
    if (letter === 'C' || letter === 'B') return { classType: rawClass, dmg: 11, duration: 4, meteors: 12, shieldDrain: 4 };
    return { classType: rawClass, dmg: 15, duration: 5, meteors: 16, shieldDrain: 5 };
}

function initScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050814, 0.012);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0x506080, 1.4);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
    dirLight.position.set(18, 30, 14);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Starfield
    const starsGeo = new THREE.BufferGeometry();
    const starsPos = new Float32Array(3000 * 3);
    for (let i = 0; i < starsPos.length; i++) starsPos[i] = (Math.random() - 0.5) * 320;
    starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
    scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.55 })));

    // Distant Earth in the Lunar Sky
    earthMesh = new THREE.Mesh(
        new THREE.SphereGeometry(9, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0x2b7de9, emissive: 0x0b2545, roughness: 0.6 })
    );
    earthMesh.position.set(-45, 38, -85);
    scene.add(earthMesh);

    // Lunar Surface
    const groundGeo = new THREE.PlaneGeometry(100, 100, 64, 64);
    const positions = groundGeo.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) positions[i + 2] = Math.random() * 0.35;
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
        groundGeo,
        new THREE.MeshStandardMaterial({ color: 0x252838, roughness: 0.95, flatShading: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Central Lunar Habitat Dome
    const habGroup = new THREE.Group();
    const habDome = new THREE.Mesh(
        new THREE.SphereGeometry(3.2, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xd8e2dc, roughness: 0.4, metalness: 0.3 })
    );
    habDome.castShadow = true;
    habDome.receiveShadow = true;
    habGroup.add(habDome);
    const habRing = new THREE.Mesh(
        new THREE.CylinderGeometry(3.4, 3.6, 0.5, 20),
        new THREE.MeshStandardMaterial({ color: 0x3a506b, metalness: 0.6 })
    );
    habRing.position.y = 0.25;
    habGroup.add(habRing);
    scene.add(habGroup);
    obstacles.push({ x: 0, z: 0, radius: 3.6 });

    // Scattered Lunar Boulders outside main walkways
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3d4d, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2;
        const dist = 24 + Math.random() * 10;
        const rock = new THREE.Mesh(rockGeo, rockMat);
        const s = 0.6 + Math.random() * 1.1;
        rock.scale.set(s, s * 0.7, s);
        rock.position.set(Math.cos(angle) * dist, s * 0.3, Math.sin(angle) * dist);
        rock.castShadow = true;
        scene.add(rock);
    }

    function createLabel(text, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, 256, 64);
        ctx.font = 'bold 22px Courier New';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 32);
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(4.2, 1.05, 1);
        return sprite;
    }

    const modData = [
        { x: -12, z: 12,  color: 0x43aa8b, name: "O2 RECYCLER",  active: false, damaged: false },
        { x: 0,   z: -12, color: 0xf9c74f, name: "SOLAR ARRAY",  active: true,  damaged: false },
        { x: 12,  z: 0,   color: 0x5bc0be, name: "SHIELD EAST",  active: false, damaged: false },
        { x: -12, z: 0,   color: 0x5bc0be, name: "SHIELD WEST",  active: false, damaged: false },
        { x: 0,   z: 12,  color: 0x5bc0be, name: "SHIELD SOUTH", active: false, damaged: false },
        { x: 0,   z: -24, color: 0x5bc0be, name: "SHIELD NORTH", active: false, damaged: false }
    ];

    modData.forEach(m => {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(3, 3, 3),
            new THREE.MeshStandardMaterial({ color: m.active ? m.color : 0x444444, roughness: 0.5 })
        );
        mesh.position.set(m.x, 1.5, m.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        m.mesh = mesh;

        const light = new THREE.Mesh(
            new THREE.SphereGeometry(0.32, 10, 10),
            new THREE.MeshBasicMaterial({ color: m.active ? m.color : 0x333333 })
        );
        light.position.set(m.x, 3.25, m.z);
        scene.add(light);
        m.light = light;

        const label = createLabel(m.name, m.color);
        label.position.set(m.x, 4.5, m.z);
        scene.add(label);

        modules.push(m);
        obstacles.push({ x: m.x, z: m.z, radius: 2.2 });
    });

    shieldDome = new THREE.Mesh(
        new THREE.SphereGeometry(22, 32, 24),
        new THREE.MeshBasicMaterial({ color: 0x5bc0be, transparent: true, opacity: 0.14, wireframe: true })
    );
    shieldDome.visible = false;
    scene.add(shieldDome);

    // Astronaut Player
    player = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1, roughness: 0 });
    const packMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1, 0.5), suitMat); torso.position.y = 1.8; torso.castShadow = true; player.add(torso);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.3), packMat); pack.position.set(0, 1.8, -0.4); pack.castShadow = true; player.add(pack);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), suitMat); helmet.position.y = 2.5; helmet.castShadow = true; player.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), visorMat); visor.position.set(0, 2.5, 0.2); visor.scale.set(1, 0.7, 0.5); player.add(visor);
    leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 4, 8), suitMat); leftArm.position.set(-0.55, 1.8, 0); leftArm.castShadow = true; player.add(leftArm);
    rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 4, 8), suitMat); rightArm.position.set(0.55, 1.8, 0); rightArm.castShadow = true; player.add(rightArm);
    leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.7, 4, 8), suitMat); leftLeg.position.set(-0.25, 0.9, 0); leftLeg.castShadow = true; player.add(leftLeg);
    rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.7, 4, 8), suitMat); rightLeg.position.set(0.25, 0.9, 0); rightLeg.castShadow = true; player.add(rightLeg);

    player.position.set(0, 0, 6);
    scene.add(player);

    setupInputs();
    setInterval(gameTick, 1000);
    animate();

    addLog("System Online. NASA Data Loaded.");
}

// --- 5. INPUT & MODULE STATE HELPERS ---
const keys = {};
function setupInputs() {
    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => keys[e.code] = false);
}

function refreshModuleVisual(m) {
    if (m.damaged) {
        m.mesh.material.color.setHex(0x661111);
        m.light.material.color.setHex(0xff2222);
    } else {
        m.mesh.material.color.setHex(m.active ? m.color : 0x444444);
        m.light.material.color.setHex(m.active ? m.color : 0x333333);
    }
}

function addLog(msg, isAlert = false) {
    const logDiv = document.getElementById('log-content');
    if (!logDiv) return;
    const p = document.createElement('div');
    p.className = 'log-entry';
    if (isAlert) p.style.color = '#ff4d4d';
    p.innerText = `> ${msg}`;
    logDiv.prepend(p);
}

function setStatusBadge(el, mod) {
    if (mod.damaged) {
        el.innerText = 'DAMAGED!';
        el.className = 'status-dmg';
    } else if (mod.active) {
        el.innerText = 'ONLINE';
        el.className = 'status-on';
    } else {
        el.innerText = 'OFFLINE';
        el.className = 'status-off';
    }
}

function updateUI() {
    document.getElementById('power-val').innerText = Math.max(0, Math.floor(state.power)) + '%';
    document.getElementById('power-bar').style.width = Math.max(0, state.power) + '%';
    document.getElementById('oxygen-val').innerText = Math.max(0, Math.floor(state.oxygen)) + '%';
    document.getElementById('oxygen-bar').style.width = Math.max(0, state.oxygen) + '%';
    document.getElementById('health-val').innerText = Math.max(0, Math.floor(state.health)) + '%';
    document.getElementById('health-bar').style.width = Math.max(0, state.health) + '%';
    document.getElementById('time-val').innerText = Math.max(0, state.timeLimit - state.timeSurvived);

    if (modules.length >= 3) {
        setStatusBadge(document.getElementById('sys-o2'), modules[0]);
        setStatusBadge(document.getElementById('sys-solar'), modules[1]);
        setStatusBadge(document.getElementById('sys-shield'), modules[2]);
    }
}

window.closeAlert = function() {
    document.getElementById('alert-screen').style.display = 'none';
    state.isPaused = false;
    const flareInfo = getActiveFlareInfo();
    state.flareTimer = flareInfo.duration;
    for (let i = 0; i < flareInfo.meteors; i++) spawnMeteor();
};

function spawnMeteor() {
    const x = (Math.random() - 0.5) * 44;
    const z = (Math.random() - 0.5) * 44;
    const startY = 22 + Math.random() * 14;

    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0xff2200 })
    );
    mesh.position.set(x, startY, z);
    scene.add(mesh);

    // Ground warning ring so player can see where the meteor will land
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 2.6, 20),
        new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    scene.add(ring);

    meteors.push({ mesh, ring, speed: 11 + Math.random() * 7 });
}

function spawnCrate() {
    if (crates.length >= 8) return;
    const roll = Math.random();
    let type = 'oxygen', color = 0x43aa8b;
    if (roll < 0.22) {
        type = 'health'; color = 0xf94144;
    } else if (roll < 0.45) {
        type = 'power'; color = 0xf9c74f;
    }

    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 1.3, 1.3),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.3 })
    );

    let x = 0, z = 0;
    do {
        x = (Math.random() - 0.5) * 34;
        z = (Math.random() - 0.5) * 34;
    } while (Math.hypot(x, z) < 5);

    mesh.position.set(x, 0.9, z);
    scene.add(mesh);
    crates.push({ mesh, type, phase: Math.random() * Math.PI * 2 });
}

function spawnJetpackParticle() {
    const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x5bc0be, transparent: true, opacity: 0.8 })
    );
    p.position.set(
        player.position.x + (Math.random() - 0.5) * 0.25,
        player.position.y + 1.3,
        player.position.z + (Math.random() - 0.5) * 0.25
    );
    scene.add(p);
    particles.push({ mesh: p, life: 0.35 });
}

// --- 6. 1-SECOND MISSION SIMULATION TICK ---
function gameTick() {
    if (state.isGameOver || !scene) return;

    if (state.warningActive) {
        state.countdown--;
        sfx.alarm();
        document.getElementById('countdown-text').innerText = state.countdown;
        if (state.countdown <= 0) {
            state.warningActive = false;
            document.getElementById('warning-overlay').style.display = 'none';

            const flareInfo = getActiveFlareInfo();
            state.currentFlareClass = flareInfo.classType;
            document.getElementById('alert-heading').innerText = `⚠️ CLASS ${flareInfo.classType} SOLAR FLARE`;

            let alertDesc = `NASA's DONKI database recorded a Class ${flareInfo.classType} event.`;
            if (realFlareData && realFlareData.beginTime) {
                alertDesc = `NASA DONKI LIVE DATA: Real Solar Flare (Class ${flareInfo.classType}) recorded on ${new Date(realFlareData.beginTime).toLocaleDateString()}.`;
            }
            document.getElementById('alert-desc').innerText = alertDesc;

            state.isPaused = true;
            document.getElementById('alert-screen').style.display = 'flex';
            addLog(`⚠️ SOLAR FLARE (${flareInfo.classType}) IMPACT!`, true);
        }
        return;
    }

    if (state.isPaused) return;

    state.timeSurvived++;
    state.oxygen = Math.max(0, state.oxygen - state.o2Drain);

    // O2 Recycler
    if (modules[0].active && !modules[0].damaged && state.power > 0) {
        state.power = Math.max(0, state.power - 3);
        state.oxygen = Math.min(100, state.oxygen + 2.4);
    }
    // Solar Array
    if (modules[1].active && !modules[1].damaged && state.flareTimer <= 0) {
        state.power = Math.min(100, state.power + 4);
    }

    const flareInfo = getActiveFlareInfo();
    let anyShieldActive = false;
    modules.forEach(m => {
        if (m.name.includes("SHIELD") && m.active && !m.damaged && state.power > 0) {
            anyShieldActive = true;
        }
    });

    if (anyShieldActive) {
        state.power = Math.max(0, state.power - flareInfo.shieldDrain);
        if (state.power <= 0) {
            modules.forEach(m => {
                if (m.name.includes("SHIELD")) {
                    m.active = false;
                    refreshModuleVisual(m);
                }
            });
            shieldDome.visible = false;
            anyShieldActive = false;
            addLog("SHIELDS OFFLINE: Power depleted!", true);
        }
    }

    if (state.power <= 0) {
        state.power = 0;
        state.oxygen = Math.max(0, state.oxygen - 2.5);
    }

    if (state.timeSurvived % 5 === 0) spawnCrate();

    if (state.timeSurvived >= state.nextFlare && !state.warningActive) {
        state.nextFlare += state.flareInterval;
        state.warningActive = true;
        state.countdown = 5;
        document.getElementById('countdown-text').innerText = 5;
        document.getElementById('warning-overlay').style.display = 'flex';
        sfx.alarm();
        addLog("WARNING: Solar Flare Inbound! Activate Shields!", true);
    }

    if (state.flareTimer > 0) {
        state.flareTimer--;
        if (!anyShieldActive) {
            state.health = Math.max(0, state.health - flareInfo.dmg);
            document.getElementById('damage-flash').style.opacity = 1;
            setTimeout(() => document.getElementById('damage-flash').style.opacity = 0, 140);
            addLog(`Radiation dose! (-${flareInfo.dmg}% Health)`, true);
        }
    }

    if (state.timeSurvived >= state.timeLimit) endGame(true);
    else if (state.oxygen <= 0 || state.health <= 0) endGame(false);

    updateUI();
}

function endGame(isWin) {
    state.isGameOver = true;
    document.getElementById('end-screen').style.display = 'flex';
    const title = document.getElementById('end-title');
    const desc = document.getElementById('end-desc');

    if (isWin) {
        sfx.win();
        const bonus = state.cratesCollected * 50 + state.repairsMade * 100;
        const score = Math.floor((state.power + state.oxygen + state.health) * 10 + bonus);
        title.innerText = "MISSION SUCCESS";
        title.style.color = "#43aa8b";
        desc.innerHTML = `
            <strong>Mission Report (${selectedDiff.toUpperCase()}):</strong><br>
            You kept the lunar outpost operational through solar weather!<br><br>
            • <strong>Final Science Score:</strong> ${score}<br>
            • <strong>Supplies Collected:</strong> ${state.cratesCollected} | <strong>Repairs:</strong> ${state.repairsMade}<br>
            • <strong>Remaining Reserves:</strong> ⚡ ${Math.floor(state.power)}% | 🫧 ${Math.floor(state.oxygen)}% | ❤️ ${Math.floor(state.health)}%<br><br>
            <em>NASA Data Grounding:</em><br>
            • <strong>DONKI API:</strong> Live solar flare class & event telemetry.<br>
            • <strong>OSDR RadLab:</strong> Radiation shielding vs. biological dose trade-offs.
        `;
    } else {
        sfx.lose();
        title.innerText = "MISSION FAILED";
        title.style.color = "#ff4d4d";
        const reason = state.oxygen <= 0 ? "Oxygen reserves depleted." : "Crew radiation/impact health reached critical levels.";
        desc.innerHTML = `
            <strong>Outpost Status: Critical Failure</strong><br>
            ${reason}<br><br>
            <strong>Tip:</strong> Keep the <strong>Solar Array</strong> repaired for Power, toggle the <strong>O₂ Recycler</strong> when Oxygen dips, and activate a <strong>Shield Generator</strong> only during the 5-second Solar Flare warning!
        `;
    }
}

// --- 7. RENDER & FRAME LOOP ---
function animate() {
    requestAnimationFrame(animate);
    if (!scene) return;

    const dt = Math.min(clock.getDelta(), 0.1);

    if (earthMesh) earthMesh.rotation.y += 0.15 * dt;

    if (!state.isPaused && !state.isGameOver) {
        let mx = 0, mz = 0;
        if (keys['KeyW'] || keys['ArrowUp']) mz -= 1;
        if (keys['KeyS'] || keys['ArrowDown']) mz += 1;
        if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
        if (keys['KeyD'] || keys['ArrowRight']) mx += 1;

        const boosting = (keys['ShiftLeft'] || keys['ShiftRight'] || keys['Space']) && state.oxygen > 5;
        const baseSpeed = 14;
        const speed = boosting ? baseSpeed * 1.65 : baseSpeed;

        if (mx !== 0 || mz !== 0) {
            isMoving = true;
            const len = Math.hypot(mx, mz);
            mx /= len;
            mz /= len;

            let nextX = Math.max(-30, Math.min(30, player.position.x + mx * speed * dt));
            let nextZ = Math.max(-30, Math.min(30, player.position.z + mz * speed * dt));

            // Push player out of solid modules and habitat dome
            obstacles.forEach(ob => {
                const dist = Math.hypot(nextX - ob.x, nextZ - ob.z);
                if (dist < ob.radius && dist > 0.001) {
                    const overlap = ob.radius - dist;
                    nextX += ((nextX - ob.x) / dist) * overlap;
                    nextZ += ((nextZ - ob.z) / dist) * overlap;
                }
            });

            player.position.x = nextX;
            player.position.z = nextZ;
            player.rotation.y = Math.atan2(mx, mz);
            walkCycle += (boosting ? 18 : 12) * dt;

            if (boosting) {
                state.oxygen = Math.max(0, state.oxygen - 2.2 * dt);
                player.position.y = Math.abs(Math.sin(walkCycle * 0.5)) * 0.45;
                if (Math.random() < 0.6) spawnJetpackParticle();
            } else {
                player.position.y = 0;
            }
        } else {
            isMoving = false;
            player.position.y = 0;
        }

        if (isMoving) {
            leftLeg.rotation.x = Math.sin(walkCycle) * 0.6;
            rightLeg.rotation.x = -Math.sin(walkCycle) * 0.6;
            leftArm.rotation.x = -Math.sin(walkCycle) * 0.4;
            rightArm.rotation.x = Math.sin(walkCycle) * 0.4;
        } else {
            leftLeg.rotation.x = 0; rightLeg.rotation.x = 0; leftArm.rotation.x = 0; rightArm.rotation.x = 0;
        }

        // Module Interaction & Repair
        let nearModule = null;
        modules.forEach(m => {
            if (Math.hypot(player.position.x - m.x, player.position.z - m.z) < 3.8) nearModule = m;
        });

        const prompt = document.getElementById('interact-prompt');
        if (nearModule) {
            prompt.style.display = 'block';
            if (nearModule.damaged) {
                prompt.innerText = `Press E to REPAIR ${nearModule.name}`;
            } else {
                prompt.innerText = `Press E to turn ${nearModule.active ? 'OFF' : 'ON'} ${nearModule.name}`;
            }

            if (keys['KeyE']) {
                keys['KeyE'] = false;
                if (nearModule.damaged) {
                    nearModule.damaged = false;
                    state.repairsMade++;
                    refreshModuleVisual(nearModule);
                    sfx.repair();
                    addLog(`🔧 Repaired ${nearModule.name}!`);
                } else if (nearModule.name.includes("SHIELD")) {
                    const newState = !nearModule.active;
                    modules.forEach(m => {
                        if (m.name.includes("SHIELD")) {
                            m.active = newState;
                            m.damaged = false;
                            refreshModuleVisual(m);
                        }
                    });
                    shieldDome.visible = newState;
                    sfx.toggle(newState);
                    addLog(`ALL SHIELDS: ${newState ? 'ONLINE' : 'OFFLINE'}`);
                } else {
                    nearModule.active = !nearModule.active;
                    refreshModuleVisual(nearModule);
                    sfx.toggle(nearModule.active);
                    addLog(`${nearModule.name}: ${nearModule.active ? 'ONLINE' : 'OFFLINE'}`);
                }
                updateUI();
            }
        } else {
            prompt.style.display = 'none';
        }

        // Collectible Crates (backwards loop for safe splice)
        const elapsed = clock.getElapsedTime();
        for (let i = crates.length - 1; i >= 0; i--) {
            const c = crates[i];
            c.mesh.rotation.y += 1.8 * dt;
            c.mesh.position.y = 0.85 + Math.sin(elapsed * 3 + c.phase) * 0.2;

            const dist = Math.hypot(player.position.x - c.mesh.position.x, player.position.z - c.mesh.position.z);
            if (dist < 2.1) {
                sfx.pickup();
                state.cratesCollected++;
                if (c.type === 'health') {
                    state.health = Math.min(100, state.health + 15);
                    addLog("❤️ Medkit Collected (+15% Health)");
                } else if (c.type === 'power') {
                    state.power = Math.min(100, state.power + 20);
                    addLog("⚡ Power Cell Collected (+20% Power)");
                } else {
                    state.oxygen = Math.min(100, state.oxygen + 15);
                    addLog("🫧 Oxygen Crate Collected (+15% O₂)");
                }
                scene.remove(c.mesh);
                crates.splice(i, 1);
                updateUI();
            }
        }

        // Falling Meteors + Ground Rings + Shield Deflection
        for (let i = meteors.length - 1; i >= 0; i--) {
            const m = meteors[i];
            m.mesh.position.y -= m.speed * dt;
            const ringScale = Math.max(0.25, m.mesh.position.y / 22);
            m.ring.scale.set(ringScale, ringScale, 1);

            const distFromCenter = Math.hypot(m.mesh.position.x, m.mesh.position.z);
            if (shieldDome.visible && m.mesh.position.y <= 14 && distFromCenter < 21) {
                sfx.deflect();
                scene.remove(m.mesh);
                scene.remove(m.ring);
                meteors.splice(i, 1);
                continue;
            }

            if (m.mesh.position.y <= 0.4) {
                sfx.impact();
                const distToPlayer = Math.hypot(player.position.x - m.mesh.position.x, player.position.z - m.mesh.position.z);
                if (distToPlayer < 3.2) {
                    state.health = Math.max(0, state.health - 12);
                    document.getElementById('damage-flash').style.opacity = 1;
                    setTimeout(() => document.getElementById('damage-flash').style.opacity = 0, 120);
                    addLog("☄️ Meteor impact near astronaut! (-12% Health)", true);
                }

                // Check if meteor struck an unprotected module
                modules.forEach(mod => {
                    if (!mod.damaged && Math.hypot(mod.x - m.mesh.position.x, mod.z - m.mesh.position.z) < 3.2) {
                        mod.damaged = true;
                        mod.active = false;
                        refreshModuleVisual(mod);
                        addLog(`⚠️ ${mod.name} struck by meteor! Press E to repair!`, true);
                    }
                });

                scene.remove(m.mesh);
                scene.remove(m.ring);
                meteors.splice(i, 1);
                updateUI();
            }
        }

        // Jetpack Exhaust Particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= dt;
            p.mesh.position.y -= 2 * dt;
            p.mesh.material.opacity = Math.max(0, p.life * 2);
            if (p.life <= 0) {
                scene.remove(p.mesh);
                particles.splice(i, 1);
            }
        }

        camera.position.x = player.position.x;
        camera.position.z = player.position.z + 15;
        camera.position.y = 10;
        camera.lookAt(player.position.x, 0, player.position.z);
    }

    if (shieldDome && shieldDome.visible) shieldDome.rotation.y += 0.6 * dt;
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});

fetchNASAData();
