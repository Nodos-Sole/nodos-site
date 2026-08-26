// <balcony-viewer> 한국 아파트 베란다에 미니태양광(300W 모듈)을 붙여보는 3D 뷰.
// 드래그로 시점 회전, ＋/− 로 모듈 수, 시간 슬라이더로 해의 위치와 그 시각 출력이 바뀜.
(() => {
  const THREE_URL = 'https://esm.sh/three@0.160.0';
  const PER_PANEL_W = 300;
  const MAX = 3;
  const SYSTEM_DERATE = 0.86; // 인버터·배선·온도 손실을 뭉뚱그린 계수

  // 유리 투과율. 단판 값만 출처가 있고 나머지는 추정.
  // 단판 3mm 투명유리: 투과 86 / 반사 8 / 흡수 6 (%)
  // 복층: 유리면 4개 반사 15~16% + 유리 2장 흡수 → 대략 75%
  // 로이 복층: 코팅에 따라 편차가 크다. 가운데값으로 50% 잡음
  const GLASS = {
    none:   { f: 1.00, label: '유리 없음',     en: 'no glass' },
    single: { f: 0.86, label: '단판 유리',     en: 'single pane' },
    double: { f: 0.75, label: '복층유리',      en: 'double glazing' },
    lowe:   { f: 0.50, label: '로이 복층유리', en: 'low-E double glazing' }
  };

  // 한국어와 영어 문구. lang="en" 을 주면 영어로 뜬다
  const T = {
    ko: {
      minus: '모듈 줄이기', plus: '모듈 늘리기',
      outside: '난간 바깥에 걸기', inside: '창문 안쪽에 놓기',
      read: (n, kw, w) => `모듈 <b>${n}</b>장 · <b>${kw}</b> kW · 지금 <b>${w}</b> W`,
      glassLabel: '유리', timeAria: '시각',
      opts: ['단판 유리 (투과 86%)', '복층유리 (투과 75%, 추정)', '로이 복층유리 (투과 50%, 추정)'],
      src: '단판 3mm 투명유리의 투과 86퍼센트만 출처가 있는 값입니다. 복층과 로이는 추정이라 실제와 다를 수 있습니다. 난간 가림은 이 그림의 치수로 계산한 값입니다.',
      blocked: '지금은 <span class="warn">난간벽에 가려서 0 W</span> 입니다. 해가 더 높이 올라와야 빛이 패널에 닿습니다.',
      insideMsg: (g, clear, out, lost, pct) =>
        `창문 안쪽이라 <b>${g}</b> 한 겹을 통과합니다. 난간 바깥에 걸었으면 <b>${clear} W</b> 였을 것이 <b>${out} W</b> 로 떨어집니다. <span class="warn">${lost} W 손해, 약 ${pct}퍼센트</span> 입니다.`,
      outsideMsg: '난간 바깥이라 유리를 통과하지 않습니다. 위 버튼으로 창문 안쪽에 놓아보면 얼마나 손해인지 보입니다.'
    },
    en: {
      minus: 'fewer modules', plus: 'more modules',
      outside: 'Outside the railing', inside: 'Inside the window',
      read: (n, kw, w) => `<b>${n}</b> modules · <b>${kw}</b> kW · <b>${w}</b> W right now`,
      glassLabel: 'Glass', timeAria: 'time of day',
      opts: ['Single pane (86% through)', 'Double glazing (75%, estimated)', 'Low-E double (50%, estimated)'],
      src: 'Only the 86% figure for 3mm clear single-pane glass has a source. The double and low-E numbers are estimates and may be off. The railing shading is computed from the dimensions in this drawing.',
      blocked: 'Right now the parapet wall blocks the sun completely: <span class="warn">0 W</span>. The sun has to climb higher before any light reaches the panel.',
      insideMsg: (g, clear, out, lost, pct) =>
        `Inside the window, the light passes through <b>${g}</b>. Hung outside the railing this would be <b>${clear} W</b>. Behind the glass it drops to <b>${out} W</b>. <span class="warn">You lose ${lost} W, about ${pct}%</span>.`,
      outsideMsg: 'Outside the railing, nothing blocks the light. Press the other button to see what a single pane of glass costs you.'
    }
  };

  class BalconyViewer extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      this.style.display = 'block';
      const lang = (this.getAttribute('lang') || 'ko').toLowerCase().startsWith('en') ? 'en' : 'ko';
      const t = (this._t = T[lang]);
      this._lang = lang;
      const root = (this._root = this.attachShadow({ mode: 'open' }));
      root.innerHTML = `
        <style>
          :host { display: block; }
          * { box-sizing: border-box; font-family: inherit; }
          .stage { width: 100%; height: 340px; cursor: grab; touch-action: none; }
          @media (max-width: 520px) { .stage { height: 260px; } }
          .bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 14px 0 0; }
          .step { display: flex; align-items: center; gap: 1px; background: #e4e5df; border: 1px solid #e4e5df; border-radius: 4px; overflow: hidden; }
          .step button { width: 38px; height: 38px; border: 0; background: #fbfbf8; font-size: 18px; line-height: 1; cursor: pointer; color: #101418; }
          .step button:hover { background: #ffd12e; }
          .read { margin: 0; font-size: 14px; color: #43484d; }
          .read b { font-weight: 600; }
          .time { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 210px; }
          .time span { font-size: 13px; color: #6b706d; white-space: nowrap; }
          input[type=range] { flex: 1; min-width: 110px; accent-color: #ffd12e; }

          .where { display: flex; width: 100%; border: 1px solid #e4e5df; border-radius: 4px; overflow: hidden; }
          .where button { flex: 1; padding: 11px 10px; border: 0; background: #fbfbf8; font-size: 13.5px; font-weight: 600; cursor: pointer; color: #6b706d; }
          .where button[aria-pressed="true"] { background: #101418; color: #fbfbf8; }
          .glassrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: 100%; }
          .glassrow label { font-size: 13px; color: #6b706d; white-space: nowrap; }
          select { font: inherit; font-size: 13.5px; padding: 8px 10px; border: 1px solid #e4e5df; border-radius: 4px; background: #fbfbf8; color: #101418; }
          select:disabled { opacity: .4; }
          .verdict { margin: 0; width: 100%; font-size: 13.5px; line-height: 1.7; color: #43484d; padding: 12px 14px; background: #fbfbf8; border-left: 3px solid #ffd12e; }
          .verdict b { font-weight: 600; }
          .verdict .warn { color: #93551c; font-weight: 600; }
          .src { margin: 0; width: 100%; font-size: 11.5px; line-height: 1.7; color: #6b706d; }
        </style>
        <div class="stage"></div>
        <div class="bar">
          <div class="where">
            <button data-where="outside" type="button" aria-pressed="true">${t.outside}</button>
            <button data-where="inside" type="button" aria-pressed="false">${t.inside}</button>
          </div>
          <div class="step">
            <button data-minus type="button" aria-label="${t.minus}">−</button>
            <button data-plus type="button" aria-label="${t.plus}">+</button>
          </div>
          <p class="read" data-read>${t.read('2', '0.6', '0')}</p>
          <label class="time"><span data-clock>13:00</span><input data-time type="range" min="6" max="20" step="0.1" value="13" aria-label="${t.timeAria}"></label>
          <div class="glassrow">
            <label for="g">${t.glassLabel}</label>
            <select id="g" data-glass disabled>
              <option value="single">${t.opts[0]}</option>
              <option value="double" selected>${t.opts[1]}</option>
              <option value="lowe">${t.opts[2]}</option>
            </select>
          </div>
          <p class="verdict" data-verdict></p>
          <p class="src">${t.src}</p>
        </div>`;
      this._stage = root.querySelector('.stage');
      root.querySelector('[data-plus]').addEventListener('click', () => this.setCount(this._count + 1));
      root.querySelector('[data-minus]').addEventListener('click', () => this.setCount(this._count - 1));
      this._slider = root.querySelector('[data-time]');
      this._slider.addEventListener('pointerdown', () => (this._manual = true));
      this._slider.addEventListener('input', () => { this._manual = true; this._hour = +this._slider.value; });
      this._glassSel = root.querySelector('[data-glass]');
      this._glassSel.addEventListener('change', () => (this._glass = this._glassSel.value));
      root.querySelectorAll('[data-where]').forEach((b) =>
        b.addEventListener('click', () => this.setWhere(b.dataset.where))
      );
      this._count = 2;
      this._hour = 13;
      this._manual = false;
      this._where = 'outside';
      this._glass = 'double';
      this.init().catch((e) => console.warn('balcony-viewer', e));
    }

    setWhere(where) {
      this._where = where;
      this._root.querySelectorAll('[data-where]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.where === where))
      );
      this._glassSel.disabled = where !== 'inside';
      if (this._layout) this._layout();
    }

    disconnectedCallback() {
      this._stop = true;
      if (this._ro) this._ro.disconnect();
      if (this._renderer) this._renderer.dispose();
    }

    setCount(n) {
      n = Math.max(1, Math.min(MAX, n));
      this._count = n;
      const kw = ((n * PER_PANEL_W) / 1000).toFixed(1);
      const now = this._root.querySelector('[data-now]');
      this._root.querySelector('[data-read]').innerHTML =
        this._t.read(String(n), kw, now ? now.textContent : '0');
      if (this._panels) this._panels.forEach((p, i) => { p.visible = i < n; });
    }

    async init() {
      const THREE = await import(THREE_URL);
      const stage = this._stage;
      const w = () => stage.clientWidth || 600;
      const h = () => stage.clientHeight || 320;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(w(), h());
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.style.display = 'block';
      stage.appendChild(renderer.domElement);
      this._renderer = renderer;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, w() / h(), 0.1, 200);
      camera.position.set(7.4, 4.9, 8.6);
      camera.lookAt(0, 3.5, 0.8);

      scene.add(new THREE.HemisphereLight(0xffffff, 0xdedcd2, 0.9));
      const sun = new THREE.DirectionalLight(0xfff2ce, 1.35);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const sc = sun.shadow.camera;
      sc.left = sc.bottom = -9; sc.right = sc.top = 9; sc.near = 0.5; sc.far = 40;
      scene.add(sun);
      const sunMark = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0xffd12e })
      );
      scene.add(sunMark);

      const world = new THREE.Group();
      scene.add(world);
      this._world = world;

      const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
      const wall = M(0xe7e4db);
      const slabMat = M(0xdedbd0);
      const trimMat = M(0xf2f0e9);

      // 건물 외벽 (한 개 라인)
      const facade = new THREE.Mesh(new THREE.BoxGeometry(11, 13, 0.4), wall);
      facade.position.set(0, 5.2, -0.2);
      facade.receiveShadow = true;
      world.add(facade);

      // 세대 하나 만들기 (y = 슬래브 상단)
      const unit = (y, focal) => {
        const g = new THREE.Group();
        g.position.y = y;

        const slab = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.22, 1.75), slabMat);
        slab.position.set(0, -0.11, 0.87);
        slab.castShadow = slab.receiveShadow = true;
        g.add(slab);

        // 난간벽 (콘크리트 파라펫)
        const para = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.02, 0.16), trimMat);
        para.position.set(0, 0.51, 1.67);
        para.castShadow = para.receiveShadow = true;
        g.add(para);

        // 난간 위 유리 + 손잡이
        const glass = new THREE.Mesh(
          new THREE.BoxGeometry(5.2, 0.42, 0.03),
          new THREE.MeshStandardMaterial({ color: 0xc9d6d8, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.55 })
        );
        glass.position.set(0, 1.24, 1.67);
        g.add(glass);
        const rail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 5.3, 12),
          M(0xa9aca6, { metalness: 0.4, roughness: 0.4 })
        );
        rail.rotation.z = Math.PI / 2;
        rail.position.set(0, 1.47, 1.67);
        g.add(rail);

        // 거실 새시 (창 3짝)
        const frame = M(0xf7f6f1);
        const paneMat = new THREE.MeshStandardMaterial({
          color: focal ? 0x9fb6bd : 0x8ea3aa, roughness: 0.15, metalness: 0.25
        });
        for (let i = -1; i <= 1; i++) {
          const f = new THREE.Mesh(new THREE.BoxGeometry(1.62, 2.2, 0.09), frame);
          f.position.set(i * 1.66, 1.1, 0.05);
          g.add(f);
          const p = new THREE.Mesh(new THREE.BoxGeometry(1.44, 2.02, 0.04), paneMat);
          p.position.set(i * 1.66, 1.1, 0.12);
          g.add(p);
        }
        return g;
      };

      const lower = unit(0.4, false);
      const ours = unit(3.4, true);
      const upper = unit(6.4, false);
      world.add(lower, ours, upper);
      // 아래 세대에는 실외기 하나. 실제 베란다 풍경
      const ac = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 0.42), M(0xd9d7cd));
      ac.position.set(1.7, 0.72, 1.1);
      ac.castShadow = true;
      lower.add(ac);

      // 우리 집 모듈. 놓는 자리는 아래 _layout 에서 정함
      const panelGlass = new THREE.MeshStandardMaterial({ color: 0x18293a, roughness: 0.25, metalness: 0.4 });
      const panelFrame = M(0xb8bbb4, { metalness: 0.5, roughness: 0.4 });
      const bracketMat = M(0x8e918b, { metalness: 0.5, roughness: 0.5 });
      const panels = [];
      const pw = 1.52, ph = 0.92;
      for (let i = 0; i < MAX; i++) {
        const g = new THREE.Group();
        const f = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.05), panelFrame);
        const gl = new THREE.Mesh(new THREE.BoxGeometry(pw - 0.09, ph - 0.09, 0.06), panelGlass);
        gl.position.z = 0.015;
        f.castShadow = true;
        g.add(f, gl);
        for (const sx of [-0.5, 0.5]) {
          const br = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), bracketMat);
          br.position.set(sx * pw * 0.7, -ph * 0.32, -0.16);
          g.add(br);
        }
        ours.add(g);
        panels.push(g);
      }
      this._panels = panels;

      // 창문 안쪽 모드에서만 보이는 베란다 창. 난간 위로 올라오는 유리
      const sash = new THREE.Mesh(
        new THREE.BoxGeometry(5.2, 1.5, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xbcd0d4, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.42 })
      );
      sash.position.set(0, 1.79, 1.67);
      sash.visible = false;
      ours.add(sash);

      // 두 가지 놓는 자리.
      // 난간 바깥 = 브래킷으로 걸고 14도만 기울임
      // 창문 안쪽 = 창턱 위에 세우고 35도. 유리 한 겹을 통과하게 됨
      const SPOT = {
        outside: { y: 0.50, z: 1.86, tilt: 14 },
        inside:  { y: 1.05, z: 1.45, tilt: 35 }
      };
      const PARAPET_TOP = 1.02;   // 난간벽 윗면 높이
      const PARAPET_Z = 1.59;     // 난간벽 안쪽면

      this._layout = () => {
        const s = SPOT[this._where];
        const rad = THREE.MathUtils.degToRad(s.tilt);
        panels.forEach((g, i) => {
          g.position.set((i - 1) * (pw + 0.1), s.y, s.z);
          g.rotation.x = -rad;
        });
        sash.visible = this._where === 'inside';
        this._panelNormal = new THREE.Vector3(0, Math.sin(rad), Math.cos(rad));
        this._spot = s;
      };
      this._parapet = { top: PARAPET_TOP, z: PARAPET_Z };
      this._layout();
      this.setCount(this._count);

      // 드래그로 시점 회전 (정면 파사드라 좌우로만 조금)
      let dragging = false, lastX = 0;
      const el = renderer.domElement;
      const clampYaw = (v) => Math.max(-0.62, Math.min(0.42, v));
      el.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; stage.style.cursor = 'grabbing'; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX; lastX = e.clientX;
        world.rotation.y = clampYaw(world.rotation.y + dx * 0.006);
      });
      const end = () => { dragging = false; stage.style.cursor = 'grab'; };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);

      this._ro = new ResizeObserver(() => {
        renderer.setSize(w(), h());
        camera.aspect = w() / h();
        camera.updateProjectionMatrix();
      });
      this._ro.observe(stage);

      const clockEl = this._root.querySelector('[data-clock]');
      const nowEl = this._root.querySelector('[data-now]');
      const readEl = this._root.querySelector('[data-read]');
      const verdictEl = this._root.querySelector('[data-verdict]');
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const sunDir = new THREE.Vector3();
      let last = performance.now();

      const tick = (now) => {
        if (this._stop) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!this._manual && !reduce) {
          this._hour += dt * 0.6;
          if (this._hour > 20) this._hour = 6;
          this._slider.value = String(this._hour);
        }
        const hr = this._hour;
        // 6시 동쪽 → 13시 남중 → 20시 서쪽
        const t = (hr - 6) / 14;
        const az = (t - 0.5) * Math.PI * 1.06;
        const alt = Math.max(0.02, Math.sin(t * Math.PI)) * 0.95;
        sunDir.set(Math.sin(az) * 1.0, Math.max(0.05, alt), Math.cos(az) * 0.85).normalize();
        sun.position.copy(sunDir).multiplyScalar(16);
        sun.target.position.set(0, 3.4, 0.9);
        sun.target.updateMatrixWorld();
        sun.intensity = 0.5 + alt * 1.2;
        sunMark.position.copy(sunDir).multiplyScalar(11).add(new THREE.Vector3(0, 2, 0));

        const nrm = this._panelNormal.clone().applyEuler(world.rotation);
        const cos = Math.max(0, nrm.dot(sunDir));

        // 난간벽이 해를 가리는지. 패널에서 해 쪽으로 나간 빛이 난간 윗면을 넘는가
        let blocked = false;
        if (cos > 0) {
          if (sunDir.z <= 0.001) {
            blocked = true; // 해가 건물 뒤편
          } else {
            const t = (this._parapet.z - this._spot.z) / sunDir.z;
            if (t > 0 && this._spot.y + t * sunDir.y < this._parapet.top) blocked = true;
          }
        }

        const base = this._count * PER_PANEL_W * cos * SYSTEM_DERATE;
        const clear = blocked ? 0 : base;                              // 유리를 안 거쳤을 때
        const glass = this._where === 'inside' ? GLASS[this._glass] : GLASS.none;
        const out = Math.round(clear * glass.f);

        const hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60);
        clockEl.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        if (nowEl) nowEl.textContent = String(out);
        readEl.innerHTML = this._t.read(String(this._count), ((this._count * PER_PANEL_W) / 1000).toFixed(1), String(out));

        // 아래 한 줄 판정. 창문 안쪽일 때는 난간 바깥과 얼마나 차이나는지 같이 보여줌
        const T2 = this._t;
        if (blocked) {
          verdictEl.innerHTML = T2.blocked;
        } else if (this._where === 'inside') {
          const lost = Math.round(clear - out);
          const pct = clear > 0 ? Math.round((1 - glass.f) * 100) : 0;
          const gname = this._lang === 'en' ? glass.en : glass.label;
          verdictEl.innerHTML = T2.insideMsg(gname, Math.round(clear), out, lost, pct);
        } else {
          verdictEl.innerHTML = T2.outsideMsg;
        }

        renderer.render(scene, camera);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  if (!customElements.get('balcony-viewer')) customElements.define('balcony-viewer', BalconyViewer);
})();
