import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- Global Variables & State ---
let scene, camera, renderer;
let world;
let playerBody, playerMesh;
let lastTime;

// Game State
let gameState = 'START'; // START, PLAYING, PAUSED, GAMEOVER, WIN
let score = 0;
let coinsCollected = 0;
let distance = 0;
let checkpointPos = new CANNON.Vec3(0, 5, 0);

// Arrays for logic
const objectsToUpdate = [];
const coins = [];
const checkpoints = [];
const movingObstacles = [];
const particles = [];

// Input State
const keys = { w: false, a: false, s: false, d: false };
const touchInput = { active: false, x: 0, y: 0, originX: 0, originY: 0 };

// --- DOM Elements ---
const hud = document.getElementById('hud');
const scoreEl = document.getElementById('score');
const distanceEl = document.getElementById('distance');
const startMenu = document.getElementById('start-menu');
const pauseMenu = document.getElementById('pause-menu');
const gameOverMenu = document.getElementById('game-over-menu');
const winMenu = document.getElementById('win-menu');
const finalScoreEl = document.getElementById('final-score');

// --- Initialization ---
function init() {
    // 1. Three.js Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(-20, 50, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -150;
    scene.add(dirLight);

    // 2. Cannon-es Setup
    world = new CANNON.World();
    world.gravity.set(0, -15, 0); // slightly stronger gravity for snappy feeling
    world.broadphase = new CANNON.SAPBroadphase(world);

    // Physics Materials
    const defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(
        defaultMaterial, defaultMaterial,
        { friction: 0.1, restitution: 0.3 }
    );
    world.addContactMaterial(defaultContactMaterial);

    // 3. Create Player
    const radius = 1;
    const sphereShape = new CANNON.Sphere(radius);
    playerBody = new CANNON.Body({
        mass: 1,
        position: new CANNON.Vec3(0, 5, 0),
        shape: sphereShape,
        material: defaultMaterial,
        linearDamping: 0.4, // Simulate friction/drag
        angularDamping: 0.4
    });
    world.addBody(playerBody);

    const sphereGeo = new THREE.SphereGeometry(radius, 32, 32);
    // Custom shader-like material for a cool rolling effect
    const texLoader = new THREE.TextureLoader();
    const sphereMat = new THREE.MeshStandardMaterial({ 
        color: 0xff3366, 
        roughness: 0.2, 
        metalness: 0.5,
        wireframe: false
    });
    playerMesh = new THREE.Mesh(sphereGeo, sphereMat);
    playerMesh.castShadow = true;
    scene.add(playerMesh);

    // 4. Build Level
    buildLevel(defaultMaterial);

    // 5. Event Listeners
    setupInputs();
    setupUIEvents();
    window.addEventListener('resize', onWindowResize);

    // Start Loop
    lastTime = performance.now();
    requestAnimationFrame(tick);
}

// --- Level Generation ---
function buildLevel(physMat) {
    // Helper to create platforms
    const createPlatform = (x, y, z, w, h, d, color = 0x4CAF50) => {
        const shape = new CANNON.Box(new CANNON.Vec3(w/2, h/2, d/2));
        const body = new CANNON.Body({ mass: 0, material: physMat });
        body.addShape(shape);
        body.position.set(x, y, z);
        world.addBody(body);

        const geo = new THREE.BoxGeometry(w, h, d);
        const mat = new THREE.MeshStandardMaterial({ color: color });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(body.position);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        scene.add(mesh);
        
        return { body, mesh };
    };

    // Helper for Coins
    const createCoin = (x, y, z) => {
        const geo = new THREE.TorusGeometry(0.5, 0.15, 8, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.8, roughness: 0.2 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        scene.add(mesh);
        coins.push({ mesh, active: true });
    };

    // Helper for Moving Hammers
    const createHammer = (x, y, z) => {
        const shape = new CANNON.Box(new CANNON.Vec3(3, 1, 1));
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
        body.addShape(shape);
        body.position.set(x, y, z);
        world.addBody(body);

        const geo = new THREE.BoxGeometry(6, 2, 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0xFF5722 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        scene.add(mesh);

        movingObstacles.push({ body, mesh, startX: x, type: 'hammer', time: Math.random() * Math.PI });
    };

    // Helper for Rotating Bars
    const createRotatingBar = (x, y, z) => {
        const shape = new CANNON.Box(new CANNON.Vec3(4, 0.5, 0.5));
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
        body.addShape(shape);
        body.position.set(x, y, z);
        world.addBody(body);

        const geo = new THREE.BoxGeometry(8, 1, 1);
        const mat = new THREE.MeshStandardMaterial({ color: 0x9C27B0 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        scene.add(mesh);

        movingObstacles.push({ body, mesh, type: 'spinner' });
    };

    // Checkpoint Trigger
    const createCheckpoint = (x, y, z) => {
        checkpoints.push(new THREE.Vector3(x, y, z));
        // Visual indicator
        const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00FF00, transparent: true, opacity: 0.5 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        scene.add(mesh);
    };

    // --- Build Track Layout ---
    // Start Platform
    createPlatform(0, -1, -10, 10, 2, 40);
    createCoin(0, 0.5, -5);
    createCoin(0, 0.5, -10);
    createCoin(0, 0.5, -15);
    
    // Gap
    // Platform 2
    createPlatform(0, -1, -45, 10, 2, 20);
    createRotatingBar(0, 0, -45);
    createCoin(-2, 0.5, -40);
    createCoin(2, 0.5, -50);

    // Ramp Up
    const ramp = createPlatform(0, 2, -65, 10, 2, 25);
    ramp.body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 12);
    ramp.mesh.quaternion.copy(ramp.body.quaternion);

    // Elevated Platform & Checkpoint
    createPlatform(0, 5, -90, 10, 2, 30);
    createCheckpoint(0, 7, -80);
    createCoin(0, 6.5, -85);

    // Narrow bridge
    createPlatform(0, 5, -120, 2, 2, 30, 0xFF9800);
    createCoin(0, 6.5, -115);
    createCoin(0, 6.5, -120);
    createCoin(0, 6.5, -125);

    // Hammer Trap area
    createPlatform(0, 5, -160, 14, 2, 50);
    createHammer(0, 6.5, -145);
    createHammer(0, 6.5, -160);
    createHammer(0, 6.5, -175);

    // Drop down to finish
    createPlatform(0, -5, -200, 15, 2, 20, 0x2196F3);
    createCoin(0, -3.5, -195);
    createCoin(0, -3.5, -200);
    createCoin(0, -3.5, -205);
    
    // Finish Line
    const finishGeo = new THREE.BoxGeometry(15, 1, 5);
    const finishMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const finishMesh = new THREE.Mesh(finishGeo, finishMat);
    finishMesh.position.set(0, -4.5, -215);
    scene.add(finishMesh);
    
    // Finish trigger object (no physics body, just logical trigger)
    checkpoints.push({ isFinish: true, pos: new THREE.Vector3(0, -4, -215) });
}

// --- Inputs ---
function setupInputs() {
    // Keyboard
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = true;
    });
    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = false;
    });

    // Touch (Mobile Steering)
    window.addEventListener('touchstart', (e) => {
        if (gameState !== 'PLAYING') return;
        touchInput.active = true;
        touchInput.originX = e.touches[0].clientX;
        touchInput.originY = e.touches[0].clientY;
        touchInput.x = 0;
        touchInput.y = 0;
    }, {passive: false});

    window.addEventListener('touchmove', (e) => {
        if (!touchInput.active || gameState !== 'PLAYING') return;
        const deltaX = e.touches[0].clientX - touchInput.originX;
        const deltaY = e.touches[0].clientY - touchInput.originY;
        // Normalize touch input
        touchInput.x = Math.max(-1, Math.min(1, deltaX / 50));
        touchInput.y = Math.max(-1, Math.min(1, deltaY / 50));
    }, {passive: false});

    window.addEventListener('touchend', () => {
        touchInput.active = false;
        touchInput.x = 0;
        touchInput.y = 0;
    });
}

function handleMovement() {
    if (gameState !== 'PLAYING') return;

    const force = 15;
    let fx = 0;
    let fz = 0;

    // Keyboard
    if (keys.w || keys.ArrowUp) fz -= force;
    if (keys.s || keys.ArrowDown) fz += force;
    if (keys.a || keys.ArrowLeft) fx -= force;
    if (keys.d || keys.ArrowRight) fx += force;

    // Touch
    if (touchInput.active) {
        fx += touchInput.x * force;
        fz += touchInput.y * force; // pull down to brake, push up to move forward
    }

    // Apply force to physics body
    playerBody.applyForce(new CANNON.Vec3(fx, 0, fz), playerBody.position);
}

// --- Visual Effects ---
function spawnParticles(pos) {
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xFFD700 });
    
    for(let i=0; i<8; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        scene.add(mesh);
        particles.push({
            mesh: mesh,
            life: 1.0,
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 5,
                Math.random() * 5,
                (Math.random() - 0.5) * 5
            )
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt * 2;
        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        } else {
            p.mesh.position.addScaledVector(p.velocity, dt);
            p.mesh.rotation.x += dt * 5;
            p.mesh.rotation.y += dt * 5;
            p.mesh.scale.setScalar(p.life);
        }
    }
}

// --- Main Game Logic ---
function checkTriggers() {
    const pos = playerMesh.position;

    // 1. Coins
    coins.forEach(coin => {
        if (coin.active && pos.distanceTo(coin.mesh.position) < 1.5) {
            coin.active = false;
            scene.remove(coin.mesh);
            coinsCollected++;
            score += 10;
            scoreEl.innerText = score;
            spawnParticles(coin.mesh.position);
        }
    });

    // 2. Checkpoints & Finish Line
    checkpoints.forEach((cp, index) => {
        if (cp.isFinish) {
            if (pos.distanceTo(cp.pos) < 5) {
                gameWin();
            }
        } else if (pos.distanceTo(cp) < 3) {
            // Update checkpoint
            checkpointPos.copy(cp);
            checkpointPos.y += 2; // spawn slightly above
            checkpoints.splice(index, 1); // remove once hit
        }
    });

    // 3. Fall Death
    if (pos.y < -15) {
        gameOver();
    }
}

function updateMovingObstacles(time) {
    movingObstacles.forEach(obs => {
        if (obs.type === 'hammer') {
            // Swing side to side
            obs.body.position.x = obs.startX + Math.sin(time * 3 + obs.time) * 4;
        } else if (obs.type === 'spinner') {
            // Rotate continuously
            obs.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), time * 2);
        }
        
        // Sync visuals
        obs.mesh.position.copy(obs.body.position);
        obs.mesh.quaternion.copy(obs.body.quaternion);
    });
}

function updateCamera() {
    // Smooth follow camera with slight lag
    const targetPos = playerMesh.position.clone();
    targetPos.y += 6;
    targetPos.z += 12; // Behind the ball
    
    camera.position.lerp(targetPos, 0.1);
    
    // Look slightly ahead of the ball
    const lookTarget = playerMesh.position.clone();
    lookTarget.z -= 5;
    camera.lookAt(lookTarget);
}

// --- Game Loop ---
function tick() {
    requestAnimationFrame(tick);

    const time = performance.now();
    const dt = (time - lastTime) / 1000;
    lastTime = time;

    if (gameState === 'PLAYING') {
        // Physics Step
        world.step(1/60, dt, 3);

        // Inputs
        handleMovement();

        // Sync Player Mesh
        playerMesh.position.copy(playerBody.position);
        playerMesh.quaternion.copy(playerBody.quaternion);

        // Update Distance
        distance = Math.max(0, Math.floor(-playerMesh.position.z));
        distanceEl.innerText = distance;

        // Animate Coins
        coins.forEach(c => {
            if(c.active) c.mesh.rotation.y += dt * 3;
        });

        updateMovingObstacles(time / 1000);
        checkTriggers();
        updateParticles(dt);
        updateCamera();
    }
    
    renderer.render(scene, camera);
}

// --- UI & State Management ---
function setupUIEvents() {
    document.getElementById('start-btn').addEventListener('click', () => {
        startMenu.classList.add('hidden');
        hud.classList.remove('hidden');
        gameState = 'PLAYING';
    });

    document.getElementById('pause-btn').addEventListener('click', () => {
        gameState = 'PAUSED';
        pauseMenu.classList.remove('hidden');
    });

    document.getElementById('resume-btn').addEventListener('click', () => {
        pauseMenu.classList.add('hidden');
        lastTime = performance.now(); // Prevent large physics delta
        gameState = 'PLAYING';
    });

    document.getElementById('restart-btn').addEventListener('click', () => {
        pauseMenu.classList.add('hidden');
        respawn();
    });

    document.getElementById('respawn-btn').addEventListener('click', () => {
        gameOverMenu.classList.add('hidden');
        respawn();
    });

    document.getElementById('play-again-btn').addEventListener('click', () => {
        location.reload(); // Simple full reset
    });
}

function gameOver() {
    gameState = 'GAMEOVER';
    gameOverMenu.classList.remove('hidden');
}

function gameWin() {
    gameState = 'WIN';
    hud.classList.add('hidden');
    finalScoreEl.innerText = score + distance;
    winMenu.classList.remove('hidden');
}

function respawn() {
    // Reset ball to checkpoint
    playerBody.position.copy(checkpointPos);
    playerBody.velocity.set(0,0,0);
    playerBody.angularVelocity.set(0,0,0);
    
    playerMesh.position.copy(checkpointPos);
    
    // Snap camera immediately
    camera.position.set(checkpointPos.x, checkpointPos.y + 6, checkpointPos.z + 12);
    
    lastTime = performance.now();
    gameState = 'PLAYING';
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Kickoff
init();
